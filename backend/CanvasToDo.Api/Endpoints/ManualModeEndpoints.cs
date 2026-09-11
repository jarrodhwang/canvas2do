using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using CanvasToDo.Api.Data;
using CanvasToDo.Api.Domain.Entities;
using CanvasToDo.Api.Domain.Identity;
using CanvasToDo.Api.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace CanvasToDo.Api.Endpoints;

public static class ManualModeEndpoints
{
    public const string SettingKey = "canvas.manual-mode";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    public sealed record ModeRequest(Guid Id, string Status, DateTimeOffset RequestedAt,
        DateTimeOffset? ReviewedAt = null, Guid? ReviewedBy = null);
    public sealed record Confirmations(bool LeavingCanvasPermanently, bool UnderstandsIrreversible, bool UnderstandsApprovalDelay);
    public sealed record Review(Guid RequestId, bool Approve);

    public static IEndpointRouteBuilder MapManualModeEndpoints(this IEndpointRouteBuilder app)
    {
        var own = app.MapGroup("/api/canvas/manual-mode").RequireAuthorization();
        own.MapGet("", async (HttpContext context, CanvasToDoDbContext db, CancellationToken ct) =>
        {
            var owner = Owner(context);
            return owner is null ? Results.Unauthorized() : Results.Json(new { request = await GetAsync(db, owner, ct) }, JsonOptions);
        });
        own.MapPost("", RequestAsync).RequireRateLimiting("auth-sensitive");
        app.MapPost("/api/admin/users/{id:guid}/manual-mode/review", ReviewAsync)
            .RequireAuthorization("Admin").RequireRateLimiting("admin-write");
        return app;
    }

    private static string? Owner(HttpContext context)
    {
        var id = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(id, out var userId)) return null;
        var owner = UserOwnerKeys.FromId(userId);
        return context.Request.Headers["X-Canvas-To-Do-Owner-Key"] == owner ? owner : null;
    }

    public static async Task<ModeRequest?> GetAsync(CanvasToDoDbContext db, string owner, CancellationToken ct)
    {
        var json = await db.UserSettings.AsNoTracking().Where(s => s.UserKey == owner && s.SettingKey == SettingKey)
            .Select(s => s.SettingJson).SingleOrDefaultAsync(ct);
        return json is null ? null : JsonSerializer.Deserialize<ModeRequest>(json, JsonOptions);
    }

    internal static Task LockAsync(CanvasToDoDbContext db, string owner, CancellationToken ct) =>
        db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({owner + ":" + AcademyPreferenceEndpoints.SettingKey}, 0));", ct);

    private static async Task<IResult> RequestAsync(Confirmations request, HttpContext context, CanvasToDoDbContext db, CancellationToken ct)
    {
        var owner = Owner(context);
        if (owner is null) return Results.Unauthorized();
        if (!request.LeavingCanvasPermanently || !request.UnderstandsIrreversible || !request.UnderstandsApprovalDelay)
            return Results.BadRequest(new { detail = "Confirm all three notices before requesting permanent manual mode." });
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await LockAsync(db, owner, ct);
        var existing = await GetAsync(db, owner, ct);
        if (existing?.Status is "pending" or "approved") return Results.Ok(existing);
        var settings = await db.UserSettings.Where(s => s.UserKey == owner).ToListAsync(ct);
        var prefs = settings.Find(s => s.SettingKey == AcademyPreferenceEndpoints.SettingKey);
        var hasSavedCourses = JsonNode.Parse(prefs?.SettingJson ?? "{}")?["canvasLecturePreferences"] is JsonObject courses && courses.Count > 0;
        if (!hasSavedCourses && !settings.Any(s => s.SettingKey == "canvas.token"))
            return Results.Conflict(new { detail = "You can already use manual courses without a Canvas token." });
        var next = new ModeRequest(Guid.NewGuid(), "pending", DateTimeOffset.UtcNow);
        await StoreAsync(db, owner, next, ct);
        await transaction.CommitAsync(ct);
        return Results.Ok(next);
    }

    internal static async Task<IResult> ReviewAsync(Guid id, Review review, HttpContext context,
        UserManager<ApplicationUser> users, CanvasToDoDbContext db, CancellationToken ct)
    {
        if (await users.FindByIdAsync(id.ToString()) is null) return Results.NotFound();
        var actor = Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var owner = UserOwnerKeys.FromId(id);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await LockAsync(db, owner, ct);
        var existing = await GetAsync(db, owner, ct);
        if (existing?.Id != review.RequestId || existing.Status != "pending")
            return Results.Conflict(new { detail = "This request is no longer pending. Refresh the user details." });
        var now = DateTimeOffset.UtcNow;
        var next = existing with { Status = review.Approve ? "approved" : "rejected", ReviewedAt = now, ReviewedBy = actor };
        if (review.Approve)
        {
            var prefs = await db.UserSettings.SingleOrDefaultAsync(s => s.UserKey == owner && s.SettingKey == AcademyPreferenceEndpoints.SettingKey, ct);
            if (prefs is null)
            {
                prefs = new UserSetting { UserKey = owner, SettingKey = AcademyPreferenceEndpoints.SettingKey, SettingJson = "{}" };
                db.UserSettings.Add(prefs);
            }
            prefs.SettingJson = ConvertSavedCourses(prefs.SettingJson, now);
            prefs.UpdatedAt = now;
            var tokens = await db.UserSettings.Where(s => s.UserKey == owner && s.SettingKey == "canvas.token").ToListAsync(ct);
            db.UserSettings.RemoveRange(tokens);
        }
        await StoreAsync(db, owner, next, ct);
        await transaction.CommitAsync(ct);
        context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("AdministratorAudit")
            .LogInformation("Administrator {ActorUserId} reviewed manual mode request {RequestId} for {TargetUserId}: {Status}.", actor, next.Id, id, next.Status);
        return Results.Ok(next);
    }

    private static async Task StoreAsync(CanvasToDoDbContext db, string owner, ModeRequest request, CancellationToken ct)
    {
        var row = await db.UserSettings.SingleOrDefaultAsync(s => s.UserKey == owner && s.SettingKey == SettingKey, ct);
        if (row is null)
        {
            row = new UserSetting { UserKey = owner, SettingKey = SettingKey };
            db.UserSettings.Add(row);
        }
        row.SettingJson = JsonSerializer.Serialize(request, JsonOptions);
        row.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    // Convert only saved snapshots, preserving grades, schedules and user edits. Stable IDs
    // make retries safe; existing manual copies always win over older Canvas snapshots.
    internal static string ConvertSavedCourses(string json, DateTimeOffset now)
    {
        var root = JsonNode.Parse(json)!.AsObject();
        var manual = root["manualLectures"] as JsonArray ?? new JsonArray();
        root["manualLectures"] ??= manual;
        var courses = root["canvasLecturePreferences"] as JsonObject ?? new JsonObject();
        foreach (var (courseId, node) in courses)
        {
            if (node is not JsonObject course) continue;
            var manualId = course["archivedAsManualLectureId"]?.GetValue<string>() ?? $"manual-canvas-{courseId}";
            if (!manual.OfType<JsonObject>().Any(c => c["id"]?.GetValue<string>() == manualId))
            {
                var copy = new JsonObject();
                foreach (var key in new[] { "credits", "assessments", "schedule", "links", "lectureSection", "labSection", "tutorialSection", "chipColor", "starred", "hidden", "deleted", "semester", "friendlyName", "friendlyCourseCode" })
                    copy[key] = course[key]?.DeepClone();
                copy["id"] = manualId;
                copy["name"] = (course["friendlyName"] ?? course["courseName"])?.DeepClone() ?? JsonValue.Create($"Course {courseId}");
                copy["code"] = (course["friendlyCourseCode"] ?? course["originalCourseCode"])?.DeepClone() ?? JsonValue.Create(courseId);
                copy["semester"] ??= course["termName"]?.DeepClone() ?? JsonValue.Create($"{(now.Month <= 4 ? "Spring" : now.Month <= 8 ? "Summer" : "Fall")} {now.Year}");
                copy["credits"] ??= "";
                copy["assessments"] ??= new JsonArray();
                copy["links"] ??= new JsonArray();
                copy["schedule"] ??= new JsonObject { ["deliveryMode"] = "inPerson", ["day"] = "", ["time"] = "", ["location"] = "", ["entries"] = new JsonArray() };
                foreach (var key in new[] { "lectureSection", "labSection", "tutorialSection" }) copy[key] ??= "";
                copy["canvasGradeSummary"] = new JsonObject { ["grade"] = course["currentGrade"]?.DeepClone(), ["score"] = course["currentScore"]?.DeepClone() };
                manual.Add(copy);
            }
            course["convertedToManualAt"] ??= now.ToString("O");
            course["archivedAsManualLectureId"] = manualId;
            course["deleted"] = true;
            course["hidden"] = true;
        }
        var settings = root["calendarSettings"] as JsonObject ?? new JsonObject();
        root["calendarSettings"] ??= settings;
        settings["canvasTokenPromptEnabled"] = false;
        settings.Remove("lastCanvasTermName");
        return root.ToJsonString();
    }
}
