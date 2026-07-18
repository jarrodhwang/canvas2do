using Incos.Workspace.Api.Contracts;
using Incos.Workspace.Api.Data;
using Incos.Workspace.Api.Domain.Entities;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using System.Collections.Concurrent;
using System.Globalization;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;

namespace Incos.Workspace.Api.Endpoints;

public static class CanvasIntegrationEndpoints
{
    private const string CanvasTokenSettingKey = "canvas.token";
    private const string CanvasTokenProtectorPurpose = "incos.workspace.canvas-token.v1";
    private const string CanvasUserAgent = "INCOS-Workspace/1.0 (Canvas LMS integration)";
    private const int CanvasActiveCourseFetchPageSize = 50;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> CanvasActiveCourseCacheLocks = new(StringComparer.Ordinal);

    public static IEndpointRouteBuilder MapCanvasIntegrationEndpoints(this IEndpointRouteBuilder app)
    {
        var canvas = app.MapGroup("/api/canvas")
            .RequireAuthorization();

        canvas.MapGet("/integration", GetCanvasIntegrationStatusAsync)
            .WithName("GetCanvasIntegrationStatus");

        canvas.MapGet("/token", GetCanvasTokenStatusAsync)
            .WithName("GetCanvasTokenStatus");

        canvas.MapPut("/token", UpdateCanvasTokenAsync)
            .WithName("UpdateCanvasToken");

        canvas.MapDelete("/token", DeleteCanvasTokenAsync)
            .WithName("DeleteCanvasToken");

        canvas.MapGet("/admin/users/{userId:guid}/token", GetAdminUserCanvasTokenStatusAsync)
            .WithName("GetAdminUserCanvasTokenStatus");

        canvas.MapPut("/admin/users/{userId:guid}/token", UpdateAdminUserCanvasTokenAsync)
            .WithName("UpdateAdminUserCanvasToken");

        canvas.MapDelete("/admin/users/{userId:guid}/token", DeleteAdminUserCanvasTokenAsync)
            .WithName("DeleteAdminUserCanvasToken");

        canvas.MapGet("/courses", GetCanvasCoursesAsync)
            .WithName("GetCanvasCourses");

        canvas.MapGet("/courses/{courseId}/content", GetCanvasCourseContentAsync)
            .WithName("GetCanvasCourseContent");

        canvas.MapGet("/courses/{courseId}/pages", GetCanvasCoursePageAsync)
            .WithName("GetCanvasCoursePage");

        canvas.MapGet("/courses/{courseId}/people", GetCanvasCoursePeopleAsync)
            .WithName("GetCanvasCoursePeople");

        canvas.MapGet("/courses/{courseId}/assignments/{assignmentId}", GetCanvasCourseAssignmentAsync)
            .WithName("GetCanvasCourseAssignment");

        canvas.MapPost("/courses/{courseId}/assignments/{assignmentId}/submit", SubmitCanvasCourseAssignmentAsync)
            .WithName("SubmitCanvasCourseAssignment");

        canvas.MapGet("/courses/{courseId}/quizzes/{quizId}", GetCanvasCourseQuizAsync)
            .WithName("GetCanvasCourseQuiz");

        canvas.MapPost("/courses/{courseId}/quizzes/{quizId}/submissions", StartCanvasCourseQuizAsync)
            .WithName("StartCanvasCourseQuiz");

        canvas.MapGet("/courses/{courseId}/discussion-topics/{topicId}", GetCanvasCourseDiscussionAsync)
            .WithName("GetCanvasCourseDiscussion");

        canvas.MapPost("/courses/{courseId}/discussion-topics/{topicId}/entries", SubmitCanvasCourseDiscussionEntryAsync)
            .WithName("SubmitCanvasCourseDiscussionEntry");

        canvas.MapGet("/courses/{courseId}/files/{fileId}", GetCanvasCourseFileAsync)
            .WithName("GetCanvasCourseFile");

        canvas.MapGet("/courses/{courseId}/module-items/{moduleItemId}", GetCanvasCourseModuleItemAsync)
            .WithName("GetCanvasCourseModuleItem");

        canvas.MapGet("/calendar-items", GetCanvasCalendarItemsAsync)
            .WithName("GetCanvasCalendarItems");

        canvas.MapGet("/inbox-items", GetCanvasInboxItemsAsync)
            .WithName("GetCanvasInboxItems");

        return app;
    }

    private static async Task<IResult> GetCanvasIntegrationStatusAsync(
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        return Results.Ok(new CanvasIntegrationStatusDto(
            "canvas_lms",
            "Canvas LMS",
            connection.Configured,
            connection.Connected,
            connection.Status,
            "",
            connection.InstanceUrl,
            connection.UserName,
            Array.Empty<string>(),
            connection.TokenSource,
            connection.StartsAt,
            connection.ExpiresAt,
            connection.UpdatedAt));
    }

    private static async Task<IResult> GetCanvasTokenStatusAsync(
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        return Results.Ok(ToCanvasTokenStatusDto(connection));
    }

    private static async Task<IResult> UpdateCanvasTokenAsync(
        HttpContext context,
        IHttpClientFactory httpClientFactory,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        UpdateCanvasTokenRequest request,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        if (string.IsNullOrWhiteSpace(userKey))
        {
            return Results.Unauthorized();
        }

        return await UpdateCanvasTokenForUserKeyAsync(
            userKey,
            httpClientFactory,
            db,
            dataProtectionProvider,
            request,
            cancellationToken);
    }

    private static async Task<IResult> DeleteCanvasTokenAsync(
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        if (string.IsNullOrWhiteSpace(userKey))
        {
            return Results.Unauthorized();
        }

        return await DeleteCanvasTokenForUserKeyAsync(
            userKey,
            db,
            dataProtectionProvider,
            cancellationToken);
    }

    private static async Task<IResult> GetAdminUserCanvasTokenStatusAsync(
        Guid userId,
        IncosWorkspaceDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        CancellationToken cancellationToken)
    {
        var userKey = await GetAdminUserKeyAsync(db, userId, cancellationToken);

        if (string.IsNullOrWhiteSpace(userKey))
        {
            return Results.NotFound();
        }

        var connection = await ResolveCanvasConnectionForUserKeyAsync(
            userKey,
            db,
            dataProtectionProvider,
            cancellationToken);

        return Results.Ok(ToCanvasTokenStatusDto(connection));
    }

    private static async Task<IResult> UpdateAdminUserCanvasTokenAsync(
        Guid userId,
        IHttpClientFactory httpClientFactory,
        IncosWorkspaceDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        UpdateCanvasTokenRequest request,
        CancellationToken cancellationToken)
    {
        var userKey = await GetAdminUserKeyAsync(db, userId, cancellationToken);

        if (string.IsNullOrWhiteSpace(userKey))
        {
            return Results.NotFound();
        }

        return await UpdateCanvasTokenForUserKeyAsync(
            userKey,
            httpClientFactory,
            db,
            dataProtectionProvider,
            request,
            cancellationToken);
    }

    private static async Task<IResult> DeleteAdminUserCanvasTokenAsync(
        Guid userId,
        IncosWorkspaceDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        CancellationToken cancellationToken)
    {
        var userKey = await GetAdminUserKeyAsync(db, userId, cancellationToken);

        if (string.IsNullOrWhiteSpace(userKey))
        {
            return Results.NotFound();
        }

        return await DeleteCanvasTokenForUserKeyAsync(
            userKey,
            db,
            dataProtectionProvider,
            cancellationToken);
    }

    private static async Task<IResult> GetCanvasCoursesAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        IMemoryCache memoryCache,
        string? courseId,
        int? pageSize,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        var instanceUrl = connection.InstanceUrl!;
        var accessToken = connection.AccessToken!;
        var safePageSize = Math.Clamp(pageSize ?? 5, 1, 50);
        var userCacheKey = GetUserKey(context) ??
            context.User.FindFirstValue(ClaimTypes.NameIdentifier) ??
            "unknown";

        try
        {
            var courses = await GetCachedActiveStudentCoursesAsync(
                memoryCache,
                httpClientFactory,
                instanceUrl,
                accessToken,
                userCacheKey,
                safePageSize,
                cancellationToken);

            return Results.Ok(new CanvasCoursesDto(courses, GetCommonTermName(courses)));
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task<IResult> GetCanvasCalendarItemsAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        IMemoryCache memoryCache,
        string? startDate,
        string? endDate,
        int? pageSize,
        bool? forceRefresh,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        var instanceUrl = connection.InstanceUrl!;
        var accessToken = connection.AccessToken!;
        var startAt = ParseCanvasDate(startDate) ?? DateTimeOffset.UtcNow.AddDays(-30);
        var endAt = ParseCanvasDate(endDate)?.AddDays(1).AddTicks(-1) ?? startAt.AddDays(60);
        var safePageSize = Math.Clamp(pageSize ?? 100, 1, 100);
        var userCacheKey = GetUserKey(context) ??
            context.User.FindFirstValue(ClaimTypes.NameIdentifier) ??
            "unknown";
        var cacheKey = string.Join(
            ':',
            "canvas-calendar",
            "v2",
            userCacheKey,
            instanceUrl,
            startAt.UtcDateTime.ToString("O", CultureInfo.InvariantCulture),
            endAt.UtcDateTime.ToString("O", CultureInfo.InvariantCulture),
            safePageSize.ToString(CultureInfo.InvariantCulture));

        if (forceRefresh != true &&
            memoryCache.TryGetValue(cacheKey, out CanvasCalendarItemsDto? cachedCalendarItems) &&
            cachedCalendarItems is not null)
        {
            return Results.Ok(cachedCalendarItems);
        }

        try
        {
            var courses = await GetCachedActiveStudentCoursesAsync(
                memoryCache,
                httpClientFactory,
                instanceUrl,
                accessToken,
                userCacheKey,
                50,
                cancellationToken);

            var courseLookup = courses
                .Where(course => !string.IsNullOrWhiteSpace(course.Id))
                .ToDictionary(course => course.Id, StringComparer.OrdinalIgnoreCase);
            var contextCodes = courses
                .Where(course => !string.IsNullOrWhiteSpace(course.Id))
                .Select(course => $"course_{course.Id}")
                .ToArray();
            var assignmentEventsTask = GetCanvasCalendarEventsBestEffortAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                "assignment",
                startAt,
                endAt,
                safePageSize,
                contextCodes,
                cancellationToken);
            var calendarEventsTask = GetCanvasCalendarEventsBestEffortAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                "event",
                startAt,
                endAt,
                safePageSize,
                contextCodes,
                cancellationToken);
            await Task.WhenAll(assignmentEventsTask, calendarEventsTask);

            var assignmentEventsResult = await assignmentEventsTask;
            var calendarEventsResult = await calendarEventsTask;

            if (assignmentEventsResult.Error is not null && calendarEventsResult.Error is not null)
            {
                return Results.Problem(
                    title: "Canvas calendar failed to load.",
                    detail: "Canvas could not provide assignment or event calendar data.",
                    statusCode: GetMostRelevantCanvasStatusCode(assignmentEventsResult.Error, calendarEventsResult.Error));
            }

            var assignmentEvents = assignmentEventsResult.Events;
            var calendarEvents = calendarEventsResult.Events;
            var submissionLookupResult = await GetCanvasAssignmentSubmissionLookupBestEffortAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                assignmentEvents,
                cancellationToken);
            var submissionLookup = submissionLookupResult.Lookup;
            var courseAssignmentItems = await GetCanvasCourseAssignmentCalendarItemsAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                courses,
                startAt,
                endAt,
                submissionLookup,
                cancellationToken);
            var items = assignmentEvents
                .Select(calendarEvent => ParseCanvasCalendarItem(calendarEvent, "assignment", courseLookup, submissionLookup))
                .Concat(courseAssignmentItems)
                .Concat(calendarEvents.Select(calendarEvent => ParseCanvasCalendarItem(calendarEvent, "event", courseLookup, submissionLookup)))
                .Where(item => item is not null)
                .Select(item => item!)
                .GroupBy(GetCanvasCalendarItemDedupeKey, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .OrderBy(item => item.DueAt ?? item.StartAt ?? item.EndAt ?? DateTimeOffset.MaxValue)
                .ToArray();
            var response = new CanvasCalendarItemsDto(items);

            memoryCache.Set(
                cacheKey,
                response,
                new MemoryCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = submissionLookupResult.IsComplete
                        ? TimeSpan.FromMinutes(3)
                        : TimeSpan.FromSeconds(45),
                    SlidingExpiration = submissionLookupResult.IsComplete
                        ? TimeSpan.FromSeconds(45)
                        : TimeSpan.FromSeconds(20),
                });

            return Results.Ok(response);
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task<IResult> GetCanvasCourseContentAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string? section,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        if (string.IsNullOrWhiteSpace(courseId))
        {
            return Results.BadRequest();
        }

        try
        {
            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var encodedCourseId = Uri.EscapeDataString(courseId);
            var requestedSection = NormalizeCanvasCourseContentSection(section);
            var courseQuery = new List<KeyValuePair<string, string?>>
            {
                new("include[]", "term"),
                new("include[]", "total_scores"),
                new("include[]", "syllabus_body"),
            };
            var course = await GetCanvasObjectAsync(
                httpClientFactory,
                accessToken,
                QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/courses/{encodedCourseId}", courseQuery),
                cancellationToken);
            var tabsTask = GetCanvasArrayBestEffortAsync(
                httpClientFactory,
                accessToken,
                QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/courses/{encodedCourseId}/tabs", new Dictionary<string, string?>
                {
                    ["include[]"] = "external",
                    ["per_page"] = "100",
                }),
                cancellationToken);
            var modulesTask = ShouldLoadCanvasCourseContentSection(requestedSection, "modules")
                ? GetCanvasArrayBestEffortAsync(
                httpClientFactory,
                accessToken,
                QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/courses/{encodedCourseId}/modules", new Dictionary<string, string?>
                {
                    ["include[]"] = "items",
                    ["per_page"] = "100",
                }),
                cancellationToken)
                : Task.FromResult(Array.Empty<JsonElement>());
            var announcementsTask = ShouldLoadCanvasCourseContentSection(requestedSection, "announcements") ||
                ShouldLoadCanvasCourseContentSection(requestedSection, "home")
                ? GetCanvasArrayBestEffortAsync(
                httpClientFactory,
                accessToken,
                QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/announcements", new List<KeyValuePair<string, string?>>
                {
                    new("context_codes[]", $"course_{courseId}"),
                    new("per_page", "25"),
                }),
                cancellationToken)
                : Task.FromResult(Array.Empty<JsonElement>());
            var assignmentsTask = ShouldLoadCanvasCourseContentSection(requestedSection, "assignments") ||
                ShouldLoadCanvasCourseContentSection(requestedSection, "grades")
                ? GetCanvasArrayBestEffortAsync(
                httpClientFactory,
                accessToken,
                QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/courses/{encodedCourseId}/assignments", new List<KeyValuePair<string, string?>>
                {
                    new("include[]", "submission"),
                    new("order_by", "due_at"),
                    new("per_page", "100"),
                }),
                cancellationToken)
                : Task.FromResult(Array.Empty<JsonElement>());
            var quizzesTask = ShouldLoadCanvasCourseContentSection(requestedSection, "assignments") ||
                ShouldLoadCanvasCourseContentSection(requestedSection, "grades")
                ? GetCanvasArrayBestEffortAsync(
                httpClientFactory,
                accessToken,
                QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/courses/{encodedCourseId}/quizzes", new Dictionary<string, string?>
                {
                    ["per_page"] = "100",
                }),
                cancellationToken)
                : Task.FromResult(Array.Empty<JsonElement>());
            var discussionsTask = ShouldLoadCanvasCourseContentSection(requestedSection, "announcements")
                ? GetCanvasArrayBestEffortAsync(
                httpClientFactory,
                accessToken,
                QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/courses/{encodedCourseId}/discussion_topics", new Dictionary<string, string?>
                {
                    ["per_page"] = "100",
                }),
                cancellationToken)
                : Task.FromResult(Array.Empty<JsonElement>());
            var pagesTask = ShouldLoadCanvasCourseContentSection(requestedSection, "pages")
                ? GetCanvasArrayBestEffortAsync(
                httpClientFactory,
                accessToken,
                QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/courses/{encodedCourseId}/pages", new Dictionary<string, string?>
                {
                    ["sort"] = "title",
                    ["order"] = "asc",
                    ["per_page"] = "100",
                }),
                cancellationToken)
                : Task.FromResult(Array.Empty<JsonElement>());
            var peopleTask = ShouldLoadCanvasCourseContentSection(requestedSection, "people")
                ? GetCanvasArrayBestEffortAsync(
                httpClientFactory,
                accessToken,
                QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/courses/{encodedCourseId}/users", new List<KeyValuePair<string, string?>>
                {
                    new("include[]", "avatar_url"),
                    new("include[]", "enrollments"),
                    new("per_page", "100"),
                }),
                cancellationToken)
                : Task.FromResult(Array.Empty<JsonElement>());
            var frontPageTask = ShouldLoadCanvasCourseContentSection(requestedSection, "home")
                ? GetCanvasObjectBestEffortAsync(
                httpClientFactory,
                accessToken,
                $"{instanceUrl}/api/v1/courses/{encodedCourseId}/front_page",
                cancellationToken)
                : Task.FromResult<JsonElement?>(null);

            await Task.WhenAll(tabsTask, modulesTask, announcementsTask, assignmentsTask, quizzesTask, discussionsTask, pagesTask, peopleTask, frontPageTask);

            return Results.Ok(new CanvasCourseContentDto(
                ParseCanvasCourse(course, instanceUrl),
                tabsTask.Result.Select(ParseCanvasCourseTab).Where(tab => tab is not null).Select(tab => tab!).ToArray(),
                modulesTask.Result.Select(ParseCanvasCourseModule).Where(module => module is not null).Select(module => module!).ToArray(),
                announcementsTask.Result.Select(ParseCanvasCourseAnnouncement).Where(announcement => announcement is not null).Select(announcement => announcement!).ToArray(),
                assignmentsTask.Result.Select(assignment => ParseCanvasCourseAssignment(assignment)).Where(assignment => assignment is not null).Select(assignment => assignment!).ToArray(),
                quizzesTask.Result.Select(ParseCanvasCourseQuiz).Where(quiz => quiz is not null).Select(quiz => quiz!).ToArray(),
                discussionsTask.Result.Select(discussion => ParseCanvasCourseDiscussion(discussion, false)).Where(discussion => discussion is not null).Select(discussion => discussion!).ToArray(),
                pagesTask.Result.Select(ParseCanvasCoursePage).Where(page => page is not null).Select(page => page!).ToArray(),
                peopleTask.Result.Select(ParseCanvasCourseUser).Where(user => user is not null).Select(user => user!).ToArray(),
                frontPageTask.Result.HasValue ? ParseCanvasCoursePage(frontPageTask.Result.Value) : null,
                ShouldLoadCanvasCourseContentSection(requestedSection, "syllabus") ? GetJsonString(course, "syllabus_body") : null));
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task<IResult> GetCanvasCoursePageAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string pageUrl,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        var normalizedPageUrl = NormalizeCanvasPageUrl(pageUrl);

        if (string.IsNullOrWhiteSpace(courseId) || string.IsNullOrWhiteSpace(normalizedPageUrl))
        {
            return Results.BadRequest();
        }

        try
        {
            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var encodedCourseId = Uri.EscapeDataString(courseId);
            var encodedPageUrl = Uri.EscapeDataString(normalizedPageUrl);
            var page = await GetCanvasObjectAsync(
                httpClientFactory,
                accessToken,
                $"{instanceUrl}/api/v1/courses/{encodedCourseId}/pages/{encodedPageUrl}",
                cancellationToken);

            var parsedPage = ParseCanvasCoursePage(page);

            return parsedPage is null
                ? Results.Problem(
                    title: "Canvas page failed to load.",
                    detail: "Canvas returned an unexpected page response.",
                    statusCode: StatusCodes.Status502BadGateway)
                : Results.Ok(parsedPage);
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task<IResult> GetCanvasCoursePeopleAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        if (string.IsNullOrWhiteSpace(courseId))
        {
            return Results.BadRequest();
        }

        try
        {
            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var encodedCourseId = Uri.EscapeDataString(courseId);
            var requestUri = QueryHelpers.AddQueryString(
                $"{instanceUrl}/api/v1/courses/{encodedCourseId}/users",
                new List<KeyValuePair<string, string?>>
                {
                    new("include[]", "avatar_url"),
                    new("include[]", "bio"),
                    new("include[]", "enrollments"),
                    new("include[]", "uuid"),
                    new("per_page", "100"),
                });
            var people = await GetCanvasArrayAsync(
                httpClientFactory,
                accessToken,
                requestUri,
                cancellationToken);

            return Results.Ok(new CanvasCoursePeopleDto(
                people
                    .Select(ParseCanvasCourseUser)
                    .Where(user => user is not null)
                    .Select(user => user!)
                    .OrderBy(user => user.SortableName ?? user.Name, StringComparer.OrdinalIgnoreCase)
                    .ToArray()));
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static string NormalizeCanvasCourseContentSection(string? section)
    {
        if (string.IsNullOrWhiteSpace(section))
        {
            return "all";
        }

        return section.Trim().ToLowerInvariant() switch
        {
            "home" => "home",
            "modules" or "module" => "modules",
            "announcements" or "announcement" => "announcements",
            "syllabus" => "syllabus",
            "assignments" or "assignment" or "quizzes" or "quiz" => "assignments",
            "pages" or "page" or "wiki" => "pages",
            "people" or "users" or "user" => "people",
            "grades" or "grade" => "grades",
            "all" => "all",
            _ => "home",
        };
    }

    private static bool ShouldLoadCanvasCourseContentSection(string requestedSection, string section)
    {
        return requestedSection == "all" || requestedSection == section;
    }

    private static async Task<IResult> GetCanvasCourseAssignmentAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string assignmentId,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        if (string.IsNullOrWhiteSpace(courseId) || string.IsNullOrWhiteSpace(assignmentId))
        {
            return Results.BadRequest();
        }

        try
        {
            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var encodedCourseId = Uri.EscapeDataString(courseId);
            var encodedAssignmentId = Uri.EscapeDataString(assignmentId);
            var requestUri = QueryHelpers.AddQueryString(
                $"{instanceUrl}/api/v1/courses/{encodedCourseId}/assignments/{encodedAssignmentId}",
                new List<KeyValuePair<string, string?>>
                {
                    new("include[]", "submission"),
                });
            var assignment = await GetCanvasObjectAsync(
                httpClientFactory,
                accessToken,
                requestUri,
                cancellationToken);
            var directSubmissionStatus = await GetCanvasSingleAssignmentSubmissionStatusAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                courseId,
                assignmentId,
                cancellationToken);
            var parsedAssignment = ParseCanvasCourseAssignment(assignment, directSubmissionStatus);

            return parsedAssignment is null
                ? Results.Problem(
                    title: "Canvas assignment failed to load.",
                    detail: "Canvas returned an unexpected assignment response.",
                    statusCode: StatusCodes.Status502BadGateway)
                : Results.Ok(parsedAssignment);
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task<IResult> SubmitCanvasCourseAssignmentAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string assignmentId,
        CanvasAssignmentSubmissionRequest request,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        var submissionType = request.SubmissionType.Trim();
        var fields = new List<KeyValuePair<string, string>>();

        if (submissionType == "online_text_entry")
        {
            if (string.IsNullOrWhiteSpace(request.Body))
            {
                return Results.BadRequest(new
                {
                    title = "Assignment submission is empty.",
                    detail = "Enter text before submitting this assignment.",
                });
            }

            fields.Add(new("submission[submission_type]", submissionType));
            fields.Add(new("submission[body]", request.Body.Trim()));
        }
        else if (submissionType == "online_url")
        {
            var url = request.Url?.Trim();

            if (string.IsNullOrWhiteSpace(url) ||
                !Uri.TryCreate(url, UriKind.Absolute, out var parsedUrl) ||
                (parsedUrl.Scheme != Uri.UriSchemeHttps && parsedUrl.Scheme != Uri.UriSchemeHttp))
            {
                return Results.BadRequest(new
                {
                    title = "Assignment submission URL is invalid.",
                    detail = "Enter a full http or https URL before submitting this assignment.",
                });
            }

            fields.Add(new("submission[submission_type]", submissionType));
            fields.Add(new("submission[url]", parsedUrl.ToString()));
        }
        else
        {
            return Results.BadRequest(new
            {
                title = "Submission type is not supported yet.",
                detail = "This integrated submission form supports text entry and URL submissions. Use Canvas for uploads, media recordings, annotations, or external tool submissions.",
            });
        }

        if (!string.IsNullOrWhiteSpace(request.Comment))
        {
            fields.Add(new("comment[text_comment]", request.Comment.Trim()));
        }

        try
        {
            var submission = await PostCanvasFormObjectAsync(
                httpClientFactory,
                connection.AccessToken!,
                $"{connection.InstanceUrl}/api/v1/courses/{Uri.EscapeDataString(courseId)}/assignments/{Uri.EscapeDataString(assignmentId)}/submissions",
                fields,
                cancellationToken);

            return Results.Ok(ParseCanvasSubmissionResult(submission));
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task<IResult> GetCanvasCourseQuizAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string quizId,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        if (string.IsNullOrWhiteSpace(courseId) || string.IsNullOrWhiteSpace(quizId))
        {
            return Results.BadRequest();
        }

        try
        {
            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var quiz = await GetCanvasObjectAsync(
                httpClientFactory,
                accessToken,
                $"{instanceUrl}/api/v1/courses/{Uri.EscapeDataString(courseId)}/quizzes/{Uri.EscapeDataString(quizId)}",
                cancellationToken);
            var parsedQuiz = ParseCanvasCourseQuiz(quiz);

            return parsedQuiz is null
                ? Results.Problem(
                    title: "Canvas quiz failed to load.",
                    detail: "Canvas returned an unexpected quiz response.",
                    statusCode: StatusCodes.Status502BadGateway)
                : Results.Ok(parsedQuiz);
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task<IResult> StartCanvasCourseQuizAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string quizId,
        CanvasQuizStartRequest request,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        var fields = new List<KeyValuePair<string, string>>();

        if (!string.IsNullOrWhiteSpace(request.AccessCode))
        {
            fields.Add(new("access_code", request.AccessCode.Trim()));
        }

        try
        {
            var submissionResponse = await PostCanvasFormObjectAsync(
                httpClientFactory,
                connection.AccessToken!,
                $"{connection.InstanceUrl}/api/v1/courses/{Uri.EscapeDataString(courseId)}/quizzes/{Uri.EscapeDataString(quizId)}/submissions",
                fields,
                cancellationToken);
            var submission = ParseCanvasQuizSubmissionWrapper(submissionResponse);

            return submission is null
                ? Results.Problem(
                    title: "Canvas quiz attempt failed to start.",
                    detail: "Canvas returned an unexpected quiz submission response.",
                    statusCode: StatusCodes.Status502BadGateway)
                : Results.Ok(submission);
        }
        catch (CanvasApiRequestException exception) when (exception.StatusCode == StatusCodes.Status409Conflict)
        {
            try
            {
                var currentSubmissionResponse = await GetCanvasObjectAsync(
                    httpClientFactory,
                    connection.AccessToken!,
                    $"{connection.InstanceUrl}/api/v1/courses/{Uri.EscapeDataString(courseId)}/quizzes/{Uri.EscapeDataString(quizId)}/submission",
                    cancellationToken);
                var submission = ParseCanvasQuizSubmissionWrapper(currentSubmissionResponse);

                return submission is null
                    ? Results.Problem(
                        title: "Canvas quiz attempt failed to resume.",
                        detail: "Canvas returned an unexpected quiz submission response.",
                        statusCode: StatusCodes.Status502BadGateway)
                    : Results.Ok(submission);
            }
            catch (CanvasApiRequestException currentException)
            {
                return Results.Problem(
                    title: currentException.Title,
                    detail: currentException.Detail,
                    statusCode: currentException.StatusCode);
            }
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task<IResult> GetCanvasCourseDiscussionAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string topicId,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        if (string.IsNullOrWhiteSpace(courseId) || string.IsNullOrWhiteSpace(topicId))
        {
            return Results.BadRequest();
        }

        try
        {
            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var discussion = await GetCanvasObjectAsync(
                httpClientFactory,
                accessToken,
                $"{instanceUrl}/api/v1/courses/{Uri.EscapeDataString(courseId)}/discussion_topics/{Uri.EscapeDataString(topicId)}",
                cancellationToken);
            var parsedDiscussion = ParseCanvasCourseDiscussion(discussion, GetJsonBool(discussion, "is_announcement") == true);

            return parsedDiscussion is null
                ? Results.Problem(
                    title: "Canvas discussion failed to load.",
                    detail: "Canvas returned an unexpected discussion response.",
                    statusCode: StatusCodes.Status502BadGateway)
                : Results.Ok(parsedDiscussion);
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task<IResult> SubmitCanvasCourseDiscussionEntryAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string topicId,
        CanvasDiscussionEntryRequest request,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        if (string.IsNullOrWhiteSpace(request.Message))
        {
            return Results.BadRequest(new
            {
                title = "Discussion reply is empty.",
                detail = "Enter a message before posting to this discussion.",
            });
        }

        var endpoint = string.IsNullOrWhiteSpace(request.ParentEntryId)
            ? $"{connection.InstanceUrl}/api/v1/courses/{Uri.EscapeDataString(courseId)}/discussion_topics/{Uri.EscapeDataString(topicId)}/entries"
            : $"{connection.InstanceUrl}/api/v1/courses/{Uri.EscapeDataString(courseId)}/discussion_topics/{Uri.EscapeDataString(topicId)}/entries/{Uri.EscapeDataString(request.ParentEntryId.Trim())}/replies";

        try
        {
            var entry = await PostCanvasFormObjectAsync(
                httpClientFactory,
                connection.AccessToken!,
                endpoint,
                [new("message", request.Message.Trim())],
                cancellationToken);

            return Results.Ok(ParseCanvasDiscussionEntry(entry));
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task<IResult> GetCanvasCourseFileAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string fileId,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        if (string.IsNullOrWhiteSpace(courseId) || string.IsNullOrWhiteSpace(fileId))
        {
            return Results.BadRequest();
        }

        try
        {
            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var encodedCourseId = Uri.EscapeDataString(courseId);
            var encodedFileId = Uri.EscapeDataString(fileId);
            var file = await GetCanvasObjectAsync(
                httpClientFactory,
                accessToken,
                $"{instanceUrl}/api/v1/courses/{encodedCourseId}/files/{encodedFileId}",
                cancellationToken);
            var parsedFile = ParseCanvasCourseFile(file);

            return parsedFile is null
                ? Results.Problem(
                    title: "Canvas file failed to load.",
                    detail: "Canvas returned an unexpected file response.",
                    statusCode: StatusCodes.Status502BadGateway)
                : Results.Ok(parsedFile);
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task<IResult> GetCanvasCourseModuleItemAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string moduleItemId,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        if (string.IsNullOrWhiteSpace(courseId) || string.IsNullOrWhiteSpace(moduleItemId))
        {
            return Results.BadRequest();
        }

        try
        {
            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var item = await GetCanvasObjectAsync(
                httpClientFactory,
                accessToken,
                $"{instanceUrl}/api/v1/courses/{Uri.EscapeDataString(courseId)}/modules/items/{Uri.EscapeDataString(moduleItemId)}",
                cancellationToken);
            var parsedItem = ParseCanvasCourseModuleItem(item);

            return parsedItem is null
                ? Results.Problem(
                    title: "Canvas module item failed to load.",
                    detail: "Canvas returned an unexpected module item response.",
                    statusCode: StatusCodes.Status502BadGateway)
                : Results.Ok(parsedItem);
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task<IResult> GetCanvasInboxItemsAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string? courseId,
        int? pageSize,
        CancellationToken cancellationToken)
    {
        var connection = await ResolveCanvasConnectionAsync(
            context,
            db,
            configuration,
            dataProtectionProvider,
            cancellationToken);

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        var instanceUrl = connection.InstanceUrl!;
        var accessToken = connection.AccessToken!;
        var safePageSize = Math.Clamp(pageSize ?? 50, 1, 100);

        try
        {
            var courses = await GetActiveStudentCoursesAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                50,
                cancellationToken);
            var courseLookup = courses
                .Where(course => !string.IsNullOrWhiteSpace(course.Id))
                .ToDictionary(course => course.Id, StringComparer.OrdinalIgnoreCase);
            var safeCourseId = courseId?.Trim();
            var query = new List<KeyValuePair<string, string?>>
            {
                new("per_page", Math.Min(safePageSize, 100).ToString(CultureInfo.InvariantCulture)),
            };

            if (string.IsNullOrWhiteSpace(safeCourseId))
            {
                query.Add(new("only_active_courses", "true"));
            }

            var requestPath = string.IsNullOrWhiteSpace(safeCourseId)
                ? $"{instanceUrl}/api/v1/users/self/activity_stream"
                : $"{instanceUrl}/api/v1/courses/{Uri.EscapeDataString(safeCourseId)}/activity_stream";
            var requestUri = QueryHelpers.AddQueryString(requestPath, query);
            var inboxItems = new List<CanvasInboxItemDto>();

            while (!string.IsNullOrWhiteSpace(requestUri) && inboxItems.Count < safePageSize)
            {
                var page = await SendCanvasGetPageAsync(
                    httpClientFactory,
                    accessToken,
                    requestUri,
                    cancellationToken);

                using var document = JsonDocument.Parse(page.Payload);

                if (document.RootElement.ValueKind != JsonValueKind.Array)
                {
                    throw new CanvasApiRequestException(
                        "Canvas inbox failed to load.",
                        "Canvas returned an unexpected activity stream response.",
                        StatusCodes.Status502BadGateway);
                }

                inboxItems.AddRange(document.RootElement
                    .EnumerateArray()
                    .Select(activityItem => ParseCanvasInboxItem(activityItem, courseLookup, safeCourseId))
                    .Where(item => item is not null)
                    .Select(item => item!)
                    .Where(item => string.IsNullOrWhiteSpace(safeCourseId) ||
                                   string.Equals(item.CourseId, safeCourseId, StringComparison.OrdinalIgnoreCase)));

                requestUri = page.NextUrl;
            }

            return Results.Ok(new CanvasInboxItemsDto(
                inboxItems
                    .GroupBy(item => item.Id, StringComparer.OrdinalIgnoreCase)
                    .Select(group => group.First())
                    .OrderByDescending(item => item.UpdatedAt ?? item.CreatedAt ?? DateTimeOffset.MinValue)
                    .Take(safePageSize)
                    .ToArray()));
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task<CanvasConnection> ResolveCanvasConnectionAsync(
        HttpContext context,
        IncosWorkspaceDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        return await ResolveCanvasConnectionForUserKeyAsync(
            userKey,
            db,
            dataProtectionProvider,
            cancellationToken);
    }

    private static async Task<CanvasConnection> ResolveCanvasConnectionForUserKeyAsync(
        string? userKey,
        IncosWorkspaceDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(userKey))
        {
            return CanvasConnection.None();
        }

        await WorkspaceEndpoints.EnsureUserSettingsTableAsync(db, cancellationToken);

        var setting = await db.UserSettings
            .AsNoTracking()
            .OrderBy(userSetting => userSetting.UserKey == userKey ? 0 : 1)
            .FirstOrDefaultAsync(
                userSetting =>
                    userSetting.UserKey.ToLower() == userKey &&
                    userSetting.SettingKey == CanvasTokenSettingKey,
                cancellationToken);

        if (setting is null)
        {
            return CanvasConnection.None();
        }

        var storedToken = TryReadStoredCanvasToken(setting.SettingJson);

        if (storedToken is null)
        {
            return CanvasConnection.Invalid();
        }

        try
        {
            var protector = dataProtectionProvider.CreateProtector(CanvasTokenProtectorPurpose);
            var accessToken = protector.Unprotect(storedToken.ProtectedAccessToken);
            var now = DateTimeOffset.UtcNow;
            var status = GetCanvasTokenStatus(storedToken.StartsAt, storedToken.ExpiresAt, now);
            var usableAccessToken = status == "connected" ? accessToken : null;

            return new CanvasConnection(
                storedToken.InstanceUrl,
                usableAccessToken,
                "user",
                status,
                storedToken.StartsAt,
                storedToken.ExpiresAt,
                storedToken.UpdatedAt,
                storedToken.UserName);
        }
        catch
        {
            return CanvasConnection.Invalid();
        }
    }

    public static async Task<IResult> UpdateCanvasTokenForUserKeyAsync(
        string userKey,
        IHttpClientFactory httpClientFactory,
        IncosWorkspaceDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        UpdateCanvasTokenRequest request,
        CancellationToken cancellationToken)
    {
        var normalizedUserKey = userKey.Trim().ToLowerInvariant();
        var instanceUrl = NormalizeCanvasInstanceUrl(request.InstanceUrl);
        var accessToken = request.AccessToken.Trim();

        if (string.IsNullOrWhiteSpace(instanceUrl) || !IsSecureCanvasInstanceUrl(instanceUrl))
        {
            return Results.BadRequest(new
            {
                title = "Canvas instance URL is invalid.",
                detail = "Use the HTTPS root URL for your institution Canvas instance.",
            });
        }

        if (string.IsNullOrWhiteSpace(accessToken) || accessToken.Length > 8192)
        {
            return Results.BadRequest(new
            {
                title = "Canvas API token is invalid.",
                detail = "Enter a Canvas API access token.",
            });
        }

        var startsAt = request.StartsAt ?? DateTimeOffset.UtcNow;
        var expiresAt = request.ExpiresAt;

        if (expiresAt.HasValue && expiresAt <= startsAt)
        {
            return Results.BadRequest(new
            {
                title = "Canvas token expiration is invalid.",
                detail = "The expiration date must be after the start date.",
            });
        }

        string? userName;

        try
        {
            var profile = await GetCanvasObjectAsync(
                httpClientFactory,
                accessToken,
                $"{instanceUrl}/api/v1/users/self/profile",
                cancellationToken);

            userName =
                GetJsonString(profile, "name") ??
                GetJsonString(profile, "short_name") ??
                GetJsonString(profile, "login_id");
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: "Canvas token could not be verified.",
                detail: "Canvas rejected the token or the instance URL. The token was not stored.",
                statusCode: exception.StatusCode is StatusCodes.Status401Unauthorized or StatusCodes.Status403Forbidden
                    ? StatusCodes.Status401Unauthorized
                    : StatusCodes.Status502BadGateway);
        }

        await WorkspaceEndpoints.EnsureUserSettingsTableAsync(db, cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var setting = await db.UserSettings
            .OrderBy(userSetting => userSetting.UserKey == normalizedUserKey ? 0 : 1)
            .FirstOrDefaultAsync(
                userSetting =>
                    userSetting.UserKey.ToLower() == normalizedUserKey &&
                    userSetting.SettingKey == CanvasTokenSettingKey,
                cancellationToken);

        if (setting is null)
        {
            setting = new UserSetting
            {
                Id = Guid.NewGuid(),
                CreatedAt = now,
                UserKey = normalizedUserKey,
                SettingKey = CanvasTokenSettingKey,
            };
            db.UserSettings.Add(setting);
        }

        setting.UserKey = normalizedUserKey;
        var protector = dataProtectionProvider.CreateProtector(CanvasTokenProtectorPurpose);
        setting.SettingJson = JsonSerializer.Serialize(
            new StoredCanvasToken(
                instanceUrl,
                protector.Protect(accessToken),
                startsAt,
                expiresAt,
                now,
                userName),
            JsonOptions);
        setting.UpdatedAt = now;

        await db.SaveChangesAsync(cancellationToken);

        var connection = await ResolveCanvasConnectionForUserKeyAsync(
            normalizedUserKey,
            db,
            dataProtectionProvider,
            cancellationToken);

        return Results.Ok(ToCanvasTokenStatusDto(connection));
    }

    private static async Task<IResult> DeleteCanvasTokenForUserKeyAsync(
        string userKey,
        IncosWorkspaceDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        CancellationToken cancellationToken)
    {
        var normalizedUserKey = userKey.Trim().ToLowerInvariant();
        await WorkspaceEndpoints.EnsureUserSettingsTableAsync(db, cancellationToken);

        var setting = await db.UserSettings
            .OrderBy(userSetting => userSetting.UserKey == normalizedUserKey ? 0 : 1)
            .FirstOrDefaultAsync(
                userSetting =>
                    userSetting.UserKey.ToLower() == normalizedUserKey &&
                    userSetting.SettingKey == CanvasTokenSettingKey,
                cancellationToken);

        if (setting is not null)
        {
            db.UserSettings.Remove(setting);
            await db.SaveChangesAsync(cancellationToken);
        }

        var connection = await ResolveCanvasConnectionForUserKeyAsync(
            normalizedUserKey,
            db,
            dataProtectionProvider,
            cancellationToken);

        return Results.Ok(ToCanvasTokenStatusDto(connection));
    }

    private static async Task<string?> GetAdminUserKeyAsync(
        IncosWorkspaceDbContext db,
        Guid userId,
        CancellationToken cancellationToken)
    {
        await GoogleIntegrationEndpoints.EnsureAdminUsersTableAsync(db, cancellationToken);

        var user = await db.AdminUsers
            .AsNoTracking()
            .FirstOrDefaultAsync(adminUser => adminUser.Id == userId, cancellationToken);

        return string.IsNullOrWhiteSpace(user?.Email)
            ? null
            : user.Email.Trim().ToLowerInvariant();
    }

    private static CanvasTokenStatusDto ToCanvasTokenStatusDto(CanvasConnection connection) =>
        new(
            connection.Configured,
            connection.Connected,
            connection.Status,
            connection.InstanceUrl,
            connection.TokenSource,
            connection.StartsAt,
            connection.ExpiresAt,
            connection.UpdatedAt,
            connection.UserName);

    private static StoredCanvasToken? TryReadStoredCanvasToken(string settingJson)
    {
        if (string.IsNullOrWhiteSpace(settingJson))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<StoredCanvasToken>(settingJson, JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string GetCanvasTokenStatus(
        DateTimeOffset? startsAt,
        DateTimeOffset? expiresAt,
        DateTimeOffset now)
    {
        if (startsAt.HasValue && startsAt > now)
        {
            return "pending";
        }

        if (expiresAt.HasValue && expiresAt <= now)
        {
            return "expired";
        }

        return "connected";
    }

    private static IResult CreateCanvasConnectionProblem(CanvasConnection connection)
    {
        var detail = connection.Status switch
        {
            "pending" => "The stored Canvas API token has a future start date.",
            "expired" => "The stored Canvas API token is expired. Update it in Academy Settings.",
            "invalid" => "The stored Canvas API token could not be decrypted. Update it in Academy Settings.",
            _ => "Add a Canvas API token in Academy Settings.",
        };

        return Results.Problem(
            title: "Canvas LMS is not connected.",
            detail: detail,
            statusCode: StatusCodes.Status409Conflict);
    }

    private static bool IsSecureCanvasInstanceUrl(string instanceUrl)
    {
        if (!Uri.TryCreate(instanceUrl, UriKind.Absolute, out var uri))
        {
            return false;
        }

        if (uri.Scheme == Uri.UriSchemeHttps)
        {
            return true;
        }

        return uri.Scheme == Uri.UriSchemeHttp &&
               (uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
                uri.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase));
    }

    private static string? GetUserKey(HttpContext context)
    {
        var email = context.User.FindFirstValue(ClaimTypes.Email);

        return string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();
    }

    private static async Task<CanvasCourseDto[]> GetCachedActiveStudentCoursesAsync(
        IMemoryCache memoryCache,
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        string userCacheKey,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var safePageSize = Math.Clamp(pageSize, 1, 50);
        var courseCacheKey = string.Join(
            ':',
            "canvas-active-courses",
            "v3",
            userCacheKey,
            instanceUrl);

        if (memoryCache.TryGetValue(courseCacheKey, out CanvasCourseDto[]? courses) &&
            courses is not null)
        {
            return courses.Take(safePageSize).ToArray();
        }

        var cacheLock = CanvasActiveCourseCacheLocks.GetOrAdd(courseCacheKey, _ => new SemaphoreSlim(1, 1));
        await cacheLock.WaitAsync(cancellationToken);

        try
        {
            if (memoryCache.TryGetValue(courseCacheKey, out courses) && courses is not null)
            {
                return courses.Take(safePageSize).ToArray();
            }

            courses = await GetActiveStudentCoursesAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                CanvasActiveCourseFetchPageSize,
                cancellationToken);

            memoryCache.Set(
                courseCacheKey,
                courses,
                new MemoryCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5),
                    SlidingExpiration = TimeSpan.FromMinutes(1),
                });

            return courses.Take(safePageSize).ToArray();
        }
        finally
        {
            cacheLock.Release();
        }
    }

    private static async Task<CanvasCourseDto[]> GetActiveStudentCoursesAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var courses = new List<CanvasCourseDto>();
        var query = new List<KeyValuePair<string, string?>>
        {
            new("enrollment_type", "student"),
            new("enrollment_state", "active"),
            new("include[]", "term"),
            new("include[]", "total_scores"),
            new("state[]", "available"),
            new("per_page", Math.Min(pageSize, 50).ToString(CultureInfo.InvariantCulture)),
        };
        var requestUri = QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/courses", query);

        while (!string.IsNullOrWhiteSpace(requestUri) && courses.Count < pageSize)
        {
            var page = await SendCanvasGetPageAsync(
                httpClientFactory,
                accessToken,
                requestUri,
                cancellationToken);

            using var document = JsonDocument.Parse(page.Payload);

            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                throw new CanvasApiRequestException(
                    "Canvas courses failed to load.",
                    "Canvas returned an unexpected courses response.",
                    StatusCodes.Status502BadGateway);
            }

            courses.AddRange(document.RootElement
                .EnumerateArray()
                .Select(course => ParseCanvasCourse(course, instanceUrl))
                .Where(course => !string.IsNullOrWhiteSpace(course.Name)));

            requestUri = page.NextUrl;
        }

        return courses
            .Take(pageSize)
            .ToArray();
    }

    private static CanvasCourseDto ParseCanvasCourse(JsonElement course, string instanceUrl)
    {
        var id = GetJsonStringOrNumber(course, "id") ?? "";
        var name =
            GetJsonString(course, "name") ??
            GetJsonString(course, "original_name") ??
            GetJsonString(course, "course_code") ??
            "Untitled course";
        var htmlUrl = GetJsonString(course, "html_url");

        if (string.IsNullOrWhiteSpace(htmlUrl) && !string.IsNullOrWhiteSpace(id))
        {
            htmlUrl = $"{instanceUrl}/courses/{id}";
        }

        var grade = GetCanvasCourseGrade(course);

        return new CanvasCourseDto(
            id,
            name,
            GetJsonString(course, "course_code"),
            GetCanvasTermName(course),
            GetJsonString(course, "workflow_state"),
            GetJsonDateTimeOffset(course, "start_at"),
            GetJsonDateTimeOffset(course, "end_at"),
            htmlUrl,
            grade.CurrentScore,
            grade.CurrentGrade);
    }

    private static async Task<JsonElement[]> GetCanvasCalendarEventsAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        string type,
        DateTimeOffset startAt,
        DateTimeOffset endAt,
        int pageSize,
        string[] contextCodes,
        CancellationToken cancellationToken)
    {
        var contextCodeBatches = contextCodes.Length > 0
            ? contextCodes.Chunk(10).Select(batch => batch.ToArray()).ToArray()
            : new[] { Array.Empty<string>() };
        using var concurrencyGate = new SemaphoreSlim(8);
        var batchTasks = contextCodeBatches.Select(async contextCodeBatch =>
        {
            await concurrencyGate.WaitAsync(cancellationToken);

            try
            {
                return await GetCanvasCalendarEventsBatchAsync(
                    httpClientFactory,
                    instanceUrl,
                    accessToken,
                    type,
                    startAt,
                    endAt,
                    pageSize,
                    contextCodeBatch,
                    cancellationToken);
            }
            finally
            {
                concurrencyGate.Release();
            }
        });
        var batchEvents = await Task.WhenAll(batchTasks);

        return batchEvents.SelectMany(events => events).ToArray();
    }

    private static async Task<CanvasCalendarEventsResult> GetCanvasCalendarEventsBestEffortAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        string type,
        DateTimeOffset startAt,
        DateTimeOffset endAt,
        int pageSize,
        string[] contextCodes,
        CancellationToken cancellationToken)
    {
        try
        {
            var events = await GetCanvasCalendarEventsAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                type,
                startAt,
                endAt,
                pageSize,
                contextCodes,
                cancellationToken);

            return new CanvasCalendarEventsResult(events, null);
        }
        catch (CanvasApiRequestException exception)
        {
            return new CanvasCalendarEventsResult([], exception);
        }
    }

    private static int GetMostRelevantCanvasStatusCode(
        CanvasApiRequestException firstException,
        CanvasApiRequestException secondException)
    {
        return firstException.StatusCode is >= 400 and < 500
            ? firstException.StatusCode
            : secondException.StatusCode;
    }

    private static async Task<JsonElement[]> GetCanvasCalendarEventsBatchAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        string type,
        DateTimeOffset startAt,
        DateTimeOffset endAt,
        int pageSize,
        string[] contextCodeBatch,
        CancellationToken cancellationToken)
    {
        var events = new List<JsonElement>();
        var query = new List<KeyValuePair<string, string?>>
        {
            new("type", type),
            new("start_date", startAt.ToString("O", CultureInfo.InvariantCulture)),
            new("end_date", endAt.ToString("O", CultureInfo.InvariantCulture)),
            new("per_page", Math.Min(pageSize, 100).ToString(CultureInfo.InvariantCulture)),
        };

        foreach (var contextCode in contextCodeBatch)
        {
            query.Add(new KeyValuePair<string, string?>("context_codes[]", contextCode));
        }

        var requestUri = QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/calendar_events", query);

        while (!string.IsNullOrWhiteSpace(requestUri))
        {
            var page = await SendCanvasGetPageAsync(
                httpClientFactory,
                accessToken,
                requestUri,
                cancellationToken);

            using var document = JsonDocument.Parse(page.Payload);

            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                throw new CanvasApiRequestException(
                    "Canvas calendar failed to load.",
                    "Canvas returned an unexpected calendar response.",
                    StatusCodes.Status502BadGateway);
            }

            events.AddRange(document.RootElement
                .EnumerateArray()
                .Select(calendarEvent => calendarEvent.Clone()));

            requestUri = page.NextUrl;
        }

        return events.ToArray();
    }

    private static async Task<CanvasCalendarItemDto[]> GetCanvasCourseAssignmentCalendarItemsAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        CanvasCourseDto[] courses,
        DateTimeOffset startAt,
        DateTimeOffset endAt,
        IReadOnlyDictionary<string, CanvasSubmissionStatus> submissionLookup,
        CancellationToken cancellationToken)
    {
        using var concurrencyGate = new SemaphoreSlim(4);
        var courseTasks = courses
            .Where(course => !string.IsNullOrWhiteSpace(course.Id))
            .Select(async course =>
            {
                await concurrencyGate.WaitAsync(cancellationToken);

                try
                {
                    return await GetCanvasCourseAssignmentCalendarItemsForCourseAsync(
                        httpClientFactory,
                        instanceUrl,
                        accessToken,
                        course,
                        startAt,
                        endAt,
                        submissionLookup,
                        cancellationToken);
                }
                catch (CanvasApiRequestException)
                {
                    return [];
                }
                finally
                {
                    concurrencyGate.Release();
                }
            });
        var courseItems = await Task.WhenAll(courseTasks);

        return courseItems.SelectMany(items => items).ToArray();
    }

    private static async Task<CanvasCalendarItemDto[]> GetCanvasCourseAssignmentCalendarItemsForCourseAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        CanvasCourseDto course,
        DateTimeOffset startAt,
        DateTimeOffset endAt,
        IReadOnlyDictionary<string, CanvasSubmissionStatus> submissionLookup,
        CancellationToken cancellationToken)
    {
        var assignments = new List<CanvasCalendarItemDto>();
        var query = new List<KeyValuePair<string, string?>>
        {
            new("include[]", "submission"),
            new("order_by", "due_at"),
            new("per_page", "100"),
        };
        var requestUri = QueryHelpers.AddQueryString(
            $"{instanceUrl}/api/v1/courses/{Uri.EscapeDataString(course.Id)}/assignments",
            query);

        while (!string.IsNullOrWhiteSpace(requestUri))
        {
            var page = await SendCanvasGetPageAsync(
                httpClientFactory,
                accessToken,
                requestUri,
                cancellationToken);

            using var document = JsonDocument.Parse(page.Payload);

            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                throw new CanvasApiRequestException(
                    "Canvas assignments failed to load.",
                    "Canvas returned an unexpected assignments response.",
                    StatusCodes.Status502BadGateway);
            }

            assignments.AddRange(document.RootElement
                .EnumerateArray()
                .Select(assignment => ParseCanvasAssignmentCalendarItem(assignment, course, startAt, endAt, submissionLookup))
                .Where(item => item is not null)
                .Select(item => item!));

            requestUri = page.NextUrl;
        }

        return assignments.ToArray();
    }

    private static CanvasCalendarItemDto? ParseCanvasAssignmentCalendarItem(
        JsonElement assignment,
        CanvasCourseDto course,
        DateTimeOffset startAt,
        DateTimeOffset endAt,
        IReadOnlyDictionary<string, CanvasSubmissionStatus> submissionLookup)
    {
        var assignmentId = GetJsonStringOrNumber(assignment, "id");
        var title = GetJsonString(assignment, "name");
        var dueAt = GetJsonDateTimeOffset(assignment, "due_at");

        if (string.IsNullOrWhiteSpace(assignmentId) ||
            string.IsNullOrWhiteSpace(title) ||
            !dueAt.HasValue ||
            dueAt.Value < startAt ||
            dueAt.Value > endAt)
        {
            return null;
        }

        var submissionStatus = GetCanvasAssignmentSubmissionStatus(assignment);
        if (submissionLookup.TryGetValue(GetAssignmentSubmissionLookupKey(course.Id, assignmentId), out var lookupStatus))
        {
            submissionStatus = lookupStatus;
        }
        var contextCode = $"course_{course.Id}";

        return new CanvasCalendarItemDto(
            $"canvas-assignment-{course.Id}-{assignmentId}",
            title,
            GetCanvasCalendarItemType(title, "assignment", assignment),
            course.Id,
            course.CourseCode,
            course.Name,
            dueAt,
            dueAt,
            dueAt,
            GetJsonString(assignment, "html_url"),
            contextCode,
            GetJsonStringArray(assignment, "submission_types"),
            assignmentId,
            submissionStatus.IsSubmitted,
            submissionStatus.SubmittedAt);
    }

    private static string GetCanvasCalendarItemDedupeKey(CanvasCalendarItemDto item)
    {
        return !string.IsNullOrWhiteSpace(item.CourseId) && !string.IsNullOrWhiteSpace(item.AssignmentId)
            ? $"assignment:{item.CourseId}:{item.AssignmentId}"
            : item.Id;
    }

    private static async Task<(IReadOnlyDictionary<string, CanvasSubmissionStatus> Lookup, bool IsComplete)> GetCanvasAssignmentSubmissionLookupBestEffortAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        JsonElement[] assignmentEvents,
        CancellationToken cancellationToken)
    {
        using var timeoutCancellationToken = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCancellationToken.CancelAfter(TimeSpan.FromSeconds(3));

        try
        {
            var lookup = await GetCanvasAssignmentSubmissionLookupAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                assignmentEvents,
                timeoutCancellationToken.Token);

            return (lookup, true);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return (new Dictionary<string, CanvasSubmissionStatus>(StringComparer.OrdinalIgnoreCase), false);
        }
    }

    private static async Task<IReadOnlyDictionary<string, CanvasSubmissionStatus>> GetCanvasAssignmentSubmissionLookupAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        JsonElement[] assignmentEvents,
        CancellationToken cancellationToken)
    {
        var assignmentReferences = assignmentEvents
            .Select(GetCanvasAssignmentReference)
            .Where(reference => reference is not null)
            .Select(reference => reference!)
            .DistinctBy(reference => GetAssignmentSubmissionLookupKey(reference.CourseId, reference.AssignmentId))
            .GroupBy(reference => reference.CourseId, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (assignmentReferences.Length == 0)
        {
            return new Dictionary<string, CanvasSubmissionStatus>(StringComparer.OrdinalIgnoreCase);
        }

        var submissionTasks = assignmentReferences.Select(group => GetCanvasCourseSubmissionLookupAsync(
            httpClientFactory,
            instanceUrl,
            accessToken,
            group.Key,
            group.Select(reference => reference.AssignmentId).ToArray(),
            cancellationToken));
        var submissionGroups = await Task.WhenAll(submissionTasks);
        var lookup = new Dictionary<string, CanvasSubmissionStatus>(StringComparer.OrdinalIgnoreCase);

        foreach (var submissionGroup in submissionGroups)
        {
            foreach (var submission in submissionGroup)
            {
                lookup[submission.Key] = submission.Value;
            }
        }

        return lookup;
    }

    private static async Task<IReadOnlyDictionary<string, CanvasSubmissionStatus>> GetCanvasCourseSubmissionLookupAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        string courseId,
        string[] assignmentIds,
        CancellationToken cancellationToken,
        bool ignoreRequestFailures = true)
    {
        var lookup = new Dictionary<string, CanvasSubmissionStatus>(StringComparer.OrdinalIgnoreCase);

        foreach (var assignmentIdBatch in assignmentIds.Chunk(50))
        {
            var query = new List<KeyValuePair<string, string?>>
            {
                new("student_ids[]", "self"),
                new("per_page", "100"),
            };

            foreach (var assignmentId in assignmentIdBatch)
            {
                query.Add(new KeyValuePair<string, string?>("assignment_ids[]", assignmentId));
            }

            var requestUri = QueryHelpers.AddQueryString(
                $"{instanceUrl}/api/v1/courses/{Uri.EscapeDataString(courseId)}/students/submissions",
                query);

            try
            {
                while (!string.IsNullOrWhiteSpace(requestUri))
                {
                    var page = await SendCanvasGetPageAsync(
                        httpClientFactory,
                        accessToken,
                        requestUri,
                        cancellationToken);

                    using var document = JsonDocument.Parse(page.Payload);

                    if (document.RootElement.ValueKind != JsonValueKind.Array)
                    {
                        break;
                    }

                    foreach (var submission in document.RootElement.EnumerateArray())
                    {
                        var assignmentId = GetJsonStringOrNumber(submission, "assignment_id");

                        if (string.IsNullOrWhiteSpace(assignmentId))
                        {
                            continue;
                        }

                        lookup[GetAssignmentSubmissionLookupKey(courseId, assignmentId)] =
                            GetCanvasSubmissionStatus(submission);
                    }

                    requestUri = page.NextUrl;
                }
            }
            catch (CanvasApiRequestException)
            {
                if (!ignoreRequestFailures)
                {
                    throw;
                }

                // Submission status is a helpful enhancement, but calendar data should still render without it.
            }
        }

        return lookup;
    }

    private static async Task<CanvasSubmissionStatus> GetCanvasSingleAssignmentSubmissionStatusAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        string courseId,
        string assignmentId,
        CancellationToken cancellationToken)
    {
        var lookup = await GetCanvasCourseSubmissionLookupAsync(
            httpClientFactory,
            instanceUrl,
            accessToken,
            courseId,
            [assignmentId],
            cancellationToken,
            ignoreRequestFailures: false);

        return lookup.TryGetValue(GetAssignmentSubmissionLookupKey(courseId, assignmentId), out var status)
            ? status
            : new CanvasSubmissionStatus(false, null);
    }

    private static CanvasAssignmentReference? GetCanvasAssignmentReference(JsonElement calendarEvent)
    {
        var assignment = GetJsonObject(calendarEvent, "assignment");
        var assignmentId = assignment.HasValue
            ? GetJsonStringOrNumber(assignment.Value, "id")
            : GetJsonStringOrNumber(calendarEvent, "assignment_id");
        var courseId = GetCourseId(GetJsonString(calendarEvent, "context_code")) ??
            (assignment.HasValue ? GetJsonStringOrNumber(assignment.Value, "course_id") : null);

        return string.IsNullOrWhiteSpace(courseId) || string.IsNullOrWhiteSpace(assignmentId)
            ? null
            : new CanvasAssignmentReference(courseId, assignmentId);
    }

    private static CanvasCalendarItemDto? ParseCanvasCalendarItem(
        JsonElement calendarEvent,
        string calendarType,
        IReadOnlyDictionary<string, CanvasCourseDto> courses,
        IReadOnlyDictionary<string, CanvasSubmissionStatus> submissionLookup)
    {
        var assignment = GetJsonObject(calendarEvent, "assignment");
        var id =
            GetJsonStringOrNumber(calendarEvent, "id") ??
            (assignment.HasValue ? GetJsonStringOrNumber(assignment.Value, "id") : null);

        if (string.IsNullOrWhiteSpace(id))
        {
            return null;
        }

        var contextCode = GetJsonString(calendarEvent, "context_code");
        var courseId = GetCourseId(contextCode) ??
            (assignment.HasValue ? GetJsonStringOrNumber(assignment.Value, "course_id") : null);
        courses.TryGetValue(courseId ?? "", out var course);
        var assignmentId = assignment.HasValue ? GetJsonStringOrNumber(assignment.Value, "id") : null;
        var submissionStatus = assignment.HasValue
            ? GetCanvasAssignmentSubmissionStatus(assignment.Value)
            : new CanvasSubmissionStatus(false, null);

        if (!string.IsNullOrWhiteSpace(courseId) && !string.IsNullOrWhiteSpace(assignmentId) &&
            submissionLookup.TryGetValue(GetAssignmentSubmissionLookupKey(courseId, assignmentId), out var lookupStatus))
        {
            submissionStatus = lookupStatus;
        }

        var title =
            GetJsonString(calendarEvent, "title") ??
            (assignment.HasValue ? GetJsonString(assignment.Value, "name") : null) ??
            "Canvas item";
        var allDayDate = GetJsonDateTimeOffset(calendarEvent, "all_day_date");
        var startAt = GetJsonDateTimeOffset(calendarEvent, "start_at") ?? allDayDate;
        var endAt = GetJsonDateTimeOffset(calendarEvent, "end_at") ?? allDayDate;
        var dueAt = assignment.HasValue ? GetJsonDateTimeOffset(assignment.Value, "due_at") : null;
        var htmlUrl =
            GetJsonString(calendarEvent, "html_url") ??
            (assignment.HasValue ? GetJsonString(assignment.Value, "html_url") : null);
        var submissionTypes = assignment.HasValue
            ? GetJsonStringArray(assignment.Value, "submission_types")
            : [];
        var type = GetCanvasCalendarItemType(title, calendarType, assignment);

        return new CanvasCalendarItemDto(
            $"canvas-{calendarType}-{id}",
            title,
            type,
            courseId,
            course?.CourseCode,
            course?.Name,
            startAt,
            endAt,
            dueAt ?? startAt,
            htmlUrl,
            contextCode,
            submissionTypes,
            assignmentId,
            submissionStatus.IsSubmitted,
            submissionStatus.SubmittedAt);
    }

    private static CanvasInboxItemDto? ParseCanvasInboxItem(
        JsonElement activityItem,
        IReadOnlyDictionary<string, CanvasCourseDto> courses,
        string? fallbackCourseId = null)
    {
        var id = GetJsonStringOrNumber(activityItem, "id");

        if (string.IsNullOrWhiteSpace(id))
        {
            return null;
        }

        var courseId =
            GetJsonStringOrNumber(activityItem, "course_id") ??
            GetCourseId(GetJsonString(activityItem, "context_code")) ??
            fallbackCourseId;
        courses.TryGetValue(courseId ?? "", out var course);
        var title =
            GetJsonString(activityItem, "title") ??
            GetJsonString(activityItem, "subject") ??
            "Canvas notification";
        var type = GetJsonString(activityItem, "type") ?? "notification";
        var htmlUrl =
            GetJsonString(activityItem, "html_url") ??
            GetJsonString(activityItem, "url");

        return new CanvasInboxItemDto(
            $"canvas-inbox-{id}",
            title,
            GetJsonString(activityItem, "message"),
            type,
            courseId,
            course?.CourseCode,
            course?.Name,
            GetJsonDateTimeOffset(activityItem, "created_at"),
            GetJsonDateTimeOffset(activityItem, "updated_at"),
            htmlUrl,
            GetJsonString(activityItem, "read_state"));
    }

    private static CanvasCourseTabDto? ParseCanvasCourseTab(JsonElement tab)
    {
        var id = GetJsonStringOrNumber(tab, "id");
        var label = GetJsonString(tab, "label");

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(label))
        {
            return null;
        }

        return new CanvasCourseTabDto(
            id,
            label,
            GetJsonString(tab, "type"),
            GetJsonString(tab, "visibility"),
            GetJsonBool(tab, "hidden") == true,
            GetJsonString(tab, "html_url"));
    }

    private static CanvasCourseModuleDto? ParseCanvasCourseModule(JsonElement module)
    {
        var id = GetJsonStringOrNumber(module, "id");
        var name = GetJsonString(module, "name");

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        var items = module.TryGetProperty("items", out var moduleItems) &&
                    moduleItems.ValueKind == JsonValueKind.Array
            ? moduleItems
                .EnumerateArray()
                .Select(ParseCanvasCourseModuleItem)
                .Where(item => item is not null)
                .Select(item => item!)
                .ToArray()
            : [];

        return new CanvasCourseModuleDto(
            id,
            name,
            GetJsonInt(module, "position"),
            GetJsonInt(module, "items_count"),
            items);
    }

    private static CanvasCourseModuleItemDto? ParseCanvasCourseModuleItem(JsonElement item)
    {
        var id = GetJsonStringOrNumber(item, "id");
        var title = GetJsonString(item, "title");

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(title))
        {
            return null;
        }

        var completionRequirement = GetJsonObject(item, "completion_requirement");

        return new CanvasCourseModuleItemDto(
            id,
            title,
            GetJsonString(item, "type"),
            GetJsonStringOrNumber(item, "content_id"),
            GetJsonString(item, "page_url"),
            GetJsonString(item, "url"),
            GetJsonString(item, "html_url"),
            GetJsonString(item, "external_url"),
            completionRequirement.HasValue
                ? GetJsonDateTimeOffset(completionRequirement.Value, "completed_at")
                : null);
    }

    private static CanvasCourseAnnouncementDto? ParseCanvasCourseAnnouncement(JsonElement announcement)
    {
        var id = GetJsonStringOrNumber(announcement, "id");
        var title = GetJsonString(announcement, "title");

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(title))
        {
            return null;
        }

        return new CanvasCourseAnnouncementDto(
            id,
            title,
            GetJsonString(announcement, "message"),
            GetJsonDateTimeOffset(announcement, "posted_at") ??
            GetJsonDateTimeOffset(announcement, "created_at"),
            GetJsonString(announcement, "html_url"));
    }

    private static CanvasCourseAssignmentDto? ParseCanvasCourseAssignment(
        JsonElement assignment,
        CanvasSubmissionStatus? directSubmissionStatus = null)
    {
        var id = GetJsonStringOrNumber(assignment, "id");
        var name = GetJsonString(assignment, "name");

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        var submission = GetJsonObject(assignment, "submission");
        var submissionStatus = directSubmissionStatus ?? GetCanvasAssignmentSubmissionStatus(assignment);

        return new CanvasCourseAssignmentDto(
            id,
            name,
            GetJsonString(assignment, "description"),
            GetJsonDateTimeOffset(assignment, "due_at"),
            GetJsonDouble(assignment, "points_possible"),
            GetJsonString(assignment, "html_url"),
            GetJsonStringArray(assignment, "submission_types"),
            submissionStatus.IsSubmitted,
            submission.HasValue ? GetJsonDouble(submission.Value, "score") : null,
            submission.HasValue ? GetJsonString(submission.Value, "grade") : null,
            submissionStatus.SubmittedAt ?? (submission.HasValue ? GetJsonDateTimeOffset(submission.Value, "submitted_at") : null),
            submission.HasValue ? GetJsonString(submission.Value, "workflow_state") : null,
            GetJsonBool(assignment, "use_rubric_for_grading"),
            ParseCanvasRubricSettings(GetJsonObject(assignment, "rubric_settings")),
            ParseCanvasRubricCriteria(assignment));
    }

    private static CanvasCourseQuizDto? ParseCanvasCourseQuiz(JsonElement quiz)
    {
        var id = GetJsonStringOrNumber(quiz, "id");
        var title = GetJsonString(quiz, "title");

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(title))
        {
            return null;
        }

        return new CanvasCourseQuizDto(
            id,
            title,
            GetJsonString(quiz, "description"),
            GetJsonDateTimeOffset(quiz, "due_at"),
            GetJsonDouble(quiz, "points_possible"),
            GetJsonString(quiz, "html_url"),
            GetJsonString(quiz, "quiz_type"),
            GetJsonInt(quiz, "question_count"),
            GetJsonInt(quiz, "allowed_attempts"),
            GetJsonStringOrNumber(quiz, "assignment_id"));
    }

    private static CanvasCourseDiscussionDto? ParseCanvasCourseDiscussion(JsonElement discussion, bool fallbackAnnouncement)
    {
        var id = GetJsonStringOrNumber(discussion, "id");
        var title = GetJsonString(discussion, "title");

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(title))
        {
            return null;
        }

        var author = GetJsonObject(discussion, "author");

        return new CanvasCourseDiscussionDto(
            id,
            title,
            GetJsonString(discussion, "message"),
            GetJsonDateTimeOffset(discussion, "posted_at") ??
            GetJsonDateTimeOffset(discussion, "created_at"),
            GetJsonString(discussion, "html_url"),
            author.HasValue ? GetJsonString(author.Value, "display_name") ?? GetJsonString(author.Value, "name") : null,
            GetJsonBool(discussion, "is_announcement") ?? fallbackAnnouncement,
            GetJsonStringOrNumber(discussion, "assignment_id"));
    }

    private static CanvasRubricSettingsDto? ParseCanvasRubricSettings(JsonElement? settings)
    {
        if (!settings.HasValue)
        {
            return null;
        }

        return new CanvasRubricSettingsDto(
            GetJsonStringOrNumber(settings.Value, "id") ??
            GetJsonStringOrNumber(settings.Value, "rubric_id"),
            GetJsonString(settings.Value, "title"),
            GetJsonDouble(settings.Value, "points_possible"),
            GetJsonBool(settings.Value, "hide_score_total"),
            GetJsonBool(settings.Value, "hide_points"),
            GetJsonBool(settings.Value, "free_form_criterion_comments"));
    }

    private static CanvasRubricCriterionDto[] ParseCanvasRubricCriteria(JsonElement assignment)
    {
        var rubric = GetJsonArray(assignment, "rubric");

        if (!rubric.HasValue)
        {
            return [];
        }

        return rubric.Value
            .EnumerateArray()
            .Where(criterion => criterion.ValueKind == JsonValueKind.Object)
            .Select(ParseCanvasRubricCriterion)
            .Where(criterion => criterion is not null)
            .Select(criterion => criterion!)
            .ToArray();
    }

    private static CanvasRubricCriterionDto? ParseCanvasRubricCriterion(JsonElement criterion)
    {
        var id = GetJsonStringOrNumber(criterion, "id");

        if (string.IsNullOrWhiteSpace(id))
        {
            return null;
        }

        return new CanvasRubricCriterionDto(
            id,
            GetJsonString(criterion, "description"),
            GetJsonString(criterion, "long_description"),
            GetJsonDouble(criterion, "points"),
            GetJsonBool(criterion, "criterion_use_range") == true,
            GetJsonBool(criterion, "ignore_for_scoring") == true,
            ParseCanvasRubricRatings(criterion));
    }

    private static CanvasRubricRatingDto[] ParseCanvasRubricRatings(JsonElement criterion)
    {
        var ratings = GetJsonArray(criterion, "ratings");

        if (!ratings.HasValue)
        {
            return [];
        }

        return ratings.Value
            .EnumerateArray()
            .Where(rating => rating.ValueKind == JsonValueKind.Object)
            .Select(ParseCanvasRubricRating)
            .Where(rating => rating is not null)
            .Select(rating => rating!)
            .ToArray();
    }

    private static CanvasRubricRatingDto? ParseCanvasRubricRating(JsonElement rating)
    {
        var id =
            GetJsonStringOrNumber(rating, "id") ??
            GetJsonStringOrNumber(rating, "criterion_id") ??
            GetJsonString(rating, "description");

        if (string.IsNullOrWhiteSpace(id))
        {
            return null;
        }

        return new CanvasRubricRatingDto(
            id,
            GetJsonString(rating, "description"),
            GetJsonString(rating, "long_description"),
            GetJsonDouble(rating, "points"));
    }

    private static CanvasSubmissionResultDto ParseCanvasSubmissionResult(JsonElement submission)
    {
        var workflowState = GetJsonString(submission, "workflow_state") ?? "submitted";
        var submittedAt = GetJsonDateTimeOffset(submission, "submitted_at") ?? DateTimeOffset.UtcNow;

        return new CanvasSubmissionResultDto(
            true,
            workflowState,
            "Submission sent to Canvas.",
            GetJsonString(submission, "html_url") ?? GetJsonString(submission, "preview_url"),
            submittedAt);
    }

    private static CanvasDiscussionEntryDto ParseCanvasDiscussionEntry(JsonElement entry)
    {
        var author = GetJsonObject(entry, "author");

        return new CanvasDiscussionEntryDto(
            GetJsonStringOrNumber(entry, "id") ?? "",
            GetJsonString(entry, "message"),
            GetJsonDateTimeOffset(entry, "created_at") ?? GetJsonDateTimeOffset(entry, "updated_at"),
            author.HasValue ? GetJsonString(author.Value, "display_name") ?? GetJsonString(author.Value, "name") : null,
            GetJsonString(entry, "html_url"));
    }

    private static CanvasQuizSubmissionDto? ParseCanvasQuizSubmissionWrapper(JsonElement response)
    {
        var submissions = GetJsonArray(response, "quiz_submissions");
        var submission = submissions?.EnumerateArray().FirstOrDefault();

        if (submission is null || submission.Value.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return ParseCanvasQuizSubmission(submission.Value);
    }

    private static CanvasQuizSubmissionDto? ParseCanvasQuizSubmission(JsonElement submission)
    {
        var id = GetJsonStringOrNumber(submission, "id");
        var quizId = GetJsonStringOrNumber(submission, "quiz_id");

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(quizId))
        {
            return null;
        }

        return new CanvasQuizSubmissionDto(
            id,
            quizId,
            GetJsonStringOrNumber(submission, "submission_id"),
            GetJsonInt(submission, "attempt"),
            GetJsonString(submission, "workflow_state"),
            GetJsonString(submission, "validation_token"),
            GetJsonDateTimeOffset(submission, "started_at"),
            GetJsonDateTimeOffset(submission, "finished_at"),
            GetJsonDateTimeOffset(submission, "end_at"),
            GetJsonString(submission, "html_url"));
    }

    private static CanvasCoursePageDto? ParseCanvasCoursePage(JsonElement page)
    {
        var pageUrl = GetJsonString(page, "url");
        var id = GetJsonStringOrNumber(page, "page_id") ??
            GetJsonStringOrNumber(page, "id") ??
            pageUrl;
        var title = GetJsonString(page, "title");

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(title))
        {
            return null;
        }

        return new CanvasCoursePageDto(
            id,
            title,
            pageUrl,
            GetJsonString(page, "body"),
            GetJsonString(page, "html_url"),
            GetJsonDateTimeOffset(page, "updated_at"));
    }

    private static CanvasCourseFileDto? ParseCanvasCourseFile(JsonElement file)
    {
        var id = GetJsonStringOrNumber(file, "id");
        var displayName =
            GetJsonString(file, "display_name") ??
            GetJsonString(file, "filename") ??
            GetJsonString(file, "uuid");

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(displayName))
        {
            return null;
        }

        return new CanvasCourseFileDto(
            id,
            displayName,
            GetJsonString(file, "filename"),
            GetJsonString(file, "content-type") ?? GetJsonString(file, "content_type"),
            GetJsonString(file, "url"),
            GetJsonString(file, "preview_url"),
            GetJsonString(file, "html_url"),
            GetJsonInt(file, "size"),
            GetJsonDateTimeOffset(file, "updated_at"));
    }

    private static CanvasCourseUserDto? ParseCanvasCourseUser(JsonElement user)
    {
        var id = GetJsonStringOrNumber(user, "id");
        var name = GetJsonString(user, "name") ?? GetJsonString(user, "short_name");

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        var enrollments = user.TryGetProperty("enrollments", out var enrollmentsElement) &&
                          enrollmentsElement.ValueKind == JsonValueKind.Array
            ? enrollmentsElement.EnumerateArray().ToArray()
            : [];
        var roles = enrollments
            .Select(enrollment => GetJsonString(enrollment, "role") ?? GetJsonString(enrollment, "type"))
            .Where(role => !string.IsNullOrWhiteSpace(role))
            .Select(role => role!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var enrollmentStates = enrollments
            .Select(enrollment => GetJsonString(enrollment, "enrollment_state"))
            .Where(state => !string.IsNullOrWhiteSpace(state))
            .Select(state => state!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var sectionIds = enrollments
            .Select(enrollment => GetJsonStringOrNumber(enrollment, "course_section_id"))
            .Where(sectionId => !string.IsNullOrWhiteSpace(sectionId))
            .Select(sectionId => sectionId!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return new CanvasCourseUserDto(
            id,
            name,
            GetJsonString(user, "short_name"),
            GetJsonString(user, "sortable_name"),
            GetJsonString(user, "avatar_url"),
            roles,
            GetJsonString(user, "login_id"),
            GetJsonString(user, "email"),
            GetJsonString(user, "bio"),
            enrollmentStates,
            sectionIds);
    }

    private static string NormalizeCanvasPageUrl(string pageUrl)
    {
        var trimmedPageUrl = pageUrl.Trim();

        if (Uri.TryCreate(trimmedPageUrl, UriKind.Absolute, out var pageUri))
        {
            trimmedPageUrl = pageUri.AbsolutePath;
        }

        var pagesSegmentIndex = trimmedPageUrl.IndexOf("/pages/", StringComparison.OrdinalIgnoreCase);

        if (pagesSegmentIndex >= 0)
        {
            trimmedPageUrl = trimmedPageUrl[(pagesSegmentIndex + "/pages/".Length)..];
        }

        var queryIndex = trimmedPageUrl.IndexOfAny(['?', '#']);

        if (queryIndex >= 0)
        {
            trimmedPageUrl = trimmedPageUrl[..queryIndex];
        }

        return Uri.UnescapeDataString(trimmedPageUrl.Trim('/'));
    }

    private static string GetAssignmentSubmissionLookupKey(string courseId, string assignmentId)
    {
        return $"{courseId}:{assignmentId}";
    }

    private static bool IsCanvasAssignmentSubmitted(JsonElement assignment)
    {
        return GetCanvasAssignmentSubmissionStatus(assignment).IsSubmitted;
    }

    private static CanvasSubmissionStatus GetCanvasAssignmentSubmissionStatus(JsonElement assignment)
    {
        var submission = GetJsonObject(assignment, "submission");

        return submission.HasValue
            ? GetCanvasSubmissionStatus(submission.Value)
            : new CanvasSubmissionStatus(false, null);
    }

    private static bool IsCanvasSubmissionSubmitted(JsonElement submission)
    {
        return GetCanvasSubmissionStatus(submission).IsSubmitted;
    }

    private static CanvasSubmissionStatus GetCanvasSubmissionStatus(JsonElement submission)
    {
        var submittedAt = GetJsonDateTimeOffset(submission, "submitted_at");

        if (GetJsonBool(submission, "excused") == true || submittedAt.HasValue)
        {
            return new CanvasSubmissionStatus(true, submittedAt);
        }

        var workflowState = GetJsonString(submission, "workflow_state");

        return new CanvasSubmissionStatus(
            workflowState is "submitted" or "graded" or "pending_review" or "complete",
            null);
    }

    private sealed record CanvasAssignmentReference(string CourseId, string AssignmentId);
    private sealed record CanvasSubmissionStatus(bool IsSubmitted, DateTimeOffset? SubmittedAt);

    private static async Task<JsonElement> GetCanvasObjectAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUri,
        CancellationToken cancellationToken)
    {
        var page = await SendCanvasGetPageAsync(
            httpClientFactory,
            accessToken,
            requestUri,
            cancellationToken);

        using var document = JsonDocument.Parse(page.Payload);

        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            throw new CanvasApiRequestException(
                "Canvas course failed to load.",
                "Canvas returned an unexpected course response.",
                StatusCodes.Status502BadGateway);
        }

        return document.RootElement.Clone();
    }

    private static async Task<JsonElement?> GetCanvasObjectBestEffortAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUri,
        CancellationToken cancellationToken)
    {
        try
        {
            return await GetCanvasObjectAsync(httpClientFactory, accessToken, requestUri, cancellationToken);
        }
        catch (CanvasApiRequestException)
        {
            return null;
        }
    }

    private static async Task<JsonElement[]> GetCanvasArrayBestEffortAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUri,
        CancellationToken cancellationToken)
    {
        try
        {
            return await GetCanvasArrayAsync(httpClientFactory, accessToken, requestUri, cancellationToken);
        }
        catch (CanvasApiRequestException)
        {
            return [];
        }
    }

    private static async Task<JsonElement[]> GetCanvasArrayAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUri,
        CancellationToken cancellationToken)
    {
        var items = new List<JsonElement>();
        var nextRequestUri = requestUri;

        while (!string.IsNullOrWhiteSpace(nextRequestUri))
        {
            var page = await SendCanvasGetPageAsync(
                httpClientFactory,
                accessToken,
                nextRequestUri,
                cancellationToken);

            using var document = JsonDocument.Parse(page.Payload);

            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                throw new CanvasApiRequestException(
                    "Canvas course content failed to load.",
                    "Canvas returned an unexpected course content response.",
                    StatusCodes.Status502BadGateway);
            }

            items.AddRange(document.RootElement.EnumerateArray().Select(item => item.Clone()));
            nextRequestUri = page.NextUrl;
        }

        return items.ToArray();
    }

    private static async Task<CanvasApiPage> SendCanvasGetPageAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUri,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
        AddCanvasRequestHeaders(request, accessToken);

        var response = await httpClientFactory
            .CreateClient()
            .SendAsync(request, cancellationToken);
        var payload = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw CreateCanvasRequestException(response.StatusCode);
        }

        return new CanvasApiPage(payload, GetNextLinkUrl(response));
    }

    private static async Task<JsonElement> PostCanvasFormObjectAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUri,
        IEnumerable<KeyValuePair<string, string>> fields,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, requestUri);
        AddCanvasRequestHeaders(request, accessToken);
        request.Content = new FormUrlEncodedContent(fields);

        var response = await httpClientFactory
            .CreateClient()
            .SendAsync(request, cancellationToken);
        var payload = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw CreateCanvasRequestException(response.StatusCode);
        }

        using var document = JsonDocument.Parse(payload);

        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            throw new CanvasApiRequestException(
                "Canvas request failed.",
                "Canvas returned an unexpected response.",
                StatusCodes.Status502BadGateway);
        }

        return document.RootElement.Clone();
    }

    private static void AddCanvasRequestHeaders(HttpRequestMessage request, string accessToken)
    {
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.TryAddWithoutValidation("User-Agent", CanvasUserAgent);
    }

    private static CanvasApiRequestException CreateCanvasRequestException(System.Net.HttpStatusCode statusCode)
    {
        if (statusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden)
        {
            return new CanvasApiRequestException(
                "Canvas access was denied.",
                "Canvas rejected the saved token or this account no longer has access. Paste a current Canvas API token in Academy Settings, then refresh.",
                StatusCodes.Status409Conflict);
        }

        if (statusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            return new CanvasApiRequestException(
                "Canvas is temporarily rate limited.",
                "Canvas asked the workspace to slow down. Wait a moment, then refresh.",
                StatusCodes.Status429TooManyRequests);
        }

        if ((int)statusCode >= StatusCodes.Status500InternalServerError)
        {
            return new CanvasApiRequestException(
                "Canvas is temporarily unavailable.",
                "Canvas could not complete this request. Try again in a moment.",
                StatusCodes.Status502BadGateway);
        }

        return new CanvasApiRequestException(
            "Canvas request failed.",
            $"Canvas could not complete this request (HTTP {(int)statusCode}).",
            (int)statusCode);
    }

    private static string? GetNextLinkUrl(HttpResponseMessage response)
    {
        if (!response.Headers.TryGetValues("Link", out var linkHeaders))
        {
            return null;
        }

        foreach (var linkHeader in linkHeaders)
        {
            foreach (var linkPart in linkHeader.Split(','))
            {
                var sections = linkPart
                    .Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

                if (sections.Length < 2 ||
                    !sections[0].StartsWith('<') ||
                    !sections[0].EndsWith('>'))
                {
                    continue;
                }

                var relation = sections.FirstOrDefault(section =>
                    section.Equals("rel=\"next\"", StringComparison.OrdinalIgnoreCase) ||
                    section.Equals("rel=next", StringComparison.OrdinalIgnoreCase));

                if (relation is not null)
                {
                    return sections[0][1..^1];
                }
            }
        }

        return null;
    }

    private static string? GetCommonTermName(CanvasCourseDto[] courses)
    {
        var termNames = courses
            .Select(course => course.TermName)
            .Where(termName => !string.IsNullOrWhiteSpace(termName))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(2)
            .ToArray();

        return termNames.Length == 1 ? termNames[0] : null;
    }

    private static string? NormalizeCanvasInstanceUrl(string? instanceUrl)
    {
        if (string.IsNullOrWhiteSpace(instanceUrl))
        {
            return null;
        }

        return instanceUrl.Trim().TrimEnd('/');
    }

    private static string? GetCanvasTermName(JsonElement course)
    {
        if (!course.TryGetProperty("term", out var term) || term.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return GetJsonString(term, "name");
    }

    private static (double? CurrentScore, string? CurrentGrade) GetCanvasCourseGrade(JsonElement course)
    {
        if (!course.TryGetProperty("enrollments", out var enrollments) ||
            enrollments.ValueKind != JsonValueKind.Array)
        {
            return (null, null);
        }

        foreach (var enrollment in enrollments.EnumerateArray())
        {
            if (enrollment.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var score =
                GetJsonDouble(enrollment, "computed_current_score") ??
                GetJsonDouble(enrollment, "current_score");
            var grade =
                GetJsonString(enrollment, "computed_current_grade") ??
                GetJsonString(enrollment, "current_grade");

            if (score.HasValue || !string.IsNullOrWhiteSpace(grade))
            {
                return (score, grade);
            }
        }

        return (null, null);
    }

    private static JsonElement? GetJsonObject(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) &&
               property.ValueKind == JsonValueKind.Object
            ? property
            : null;
    }

    private static JsonElement? GetJsonArray(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) &&
               property.ValueKind == JsonValueKind.Array
            ? property
            : null;
    }

    private static string? GetCourseId(string? contextCode)
    {
        const string coursePrefix = "course_";

        return !string.IsNullOrWhiteSpace(contextCode) &&
               contextCode.StartsWith(coursePrefix, StringComparison.OrdinalIgnoreCase)
            ? contextCode[coursePrefix.Length..]
            : null;
    }

    private static DateTimeOffset? ParseCanvasDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal,
            out var parsedValue)
            ? parsedValue
            : null;
    }

    private static string GetCanvasCalendarItemType(
        string title,
        string calendarType,
        JsonElement? assignment)
    {
        var searchableTitle = title.ToLowerInvariant();

        if (searchableTitle.Contains("midterm", StringComparison.OrdinalIgnoreCase) ||
            searchableTitle.Contains("final", StringComparison.OrdinalIgnoreCase) ||
            searchableTitle.Contains("exam", StringComparison.OrdinalIgnoreCase))
        {
            return "exam";
        }

        if (assignment.HasValue && assignment.Value.TryGetProperty("quiz_id", out var quizId) &&
            quizId.ValueKind != JsonValueKind.Null)
        {
            return "quiz";
        }

        if (searchableTitle.Contains("quiz", StringComparison.OrdinalIgnoreCase))
        {
            return "quiz";
        }

        if ((assignment.HasValue && assignment.Value.TryGetProperty("discussion_topic", out _)) ||
            searchableTitle.Contains("discussion", StringComparison.OrdinalIgnoreCase))
        {
            return "discussion";
        }

        if (searchableTitle.Contains("activity", StringComparison.OrdinalIgnoreCase))
        {
            return "activity";
        }

        if (calendarType == "event")
        {
            if (searchableTitle.Contains("lecture", StringComparison.OrdinalIgnoreCase) ||
                searchableTitle.Contains("class", StringComparison.OrdinalIgnoreCase))
            {
                return "lecture";
            }

            if (searchableTitle.Contains("lab", StringComparison.OrdinalIgnoreCase))
            {
                return "lab";
            }

            if (searchableTitle.Contains("office", StringComparison.OrdinalIgnoreCase))
            {
                return "meeting";
            }
        }

        return calendarType == "event" ? "event" : "assignment";
    }

    private static string? GetJsonString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) &&
               property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
    }

    private static string? GetJsonStringOrNumber(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        return property.ValueKind switch
        {
            JsonValueKind.String => property.GetString(),
            JsonValueKind.Number => property.TryGetInt64(out var value)
                ? value.ToString(CultureInfo.InvariantCulture)
                : property.GetRawText(),
            _ => null,
        };
    }

    private static string[] GetJsonStringArray(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property) ||
            property.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return property
            .EnumerateArray()
            .Where(item => item.ValueKind == JsonValueKind.String)
            .Select(item => item.GetString())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .ToArray();
    }

    private static bool? GetJsonBool(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        return property.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(property.GetString(), out var value) => value,
            _ => null,
        };
    }

    private static int? GetJsonInt(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var numberValue))
        {
            return numberValue;
        }

        if (property.ValueKind == JsonValueKind.String &&
            int.TryParse(property.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var stringValue))
        {
            return stringValue;
        }

        return null;
    }

    private static double? GetJsonDouble(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        if (property.ValueKind == JsonValueKind.Number && property.TryGetDouble(out var numberValue))
        {
            return numberValue;
        }

        if (property.ValueKind == JsonValueKind.String &&
            double.TryParse(property.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var stringValue))
        {
            return stringValue;
        }

        return null;
    }

    private static DateTimeOffset? GetJsonDateTimeOffset(JsonElement element, string propertyName)
    {
        var value = GetJsonString(element, propertyName);

        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal,
            out var parsedValue)
            ? parsedValue
            : null;
    }

    private sealed record StoredCanvasToken(
        string InstanceUrl,
        string ProtectedAccessToken,
        DateTimeOffset? StartsAt,
        DateTimeOffset? ExpiresAt,
        DateTimeOffset? UpdatedAt,
        string? UserName);

    private sealed record CanvasConnection(
        string? InstanceUrl,
        string? AccessToken,
        string TokenSource,
        string Status,
        DateTimeOffset? StartsAt,
        DateTimeOffset? ExpiresAt,
        DateTimeOffset? UpdatedAt,
        string? UserName)
    {
        public bool Configured => !string.IsNullOrWhiteSpace(InstanceUrl) && Status != "needs_connection";
        public bool Connected => !string.IsNullOrWhiteSpace(InstanceUrl) &&
                                 !string.IsNullOrWhiteSpace(AccessToken) &&
                                 Status == "connected";

        public static CanvasConnection None() =>
            new(null, null, "none", "needs_connection", null, null, null, null);

        public static CanvasConnection Invalid() =>
            new(null, null, "user", "invalid", null, null, null, null);
    }

    private sealed record CanvasApiPage(string Payload, string? NextUrl);
    private sealed record CanvasCalendarEventsResult(JsonElement[] Events, CanvasApiRequestException? Error);

    private sealed class CanvasApiRequestException(string title, string detail, int statusCode) : Exception(title)
    {
        public string Title { get; } = title;
        public string Detail { get; } = detail;
        public int StatusCode { get; } = statusCode;
    }
}
