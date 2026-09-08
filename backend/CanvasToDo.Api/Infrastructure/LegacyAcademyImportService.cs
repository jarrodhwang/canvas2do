using CanvasToDo.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using System.Buffers.Binary;
using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace CanvasToDo.Api.Infrastructure;

public sealed class LegacyAcademyImportService(
    AuthDbContext db,
    ILogger<LegacyAcademyImportService> logger)
{
    private const string AcademyAccountDomain = "academy.local";
    private const string BindingLoginProvider = "CanvasToDo.LegacyAcademyImport";
    private const string BindingTokenName = "LegacyAcademyAccountId";
    private const string PasswordAlgorithm = "pbkdf2-sha256";
    private const int PasswordHashIterations = 210_000;
    private const int PasswordSaltSizeBytes = 16;
    private const int PasswordHashSizeBytes = 32;
    private const int MaximumLoginIdCharacters = 64;
    private const int MaximumPasswordCharacters = 256;
    private const int MaximumStoredHashCharacters = 128;
    private const int MaximumTransactionAttempts = 3;
    private static readonly TimeSpan PasswordVerificationWaitTimeout = TimeSpan.FromSeconds(3);
    private static readonly SemaphoreSlim PasswordVerificationConcurrencyGate = new(4, 4);
    private const string DummyPasswordHash =
        "pbkdf2-sha256:210000:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    private static readonly string[] EligibleSettingKeys =
    [
        "canvas.token",
        "academy.preferences",
    ];

    public async Task<LegacyAcademyImportResult> ImportAsync(
        Guid userId,
        string? loginId,
        string? password,
        CancellationToken cancellationToken)
    {
        var normalizedLoginId = NormalizeLoginId(loginId);

        if (!IsValidLoginId(normalizedLoginId) ||
            string.IsNullOrEmpty(password) ||
            password.Length > MaximumPasswordCharacters)
        {
            return LegacyAcademyImportResult.InvalidCredentials();
        }

        // PBKDF2 is intentionally expensive. Admit only a small number of imports
        // before opening a transaction so many authenticated accounts cannot tie up
        // the database pool and CPU at the same time.
        if (!await PasswordVerificationConcurrencyGate.WaitAsync(
                PasswordVerificationWaitTimeout,
                cancellationToken))
        {
            logger.LogWarning(
                "Legacy Academy import capacity is full for auth user {UserId}.",
                userId);
            return LegacyAcademyImportResult.Busy();
        }

        try
        {
            for (var attempt = 1; attempt <= MaximumTransactionAttempts; attempt++)
            {
                try
                {
                    return await ImportOnceAsync(
                        userId,
                        normalizedLoginId,
                        password,
                        cancellationToken);
                }
                catch (PostgresException exception) when (IsRetryableConcurrencyFailure(exception))
                {
                    // A same-user/different-source race can still meet the token primary key.
                    // Retry after the winning transaction commits, then report its binding.
                    db.ChangeTracker.Clear();

                    if (attempt == MaximumTransactionAttempts)
                    {
                        logger.LogWarning(
                            "Legacy Academy import hit repeated concurrent claims for auth user {UserId}.",
                            userId);
                        return LegacyAcademyImportResult.Conflict();
                    }
                }
                catch (PostgresException exception) when (
                    exception.SqlState == PostgresErrorCodes.UndefinedTable)
                {
                    logger.LogWarning(
                        "Legacy Academy import storage is unavailable for auth user {UserId}.",
                        userId);
                    return LegacyAcademyImportResult.Unavailable();
                }
            }

            return LegacyAcademyImportResult.Conflict();
        }
        finally
        {
            PasswordVerificationConcurrencyGate.Release();
        }
    }

    private async Task<LegacyAcademyImportResult> ImportOnceAsync(
        Guid userId,
        string normalizedLoginId,
        string password,
        CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);
        var databaseTransaction = transaction.GetDbTransaction();
        var connection = databaseTransaction.Connection ??
            throw new InvalidOperationException("The legacy import transaction has no database connection.");
        var legacyAccount = await ReadLegacyAccountAsync(
            connection,
            databaseTransaction,
            normalizedLoginId,
            cancellationToken);

        if (legacyAccount is null)
        {
            // Keep a syntactically valid but unknown ID on the same bounded PBKDF2 path.
            VerifyLegacyPassword(password, DummyPasswordHash);
            return LegacyAcademyImportResult.InvalidCredentials();
        }

        if (!VerifyLegacyPassword(password, legacyAccount.PasswordHash))
        {
            return LegacyAcademyImportResult.InvalidCredentials();
        }

        if (!string.Equals(
                legacyAccount.Status?.Trim(),
                "active",
                StringComparison.OrdinalIgnoreCase))
        {
            return LegacyAcademyImportResult.LegacyAccountInactive();
        }

        await AcquireLegacyAccountLockAsync(
            connection,
            databaseTransaction,
            legacyAccount.Id,
            cancellationToken);

        var legacyAccountId = legacyAccount.Id.ToString("D", CultureInfo.InvariantCulture);
        var bindings = await ReadBindingsAsync(
            connection,
            databaseTransaction,
            userId,
            legacyAccountId,
            cancellationToken);
        var currentUserBinding = bindings.FirstOrDefault(binding => binding.UserId == userId);

        if (currentUserBinding is not null &&
            !string.Equals(currentUserBinding.Value, legacyAccountId, StringComparison.Ordinal))
        {
            return LegacyAcademyImportResult.CurrentIdentityAlreadyLinked();
        }

        if (bindings.Any(binding =>
                binding.UserId != userId &&
                string.Equals(binding.Value, legacyAccountId, StringComparison.Ordinal)))
        {
            return LegacyAcademyImportResult.LegacyAccountAlreadyLinked();
        }

        var alreadyLinked = currentUserBinding is not null;

        if (!alreadyLinked)
        {
            await InsertBindingAsync(
                connection,
                databaseTransaction,
                userId,
                legacyAccountId,
                cancellationToken);
        }

        var importedSettingKeys = await CopyEligibleSettingsAsync(
            connection,
            databaseTransaction,
            normalizedLoginId,
            userId,
            cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        logger.LogInformation(
            "Legacy Academy data import completed for auth user {UserId}; {ImportedSettingCount} settings copied.",
            userId,
            importedSettingKeys.Count);

        return LegacyAcademyImportResult.Succeeded(alreadyLinked, [.. importedSettingKeys]);
    }

    private static async Task<LegacyAccount?> ReadLegacyAccountAsync(
        DbConnection connection,
        DbTransaction transaction,
        string normalizedLoginId,
        CancellationToken cancellationToken)
    {
        await using var command = CreateCommand(
            connection,
            transaction,
            """
            SELECT account."Id", account."PasswordHash", legacy_user."Status"
            FROM academy_credential_accounts AS account
            INNER JOIN admin_users AS legacy_user ON legacy_user."Id" = account."AdminUserId"
            WHERE account."LoginId" = @login_id
              AND char_length(account."PasswordHash") BETWEEN 1 AND @maximum_hash_length
            LIMIT 2
            FOR SHARE OF account, legacy_user;
            """);
        AddParameter(command, "login_id", normalizedLoginId);
        AddParameter(command, "maximum_hash_length", MaximumStoredHashCharacters);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var result = new LegacyAccount(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2));

        // The legacy schema has a unique LoginId index. Fail closed if the source
        // was manually corrupted rather than choosing an arbitrary account.
        return await reader.ReadAsync(cancellationToken) ? null : result;
    }

    private static async Task AcquireLegacyAccountLockAsync(
        DbConnection connection,
        DbTransaction transaction,
        Guid legacyAccountId,
        CancellationToken cancellationToken)
    {
        Span<byte> accountIdBytes = stackalloc byte[16];
        legacyAccountId.TryWriteBytes(accountIdBytes);
        var lockKey = BinaryPrimitives.ReadInt64LittleEndian(accountIdBytes);

        await using var command = CreateCommand(
            connection,
            transaction,
            "SELECT pg_advisory_xact_lock(@binding_lock_key);");
        AddParameter(command, "binding_lock_key", lockKey);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<List<LegacyBinding>> ReadBindingsAsync(
        DbConnection connection,
        DbTransaction transaction,
        Guid userId,
        string legacyAccountId,
        CancellationToken cancellationToken)
    {
        await using var command = CreateCommand(
            connection,
            transaction,
            """
            SELECT "UserId", "Value"
            FROM auth_user_tokens
            WHERE "LoginProvider" = @login_provider
              AND "Name" = @token_name
              AND ("UserId" = @user_id OR "Value" = @legacy_account_id)
            FOR UPDATE;
            """);
        AddParameter(command, "login_provider", BindingLoginProvider);
        AddParameter(command, "token_name", BindingTokenName);
        AddParameter(command, "user_id", userId);
        AddParameter(command, "legacy_account_id", legacyAccountId);

        var bindings = new List<LegacyBinding>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            bindings.Add(new LegacyBinding(
                reader.GetGuid(0),
                reader.IsDBNull(1) ? null : reader.GetString(1)));
        }

        return bindings;
    }

    private static async Task InsertBindingAsync(
        DbConnection connection,
        DbTransaction transaction,
        Guid userId,
        string legacyAccountId,
        CancellationToken cancellationToken)
    {
        await using var command = CreateCommand(
            connection,
            transaction,
            """
            INSERT INTO auth_user_tokens ("UserId", "LoginProvider", "Name", "Value")
            VALUES (@user_id, @login_provider, @token_name, @legacy_account_id);
            """);
        AddParameter(command, "user_id", userId);
        AddParameter(command, "login_provider", BindingLoginProvider);
        AddParameter(command, "token_name", BindingTokenName);
        AddParameter(command, "legacy_account_id", legacyAccountId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<List<string>> CopyEligibleSettingsAsync(
        DbConnection connection,
        DbTransaction transaction,
        string normalizedLoginId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var sourceKey = $"{normalizedLoginId}@{AcademyAccountDomain}";
        var destinationKey = UserOwnerKeys.FromId(userId);
        var importedSettingKeys = new List<string>(EligibleSettingKeys.Length);

        foreach (var settingKey in EligibleSettingKeys)
        {
            await using var command = CreateCommand(
                connection,
                transaction,
                """
                INSERT INTO user_settings
                    ("Id", "CreatedAt", "UpdatedAt", "UserKey", "SettingKey", "SettingJson")
                SELECT
                    @destination_id,
                    source."CreatedAt",
                    @updated_at,
                    @destination_key,
                    source."SettingKey",
                    source."SettingJson"
                FROM user_settings AS source
                WHERE source."UserKey" = @source_key
                  AND source."SettingKey" = @setting_key
                ON CONFLICT ("UserKey", "SettingKey") DO NOTHING;
                """);
            AddParameter(command, "destination_id", Guid.NewGuid());
            AddParameter(command, "updated_at", DateTimeOffset.UtcNow);
            AddParameter(command, "destination_key", destinationKey);
            AddParameter(command, "source_key", sourceKey);
            AddParameter(command, "setting_key", settingKey);

            if (await command.ExecuteNonQueryAsync(cancellationToken) == 1)
            {
                importedSettingKeys.Add(settingKey);
            }
        }

        // No source row is updated or deleted. A destination value always wins,
        // so importing cannot silently replace data created under the new account.
        return importedSettingKeys;
    }

    private static DbCommand CreateCommand(
        DbConnection connection,
        DbTransaction transaction,
        string commandText)
    {
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = commandText;
        return command;
    }

    private static void AddParameter(DbCommand command, string name, object value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }

    internal static bool VerifyLegacyPassword(string password, string storedHash)
    {
        if (password.Length > MaximumPasswordCharacters ||
            string.IsNullOrEmpty(storedHash) ||
            storedHash.Length > MaximumStoredHashCharacters)
        {
            return false;
        }

        var parts = storedHash.Split(':', StringSplitOptions.None);

        if (parts.Length != 4 ||
            !string.Equals(parts[0], PasswordAlgorithm, StringComparison.Ordinal) ||
            !string.Equals(
                parts[1],
                PasswordHashIterations.ToString(CultureInfo.InvariantCulture),
                StringComparison.Ordinal))
        {
            return false;
        }

        if (!TryDecodeCanonicalBase64(parts[2], PasswordSaltSizeBytes, out var salt))
        {
            return false;
        }

        if (!TryDecodeCanonicalBase64(parts[3], PasswordHashSizeBytes, out var expectedHash))
        {
            CryptographicOperations.ZeroMemory(salt);
            return false;
        }

        var passwordBytes = Encoding.UTF8.GetBytes(password);
        var actualHash = new byte[PasswordHashSizeBytes];

        try
        {
            Rfc2898DeriveBytes.Pbkdf2(
                passwordBytes,
                salt,
                actualHash,
                PasswordHashIterations,
                HashAlgorithmName.SHA256);
            return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(passwordBytes);
            CryptographicOperations.ZeroMemory(actualHash);
            CryptographicOperations.ZeroMemory(salt);
            CryptographicOperations.ZeroMemory(expectedHash);
        }
    }

    private static bool TryDecodeCanonicalBase64(
        string value,
        int expectedByteCount,
        out byte[] bytes)
    {
        bytes = new byte[expectedByteCount];

        if (!Convert.TryFromBase64String(value, bytes, out var bytesWritten) ||
            bytesWritten != expectedByteCount ||
            !string.Equals(Convert.ToBase64String(bytes), value, StringComparison.Ordinal))
        {
            CryptographicOperations.ZeroMemory(bytes);
            bytes = [];
            return false;
        }

        return true;
    }

    private static string NormalizeLoginId(string? loginId) =>
        string.IsNullOrWhiteSpace(loginId)
            ? string.Empty
            : loginId.Trim().ToLowerInvariant();

    private static bool IsValidLoginId(string loginId)
    {
        if (loginId.Length is < 3 or > MaximumLoginIdCharacters ||
            !IsAsciiLetterOrDigit(loginId[0]))
        {
            return false;
        }

        return loginId.All(character =>
            IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-');
    }

    private static bool IsAsciiLetterOrDigit(char character) =>
        character is >= 'a' and <= 'z' or >= '0' and <= '9';

    private static bool IsRetryableConcurrencyFailure(PostgresException exception) =>
        exception.SqlState is
            PostgresErrorCodes.SerializationFailure or
            PostgresErrorCodes.UniqueViolation or
            PostgresErrorCodes.DeadlockDetected;

    private sealed record LegacyAccount(Guid Id, string PasswordHash, string? Status);

    private sealed record LegacyBinding(Guid UserId, string? Value);
}

public enum LegacyAcademyImportOutcome
{
    Succeeded,
    InvalidCredentials,
    LegacyAccountInactive,
    CurrentIdentityAlreadyLinked,
    LegacyAccountAlreadyLinked,
    Conflict,
    Unavailable,
    Busy,
}

public sealed record LegacyAcademyImportResult(
    LegacyAcademyImportOutcome Outcome,
    bool AlreadyLinked,
    string[] ImportedSettingKeys)
{
    public static LegacyAcademyImportResult Succeeded(bool alreadyLinked, string[] importedSettingKeys) =>
        new(LegacyAcademyImportOutcome.Succeeded, alreadyLinked, importedSettingKeys);

    public static LegacyAcademyImportResult InvalidCredentials() =>
        new(LegacyAcademyImportOutcome.InvalidCredentials, false, []);

    public static LegacyAcademyImportResult LegacyAccountInactive() =>
        new(LegacyAcademyImportOutcome.LegacyAccountInactive, false, []);

    public static LegacyAcademyImportResult CurrentIdentityAlreadyLinked() =>
        new(LegacyAcademyImportOutcome.CurrentIdentityAlreadyLinked, false, []);

    public static LegacyAcademyImportResult LegacyAccountAlreadyLinked() =>
        new(LegacyAcademyImportOutcome.LegacyAccountAlreadyLinked, false, []);

    public static LegacyAcademyImportResult Conflict() =>
        new(LegacyAcademyImportOutcome.Conflict, false, []);

    public static LegacyAcademyImportResult Unavailable() =>
        new(LegacyAcademyImportOutcome.Unavailable, false, []);

    public static LegacyAcademyImportResult Busy() =>
        new(LegacyAcademyImportOutcome.Busy, false, []);
}
