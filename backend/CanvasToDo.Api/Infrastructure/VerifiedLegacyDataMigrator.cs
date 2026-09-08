using CanvasToDo.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace CanvasToDo.Api.Infrastructure;

public static class VerifiedLegacyDataMigrator
{
    private static readonly string[] EligibleSettingKeys =
    [
        "canvas.token",
        "academy.preferences",
    ];

    public static async Task CopyAsync(
        CanvasToDoDbContext db,
        Guid userId,
        string verifiedEmail,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var destinationKey = UserOwnerKeys.FromId(userId);

        try
        {
            foreach (var settingKey in EligibleSettingKeys)
            {
                var destinationId = Guid.NewGuid();
                var now = DateTimeOffset.UtcNow;

                // The source comparison is intentionally exact. ON CONFLICT makes retries and
                // concurrent callbacks idempotent and never overwrites a destination setting.
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"""
                    INSERT INTO user_settings
                        ("Id", "CreatedAt", "UpdatedAt", "UserKey", "SettingKey", "SettingJson")
                    SELECT
                        {destinationId}, source."CreatedAt", {now}, {destinationKey}, source."SettingKey", source."SettingJson"
                    FROM user_settings AS source
                    WHERE source."UserKey" = {verifiedEmail}
                      AND source."SettingKey" = {settingKey}
                    ON CONFLICT ("UserKey", "SettingKey") DO NOTHING;
                    """,
                    cancellationToken);
            }
        }
        catch (Exception exception) when (
            exception is DbUpdateException or InvalidOperationException or Npgsql.NpgsqlException)
        {
            // Authentication must remain available; a later verified login retries this idempotent copy.
            logger.LogWarning(
                exception,
                "Could not copy verified legacy Canvas/Academy settings for auth user {UserId}.",
                userId);
        }
    }
}
