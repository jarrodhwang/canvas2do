using CanvasToDo.Api.Contracts;
using CanvasToDo.Api.Data;
using CanvasToDo.Api.Domain.Entities;
using CanvasToDo.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace CanvasToDo.Api.Endpoints;

public static class AcademyPreferenceEndpoints
{
    public const string SettingKey = "academy.preferences";
    private const string OwnerHeader = "X-Canvas-To-Do-Owner-Key";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static IEndpointRouteBuilder MapAcademyPreferenceEndpoints(this IEndpointRouteBuilder app)
    {
        var preferences = app.MapGroup("/api/academy/preferences")
            .RequireAuthorization();

        preferences.MapGet("", GetAsync)
            .WithName("GetAcademyPreferences");
        preferences.MapPut("", SaveAsync)
            .WithName("SaveAcademyPreferences");

        app.MapPut("/api/academy/courses/{id}/term", ChangeTermAsync).RequireAuthorization();
        return app;
    }

    public sealed record ChangeTerm(int Year, string Term);

    internal static async Task<IResult> ChangeTermAsync(string id, ChangeTerm request, HttpContext context,
        CanvasToDoDbContext db, CancellationToken cancellationToken)
    {
        var owner = GetUserKey(context);
        if (owner is null) return Results.Unauthorized();
        if (ValidateOwner(context, owner) is { } mismatch) return mismatch;
        if (request.Year < 2000 || request.Year > DateTimeOffset.UtcNow.Year ||
            request.Term is not ("Spring" or "Summer" or "Fall" or "Winter"))
            return Results.BadRequest(new { detail = "Choose a year from 2000 through the current year and Spring, Summer, Fall or Winter." });
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await ManualModeEndpoints.LockAsync(db, owner, cancellationToken);
        var row = await db.UserSettings.SingleOrDefaultAsync(s => s.UserKey == owner && s.SettingKey == SettingKey, cancellationToken);
        if (row is null) return Results.NotFound();
        var root = JsonNode.Parse(row.SettingJson)!.AsObject();
        if (!MoveManualCourse(root, id, $"{request.Term} {request.Year}"))
            return Results.Conflict(new { detail = "Only saved manual courses can change term. Refresh your courses and try again." });
        row.SettingJson = root.ToJsonString();
        row.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Results.Ok(ToDto(row.SettingJson, true));
    }

    internal static bool MoveManualCourse(JsonObject root, string id, string term)
    {
        var lecture = (root["manualLectures"] as JsonArray)?.OfType<JsonObject>()
            .FirstOrDefault(c => c["id"]?.GetValue<string>() == id && c["deleted"]?.GetValue<bool>() != true);
        if (lecture is null) return false;
        var previousTerm = lecture["semester"]?.GetValue<string>();
        var codes = new[] { lecture["code"]?.GetValue<string>(), lecture["friendlyCourseCode"]?.GetValue<string>() }
            .Where(code => !string.IsNullOrWhiteSpace(code)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var archivedId = (root["canvasLecturePreferences"] as JsonObject)?.FirstOrDefault(pair =>
            pair.Value?["archivedAsManualLectureId"]?.GetValue<string>() == id || $"manual-canvas-{pair.Key}" == id).Key;
        foreach (var key in new[] { "manualCoursework", "manualAssessments", "canvasCourseworkPreferences", "canvasAssessmentPreferences" })
        {
            IEnumerable<JsonObject> items = root[key] switch {
                JsonArray array => array.OfType<JsonObject>(),
                JsonObject map => map.Select(pair => pair.Value).OfType<JsonObject>(),
                _ => []
            };
            foreach (var item in items)
            {
                var courseId = item["courseId"]?.GetValue<string>() ?? item["retainedFromCanvasCourseId"]?.GetValue<string>();
                var exactMatch = item["manualLectureId"]?.GetValue<string>() == id || (archivedId is not null && courseId == archivedId);
                var codeMatch = courseId is null && codes.Contains(item["courseCode"]?.GetValue<string>() ?? "") &&
                    item["semester"]?.GetValue<string>() == previousTerm;
                if (exactMatch || codeMatch) item["semester"] = term;
            }
        }
        lecture["semester"] = term;
        return true;
    }

    /// <summary>
    /// Ensures user_settings exists independently of AuthDbContext migrations, whose rollbacks
    /// must not drop encrypted Canvas data. The repeatable bootstrap also supports deployments
    /// with EnsureCreated disabled.
    /// </summary>
    public static Task EnsureTableAsync(
        CanvasToDoDbContext db,
        CancellationToken cancellationToken = default) =>
        db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS user_settings (
                "Id" uuid NOT NULL PRIMARY KEY,
                "CreatedAt" timestamp with time zone NOT NULL,
                "UpdatedAt" timestamp with time zone NOT NULL,
                "UserKey" character varying(320) NOT NULL,
                "SettingKey" character varying(120) NOT NULL,
                "SettingJson" jsonb NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_user_settings_UserKey_SettingKey"
                ON user_settings ("UserKey", "SettingKey");
            """,
            cancellationToken);

    internal static async Task<IResult> GetAsync(
        HttpContext context,
        CanvasToDoDbContext db,
        CancellationToken cancellationToken)
    {
        context.Response.Headers.CacheControl = "no-store";
        var userKey = GetUserKey(context);

        if (userKey is null)
        {
            return Results.Unauthorized();
        }

        if (ValidateOwner(context, userKey) is { } mismatch)
        {
            return mismatch;
        }

        var setting = await FindAsync(db, userKey, cancellationToken);

        return Results.Ok(ToDto(setting?.SettingJson, setting is not null));
    }

    internal static async Task<IResult> SaveAsync(
        SaveAcademyPreferencesRequest request,
        HttpContext context,
        CanvasToDoDbContext db,
        CancellationToken cancellationToken)
    {
        context.Response.Headers.CacheControl = "no-store";
        var userKey = GetUserKey(context);

        if (userKey is null)
        {
            return Results.Unauthorized();
        }

        if (ValidateOwner(context, userKey) is { } mismatch)
        {
            return mismatch;
        }

        var normalizedUserKey = userKey.Trim().ToLowerInvariant();
        var writeLockKey = $"{normalizedUserKey}:{SettingKey}";
        var now = DateTimeOffset.UtcNow;
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // A transaction-scoped database lock preserves partial/deep-merge semantics across
        // multiple API instances, including when two requests both observe a missing row.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({writeLockKey}, 0));",
            cancellationToken);

        var existingSetting = await FindAsync(db, normalizedUserKey, cancellationToken);
        if ((await ManualModeEndpoints.GetAsync(db, normalizedUserKey, cancellationToken))?.Status == "approved" &&
            request.CanvasLecturePreferences.ValueKind == JsonValueKind.Object &&
            request.CanvasLecturePreferences.EnumerateObject().Any(p => p.Value.ValueKind == JsonValueKind.Object &&
                !p.Value.TryGetProperty("convertedToManualAt", out _)))
            return Results.Conflict(new { detail = "Permanent manual mode was approved. Refresh before saving your courses." });
        var storageUserKey = existingSetting?.UserKey ?? normalizedUserKey;
        var settingJson = Serialize(request, existingSetting?.SettingJson);

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO user_settings
                ("Id", "CreatedAt", "UpdatedAt", "UserKey", "SettingKey", "SettingJson")
            VALUES
                ({Guid.NewGuid()}, {now}, {now}, {storageUserKey}, {SettingKey}, CAST({settingJson} AS jsonb))
            ON CONFLICT ("UserKey", "SettingKey") DO UPDATE SET
                "UpdatedAt" = EXCLUDED."UpdatedAt",
                "SettingJson" = EXCLUDED."SettingJson";
            """,
            cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return Results.Ok(ToDto(settingJson, true));
    }

    private static async Task<UserSetting?> FindAsync(
        CanvasToDoDbContext db,
        string userKey,
        CancellationToken cancellationToken)
    {
        var exact = await db.UserSettings.AsNoTracking().FirstOrDefaultAsync(
            setting => setting.UserKey == userKey && setting.SettingKey == SettingKey,
            cancellationToken);

        return exact ?? await db.UserSettings.AsNoTracking().FirstOrDefaultAsync(
            setting => setting.UserKey.ToLower() == userKey && setting.SettingKey == SettingKey,
            cancellationToken);
    }

    private static string Serialize(SaveAcademyPreferencesRequest request, string? existingJson)
    {
        var value = new
        {
            manualLectures = SelectArray(request.ManualLectures, existingJson, "manualLectures"),
            canvasLecturePreferences = SelectObject(request.CanvasLecturePreferences, existingJson, "canvasLecturePreferences"),
            manualCoursework = SelectArray(request.ManualCoursework, existingJson, "manualCoursework"),
            canvasCourseworkPreferences = SelectObject(request.CanvasCourseworkPreferences, existingJson, "canvasCourseworkPreferences"),
            manualAssessments = SelectArray(request.ManualAssessments, existingJson, "manualAssessments"),
            canvasAssessmentPreferences = SelectObject(request.CanvasAssessmentPreferences, existingJson, "canvasAssessmentPreferences"),
            calendarSettings = request.CalendarSettings.ValueKind == JsonValueKind.Object
                ? MergeStoredObject(request.CalendarSettings, existingJson, "calendarSettings")
                : GetStored(existingJson, "calendarSettings", JsonValueKind.Object),
        };

        return JsonSerializer.Serialize(value, JsonOptions);
    }

    private static JsonElement SelectArray(JsonElement requested, string? stored, string propertyName) =>
        requested.ValueKind == JsonValueKind.Array
            ? requested.Clone()
            : GetStored(stored, propertyName, JsonValueKind.Array);

    private static JsonElement SelectObject(JsonElement requested, string? stored, string propertyName) =>
        requested.ValueKind == JsonValueKind.Object
            ? requested.Clone()
            : GetStored(stored, propertyName, JsonValueKind.Object);

    private static JsonElement MergeStoredObject(
        JsonElement requested,
        string? storedJson,
        string propertyName)
    {
        var stored = GetStored(storedJson, propertyName, JsonValueKind.Object);
        return MergeObjects(stored, requested);
    }

    private static JsonElement MergeObjects(JsonElement stored, JsonElement requested)
    {
        var properties = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);

        if (stored.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in stored.EnumerateObject())
            {
                properties[property.Name] = property.Value.Clone();
            }
        }

        foreach (var property in requested.EnumerateObject())
        {
            if (properties.TryGetValue(property.Name, out var oldValue) &&
                oldValue.ValueKind == JsonValueKind.Object &&
                property.Value.ValueKind == JsonValueKind.Object)
            {
                properties[property.Name] = MergeObjects(oldValue, property.Value);
            }
            else
            {
                properties[property.Name] = property.Value.Clone();
            }
        }

        return JsonSerializer.SerializeToElement(properties, JsonOptions);
    }

    private static AcademyPreferencesDto ToDto(string? settingJson, bool exists)
    {
        if (!TryParseObject(settingJson, out var root))
        {
            return DefaultDto(exists);
        }

        return new AcademyPreferencesDto(
            GetProperty(root, "manualLectures", JsonValueKind.Array),
            GetProperty(root, "canvasLecturePreferences", JsonValueKind.Object),
            GetProperty(root, "manualCoursework", JsonValueKind.Array),
            GetProperty(root, "canvasCourseworkPreferences", JsonValueKind.Object),
            GetProperty(root, "manualAssessments", JsonValueKind.Array),
            GetProperty(root, "canvasAssessmentPreferences", JsonValueKind.Object),
            GetProperty(root, "calendarSettings", JsonValueKind.Object),
            exists);
    }

    private static JsonElement GetStored(string? json, string propertyName, JsonValueKind expectedKind)
    {
        if (!TryParseObject(json, out var root))
        {
            return Empty(expectedKind);
        }

        return GetProperty(root, propertyName, expectedKind);
    }

    private static JsonElement GetProperty(JsonElement root, string propertyName, JsonValueKind expectedKind) =>
        root.TryGetProperty(propertyName, out var value) && value.ValueKind == expectedKind
            ? value.Clone()
            : Empty(expectedKind);

    private static bool TryParseObject(string? json, out JsonElement root)
    {
        root = default;

        if (string.IsNullOrWhiteSpace(json))
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(json);

            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return false;
            }

            root = document.RootElement.Clone();
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static AcademyPreferencesDto DefaultDto(bool exists) => new(
        Empty(JsonValueKind.Array),
        Empty(JsonValueKind.Object),
        Empty(JsonValueKind.Array),
        Empty(JsonValueKind.Object),
        Empty(JsonValueKind.Array),
        Empty(JsonValueKind.Object),
        Empty(JsonValueKind.Object),
        exists);

    private static JsonElement Empty(JsonValueKind kind) =>
        kind == JsonValueKind.Array
            ? JsonSerializer.SerializeToElement(Array.Empty<object>(), JsonOptions)
            : JsonSerializer.SerializeToElement(new Dictionary<string, object>(), JsonOptions);

    private static string? GetUserKey(HttpContext context)
        => UserOwnerKeys.FromPrincipal(context.User);

    private static IResult? ValidateOwner(HttpContext context, string userKey)
    {
        var expected = context.Request.Headers[OwnerHeader].ToString().Trim();

        return !string.IsNullOrWhiteSpace(expected) &&
               string.Equals(expected, userKey, StringComparison.OrdinalIgnoreCase)
            ? null
            : Results.Problem(
                title: "Academy session changed.",
                detail: "Reload Academy data before accessing preferences for this account.",
                statusCode: StatusCodes.Status409Conflict);
    }
}
