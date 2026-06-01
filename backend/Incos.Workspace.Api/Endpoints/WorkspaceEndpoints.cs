using Incos.Workspace.Api.Contracts;
using Incos.Workspace.Api.Data;
using Incos.Workspace.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;

namespace Incos.Workspace.Api.Endpoints;

public static class WorkspaceEndpoints
{
    private const string AcademyPreferencesSettingKey = "academy.preferences";
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
            .AsNoTracking()
            .FirstOrDefaultAsync(
                userSetting =>
                    userSetting.UserKey == userKey &&
                    userSetting.SettingKey == AcademyPreferencesSettingKey,
                cancellationToken);

        return Results.Ok(ToAcademyPreferencesDto(setting?.SettingJson, setting is not null));
    }

    private static async Task<IResult> SaveAcademyPreferencesAsync(
        HttpContext context,
        SaveAcademyPreferencesRequest request,
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
            .FirstOrDefaultAsync(
                userSetting =>
                    userSetting.UserKey == userKey &&
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

        setting.SettingJson = SerializeAcademyPreferences(request, setting.SettingJson);
        setting.UpdatedAt = now;

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToAcademyPreferencesDto(setting.SettingJson, true));
    }

    private static string? GetUserKey(HttpContext context) =>
        context.User.FindFirstValue(ClaimTypes.Email);

    private static string SerializeAcademyPreferences(SaveAcademyPreferencesRequest request, string? existingSettingJson)
    {
        var manualLectures = request.ManualLectures.ValueKind == JsonValueKind.Array
            ? request.ManualLectures
            : EmptyArrayElement();
        var canvasLecturePreferences = request.CanvasLecturePreferences.ValueKind == JsonValueKind.Object
            ? request.CanvasLecturePreferences
            : EmptyObjectElement();
        var manualCoursework = request.ManualCoursework.ValueKind == JsonValueKind.Array
            ? request.ManualCoursework
            : EmptyArrayElement();
        var canvasCourseworkPreferences = request.CanvasCourseworkPreferences.ValueKind == JsonValueKind.Object
            ? request.CanvasCourseworkPreferences
            : EmptyObjectElement();
        var manualAssessments = request.ManualAssessments.ValueKind == JsonValueKind.Array
            ? request.ManualAssessments
            : EmptyArrayElement();
        var canvasAssessmentPreferences = request.CanvasAssessmentPreferences.ValueKind == JsonValueKind.Object
            ? request.CanvasAssessmentPreferences
            : EmptyObjectElement();
        var calendarSettings = request.CalendarSettings.ValueKind == JsonValueKind.Object
            ? request.CalendarSettings
            : GetStoredObjectElement(existingSettingJson, "calendarSettings");

        return JsonSerializer.Serialize(new
        {
            manualLectures,
            canvasLecturePreferences,
            manualCoursework,
            canvasCourseworkPreferences,
            manualAssessments,
            canvasAssessmentPreferences,
            calendarSettings,
        }, JsonOptions);
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
