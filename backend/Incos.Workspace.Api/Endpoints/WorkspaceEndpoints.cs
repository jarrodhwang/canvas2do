using Incos.Workspace.Api.Contracts;
using Incos.Workspace.Api.Data;
using Incos.Workspace.Api.Domain.Entities;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Incos.Workspace.Api.Endpoints;

public static class WorkspaceEndpoints
{
    public const string AcademyPreferencesSettingKey = "academy.preferences";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static IEndpointRouteBuilder MapWorkspaceEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/health", () => Results.Ok(new { service = "Incos Workspace API", status = "ok" }))
            .WithName("Health");

        api.MapGet("/images/config", () =>
                Results.Ok(new StaticImageConfigDto(
                    "/static/images",
                    "/var/www/incos-static/images",
                    [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"])))
            .WithName("GetStaticImageConfig");

        var workspaceApi = api.MapGroup("")
            .RequireAuthorization();

        workspaceApi.MapGet("/image-assets", async (IncosWorkspaceDbContext db) =>
            await db.ImageAssets
                .AsNoTracking()
                .OrderByDescending(image => image.CreatedAt)
                .Select(image => new ImageAssetDto(
                    image.Id,
                    image.OwnerType,
                    image.OwnerId,
                    image.FileName,
                    image.FileExtension,
                    image.MimeType,
                    image.StoragePath,
                    image.PublicUrl,
                    image.SizeBytes))
                .ToListAsync())
            .WithName("GetImageAssets");

        workspaceApi.MapPost("/image-assets", async (
                CreateImageAssetRequest request,
                IncosWorkspaceDbContext db) =>
            {
                var image = new ImageAsset
                {
                    OwnerType = request.OwnerType,
                    OwnerId = request.OwnerId,
                    FileName = request.FileName,
                    FileExtension = request.FileExtension.StartsWith('.')
                        ? request.FileExtension.ToLowerInvariant()
                        : $".{request.FileExtension.ToLowerInvariant()}",
                    MimeType = request.MimeType,
                    StoragePath = request.StoragePath,
                    PublicUrl = request.PublicUrl,
                    SizeBytes = request.SizeBytes,
                };

                db.ImageAssets.Add(image);
                await db.SaveChangesAsync();

                var dto = new ImageAssetDto(
                    image.Id,
                    image.OwnerType,
                    image.OwnerId,
                    image.FileName,
                    image.FileExtension,
                    image.MimeType,
                    image.StoragePath,
                    image.PublicUrl,
                    image.SizeBytes);

                return Results.Created($"/api/image-assets/{image.Id}", dto);
            })
            .WithName("CreateImageAsset");

        workspaceApi.MapGet("/workspace-modes", async (IncosWorkspaceDbContext db) =>
            await db.WorkspaceModes
                .AsNoTracking()
                .OrderBy(mode => mode.DisplayName)
                .Select(mode => new WorkspaceModeDto(
                    mode.Id,
                    mode.ModeKey,
                    mode.DisplayName,
                    mode.Icon,
                    mode.Purpose,
                    mode.AccentPrimary,
                    mode.AccentSecondary,
                    mode.Enabled,
                    mode.Hidden))
                .ToListAsync())
            .WithName("GetWorkspaceModes");

        workspaceApi.MapGet("/workspace-modes/{modeKey}/calendar-items", async (
                string modeKey,
                IncosWorkspaceDbContext db) =>
            {
                var mode = await db.WorkspaceModes
                    .AsNoTracking()
                    .FirstOrDefaultAsync(workspaceMode => workspaceMode.ModeKey == modeKey);

                if (mode is null)
                {
                    return Results.NotFound();
                }

                var items = await db.CalendarItems
                    .AsNoTracking()
                    .Where(item => item.WorkspaceModeId == mode.Id)
                    .OrderBy(item => item.StartAt ?? item.DueAt ?? item.CreatedAt)
                    .Select(item => new CalendarItemDto(
                        item.Id,
                        mode.ModeKey,
                        item.Type,
                        item.Title,
                        item.Description,
                        item.Status,
                        item.Priority,
                        item.StartAt,
                        item.EndAt,
                        item.DueAt,
                        item.RelatedEntityType,
                        item.RelatedEntityId))
                    .ToListAsync();

                return Results.Ok(items);
            })
            .WithName("GetCalendarItemsForMode");

        workspaceApi.MapPost("/workspace-modes/{modeKey}/calendar-items", async (
                string modeKey,
                CreateCalendarItemRequest request,
                IncosWorkspaceDbContext db) =>
            {
                var mode = await db.WorkspaceModes.FirstOrDefaultAsync(workspaceMode =>
                    workspaceMode.ModeKey == modeKey);

                if (mode is null)
                {
                    return Results.NotFound();
                }

                var item = new CalendarItem
                {
                    WorkspaceModeId = mode.Id,
                    Type = request.Type,
                    Title = request.Title,
                    Description = request.Description,
                    Status = request.Status ?? "open",
                    Priority = request.Priority ?? "normal",
                    StartAt = request.StartAt,
                    EndAt = request.EndAt,
                    DueAt = request.DueAt,
                    RelatedEntityType = request.RelatedEntityType,
                    RelatedEntityId = request.RelatedEntityId,
                };

                db.CalendarItems.Add(item);
                await db.SaveChangesAsync();

                var dto = new CalendarItemDto(
                    item.Id,
                    mode.ModeKey,
                    item.Type,
                    item.Title,
                    item.Description,
                    item.Status,
                    item.Priority,
                    item.StartAt,
                    item.EndAt,
                    item.DueAt,
                    item.RelatedEntityType,
                    item.RelatedEntityId);

                return Results.Created($"/api/workspace-modes/{modeKey}/calendar-items/{item.Id}", dto);
            })
            .WithName("CreateCalendarItemForMode");

        workspaceApi.MapGet("/academy/preferences", GetAcademyPreferencesAsync)
            .WithName("GetAcademyPreferences");

        workspaceApi.MapPut("/academy/preferences", SaveAcademyPreferencesAsync)
            .WithName("SaveAcademyPreferences");

        return app;
    }

    public static Task EnsureUserSettingsTableAsync(
        IncosWorkspaceDbContext db,
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

    private static async Task<IResult> GetAcademyPreferencesAsync(
        HttpContext context,
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        if (string.IsNullOrWhiteSpace(userKey))
        {
            return Results.Unauthorized();
        }

        await EnsureUserSettingsTableAsync(db, cancellationToken);

        var setting = await db.UserSettings
            .OrderBy(userSetting => userSetting.UserKey == userKey ? 0 : 1)
            .FirstOrDefaultAsync(
                userSetting =>
                    userSetting.UserKey.ToLower() == userKey &&
                    userSetting.SettingKey == AcademyPreferencesSettingKey,
                cancellationToken);

        if (setting is not null)
        {
            var normalizedSettingJson = NormalizeAcademyPreferencesJson(setting.SettingJson);

            if (!string.Equals(normalizedSettingJson, setting.SettingJson, StringComparison.Ordinal))
            {
                setting.SettingJson = normalizedSettingJson;
                setting.UpdatedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(cancellationToken);
            }
        }

        return Results.Ok(ToAcademyPreferencesDto(setting?.SettingJson, setting is not null));
    }

    private static async Task<IResult> SaveAcademyPreferencesAsync(
        HttpContext context,
        SaveAcademyPreferencesRequest request,
        IConfiguration configuration,
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        if (string.IsNullOrWhiteSpace(userKey))
        {
            return Results.Unauthorized();
        }

        await EnsureUserSettingsTableAsync(db, cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var setting = await db.UserSettings
            .OrderBy(userSetting => userSetting.UserKey == userKey ? 0 : 1)
            .FirstOrDefaultAsync(
                userSetting =>
                    userSetting.UserKey.ToLower() == userKey &&
                    userSetting.SettingKey == AcademyPreferencesSettingKey,
                cancellationToken);

        if (setting is null)
        {
            setting = new UserSetting
            {
                Id = Guid.NewGuid(),
                CreatedAt = now,
                UserKey = userKey,
                SettingKey = AcademyPreferencesSettingKey,
            };
            db.UserSettings.Add(setting);
        }

        setting.UserKey = userKey;
        setting.SettingJson = SerializeAcademyPreferences(request, setting.SettingJson);
        setting.UpdatedAt = now;

        await db.SaveChangesAsync(cancellationToken);
        await RenewCurrentSessionAsync(context, configuration, setting.SettingJson);

        return Results.Ok(ToAcademyPreferencesDto(setting.SettingJson, true));
    }

    private static async Task RenewCurrentSessionAsync(
        HttpContext context,
        IConfiguration configuration,
        string settingJson)
    {
        var authenticateResult = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);

        if (!authenticateResult.Succeeded || authenticateResult.Principal is null)
        {
            return;
        }

        var properties = authenticateResult.Properties ?? new AuthenticationProperties();
        var sessionDuration = AuthEndpoints.GetSessionDurationFromAcademyPreferencesJson(
            settingJson,
            AuthEndpoints.GetWorkspaceSessionDuration(configuration));

        properties.IsPersistent = true;
        properties.ExpiresUtc = DateTimeOffset.UtcNow.Add(sessionDuration);

        await context.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            authenticateResult.Principal,
            properties);
    }

    private static string? GetUserKey(HttpContext context)
    {
        var email = context.User.FindFirstValue(ClaimTypes.Email);

        return string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();
    }

    private static string SerializeAcademyPreferences(SaveAcademyPreferencesRequest request, string? existingSettingJson)
    {
        var manualLectures = request.ManualLectures.ValueKind == JsonValueKind.Array
            ? MergeStoredArrayById(request.ManualLectures, existingSettingJson, "manualLectures")
            : GetStoredArrayElement(existingSettingJson, "manualLectures");
        var canvasLecturePreferences = request.CanvasLecturePreferences.ValueKind == JsonValueKind.Object
            ? MergeStoredObject(request.CanvasLecturePreferences, existingSettingJson, "canvasLecturePreferences")
            : GetStoredObjectElement(existingSettingJson, "canvasLecturePreferences");
        var manualCoursework = request.ManualCoursework.ValueKind == JsonValueKind.Array
            ? MergeStoredArrayById(request.ManualCoursework, existingSettingJson, "manualCoursework")
            : GetStoredArrayElement(existingSettingJson, "manualCoursework");
        var canvasCourseworkPreferences = request.CanvasCourseworkPreferences.ValueKind == JsonValueKind.Object
            ? MergeStoredObject(request.CanvasCourseworkPreferences, existingSettingJson, "canvasCourseworkPreferences")
            : GetStoredObjectElement(existingSettingJson, "canvasCourseworkPreferences");
        var manualAssessments = request.ManualAssessments.ValueKind == JsonValueKind.Array
            ? MergeStoredArrayById(request.ManualAssessments, existingSettingJson, "manualAssessments")
            : GetStoredArrayElement(existingSettingJson, "manualAssessments");
        var canvasAssessmentPreferences = request.CanvasAssessmentPreferences.ValueKind == JsonValueKind.Object
            ? MergeStoredObject(request.CanvasAssessmentPreferences, existingSettingJson, "canvasAssessmentPreferences")
            : GetStoredObjectElement(existingSettingJson, "canvasAssessmentPreferences");
        var calendarSettings = request.CalendarSettings.ValueKind == JsonValueKind.Object
            ? MergeStoredObject(request.CalendarSettings, existingSettingJson, "calendarSettings")
            : GetStoredObjectElement(existingSettingJson, "calendarSettings");

        var serialized = JsonSerializer.Serialize(new
        {
            manualLectures,
            canvasLecturePreferences,
            manualCoursework,
            canvasCourseworkPreferences,
            manualAssessments,
            canvasAssessmentPreferences,
            calendarSettings,
        }, JsonOptions);

        return NormalizeAcademyPreferencesJson(serialized);
    }

    private static string NormalizeAcademyPreferencesJson(string? settingJson)
    {
        if (string.IsNullOrWhiteSpace(settingJson))
        {
            return JsonSerializer.Serialize(new
            {
                manualLectures = EmptyArrayElement(),
                canvasLecturePreferences = EmptyObjectElement(),
                manualCoursework = EmptyArrayElement(),
                canvasCourseworkPreferences = EmptyObjectElement(),
                manualAssessments = EmptyArrayElement(),
                canvasAssessmentPreferences = EmptyObjectElement(),
                calendarSettings = EmptyObjectElement(),
            }, JsonOptions);
        }

        try
        {
            var root = JsonNode.Parse(settingJson) as JsonObject ?? [];

            BackfillCompletedAtForArray(root["manualCoursework"] as JsonArray);
            BackfillCompletedAtForObject(root["canvasCourseworkPreferences"] as JsonObject);
            BackfillCompletedAtForArray(root["manualAssessments"] as JsonArray);
            BackfillCompletedAtForObject(root["canvasAssessmentPreferences"] as JsonObject);

            return root.ToJsonString(JsonOptions);
        }
        catch (JsonException)
        {
            return settingJson;
        }
    }

    private static void BackfillCompletedAtForArray(JsonArray? items)
    {
        if (items is null)
        {
            return;
        }

        foreach (var item in items)
        {
            if (item is JsonObject itemObject)
            {
                BackfillCompletedAt(itemObject);
            }
        }
    }

    private static void BackfillCompletedAtForObject(JsonObject? items)
    {
        if (items is null)
        {
            return;
        }

        foreach (var item in items)
        {
            if (item.Value is JsonObject itemObject)
            {
                BackfillCompletedAt(itemObject);
            }
        }
    }

    private static void BackfillCompletedAt(JsonObject item)
    {
        if (!GetBooleanValue(item, "completed") && !GetBooleanValue(item, "isSubmitted"))
        {
            return;
        }

        if (!string.IsNullOrWhiteSpace(GetStringValue(item, "completedAt")))
        {
            return;
        }

        var dueAt = GetStringValue(item, "submittedAt") ?? GetStringValue(item, "dueAt");

        if (string.IsNullOrWhiteSpace(dueAt))
        {
            return;
        }

        item["completedAt"] = dueAt;
    }

    private static bool GetBooleanValue(JsonObject item, string propertyName)
    {
        if (!item.TryGetPropertyValue(propertyName, out var value) || value is not JsonValue jsonValue)
        {
            return false;
        }

        return jsonValue.TryGetValue<bool>(out var boolValue) && boolValue;
    }

    private static string? GetStringValue(JsonObject item, string propertyName)
    {
        if (!item.TryGetPropertyValue(propertyName, out var value) || value is not JsonValue jsonValue)
        {
            return null;
        }

        return jsonValue.TryGetValue<string>(out var stringValue) ? stringValue : null;
    }

    private static JsonElement MergeStoredArrayById(JsonElement requestedArray, string? settingJson, string propertyName)
    {
        var mergedItems = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        var unkeyedItems = new List<JsonElement>();

        foreach (var item in EnumerateStoredArray(settingJson, propertyName))
        {
            AddArrayItem(item, mergedItems, unkeyedItems);
        }

        foreach (var item in requestedArray.EnumerateArray())
        {
            AddArrayItem(item, mergedItems, unkeyedItems);
        }

        return JsonSerializer.SerializeToElement(
            mergedItems.Values.Concat(unkeyedItems),
            JsonOptions);
    }

    private static void AddArrayItem(
        JsonElement item,
        Dictionary<string, JsonElement> keyedItems,
        List<JsonElement> unkeyedItems)
    {
        if (item.ValueKind == JsonValueKind.Object &&
            item.TryGetProperty("id", out var idProperty) &&
            idProperty.ValueKind == JsonValueKind.String &&
            !string.IsNullOrWhiteSpace(idProperty.GetString()))
        {
            keyedItems[idProperty.GetString()!] = item.Clone();
            return;
        }

        unkeyedItems.Add(item.Clone());
    }

    private static JsonElement MergeStoredObject(JsonElement requestedObject, string? settingJson, string propertyName)
    {
        var mergedProperties = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);

        foreach (var property in EnumerateStoredObject(settingJson, propertyName))
        {
            mergedProperties[property.Name] = property.Value.Clone();
        }

        foreach (var property in requestedObject.EnumerateObject())
        {
            if (mergedProperties.TryGetValue(property.Name, out var storedValue) &&
                storedValue.ValueKind == JsonValueKind.Object &&
                property.Value.ValueKind == JsonValueKind.Object)
            {
                mergedProperties[property.Name] = MergeJsonObjects(storedValue, property.Value);
                continue;
            }

            mergedProperties[property.Name] = property.Value.Clone();
        }

        return JsonSerializer.SerializeToElement(mergedProperties, JsonOptions);
    }

    private static JsonElement MergeJsonObjects(JsonElement storedObject, JsonElement requestedObject)
    {
        var mergedProperties = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);

        foreach (var property in storedObject.EnumerateObject())
        {
            mergedProperties[property.Name] = property.Value.Clone();
        }

        foreach (var property in requestedObject.EnumerateObject())
        {
            if (mergedProperties.TryGetValue(property.Name, out var storedValue) &&
                storedValue.ValueKind == JsonValueKind.Object &&
                property.Value.ValueKind == JsonValueKind.Object)
            {
                mergedProperties[property.Name] = MergeJsonObjects(storedValue, property.Value);
                continue;
            }

            mergedProperties[property.Name] = property.Value.Clone();
        }

        return JsonSerializer.SerializeToElement(mergedProperties, JsonOptions);
    }

    private static JsonElement GetStoredArrayElement(string? settingJson, string propertyName)
    {
        if (string.IsNullOrWhiteSpace(settingJson))
        {
            return EmptyArrayElement();
        }

        try
        {
            using var document = JsonDocument.Parse(settingJson);

            return document.RootElement.TryGetProperty(propertyName, out var storedValue) &&
                   storedValue.ValueKind == JsonValueKind.Array
                ? storedValue.Clone()
                : EmptyArrayElement();
        }
        catch (JsonException)
        {
            return EmptyArrayElement();
        }
    }

    private static JsonElement[] EnumerateStoredArray(string? settingJson, string propertyName)
    {
        var storedArray = GetStoredArrayElement(settingJson, propertyName);

        return storedArray.ValueKind == JsonValueKind.Array
            ? storedArray.EnumerateArray().Select(item => item.Clone()).ToArray()
            : [];
    }

    private static JsonProperty[] EnumerateStoredObject(string? settingJson, string propertyName)
    {
        var storedObject = GetStoredObjectElement(settingJson, propertyName);

        return storedObject.ValueKind == JsonValueKind.Object
            ? storedObject.EnumerateObject().ToArray()
            : [];
    }

    private static JsonElement GetStoredObjectElement(string? settingJson, string propertyName)
    {
        if (string.IsNullOrWhiteSpace(settingJson))
        {
            return EmptyObjectElement();
        }

        try
        {
            using var document = JsonDocument.Parse(settingJson);

            return document.RootElement.TryGetProperty(propertyName, out var storedValue) &&
                   storedValue.ValueKind == JsonValueKind.Object
                ? storedValue.Clone()
                : EmptyObjectElement();
        }
        catch (JsonException)
        {
            return EmptyObjectElement();
        }
    }

    private static AcademyPreferencesDto ToAcademyPreferencesDto(string? settingJson, bool exists)
    {
        if (string.IsNullOrWhiteSpace(settingJson))
        {
            return CreateDefaultAcademyPreferences(exists);
        }

        try
        {
            using var document = JsonDocument.Parse(settingJson);
            var root = document.RootElement;
            var manualLectures = root.TryGetProperty("manualLectures", out var storedManualLectures) &&
                                 storedManualLectures.ValueKind == JsonValueKind.Array
                ? storedManualLectures.Clone()
                : EmptyArrayElement();
            var canvasLecturePreferences =
                root.TryGetProperty("canvasLecturePreferences", out var storedCanvasLecturePreferences) &&
                storedCanvasLecturePreferences.ValueKind == JsonValueKind.Object
                    ? storedCanvasLecturePreferences.Clone()
                    : EmptyObjectElement();
            var manualCoursework = root.TryGetProperty("manualCoursework", out var storedManualCoursework) &&
                                   storedManualCoursework.ValueKind == JsonValueKind.Array
                ? storedManualCoursework.Clone()
                : EmptyArrayElement();
            var canvasCourseworkPreferences =
                root.TryGetProperty("canvasCourseworkPreferences", out var storedCanvasCourseworkPreferences) &&
                storedCanvasCourseworkPreferences.ValueKind == JsonValueKind.Object
                    ? storedCanvasCourseworkPreferences.Clone()
                    : EmptyObjectElement();
            var manualAssessments = root.TryGetProperty("manualAssessments", out var storedManualAssessments) &&
                                    storedManualAssessments.ValueKind == JsonValueKind.Array
                ? storedManualAssessments.Clone()
                : EmptyArrayElement();
            var canvasAssessmentPreferences =
                root.TryGetProperty("canvasAssessmentPreferences", out var storedCanvasAssessmentPreferences) &&
                storedCanvasAssessmentPreferences.ValueKind == JsonValueKind.Object
                    ? storedCanvasAssessmentPreferences.Clone()
                    : EmptyObjectElement();
            var calendarSettings = root.TryGetProperty("calendarSettings", out var storedCalendarSettings) &&
                                   storedCalendarSettings.ValueKind == JsonValueKind.Object
                ? storedCalendarSettings.Clone()
                : EmptyObjectElement();

            return new AcademyPreferencesDto(
                manualLectures,
                canvasLecturePreferences,
                manualCoursework,
                canvasCourseworkPreferences,
                manualAssessments,
                canvasAssessmentPreferences,
                calendarSettings,
                exists);
        }
        catch (JsonException)
        {
            return CreateDefaultAcademyPreferences(exists);
        }
    }

    private static AcademyPreferencesDto CreateDefaultAcademyPreferences(bool exists) =>
        new(
            EmptyArrayElement(),
            EmptyObjectElement(),
            EmptyArrayElement(),
            EmptyObjectElement(),
            EmptyArrayElement(),
            EmptyObjectElement(),
            EmptyObjectElement(),
            exists);

    private static JsonElement EmptyArrayElement() =>
        JsonSerializer.SerializeToElement(Array.Empty<object>(), JsonOptions);

    private static JsonElement EmptyObjectElement() =>
        JsonSerializer.SerializeToElement(new Dictionary<string, object>(), JsonOptions);
}
