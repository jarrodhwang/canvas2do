using Incos.Workspace.Api.Contracts;
using Microsoft.AspNetCore.WebUtilities;
using System.Globalization;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Incos.Workspace.Api.Endpoints;

public static class CanvasIntegrationEndpoints
{
    public static IEndpointRouteBuilder MapCanvasIntegrationEndpoints(this IEndpointRouteBuilder app)
    {
        var canvas = app.MapGroup("/api/canvas")
            .RequireAuthorization();

        canvas.MapGet("/integration", (IConfiguration configuration) =>
            {
                var instanceUrl = NormalizeCanvasInstanceUrl(configuration["Authentication:Canvas:InstanceUrl"]);
                var accessToken = configuration["Authentication:Canvas:AccessToken"];
                var isConfigured =
                    !string.IsNullOrWhiteSpace(instanceUrl) &&
                    !string.IsNullOrWhiteSpace(accessToken);

                return Results.Ok(new
                {
                    provider = "canvas_lms",
                    label = "Canvas LMS",
                    configured = isConfigured,
                    connected = isConfigured,
                    status = isConfigured ? "connected" : "needs_connection",
                    connectUrl = "",
                    instanceUrl,
                    userName = (string?)null,
                    scopes = Array.Empty<string>(),
                });
            })
            .WithName("GetCanvasIntegrationStatus");

        canvas.MapGet("/courses", GetCanvasCoursesAsync)
            .WithName("GetCanvasCourses");

        canvas.MapGet("/courses/{courseId}/content", GetCanvasCourseContentAsync)
            .WithName("GetCanvasCourseContent");

        canvas.MapGet("/calendar-items", GetCanvasCalendarItemsAsync)
            .WithName("GetCanvasCalendarItems");

        canvas.MapGet("/inbox-items", GetCanvasInboxItemsAsync)
            .WithName("GetCanvasInboxItems");

        return app;
    }

    private static async Task<IResult> GetCanvasCoursesAsync(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        int? pageSize,
        CancellationToken cancellationToken)
    {
        var instanceUrl = NormalizeCanvasInstanceUrl(configuration["Authentication:Canvas:InstanceUrl"]);
        var accessToken = configuration["Authentication:Canvas:AccessToken"];

        if (string.IsNullOrWhiteSpace(instanceUrl) || string.IsNullOrWhiteSpace(accessToken))
        {
            return Results.Problem(
                title: "Canvas LMS is not connected.",
                detail: "Add CANVAS_INSTANCE_URL and CANVAS_ACCESS_TOKEN to the API environment.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var safePageSize = Math.Clamp(pageSize ?? 5, 1, 50);

        try
        {
            var courses = await GetActiveStudentCoursesAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
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
        IConfiguration configuration,
        string? startDate,
        string? endDate,
        int? pageSize,
        CancellationToken cancellationToken)
    {
        var instanceUrl = NormalizeCanvasInstanceUrl(configuration["Authentication:Canvas:InstanceUrl"]);
        var accessToken = configuration["Authentication:Canvas:AccessToken"];

        if (string.IsNullOrWhiteSpace(instanceUrl) || string.IsNullOrWhiteSpace(accessToken))
        {
            return Results.Problem(
                title: "Canvas LMS is not connected.",
                detail: "Add CANVAS_INSTANCE_URL and CANVAS_ACCESS_TOKEN to the API environment.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var startAt = ParseCanvasDate(startDate) ?? DateTimeOffset.UtcNow.AddDays(-30);
        var endAt = ParseCanvasDate(endDate)?.AddDays(1).AddTicks(-1) ?? startAt.AddDays(60);
        var safePageSize = Math.Clamp(pageSize ?? 100, 1, 100);

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
            var contextCodes = courses
                .Where(course => !string.IsNullOrWhiteSpace(course.Id))
                .Select(course => $"course_{course.Id}")
                .ToArray();
            var assignmentEvents = await GetCanvasCalendarEventsAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                "assignment",
                startAt,
                endAt,
                safePageSize,
                contextCodes,
                cancellationToken);
            var calendarEvents = await GetCanvasCalendarEventsAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                "event",
                startAt,
                endAt,
                safePageSize,
                contextCodes,
                cancellationToken);
            var submissionLookup = await GetCanvasAssignmentSubmissionLookupAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                assignmentEvents,
                cancellationToken);
            var items = assignmentEvents
                .Select(calendarEvent => ParseCanvasCalendarItem(calendarEvent, "assignment", courseLookup, submissionLookup))
                .Concat(calendarEvents.Select(calendarEvent => ParseCanvasCalendarItem(calendarEvent, "event", courseLookup, submissionLookup)))
                .Where(item => item is not null)
                .Select(item => item!)
                .GroupBy(item => item.Id, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .OrderBy(item => item.DueAt ?? item.StartAt ?? item.EndAt ?? DateTimeOffset.MaxValue)
                .ToArray();

            return Results.Ok(new CanvasCalendarItemsDto(items));
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
        IConfiguration configuration,
        string courseId,
        CancellationToken cancellationToken)
    {
        var instanceUrl = NormalizeCanvasInstanceUrl(configuration["Authentication:Canvas:InstanceUrl"]);
        var accessToken = configuration["Authentication:Canvas:AccessToken"];

        if (string.IsNullOrWhiteSpace(instanceUrl) || string.IsNullOrWhiteSpace(accessToken))
        {
            return Results.Problem(
                title: "Canvas LMS is not connected.",
                detail: "Add CANVAS_INSTANCE_URL and CANVAS_ACCESS_TOKEN to the API environment.",
                statusCode: StatusCodes.Status409Conflict);
        }

        if (string.IsNullOrWhiteSpace(courseId))
        {
            return Results.BadRequest();
        }

        try
        {
            var encodedCourseId = Uri.EscapeDataString(courseId);
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
            var modulesTask = GetCanvasArrayBestEffortAsync(
                httpClientFactory,
                accessToken,
                QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/courses/{encodedCourseId}/modules", new Dictionary<string, string?>
                {
                    ["include[]"] = "items",
                    ["per_page"] = "100",
                }),
                cancellationToken);
            var announcementsTask = GetCanvasArrayBestEffortAsync(
                httpClientFactory,
                accessToken,
                QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/announcements", new List<KeyValuePair<string, string?>>
                {
                    new("context_codes[]", $"course_{courseId}"),
                    new("per_page", "25"),
                }),
                cancellationToken);
            var assignmentsTask = GetCanvasArrayBestEffortAsync(
                httpClientFactory,
                accessToken,
                QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/courses/{encodedCourseId}/assignments", new List<KeyValuePair<string, string?>>
                {
                    new("include[]", "submission"),
                    new("bucket", "future"),
                    new("order_by", "due_at"),
                    new("per_page", "100"),
                }),
                cancellationToken);

            await Task.WhenAll(tabsTask, modulesTask, announcementsTask, assignmentsTask);

            return Results.Ok(new CanvasCourseContentDto(
                ParseCanvasCourse(course, instanceUrl),
                tabsTask.Result.Select(ParseCanvasCourseTab).Where(tab => tab is not null).Select(tab => tab!).ToArray(),
                modulesTask.Result.Select(ParseCanvasCourseModule).Where(module => module is not null).Select(module => module!).ToArray(),
                announcementsTask.Result.Select(ParseCanvasCourseAnnouncement).Where(announcement => announcement is not null).Select(announcement => announcement!).ToArray(),
                assignmentsTask.Result.Select(ParseCanvasCourseAssignment).Where(assignment => assignment is not null).Select(assignment => assignment!).ToArray(),
                GetJsonString(course, "syllabus_body")));
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
        IConfiguration configuration,
        int? pageSize,
        CancellationToken cancellationToken)
    {
        var instanceUrl = NormalizeCanvasInstanceUrl(configuration["Authentication:Canvas:InstanceUrl"]);
        var accessToken = configuration["Authentication:Canvas:AccessToken"];

        if (string.IsNullOrWhiteSpace(instanceUrl) || string.IsNullOrWhiteSpace(accessToken))
        {
            return Results.Problem(
                title: "Canvas LMS is not connected.",
                detail: "Add CANVAS_INSTANCE_URL and CANVAS_ACCESS_TOKEN to the API environment.",
                statusCode: StatusCodes.Status409Conflict);
        }

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
            var query = new List<KeyValuePair<string, string?>>
            {
                new("only_active_courses", "true"),
                new("per_page", Math.Min(safePageSize, 100).ToString(CultureInfo.InvariantCulture)),
            };
            var requestUri = QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/users/self/activity_stream", query);
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
                    .Select(activityItem => ParseCanvasInboxItem(activityItem, courseLookup))
                    .Where(item => item is not null)
                    .Select(item => item!));

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
        var events = new List<JsonElement>();
        var contextCodeBatches = contextCodes.Length > 0
            ? contextCodes.Chunk(10)
            : new[] { Array.Empty<string>() };

        foreach (var contextCodeBatch in contextCodeBatches)
        {
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
        }

        return events.ToArray();
    }

    private static async Task<IReadOnlyDictionary<string, bool>> GetCanvasAssignmentSubmissionLookupAsync(
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
            return new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        }

        var submissionTasks = assignmentReferences.Select(group => GetCanvasCourseSubmissionLookupAsync(
            httpClientFactory,
            instanceUrl,
            accessToken,
            group.Key,
            group.Select(reference => reference.AssignmentId).ToArray(),
            cancellationToken));
        var submissionGroups = await Task.WhenAll(submissionTasks);
        var lookup = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);

        foreach (var submissionGroup in submissionGroups)
        {
            foreach (var submission in submissionGroup)
            {
                lookup[submission.Key] = submission.Value;
            }
        }

        return lookup;
    }

    private static async Task<IReadOnlyDictionary<string, bool>> GetCanvasCourseSubmissionLookupAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        string courseId,
        string[] assignmentIds,
        CancellationToken cancellationToken)
    {
        var lookup = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);

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
                            IsCanvasSubmissionSubmitted(submission);
                    }

                    requestUri = page.NextUrl;
                }
            }
            catch (CanvasApiRequestException)
            {
                // Submission status is a helpful enhancement, but calendar data should still render without it.
            }
        }

        return lookup;
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
        IReadOnlyDictionary<string, bool> submissionLookup)
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
        var isSubmitted = assignment.HasValue && IsCanvasAssignmentSubmitted(assignment.Value);

        if (!isSubmitted && !string.IsNullOrWhiteSpace(courseId) && !string.IsNullOrWhiteSpace(assignmentId))
        {
            submissionLookup.TryGetValue(GetAssignmentSubmissionLookupKey(courseId, assignmentId), out isSubmitted);
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
            isSubmitted);
    }

    private static CanvasInboxItemDto? ParseCanvasInboxItem(
        JsonElement activityItem,
        IReadOnlyDictionary<string, CanvasCourseDto> courses)
    {
        var id = GetJsonStringOrNumber(activityItem, "id");

        if (string.IsNullOrWhiteSpace(id))
        {
            return null;
        }

        var courseId =
            GetJsonStringOrNumber(activityItem, "course_id") ??
            GetCourseId(GetJsonString(activityItem, "context_code"));
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

    private static CanvasCourseAssignmentDto? ParseCanvasCourseAssignment(JsonElement assignment)
    {
        var id = GetJsonStringOrNumber(assignment, "id");
        var name = GetJsonString(assignment, "name");

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        return new CanvasCourseAssignmentDto(
            id,
            name,
            GetJsonString(assignment, "description"),
            GetJsonDateTimeOffset(assignment, "due_at"),
            GetJsonDouble(assignment, "points_possible"),
            GetJsonString(assignment, "html_url"),
            GetJsonStringArray(assignment, "submission_types"),
            IsCanvasAssignmentSubmitted(assignment));
    }

    private static string GetAssignmentSubmissionLookupKey(string courseId, string assignmentId)
    {
        return $"{courseId}:{assignmentId}";
    }

    private static bool IsCanvasAssignmentSubmitted(JsonElement assignment)
    {
        var submission = GetJsonObject(assignment, "submission");

        return submission.HasValue && IsCanvasSubmissionSubmitted(submission.Value);
    }

    private static bool IsCanvasSubmissionSubmitted(JsonElement submission)
    {
        if (GetJsonBool(submission, "excused") == true ||
            GetJsonDateTimeOffset(submission, "submitted_at").HasValue)
        {
            return true;
        }

        var workflowState = GetJsonString(submission, "workflow_state");

        return workflowState is "submitted" or "graded" or "pending_review" or "complete";
    }

    private sealed record CanvasAssignmentReference(string CourseId, string AssignmentId);

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
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        var response = await httpClientFactory
            .CreateClient()
            .SendAsync(request, cancellationToken);
        var payload = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new CanvasApiRequestException(
                "Canvas request failed.",
                string.IsNullOrWhiteSpace(payload) ? response.ReasonPhrase ?? "Canvas returned an error." : payload,
                (int)response.StatusCode);
        }

        return new CanvasApiPage(payload, GetNextLinkUrl(response));
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

    private sealed record CanvasApiPage(string Payload, string? NextUrl);

    private sealed class CanvasApiRequestException(string title, string detail, int statusCode) : Exception(title)
    {
        public string Title { get; } = title;
        public string Detail { get; } = detail;
        public int StatusCode { get; } = statusCode;
    }
}
