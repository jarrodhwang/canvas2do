using CanvasToDo.Api.Contracts;
using CanvasToDo.Api.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;

namespace CanvasToDo.Api.Endpoints;

public static partial class CanvasIntegrationEndpoints
{
    private const int CanvasMaxMutationFieldCharacters = 200_000;
    private const int CanvasMaxCourseModulesToHydrate = 20;
    private const long CanvasMaxCourseContentOutputBytes = 4L * 1024 * 1024;

    private static async Task<IResult> GetCanvasCourseContentAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string? section,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

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

        var safeCourseId = NormalizeCanvasIdentifier(courseId);

        if (safeCourseId is null)
        {
            return Results.BadRequest();
        }

        try
        {
            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var encodedCourseId = Uri.EscapeDataString(safeCourseId);
            var requestedSection = NormalizeCanvasCourseContentSection(section);
            var contentRequestBudget = new CanvasRequestBudget(30, 12 * 1024 * 1024);
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
                contentRequestBudget,
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
                contentRequestBudget,
                cancellationToken)
                : Task.FromResult(Array.Empty<JsonElement>());
            var announcementsTask = ShouldLoadCanvasCourseContentSection(requestedSection, "announcements") ||
                ShouldLoadCanvasCourseContentSection(requestedSection, "home")
                ? GetCanvasArrayBestEffortAsync(
                httpClientFactory,
                accessToken,
                QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/announcements", new List<KeyValuePair<string, string?>>
                {
                    new("context_codes[]", $"course_{safeCourseId}"),
                    new("per_page", "25"),
                }),
                contentRequestBudget,
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
                contentRequestBudget,
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
                contentRequestBudget,
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
                contentRequestBudget,
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
                contentRequestBudget,
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
                contentRequestBudget,
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
            var parsedModules = await ParseCanvasCourseModulesAsync(
                modulesTask.Result,
                httpClientFactory,
                instanceUrl,
                accessToken,
                encodedCourseId,
                cancellationToken);

            var response = new CanvasCourseContentDto(
                ParseCanvasCourse(course, instanceUrl),
                tabsTask.Result.Select(ParseCanvasCourseTab).Where(tab => tab is not null).Select(tab => tab!).ToArray(),
                parsedModules,
                announcementsTask.Result.Select(ParseCanvasCourseAnnouncement).Where(announcement => announcement is not null).Select(announcement => announcement!).ToArray(),
                assignmentsTask.Result.Select(assignment => ParseCanvasCourseAssignment(assignment)).Where(assignment => assignment is not null).Select(assignment => assignment!).ToArray(),
                quizzesTask.Result.Select(ParseCanvasCourseQuiz).Where(quiz => quiz is not null).Select(quiz => quiz!).ToArray(),
                discussionsTask.Result.Select(discussion => ParseCanvasCourseDiscussion(discussion, false)).Where(discussion => discussion is not null).Select(discussion => discussion!).ToArray(),
                pagesTask.Result.Select(ParseCanvasCoursePage).Where(page => page is not null).Select(page => page!).ToArray(),
                peopleTask.Result.Select(ParseCanvasCourseUser).Where(user => user is not null).Select(user => user!).ToArray(),
                frontPageTask.Result.HasValue ? ParseCanvasCoursePage(frontPageTask.Result.Value) : null,
                ShouldLoadCanvasCourseContentSection(requestedSection, "syllabus") ? GetJsonString(course, "syllabus_body") : null);
            EnsureSerializedOutputWithinLimit(response, CanvasMaxCourseContentOutputBytes);

            return Results.Ok(response);
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
        catch (CanvasRequestLimitException)
        {
            return CreateCanvasRequestLimitProblem();
        }
    }

    private static async Task<IResult> GetCanvasCoursePageAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string pageUrl,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

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

        var safeCourseId = NormalizeCanvasIdentifier(courseId);
        var normalizedPageUrl = NormalizeCanvasPageUrl(pageUrl);

        if (safeCourseId is null || string.IsNullOrWhiteSpace(normalizedPageUrl))
        {
            return Results.BadRequest();
        }

        try
        {
            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var encodedCourseId = Uri.EscapeDataString(safeCourseId);
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
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string assignmentId,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

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

        var safeCourseId = NormalizeCanvasIdentifier(courseId);
        var safeAssignmentId = NormalizeCanvasIdentifier(assignmentId);

        if (safeCourseId is null || safeAssignmentId is null)
        {
            return Results.BadRequest();
        }

        try
        {
            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var encodedCourseId = Uri.EscapeDataString(safeCourseId);
            var encodedAssignmentId = Uri.EscapeDataString(safeAssignmentId);
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
                safeCourseId,
                safeAssignmentId,
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
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string assignmentId,
        CanvasAssignmentSubmissionRequest request,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

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

        var safeCourseId = NormalizeCanvasIdentifier(courseId);
        var safeAssignmentId = NormalizeCanvasIdentifier(assignmentId);
        var submissionType = request.SubmissionType?.Trim();
        var fields = new List<KeyValuePair<string, string>>();

        if (safeCourseId is null || safeAssignmentId is null || string.IsNullOrWhiteSpace(submissionType))
        {
            return Results.BadRequest(new
            {
                title = "Assignment submission is invalid.",
                detail = "Choose a valid Canvas assignment and submission type.",
            });
        }

        if (submissionType == "online_text_entry")
        {
            if (string.IsNullOrWhiteSpace(request.Body) || request.Body.Length > 100_000)
            {
                return Results.BadRequest(new
                {
                    title = "Assignment submission is empty.",
                    detail = "Enter up to 100,000 characters before submitting this assignment.",
                });
            }

            fields.Add(new("submission[submission_type]", submissionType));
            fields.Add(new("submission[body]", request.Body.Trim()));
        }
        else if (submissionType == "online_url")
        {
            var url = request.Url?.Trim();

            if (string.IsNullOrWhiteSpace(url) ||
                url.Length > CanvasMaxUrlLength ||
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

        if (!string.IsNullOrWhiteSpace(request.Comment) && request.Comment.Length > 20_000)
        {
            return Results.BadRequest(new
            {
                title = "Assignment comment is too long.",
                detail = "Keep the optional comment under 20,000 characters.",
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
                $"{connection.InstanceUrl}/api/v1/courses/{Uri.EscapeDataString(safeCourseId)}/assignments/{Uri.EscapeDataString(safeAssignmentId)}/submissions",
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
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string quizId,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

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

        var safeCourseId = NormalizeCanvasIdentifier(courseId);
        var safeQuizId = NormalizeCanvasIdentifier(quizId);

        if (safeCourseId is null || safeQuizId is null)
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
                $"{instanceUrl}/api/v1/courses/{Uri.EscapeDataString(safeCourseId)}/quizzes/{Uri.EscapeDataString(safeQuizId)}",
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
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string quizId,
        CanvasQuizStartRequest request,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

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

        var safeCourseId = NormalizeCanvasIdentifier(courseId);
        var safeQuizId = NormalizeCanvasIdentifier(quizId);
        var fields = new List<KeyValuePair<string, string>>();

        if (safeCourseId is null || safeQuizId is null)
        {
            return Results.BadRequest();
        }

        if (!string.IsNullOrWhiteSpace(request.AccessCode) && request.AccessCode.Length > 512)
        {
            return Results.BadRequest(new
            {
                title = "Quiz access code is too long.",
                detail = "Enter a valid Canvas quiz access code.",
            });
        }

        if (!string.IsNullOrWhiteSpace(request.AccessCode))
        {
            fields.Add(new("access_code", request.AccessCode.Trim()));
        }

        try
        {
            var submissionResponse = await PostCanvasFormObjectAsync(
                httpClientFactory,
                connection.AccessToken!,
                $"{connection.InstanceUrl}/api/v1/courses/{Uri.EscapeDataString(safeCourseId)}/quizzes/{Uri.EscapeDataString(safeQuizId)}/submissions",
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
                    $"{connection.InstanceUrl}/api/v1/courses/{Uri.EscapeDataString(safeCourseId)}/quizzes/{Uri.EscapeDataString(safeQuizId)}/submission",
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
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string topicId,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

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

        var safeCourseId = NormalizeCanvasIdentifier(courseId);
        var safeTopicId = NormalizeCanvasIdentifier(topicId);

        if (safeCourseId is null || safeTopicId is null)
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
                $"{instanceUrl}/api/v1/courses/{Uri.EscapeDataString(safeCourseId)}/discussion_topics/{Uri.EscapeDataString(safeTopicId)}",
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
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string topicId,
        CanvasDiscussionEntryRequest request,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

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

        var safeCourseId = NormalizeCanvasIdentifier(courseId);
        var safeTopicId = NormalizeCanvasIdentifier(topicId);
        var safeParentEntryId = string.IsNullOrWhiteSpace(request.ParentEntryId)
            ? null
            : NormalizeCanvasIdentifier(request.ParentEntryId);

        if (safeCourseId is null || safeTopicId is null ||
            (!string.IsNullOrWhiteSpace(request.ParentEntryId) && safeParentEntryId is null))
        {
            return Results.BadRequest();
        }

        if (string.IsNullOrWhiteSpace(request.Message) || request.Message.Length > 100_000)
        {
            return Results.BadRequest(new
            {
                title = "Discussion reply is empty.",
                detail = "Enter a message of up to 100,000 characters before posting to this discussion.",
            });
        }

        var endpoint = safeParentEntryId is null
            ? $"{connection.InstanceUrl}/api/v1/courses/{Uri.EscapeDataString(safeCourseId)}/discussion_topics/{Uri.EscapeDataString(safeTopicId)}/entries"
            : $"{connection.InstanceUrl}/api/v1/courses/{Uri.EscapeDataString(safeCourseId)}/discussion_topics/{Uri.EscapeDataString(safeTopicId)}/entries/{Uri.EscapeDataString(safeParentEntryId)}/replies";

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
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string fileId,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

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

        var safeCourseId = NormalizeCanvasIdentifier(courseId);
        var safeFileId = NormalizeCanvasIdentifier(fileId);

        if (safeCourseId is null || safeFileId is null)
        {
            return Results.BadRequest();
        }

        try
        {
            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var encodedCourseId = Uri.EscapeDataString(safeCourseId);
            var encodedFileId = Uri.EscapeDataString(safeFileId);
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
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string courseId,
        string moduleItemId,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

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

        var safeCourseId = NormalizeCanvasIdentifier(courseId);
        var safeModuleItemId = NormalizeCanvasIdentifier(moduleItemId);

        if (safeCourseId is null || safeModuleItemId is null)
        {
            return Results.BadRequest();
        }

        try
        {
            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var encodedCourseId = Uri.EscapeDataString(safeCourseId);
            var encodedModuleItemId = Uri.EscapeDataString(safeModuleItemId);
            var sequenceRequestUri = QueryHelpers.AddQueryString(
                $"{instanceUrl}/api/v1/courses/{encodedCourseId}/module_item_sequence",
                new Dictionary<string, string?>
                {
                    ["asset_type"] = "ModuleItem",
                    ["asset_id"] = safeModuleItemId,
                });
            var sequence = await GetCanvasObjectAsync(
                httpClientFactory,
                accessToken,
                sequenceRequestUri,
                cancellationToken);
            var sequenceItems = GetJsonArray(sequence, "items");
            var currentItem = sequenceItems?
                .EnumerateArray()
                .Select(node => GetJsonObject(node, "current"))
                .Where(item => item.HasValue)
                .Select(item => item!.Value)
                .FirstOrDefault(item => string.Equals(
                    GetJsonStringOrNumber(item, "id"),
                    safeModuleItemId,
                    StringComparison.OrdinalIgnoreCase));
            var moduleId = currentItem.HasValue && currentItem.Value.ValueKind == JsonValueKind.Object
                ? NormalizeCanvasIdentifier(GetJsonStringOrNumber(currentItem.Value, "module_id"))
                : null;

            if (moduleId is null)
            {
                return Results.Problem(
                    title: "Canvas module item failed to load.",
                    detail: "Canvas could not locate this item in the course module sequence.",
                    statusCode: StatusCodes.Status404NotFound);
            }

            var requestUri = QueryHelpers.AddQueryString(
                $"{instanceUrl}/api/v1/courses/{encodedCourseId}/modules/{Uri.EscapeDataString(moduleId)}/items/{encodedModuleItemId}",
                new Dictionary<string, string?>
                {
                    ["include[]"] = "content_details",
                });
            var item = await GetCanvasObjectAsync(
                httpClientFactory,
                accessToken,
                requestUri,
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
            new CanvasRequestBudget(4, 4 * 1024 * 1024),
            cancellationToken,
            ignoreRequestFailures: false);

        return lookup.TryGetValue(GetAssignmentSubmissionLookupKey(courseId, assignmentId), out var status)
            ? status
            : new CanvasSubmissionStatus(false, null);
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

    private static async Task<CanvasCourseModuleDto[]> ParseCanvasCourseModulesAsync(
        JsonElement[] modules,
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        string encodedCourseId,
        CancellationToken cancellationToken)
    {
        var parsedModules = new List<CanvasCourseModuleDto>();
        var hydrationBudget = new CanvasRequestBudget(20, 12 * 1024 * 1024);
        var hydrationCount = 0;
        var canHydrate = true;

        foreach (var module in modules)
        {
            var parsedModule = ParseCanvasCourseModule(module);

            if (parsedModule is null)
            {
                continue;
            }

            if (canHydrate &&
                parsedModule.Items.Length == 0 &&
                parsedModule.ItemCount > 0 &&
                hydrationCount < CanvasMaxCourseModulesToHydrate)
            {
                hydrationCount++;

                try
                {
                    var items = await GetCanvasArrayBestEffortAsync(
                        httpClientFactory,
                        accessToken,
                        QueryHelpers.AddQueryString(
                            $"{instanceUrl}/api/v1/courses/{encodedCourseId}/modules/{Uri.EscapeDataString(parsedModule.Id)}/items",
                            new List<KeyValuePair<string, string?>>
                            {
                                new("include[]", "content_details"),
                                new("per_page", "100"),
                            }),
                        hydrationBudget,
                        cancellationToken);
                    parsedModule = parsedModule with
                    {
                        Items = items
                            .Select(ParseCanvasCourseModuleItem)
                            .Where(item => item is not null)
                            .Select(item => item!)
                            .ToArray(),
                    };
                }
                catch (CanvasRequestLimitException)
                {
                    // Keep the already parsed module metadata and return a bounded,
                    // partial module list instead of failing the entire course view.
                    canHydrate = false;
                }
            }

            parsedModules.Add(parsedModule);
        }

        return parsedModules.ToArray();
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

    private static CanvasCoursePersonDto? ParseCanvasCourseUser(JsonElement user)
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

        return new CanvasCoursePersonDto(
            id,
            name,
            GetJsonString(user, "short_name"),
            GetJsonString(user, "sortable_name"),
            roles,
            GetJsonString(user, "email"),
            GetJsonString(user, "avatar_url"),
            GetJsonString(user, "login_id"),
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

        return NormalizeCanvasBoundedValue(
            Uri.UnescapeDataString(trimmedPageUrl.Trim('/')),
            CanvasMaxDisplayNameLength) ?? string.Empty;
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
        CanvasRequestBudget requestBudget,
        CancellationToken cancellationToken)
    {
        try
        {
            return await GetCanvasArrayAsync(
                httpClientFactory,
                accessToken,
                requestUri,
                requestBudget,
                cancellationToken);
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
        CanvasRequestBudget requestBudget,
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
                cancellationToken,
                requestBudget);

            using var document = JsonDocument.Parse(page.Payload);

            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                throw new CanvasApiRequestException(
                    "Canvas course content failed to load.",
                    "Canvas returned an unexpected course content response.",
                    StatusCodes.Status502BadGateway);
            }

            items.AddRange(document.RootElement.EnumerateArray().Select(item => item.Clone()));

            if (items.Count > CanvasMaxPaginationItems)
            {
                throw new CanvasRequestLimitException();
            }

            nextRequestUri = page.NextUrl;
        }

        return items.ToArray();
    }
    private static async Task<JsonElement> PostCanvasFormObjectAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUri,
        IEnumerable<KeyValuePair<string, string>> fields,
        CancellationToken cancellationToken)
    {
        if (!IsAllowedCanvasRequestUri(requestUri, _configuration))
        {
            throw new CanvasApiRequestException(
                "Canvas request was blocked.",
                "The Canvas write target is outside the configured institution allowlist.",
                StatusCodes.Status502BadGateway);
        }

        var safeFields = fields.ToArray();
        var fieldCharacterCount = safeFields.Sum(field => (long)field.Key.Length + field.Value.Length);

        if (fieldCharacterCount > CanvasMaxMutationFieldCharacters)
        {
            throw new CanvasApiRequestException(
                "Canvas submission is too large.",
                "Reduce the submission content and try again.",
                StatusCodes.Status413PayloadTooLarge);
        }

        if (Interlocked.Increment(ref _canvasAdmittedOutboundRequests) > CanvasMaxAdmittedOutboundRequests)
        {
            Interlocked.Decrement(ref _canvasAdmittedOutboundRequests);
            throw CreateCanvasCapacityException();
        }

        var acquiredCapacity = false;

        try
        {
            using (var capacityCancellationToken = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
            {
                capacityCancellationToken.CancelAfter(CanvasCapacityWaitTimeout);

                try
                {
                    await CanvasOutboundConcurrencyGate.WaitAsync(capacityCancellationToken.Token);
                    acquiredCapacity = true;
                }
                catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                {
                    throw CreateCanvasCapacityException();
                }
            }

            using var request = new HttpRequestMessage(HttpMethod.Post, requestUri);
            AddCanvasRequestHeaders(request, accessToken);
            request.Content = new FormUrlEncodedContent(safeFields);
            using var timeoutCancellationToken = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCancellationToken.CancelAfter(CanvasRequestTimeout);

            try
            {
                using var response = await httpClientFactory
                    .CreateClient("Canvas")
                    .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeoutCancellationToken.Token);

                if (!HasSameOrigin(request.RequestUri, response.RequestMessage?.RequestUri))
                {
                    throw new CanvasApiRequestException(
                        "Canvas request was blocked.",
                        "Canvas redirected the write request to a different origin.",
                        StatusCodes.Status502BadGateway);
                }

                if (!response.IsSuccessStatusCode)
                {
                    throw CreateCanvasRequestException(response.StatusCode);
                }

                var responsePayload = await ReadCanvasResponsePayloadAsync(
                    response.Content,
                    timeoutCancellationToken.Token);

                try
                {
                    using var document = JsonDocument.Parse(responsePayload.Payload);

                    if (document.RootElement.ValueKind != JsonValueKind.Object)
                    {
                        throw new CanvasApiRequestException(
                            "Canvas request failed.",
                            "Canvas returned an unexpected response.",
                            StatusCodes.Status502BadGateway);
                    }

                    return document.RootElement.Clone();
                }
                catch (JsonException)
                {
                    throw new CanvasApiRequestException(
                        "Canvas returned invalid data.",
                        "Canvas returned a malformed JSON response. Check Canvas before retrying the write.",
                        StatusCodes.Status502BadGateway);
                }
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new CanvasApiRequestException(
                    "Canvas request timed out.",
                    "Canvas took too long to confirm the write. Check Canvas before retrying to avoid a duplicate submission.",
                    StatusCodes.Status504GatewayTimeout);
            }
            catch (HttpRequestException)
            {
                throw new CanvasApiRequestException(
                    "Canvas is unavailable.",
                    "The write result could not be confirmed. Check Canvas before retrying to avoid a duplicate submission.",
                    StatusCodes.Status502BadGateway);
            }
            catch (InvalidDataException)
            {
                throw new CanvasApiRequestException(
                    "Canvas response was too large.",
                    "Canvas accepted or rejected the write but returned more data than this app can safely process. Check Canvas before retrying.",
                    StatusCodes.Status502BadGateway);
            }
        }
        finally
        {
            if (acquiredCapacity)
            {
                CanvasOutboundConcurrencyGate.Release();
            }

            Interlocked.Decrement(ref _canvasAdmittedOutboundRequests);
        }
    }
    private static JsonElement? GetJsonArray(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) &&
               property.ValueKind == JsonValueKind.Array
            ? property
            : null;
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
}
