using CanvasToDo.Api.Contracts;
using CanvasToDo.Api.Data;
using CanvasToDo.Api.Infrastructure;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using System.Globalization;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

namespace CanvasToDo.Api.Endpoints;

public static partial class CanvasIntegrationEndpoints
{
    private const string CanvasTokenSettingKey = "canvas.token";
    private const string CanvasOwnerHeader = "X-Canvas-To-Do-Owner-Key";
    private const string CanvasTokenProtectorPurpose = "incos.workspace.canvas-token.v1";
    private const string CanvasOAuthStateProtectorPurpose = "incos.workspace.canvas-oauth-state.v1";
    private const string DefaultCanvasInstanceUrl = "https://sfu.instructure.com";
    private const string LegacyCanvasSfuInstanceUrl = "https://canvas.sfu.ca";
    private const string CanvasUserAgent = "canvas-to-do/1.0 (Canvas LMS integration)";
    private const int CanvasActiveCourseFetchPageSize = 50;
    private const int CanvasMaxActiveCourses = 250;
    private const int CanvasMaxPaginationPages = 50;
    private const int CanvasMaxPaginationItems = 5000;
    private const int CanvasMaxResponseBytes = 4 * 1024 * 1024;
    private const int CanvasMaxCalendarRequestBytes = 16 * 1024 * 1024;
    private const int CanvasMaxCalendarRequestPages = 120;
    private const int CanvasMaxCalendarResponseItems = 5000;
    private const int CanvasMaxCalendarRangeDays = 370;
    private const int CanvasMaxAdmittedOutboundRequests = 64;
    private const int CanvasMaxStoredTokenJsonChars = 64 * 1024;
    private const int CanvasMaxIdentifierLength = 128;
    private const int CanvasMaxDisplayNameLength = 512;
    private const int CanvasMaxCourseCodeLength = 128;
    private const int CanvasMaxTermNameLength = 256;
    private const int CanvasMaxWorkflowStateLength = 64;
    private const int CanvasMaxUrlLength = 4096;
    private const int CanvasMaxContextCodeLength = 256;
    private const int CanvasMaxSubmissionTypes = 32;
    private const int CanvasMaxSubmissionTypeLength = 64;
    private const int CanvasMaxCoursePeople = 500;
    private const int CanvasMaxInboxItems = 100;
    private const int CanvasMaxOAuthScopeLength = 2048;
    private const long CanvasMaxCoursesOutputBytes = 1024 * 1024;
    private const long CanvasMaxCoursePeopleOutputBytes = 2L * 1024 * 1024;
    private const long CanvasMaxInboxOutputBytes = 2L * 1024 * 1024;
    private const long CanvasMaxCalendarOutputBytes = 4L * 1024 * 1024;
    private static readonly TimeSpan CanvasRequestTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan CanvasCoursesRequestTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan CanvasCalendarRequestTimeout = TimeSpan.FromSeconds(45);
    private static readonly TimeSpan CanvasCapacityWaitTimeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan CanvasOAuthRefreshLockWaitTimeout = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan CanvasOAuthStateLifetime = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan CanvasOAuthRefreshWindow = TimeSpan.FromMinutes(5);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly SemaphoreSlim[] CanvasActiveCourseCacheLocks = CreateLockStripes();
    private static readonly SemaphoreSlim[] CanvasOAuthRefreshLocks = CreateLockStripes();
    private static readonly SemaphoreSlim CanvasOutboundConcurrencyGate = new(8, 8);
    private static int _canvasAdmittedOutboundRequests;
    private static IConfiguration? _configuration;

    public static IEndpointRouteBuilder MapCanvasIntegrationEndpoints(this IEndpointRouteBuilder app)
    {
        _configuration = app.ServiceProvider.GetRequiredService<IConfiguration>();

        var canvas = app.MapGroup("/api/canvas")
            .RequireAuthorization();

        canvas.MapGet("/integration", GetCanvasIntegrationStatusAsync)
            .WithName("GetCanvasIntegrationStatus")
            .RequireRateLimiting("canvas-read");

        canvas.MapGet("/token", GetCanvasTokenStatusAsync)
            .WithName("GetCanvasTokenStatus")
            .RequireRateLimiting("canvas-read");

        canvas.MapPut("/token", UpdateCanvasTokenAsync)
            .WithName("UpdateCanvasToken")
            .RequireRateLimiting("auth-sensitive");

        canvas.MapDelete("/token", DeleteCanvasTokenAsync)
            .WithName("DeleteCanvasToken")
            .RequireRateLimiting("auth-sensitive");

        canvas.MapGet("/oauth/login", StartCanvasOAuthLoginAsync)
            .WithName("StartCanvasOAuthLogin")
            .RequireRateLimiting("auth-write");

        canvas.MapGet("/oauth/callback", CompleteCanvasOAuthLoginAsync)
            .WithName("CompleteCanvasOAuthLogin")
            .RequireRateLimiting("auth-write");

        canvas.MapGet("/courses", GetCanvasCoursesAsync)
            .WithName("GetCanvasCourses")
            .RequireRateLimiting("canvas-read");

        canvas.MapGet("/courses/{courseId}/content", GetCanvasCourseContentAsync)
            .WithName("GetCanvasCourseContent")
            .RequireRateLimiting("canvas-read");

        canvas.MapGet("/courses/{courseId}/pages", GetCanvasCoursePageAsync)
            .WithName("GetCanvasCoursePage")
            .RequireRateLimiting("canvas-read");

        canvas.MapGet("/courses/{courseId}/people", GetCanvasCoursePeopleAsync)
            .WithName("GetCanvasCoursePeople")
            .RequireRateLimiting("canvas-read");

        canvas.MapGet("/courses/{courseId}/assignments/{assignmentId}", GetCanvasCourseAssignmentAsync)
            .WithName("GetCanvasCourseAssignment")
            .RequireRateLimiting("canvas-read");

        canvas.MapPost("/courses/{courseId}/assignments/{assignmentId}/submit", SubmitCanvasCourseAssignmentAsync)
            .WithName("SubmitCanvasCourseAssignment")
            .RequireRateLimiting("canvas-write");

        canvas.MapGet("/courses/{courseId}/quizzes/{quizId}", GetCanvasCourseQuizAsync)
            .WithName("GetCanvasCourseQuiz")
            .RequireRateLimiting("canvas-read");

        canvas.MapPost("/courses/{courseId}/quizzes/{quizId}/submissions", StartCanvasCourseQuizAsync)
            .WithName("StartCanvasCourseQuiz")
            .RequireRateLimiting("canvas-write");

        canvas.MapGet("/courses/{courseId}/discussion-topics/{topicId}", GetCanvasCourseDiscussionAsync)
            .WithName("GetCanvasCourseDiscussion")
            .RequireRateLimiting("canvas-read");

        canvas.MapPost("/courses/{courseId}/discussion-topics/{topicId}/entries", SubmitCanvasCourseDiscussionEntryAsync)
            .WithName("SubmitCanvasCourseDiscussionEntry")
            .RequireRateLimiting("canvas-write");

        canvas.MapGet("/courses/{courseId}/files/{fileId}", GetCanvasCourseFileAsync)
            .WithName("GetCanvasCourseFile")
            .RequireRateLimiting("canvas-read");

        canvas.MapGet("/courses/{courseId}/module-items/{moduleItemId}", GetCanvasCourseModuleItemAsync)
            .WithName("GetCanvasCourseModuleItem")
            .RequireRateLimiting("canvas-read");

        canvas.MapGet("/inbox-items", GetCanvasInboxItemsAsync)
            .WithName("GetCanvasInboxItems")
            .RequireRateLimiting("canvas-read");

        canvas.MapGet("/calendar-items", GetCanvasCalendarItemsAsync)
            .WithName("GetCanvasCalendarItems")
            .RequireRateLimiting("canvas-calendar");

        return app;
    }

    private static async Task<IResult> GetCanvasIntegrationStatusAsync(
        HttpContext context,
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
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
        var oauthOptions = GetCanvasOAuthOptions(configuration);
        var manualTokenEnabled = IsCanvasManualTokenEnabled(configuration);

        return Results.Ok(new CanvasIntegrationStatusDto(
            "canvas_lms",
            "Canvas LMS",
            connection.Configured,
            connection.Connected,
            connection.Status,
            oauthOptions.Configured ? BuildCanvasOAuthConnectUrl(context) : "",
            connection.InstanceUrl,
            connection.UserName,
            Array.Empty<string>(),
            connection.TokenSource,
            connection.StartsAt,
            connection.ExpiresAt,
            connection.UpdatedAt,
            oauthOptions.Configured,
            manualTokenEnabled));
    }

    internal static async Task<IResult> GetCanvasTokenStatusAsync(
        HttpContext context,
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
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

        return Results.Ok(ToCanvasTokenStatusDto(
            connection,
            configuration,
            BuildCanvasOAuthConnectUrl(context)));
    }

    internal static async Task<IResult> UpdateCanvasTokenAsync(
        HttpContext context,
        IHttpClientFactory httpClientFactory,
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        UpdateCanvasTokenRequest request,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

        if (!IsCanvasManualTokenEnabled(configuration))
        {
            return CreateManualCanvasTokenDisabledProblem();
        }

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
            cancellationToken,
            configuration);
    }

    internal static async Task<IResult> DeleteCanvasTokenAsync(
        HttpContext context,
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

        var userKey = GetUserKey(context);

        if (string.IsNullOrWhiteSpace(userKey))
        {
            return Results.Unauthorized();
        }

        return await DeleteCanvasTokenForUserKeyAsync(
            userKey,
            db,
            dataProtectionProvider,
            cancellationToken,
            configuration);
    }

    private static IResult StartCanvasOAuthLoginAsync(
        HttpContext context,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string? returnUrl)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
        var options = GetCanvasOAuthOptions(configuration);

        if (!options.Configured)
        {
            return CreateCanvasOAuthNotConfiguredProblem();
        }

        var userKey = GetUserKey(context);

        if (string.IsNullOrWhiteSpace(userKey))
        {
            return Results.Unauthorized();
        }

        var safeReturnUrl = NormalizeCanvasReturnUrl(returnUrl, context);
        var callbackUrl = BuildCanvasOAuthCallbackUrl(context, configuration);

        if (!IsSecureOAuthCallbackUrl(callbackUrl))
        {
            return Results.Problem(
                title: "Canvas OAuth callback URL is invalid.",
                detail: "Configure an HTTPS Canvas OAuth callback URL before connecting Canvas.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var statePayload = new CanvasOAuthState(
            userKey,
            safeReturnUrl,
            callbackUrl,
            DateTimeOffset.UtcNow,
            Convert.ToHexString(RandomNumberGenerator.GetBytes(16)));
        var stateProtector = dataProtectionProvider.CreateProtector(CanvasOAuthStateProtectorPurpose);
        var state = stateProtector.Protect(JsonSerializer.Serialize(statePayload, JsonOptions));
        var authorizationUrl = QueryHelpers.AddQueryString(
            $"{options.InstanceUrl}/login/oauth2/auth",
            new Dictionary<string, string?>
            {
                ["client_id"] = options.ClientId,
                ["response_type"] = "code",
                ["redirect_uri"] = callbackUrl,
                ["state"] = state,
            });

        return Results.Redirect(authorizationUrl);
    }

    private static async Task<IResult> CompleteCanvasOAuthLoginAsync(
        HttpContext context,
        IHttpClientFactory httpClientFactory,
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        string? code,
        string? state,
        string? error,
        string? error_description,
        CancellationToken cancellationToken)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
        var userKey = GetUserKey(context);

        if (string.IsNullOrWhiteSpace(userKey))
        {
            return Results.Unauthorized();
        }

        var statePayload = TryReadCanvasOAuthState(state, dataProtectionProvider);

        if (statePayload is null ||
            !string.Equals(statePayload.UserKey, userKey, StringComparison.OrdinalIgnoreCase) ||
            statePayload.IssuedAt > DateTimeOffset.UtcNow.AddMinutes(1) ||
            statePayload.IssuedAt.Add(CanvasOAuthStateLifetime) < DateTimeOffset.UtcNow ||
            string.IsNullOrWhiteSpace(statePayload.Nonce) ||
            statePayload.Nonce.Length != 32 ||
            !IsSafeCanvasReturnUrl(statePayload.ReturnUrl) ||
            !IsSecureOAuthCallbackUrl(statePayload.RedirectUri))
        {
            return Results.Redirect(QueryHelpers.AddQueryString(
                NormalizeCanvasReturnUrl(null, context),
                "canvasError",
                "The Canvas connection request expired or could not be verified. Start the connection again."));
        }

        var options = GetCanvasOAuthOptions(configuration);

        if (!options.Configured)
        {
            return Results.Redirect(QueryHelpers.AddQueryString(
                statePayload.ReturnUrl,
                "canvasError",
                "Canvas sign-in is not currently available. Use a manual token or contact an administrator."));
        }

        if (!string.IsNullOrWhiteSpace(error))
        {
            return Results.Redirect(QueryHelpers.AddQueryString(
                statePayload.ReturnUrl,
                "canvasError",
                "Canvas authorization was cancelled or denied."));
        }

        if (string.IsNullOrWhiteSpace(code) || code.Length > 4096)
        {
            return Results.Redirect(QueryHelpers.AddQueryString(
                statePayload.ReturnUrl,
                "canvasError",
                "Canvas did not return a valid authorization code. Start the connection again."));
        }

        try
        {
            var tokenResult = await ExchangeCanvasOAuthCodeAsync(
                httpClientFactory,
                options,
                code,
                statePayload.RedirectUri,
                cancellationToken);
            var now = DateTimeOffset.UtcNow;
            var expiresAt = now.AddSeconds(tokenResult.ExpiresInSeconds);
            var userName = tokenResult.UserName;

            if (string.IsNullOrWhiteSpace(userName))
            {
                try
                {
                    var profile = await GetCanvasObjectAsync(
                        httpClientFactory,
                        tokenResult.AccessToken,
                        $"{options.InstanceUrl}/api/v1/users/self/profile",
                        cancellationToken);
                    userName =
                        GetJsonString(profile, "name") ??
                        GetJsonString(profile, "short_name") ??
                        GetJsonString(profile, "login_id");
                }
                catch (CanvasApiRequestException)
                {
                    // The authorization-code exchange is authoritative; profile scope is optional.
                }
            }

            await SaveStoredCanvasTokenAsync(
                userKey,
                db,
                dataProtectionProvider,
                new CanvasTokenValues(
                    options.InstanceUrl,
                    tokenResult.AccessToken,
                    tokenResult.RefreshToken,
                    "oauth",
                    now,
                    expiresAt,
                    now,
                    userName,
                    tokenResult.UserId,
                    tokenResult.Scope),
                cancellationToken);

            return Results.Redirect(QueryHelpers.AddQueryString(
                statePayload.ReturnUrl,
                "canvasConnected",
                "true"));
        }
        catch (CanvasOAuthRequestException exception)
        {
            return Results.Redirect(QueryHelpers.AddQueryString(
                statePayload.ReturnUrl,
                "canvasError",
                exception.DisplayMessage));
        }
    }

    internal static async Task<IResult> GetCanvasCoursesAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        IMemoryCache memoryCache,
        int? pageSize,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

        try
        {
            using var requestDeadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            requestDeadline.CancelAfter(CanvasCoursesRequestTimeout);
            var requestCancellationToken = requestDeadline.Token;
            var connection = await ResolveCanvasConnectionAsync(
                context,
                db,
                configuration,
                dataProtectionProvider,
                requestCancellationToken);

            if (!connection.Connected)
            {
                return CreateCanvasConnectionProblem(connection);
            }

            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var safePageSize = Math.Clamp(pageSize ?? 20, 1, 100);
            var userCacheKey = GetCanvasCacheUserKey(context, connection);
            var requestBudget = new CanvasRequestBudget(5, 8 * 1024 * 1024);
            var activeCourses = await GetCachedActiveStudentCoursesAsync(
                memoryCache,
                httpClientFactory,
                instanceUrl,
                accessToken,
                userCacheKey,
                safePageSize,
                requestBudget,
                requestCancellationToken);
            CanvasCourseDto[] completedCourses;
            var completedCoursesAreComplete = true;

            try
            {
                completedCourses = await GetCachedCompletedStudentCoursesAsync(
                    memoryCache,
                    httpClientFactory,
                    instanceUrl,
                    accessToken,
                    userCacheKey,
                    safePageSize,
                    new CanvasRequestBudget(5, 8 * 1024 * 1024),
                    requestCancellationToken);
            }
            catch (CanvasApiRequestException)
            {
                // Active coursework remains usable if Canvas cannot provide historical enrollments.
                // Tell clients the combined list is incomplete so they do not interpret a missing
                // historical course as a lost enrollment.
                completedCourses = [];
                completedCoursesAreComplete = false;
            }
            catch (CanvasRequestLimitException)
            {
                completedCourses = [];
                completedCoursesAreComplete = false;
            }
            var courses = activeCourses
                .Concat(completedCourses)
                .GroupBy(course => course.Id, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .ToArray();
            var response = new CanvasCoursesDto(
                courses,
                GetCommonTermName(activeCourses),
                completedCoursesAreComplete);
            EnsureSerializedOutputWithinLimit(response, CanvasMaxCoursesOutputBytes);

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
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Results.Problem(
                title: "Canvas courses timed out.",
                detail: "Canvas could not finish the bounded course request in time. Try again in a moment.",
                statusCode: StatusCodes.Status504GatewayTimeout);
        }
    }

    private static async Task<IResult> GetCanvasCoursePeopleAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        IMemoryCache memoryCache,
        string courseId,
        int? pageSize,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

        var safeCourseId = NormalizeCanvasIdentifier(courseId);

        if (string.IsNullOrWhiteSpace(safeCourseId))
        {
            return Results.BadRequest(new
            {
                title = "Canvas course is invalid.",
                detail = "Choose a valid Canvas course and try again.",
            });
        }

        try
        {
            using var requestDeadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            requestDeadline.CancelAfter(CanvasCoursesRequestTimeout);
            var requestCancellationToken = requestDeadline.Token;
            var connection = await ResolveCanvasConnectionAsync(
                context,
                db,
                configuration,
                dataProtectionProvider,
                requestCancellationToken);

            if (!connection.Connected)
            {
                return CreateCanvasConnectionProblem(connection);
            }

            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var userCacheKey = GetCanvasCacheUserKey(context, connection);
            var requestBudget = new CanvasRequestBudget(12, 12 * 1024 * 1024);
            var activeCourses = await GetCachedActiveStudentCoursesAsync(
                memoryCache,
                httpClientFactory,
                instanceUrl,
                accessToken,
                userCacheKey,
                CanvasMaxActiveCourses,
                requestBudget,
                requestCancellationToken);
            var courseIsAccessible = activeCourses.Any(course =>
                !course.AccessClosed &&
                string.Equals(course.Id, safeCourseId, StringComparison.OrdinalIgnoreCase));

            if (!courseIsAccessible)
            {
                try
                {
                    var completedCourses = await GetCachedCompletedStudentCoursesAsync(
                        memoryCache,
                        httpClientFactory,
                        instanceUrl,
                        accessToken,
                        userCacheKey,
                        CanvasMaxActiveCourses,
                        new CanvasRequestBudget(5, 8 * 1024 * 1024),
                        requestCancellationToken);
                    courseIsAccessible = completedCourses.Any(course =>
                        !course.AccessClosed &&
                        string.Equals(course.Id, safeCourseId, StringComparison.OrdinalIgnoreCase));
                }
                catch (CanvasApiRequestException)
                {
                    courseIsAccessible = false;
                }
                catch (CanvasRequestLimitException)
                {
                    courseIsAccessible = false;
                }
            }

            if (!courseIsAccessible)
            {
                return Results.NotFound(new
                {
                    title = "Canvas course was not found.",
                    detail = "This course is not in an accessible Canvas enrollment for the signed-in user.",
                });
            }

            var safePageSize = Math.Clamp(pageSize ?? 100, 1, CanvasMaxCoursePeople);
            var query = new List<KeyValuePair<string, string?>>
            {
                new("include[]", "enrollments"),
                new("per_page", Math.Min(safePageSize, 100).ToString(CultureInfo.InvariantCulture)),
            };
            var requestUri = QueryHelpers.AddQueryString(
                $"{instanceUrl}/api/v1/courses/{Uri.EscapeDataString(safeCourseId)}/users",
                query);
            var people = new List<CanvasCoursePersonDto>();

            while (!string.IsNullOrWhiteSpace(requestUri) && people.Count < safePageSize)
            {
                var page = await SendCanvasGetPageAsync(
                    httpClientFactory,
                    accessToken,
                    requestUri,
                    requestCancellationToken,
                    requestBudget);
                using var document = JsonDocument.Parse(page.Payload);

                if (document.RootElement.ValueKind != JsonValueKind.Array)
                {
                    throw new CanvasApiRequestException(
                        "Canvas people failed to load.",
                        "Canvas returned an unexpected course roster response.",
                        StatusCodes.Status502BadGateway);
                }

                people.AddRange(document.RootElement
                    .EnumerateArray()
                    .Select(ParseCanvasCoursePerson)
                    .Where(person => person is not null)
                    .Select(person => person!));
                requestUri = page.NextUrl;
            }

            var response = new CanvasCoursePeopleDto(
                people
                    .GroupBy(person => person.Id, StringComparer.OrdinalIgnoreCase)
                    .Select(group => group.First())
                    .OrderBy(person => person.SortableName ?? person.Name, StringComparer.OrdinalIgnoreCase)
                    .Take(safePageSize)
                    .ToArray(),
                string.IsNullOrWhiteSpace(requestUri));
            EnsureSerializedOutputWithinLimit(response, CanvasMaxCoursePeopleOutputBytes);

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
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Results.Problem(
                title: "Canvas people timed out.",
                detail: "Canvas could not finish the bounded roster request in time. Try again in a moment.",
                statusCode: StatusCodes.Status504GatewayTimeout);
        }
    }

    private static async Task<IResult> GetCanvasInboxItemsAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        IMemoryCache memoryCache,
        string? courseId,
        int? pageSize,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

        try
        {
            using var requestDeadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            requestDeadline.CancelAfter(CanvasCoursesRequestTimeout);
            var requestCancellationToken = requestDeadline.Token;
            var connection = await ResolveCanvasConnectionAsync(
                context,
                db,
                configuration,
                dataProtectionProvider,
                requestCancellationToken);

            if (!connection.Connected)
            {
                return CreateCanvasConnectionProblem(connection);
            }

            var instanceUrl = connection.InstanceUrl!;
            var accessToken = connection.AccessToken!;
            var safePageSize = Math.Clamp(pageSize ?? 50, 1, CanvasMaxInboxItems);
            var safeCourseId = string.IsNullOrWhiteSpace(courseId)
                ? null
                : NormalizeCanvasIdentifier(courseId);

            if (!string.IsNullOrWhiteSpace(courseId) && safeCourseId is null)
            {
                return Results.BadRequest(new
                {
                    title = "Canvas course is invalid.",
                    detail = "Choose a valid Canvas course and try again.",
                });
            }

            var userCacheKey = GetCanvasCacheUserKey(context, connection);
            var requestBudget = new CanvasRequestBudget(12, 12 * 1024 * 1024);
            var activeCourses = await GetCachedActiveStudentCoursesAsync(
                memoryCache,
                httpClientFactory,
                instanceUrl,
                accessToken,
                userCacheKey,
                CanvasMaxActiveCourses,
                requestBudget,
                requestCancellationToken);
            var courses = activeCourses.AsEnumerable();

            if (safeCourseId is not null && !activeCourses.Any(course =>
                    !course.AccessClosed &&
                    string.Equals(course.Id, safeCourseId, StringComparison.OrdinalIgnoreCase)))
            {
                CanvasCourseDto[] completedCourses;

                try
                {
                    completedCourses = await GetCachedCompletedStudentCoursesAsync(
                        memoryCache,
                        httpClientFactory,
                        instanceUrl,
                        accessToken,
                        userCacheKey,
                        CanvasMaxActiveCourses,
                        new CanvasRequestBudget(5, 8 * 1024 * 1024),
                        requestCancellationToken);
                }
                catch (CanvasApiRequestException)
                {
                    completedCourses = [];
                }
                catch (CanvasRequestLimitException)
                {
                    completedCourses = [];
                }

                if (!completedCourses.Any(course =>
                        !course.AccessClosed &&
                        string.Equals(course.Id, safeCourseId, StringComparison.OrdinalIgnoreCase)))
                {
                    return Results.NotFound(new
                    {
                        title = "Canvas course was not found.",
                        detail = "This course is not in an accessible Canvas enrollment for the signed-in user.",
                    });
                }

                courses = activeCourses.Concat(completedCourses);
            }

            var courseLookup = courses
                .Where(course => !string.IsNullOrWhiteSpace(course.Id))
                .GroupBy(course => course.Id, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
            var query = new List<KeyValuePair<string, string?>>
            {
                new("per_page", Math.Min(safePageSize, 100).ToString(CultureInfo.InvariantCulture)),
            };

            if (safeCourseId is null)
            {
                query.Add(new("only_active_courses", "true"));
            }

            var requestPath = safeCourseId is null
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
                    requestCancellationToken,
                    requestBudget);
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
                    .Select(item => ParseCanvasInboxItem(item, courseLookup))
                    .Where(item => item is not null)
                    .Select(item => item!));
                requestUri = page.NextUrl;
            }

            var response = new CanvasInboxItemsDto(
                inboxItems
                    .GroupBy(item => item.Id, StringComparer.OrdinalIgnoreCase)
                    .Select(group => group.First())
                    .OrderByDescending(item => item.UpdatedAt ?? item.CreatedAt ?? DateTimeOffset.MinValue)
                    .Take(safePageSize)
                    .ToArray(),
                string.IsNullOrWhiteSpace(requestUri));
            EnsureSerializedOutputWithinLimit(response, CanvasMaxInboxOutputBytes);

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
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Results.Problem(
                title: "Canvas inbox timed out.",
                detail: "Canvas could not finish the bounded inbox request in time. Try again in a moment.",
                statusCode: StatusCodes.Status504GatewayTimeout);
        }
    }

    internal static async Task<IResult> GetCanvasCalendarItemsAsync(
        IHttpClientFactory httpClientFactory,
        HttpContext context,
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        IMemoryCache memoryCache,
        string? startDate,
        string? endDate,
        int? pageSize,
        bool? forceRefresh,
        CancellationToken cancellationToken)
    {
        if (ValidateCanvasOwner(context) is { } ownerMismatch)
        {
            return ownerMismatch;
        }

        using var requestDeadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        requestDeadline.CancelAfter(CanvasCalendarRequestTimeout);
        var requestCancellationToken = requestDeadline.Token;
        CanvasConnection connection;

        try
        {
            connection = await ResolveCanvasConnectionAsync(
                context,
                db,
                configuration,
                dataProtectionProvider,
                requestCancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return CreateCanvasCalendarTimeoutProblem();
        }

        if (!connection.Connected)
        {
            return CreateCanvasConnectionProblem(connection);
        }

        var instanceUrl = connection.InstanceUrl!;
        var accessToken = connection.AccessToken!;
        if (!TryParseCanvasDate(startDate, out var parsedStartAt) ||
            !TryParseCanvasDate(endDate, out var parsedEndAt) ||
            parsedEndAt >= DateTimeOffset.MaxValue.AddDays(-1) ||
            (parsedStartAt is not null &&
             parsedEndAt is null &&
             parsedStartAt.Value > DateTimeOffset.MaxValue.AddDays(-60)))
        {
            return Results.BadRequest(new
            {
                title = "Canvas calendar range is invalid.",
                detail = "Use ISO calendar dates in YYYY-MM-DD format.",
            });
        }

        var startAt = parsedStartAt ?? DateTimeOffset.UtcNow.AddDays(-30);
        var endAt = parsedEndAt?.AddDays(1).AddTicks(-1) ?? startAt.AddDays(60);

        if (endAt < startAt || endAt - startAt > TimeSpan.FromDays(CanvasMaxCalendarRangeDays))
        {
            return Results.BadRequest(new
            {
                title = "Canvas calendar range is invalid.",
                detail = $"Choose an end date on or after the start date and within {CanvasMaxCalendarRangeDays} days.",
            });
        }

        var safePageSize = Math.Clamp(pageSize ?? 100, 1, 100);
        var userCacheKey = GetCanvasCacheUserKey(context, connection);
        var cacheKey = string.Join(
            ':',
            "canvas-calendar",
            "v2",
            userCacheKey,
            instanceUrl,
            startAt.UtcDateTime.ToString("O", CultureInfo.InvariantCulture),
            endAt.UtcDateTime.ToString("O", CultureInfo.InvariantCulture));

        if (forceRefresh != true &&
            memoryCache.TryGetValue(cacheKey, out CanvasCalendarItemsDto? cachedCalendarItems) &&
            cachedCalendarItems is not null)
        {
            return Results.Ok(cachedCalendarItems);
        }

        try
        {
            var requestBudget = new CanvasRequestBudget(
                CanvasMaxCalendarRequestPages,
                CanvasMaxCalendarRequestBytes);
            var courses = await GetCachedActiveStudentCoursesAsync(
                memoryCache,
                httpClientFactory,
                instanceUrl,
                accessToken,
                userCacheKey,
                CanvasMaxActiveCourses,
                requestBudget,
                requestCancellationToken);

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
                requestBudget,
                requestCancellationToken);
            var calendarEventsTask = GetCanvasCalendarEventsBestEffortAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                "event",
                startAt,
                endAt,
                safePageSize,
                contextCodes,
                requestBudget,
                requestCancellationToken);
            await Task.WhenAll(assignmentEventsTask, calendarEventsTask);

            var assignmentEventsResult = await assignmentEventsTask;
            var calendarEventsResult = await calendarEventsTask;

            var assignmentEvents = assignmentEventsResult.Events;
            var calendarEvents = calendarEventsResult.Events;
            // Course assignments already include submission status. Only enrich calendar
            // assignments that were not returned by that source (for example, denied courses).
            var courseAssignmentResult = await GetCanvasCourseAssignmentCalendarItemsAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                courses,
                startAt,
                endAt,
                new Dictionary<string, CanvasSubmissionStatus>(),
                requestBudget,
                requestCancellationToken);
            var courseAssignmentItems = courseAssignmentResult.Items;
            var coveredAssignments = courseAssignmentItems
                .Select(GetCanvasCalendarItemDedupeKey)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var uncoveredAssignmentEvents = assignmentEvents.Where(calendarEvent =>
            {
                var reference = GetCanvasAssignmentReference(calendarEvent);
                return reference is not null &&
                    !coveredAssignments.Contains($"assignment:{reference.CourseId}:{reference.AssignmentId}");
            }).ToArray();
            var submissionLookupResult = await GetCanvasAssignmentSubmissionLookupBestEffortAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                uncoveredAssignmentEvents,
                requestBudget,
                requestCancellationToken);
            var submissionLookup = submissionLookupResult.Lookup;

            // Calendar events and per-course assignments are independent sources.
            // Keep any available data, even when an institution denies calendar access.
            if (assignmentEventsResult.Error is not null && calendarEventsResult.Error is not null &&
                assignmentEvents.Length == 0 && calendarEvents.Length == 0 &&
                !courseAssignmentResult.HasSuccessfulResponse)
            {
                var error = GetMostRelevantCanvasError(assignmentEventsResult.Error, calendarEventsResult.Error)!;
                return Results.Problem(title: error.Title, detail: error.Detail, statusCode: error.StatusCode);
            }

            var items = courseAssignmentItems
                .Concat(assignmentEvents.Select(calendarEvent => ParseCanvasCalendarItem(calendarEvent, "assignment", courseLookup, submissionLookup)))
                .Concat(calendarEvents.Select(calendarEvent => ParseCanvasCalendarItem(calendarEvent, "event", courseLookup, submissionLookup)))
                .Where(item => item is not null)
                .Select(item => item!)
                .GroupBy(GetCanvasCalendarItemDedupeKey, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .OrderBy(item => item.DueAt ?? item.StartAt ?? item.EndAt ?? DateTimeOffset.MaxValue)
                .Take(CanvasMaxCalendarResponseItems + 1)
                .ToArray();

            if (items.Length > CanvasMaxCalendarResponseItems)
            {
                throw new CanvasRequestLimitException();
            }

            var isComplete = assignmentEventsResult.Error is null &&
                             calendarEventsResult.Error is null &&
                             submissionLookupResult.IsComplete &&
                             courseAssignmentResult.IsComplete;
            var response = new CanvasCalendarItemsDto(items, isComplete);
            var serializedResponseSize = GetSerializedSizeBytes(response);

            if (serializedResponseSize > CanvasMaxCalendarOutputBytes)
            {
                throw new CanvasRequestLimitException();
            }

            if (isComplete)
            {
                memoryCache.Set(
                    cacheKey,
                    response,
                    new MemoryCacheEntryOptions
                    {
                        Size = GetApproximateCacheSizeBytes(serializedResponseSize),
                        AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(3),
                        SlidingExpiration = TimeSpan.FromSeconds(45),
                    });
            }

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
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return CreateCanvasCalendarTimeoutProblem();
        }
    }

    private static async Task<CanvasConnection> ResolveCanvasConnectionAsync(
        HttpContext context,
        CanvasToDoDbContext db,
        IConfiguration configuration,
        IDataProtectionProvider dataProtectionProvider,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        return await ResolveCanvasConnectionForUserKeyAsync(
            userKey,
            db,
            dataProtectionProvider,
            cancellationToken,
            configuration,
            context.RequestServices.GetRequiredService<IHttpClientFactory>());
    }

    private static async Task<CanvasConnection> ResolveCanvasConnectionForUserKeyAsync(
        string? userKey,
        CanvasToDoDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        CancellationToken cancellationToken,
        IConfiguration? configuration = null,
        IHttpClientFactory? httpClientFactory = null)
    {
        if (string.IsNullOrWhiteSpace(userKey))
        {
            return CanvasConnection.None();
        }

        var normalizedUserKey = userKey.Trim().ToLowerInvariant();
        configuration ??= _configuration;
        var snapshot = await ReadCanvasTokenSnapshotAsync(
            normalizedUserKey,
            db,
            dataProtectionProvider,
            configuration,
            cancellationToken);
        var tokenValues = snapshot?.TokenValues;

        if (tokenValues is null)
        {
            return ToCanvasConnection(snapshot);
        }

        if (string.Equals(tokenValues.TokenSource, "oauth", StringComparison.Ordinal) &&
            ShouldRefreshCanvasOAuthToken(tokenValues, DateTimeOffset.UtcNow) &&
            httpClientFactory is not null &&
            configuration is not null)
        {
            var refreshLock = GetStripedLock(CanvasOAuthRefreshLocks, normalizedUserKey);
            var acquiredRefreshLock = await refreshLock.WaitAsync(
                CanvasOAuthRefreshLockWaitTimeout,
                cancellationToken);

            if (!acquiredRefreshLock)
            {
                return ToCanvasConnection(await ReadCanvasTokenSnapshotAsync(
                    normalizedUserKey,
                    db,
                    dataProtectionProvider,
                    configuration,
                    cancellationToken));
            }

            try
            {
                snapshot = await ReadCanvasTokenSnapshotAsync(
                    normalizedUserKey,
                    db,
                    dataProtectionProvider,
                    configuration,
                    cancellationToken);
                tokenValues = snapshot?.TokenValues;

                if (snapshot is null || tokenValues is null)
                {
                    return ToCanvasConnection(snapshot);
                }

                if (string.Equals(tokenValues.TokenSource, "oauth", StringComparison.Ordinal) &&
                    ShouldRefreshCanvasOAuthToken(tokenValues, DateTimeOffset.UtcNow))
                {
                    var oauthOptions = GetCanvasOAuthOptions(configuration);

                    if (oauthOptions.Configured &&
                        string.Equals(
                            oauthOptions.InstanceUrl,
                            tokenValues.InstanceUrl,
                            StringComparison.OrdinalIgnoreCase) &&
                        !string.IsNullOrWhiteSpace(tokenValues.RefreshToken))
                    {
                        try
                        {
                            var refreshedToken = await RefreshCanvasOAuthTokenAsync(
                                httpClientFactory,
                                oauthOptions,
                                tokenValues.RefreshToken,
                                cancellationToken);
                            var now = DateTimeOffset.UtcNow;
                            var refreshedValues = tokenValues with
                            {
                                AccessToken = refreshedToken.AccessToken,
                                RefreshToken = string.IsNullOrWhiteSpace(refreshedToken.RefreshToken)
                                    ? tokenValues.RefreshToken
                                    : refreshedToken.RefreshToken,
                                StartsAt = now,
                                ExpiresAt = now.AddSeconds(refreshedToken.ExpiresInSeconds),
                                UpdatedAt = now,
                                UserName = string.IsNullOrWhiteSpace(refreshedToken.UserName)
                                    ? tokenValues.UserName
                                    : refreshedToken.UserName,
                                CanvasUserId = string.IsNullOrWhiteSpace(refreshedToken.UserId)
                                    ? tokenValues.CanvasUserId
                                    : refreshedToken.UserId,
                                Scope = string.IsNullOrWhiteSpace(refreshedToken.Scope)
                                    ? tokenValues.Scope
                                    : refreshedToken.Scope,
                            };

                            if (!await TryUpdateRefreshedCanvasTokenAsync(
                                normalizedUserKey,
                                db,
                                dataProtectionProvider,
                                snapshot,
                                refreshedValues,
                                cancellationToken))
                            {
                                return ToCanvasConnection(await ReadCanvasTokenSnapshotAsync(
                                    normalizedUserKey,
                                    db,
                                    dataProtectionProvider,
                                    configuration,
                                    cancellationToken));
                            }

                            return ToCanvasConnection(refreshedValues);
                        }
                        catch (CanvasOAuthRequestException)
                        {
                            // Refresh failures never mutate storage. Re-read so a concurrent manual
                            // replacement or deletion is reflected even when Canvas OAuth failed.
                            return ToCanvasConnection(await ReadCanvasTokenSnapshotAsync(
                                normalizedUserKey,
                                db,
                                dataProtectionProvider,
                                configuration,
                                cancellationToken));
                        }
                    }
                }

                return ToCanvasConnection(snapshot);
            }
            finally
            {
                refreshLock.Release();
            }
        }

        return ToCanvasConnection(tokenValues);
    }

    private static async Task<CanvasTokenSnapshot?> ReadCanvasTokenSnapshotAsync(
        string normalizedUserKey,
        CanvasToDoDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        IConfiguration? configuration,
        CancellationToken cancellationToken)
    {
        var revision = await db.UserSettings
            .AsNoTracking()
            .Where(userSetting =>
                userSetting.UserKey.ToLower() == normalizedUserKey &&
                userSetting.SettingKey == CanvasTokenSettingKey)
            .OrderBy(userSetting => userSetting.UserKey == normalizedUserKey ? 0 : 1)
            .Select(userSetting => new CanvasTokenSettingRevision(
                userSetting.Id,
                userSetting.UpdatedAt,
                userSetting.SettingJson))
            .FirstOrDefaultAsync(cancellationToken);

        if (revision is null)
        {
            return null;
        }

        var storedToken = TryReadStoredCanvasToken(revision.SettingJson);
        var tokenValues = storedToken is null
            ? null
            : TryUnprotectStoredCanvasToken(storedToken, dataProtectionProvider, configuration);

        return new CanvasTokenSnapshot(revision, storedToken, tokenValues);
    }

    private static CanvasConnection ToCanvasConnection(CanvasTokenSnapshot? snapshot)
    {
        if (snapshot is null)
        {
            return CanvasConnection.None();
        }

        if (snapshot.TokenValues is not null)
        {
            return ToCanvasConnection(snapshot.TokenValues);
        }

        return snapshot.StoredToken is null
            ? CanvasConnection.Invalid()
            : CanvasConnection.Invalid(
                NormalizeCanvasInstanceUrl(snapshot.StoredToken.InstanceUrl),
                GetStoredCanvasTokenSource(snapshot.StoredToken));
    }

    private static CanvasConnection ToCanvasConnection(CanvasTokenValues tokenValues)
    {
        var status = GetCanvasTokenStatus(tokenValues.StartsAt, tokenValues.ExpiresAt, DateTimeOffset.UtcNow);

        return new CanvasConnection(
            tokenValues.InstanceUrl,
            status == "connected" ? tokenValues.AccessToken : null,
            tokenValues.TokenSource,
            status,
            tokenValues.StartsAt,
            tokenValues.ExpiresAt,
            tokenValues.UpdatedAt,
            tokenValues.UserName);
    }

    private static async Task<bool> TryUpdateRefreshedCanvasTokenAsync(
        string normalizedUserKey,
        CanvasToDoDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        CanvasTokenSnapshot originalSnapshot,
        CanvasTokenValues refreshedValues,
        CancellationToken cancellationToken)
    {
        var rowUpdatedAt = refreshedValues.UpdatedAt ?? DateTimeOffset.UtcNow;
        var settingJson = SerializeStoredCanvasToken(
            dataProtectionProvider,
            refreshedValues,
            rowUpdatedAt);
        var affectedRows = await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            UPDATE user_settings
            SET "UpdatedAt" = {rowUpdatedAt},
                "SettingJson" = CAST({settingJson} AS jsonb)
            WHERE "Id" = {originalSnapshot.Revision.Id}
              AND lower("UserKey") = {normalizedUserKey}
              AND "SettingKey" = {CanvasTokenSettingKey}
              AND "UpdatedAt" = {originalSnapshot.Revision.UpdatedAt}
              AND "SettingJson" = CAST({originalSnapshot.Revision.SettingJson} AS jsonb);
            """,
            cancellationToken);

        return affectedRows == 1;
    }

    private static async Task<IResult> UpdateCanvasTokenForUserKeyAsync(
        string userKey,
        IHttpClientFactory httpClientFactory,
        CanvasToDoDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        UpdateCanvasTokenRequest request,
        CancellationToken cancellationToken,
        IConfiguration? configuration = null)
    {
        configuration ??= _configuration;

        if (!IsCanvasManualTokenEnabled(configuration))
        {
            return CreateManualCanvasTokenDisabledProblem();
        }

        var normalizedUserKey = userKey.Trim().ToLowerInvariant();
        var instanceUrl = GetAllowedCanvasInstanceUrl(request.InstanceUrl, configuration);
        var accessToken = (request.AccessToken ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(instanceUrl))
        {
            return Results.BadRequest(new
            {
                title = "Canvas instance is not allowed.",
                detail = "Use an HTTPS Canvas root URL from the configured institution allowlist.",
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
                    ? StatusCodes.Status422UnprocessableEntity
                    : StatusCodes.Status502BadGateway);
        }

        var now = DateTimeOffset.UtcNow;
        await SaveStoredCanvasTokenAsync(
            normalizedUserKey,
            db,
            dataProtectionProvider,
            new CanvasTokenValues(
                instanceUrl,
                accessToken,
                null,
                "user",
                startsAt,
                expiresAt,
                now,
                userName,
                null,
                null),
            cancellationToken);

        var connection = await ResolveCanvasConnectionForUserKeyAsync(
            normalizedUserKey,
            db,
            dataProtectionProvider,
            cancellationToken,
            configuration,
            httpClientFactory);

        return Results.Ok(ToCanvasTokenStatusDto(connection, configuration));
    }

    private static async Task<IResult> DeleteCanvasTokenForUserKeyAsync(
        string userKey,
        CanvasToDoDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        CancellationToken cancellationToken,
        IConfiguration? configuration = null)
    {
        var normalizedUserKey = userKey.Trim().ToLowerInvariant();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            DELETE FROM user_settings
            WHERE lower("UserKey") = {normalizedUserKey}
              AND "SettingKey" = {CanvasTokenSettingKey};
            """,
            cancellationToken);

        var connection = await ResolveCanvasConnectionForUserKeyAsync(
            normalizedUserKey,
            db,
            dataProtectionProvider,
            cancellationToken,
            configuration);

        return Results.Ok(ToCanvasTokenStatusDto(connection, configuration));
    }

    private static CanvasTokenStatusDto ToCanvasTokenStatusDto(
        CanvasConnection connection,
        IConfiguration? configuration = null,
        string? connectUrl = null)
    {
        configuration ??= _configuration;
        var oauthConfigured = GetCanvasOAuthOptions(configuration).Configured;

        return new CanvasTokenStatusDto(
            connection.Configured,
            connection.Connected,
            connection.Status,
            connection.InstanceUrl,
            connection.TokenSource,
            connection.StartsAt,
            connection.ExpiresAt,
            connection.UpdatedAt,
            connection.UserName,
            oauthConfigured,
            IsCanvasManualTokenEnabled(configuration),
            oauthConfigured ? connectUrl : null,
            GetAllowedCanvasOrigins(configuration).Select(origin => new CanvasSchoolDto(
                configuration?.GetSection("Authentication:Canvas:Schools").GetChildren()
                    .FirstOrDefault(school => TryNormalizeCanvasOrigin(school["InstanceUrl"]) == origin)?["Name"]
                ?? (origin switch {
                    "https://sfu.instructure.com" => "Simon Fraser University",
                    "https://canvas.ubc.ca" => "University of British Columbia",
                    "https://canvas.usask.ca" => "University of Saskatchewan",
                    "https://canvas.uw.edu" => "University of Washington",
                    "https://canvas.stanford.edu" => "Stanford University",
                    "https://canvas.harvard.edu" => "Harvard University",
                    _ => new Uri(origin).Host,
                }), origin)).OrderBy(school => school.Name).ToArray());
    }

    private static StoredCanvasToken? TryReadStoredCanvasToken(string settingJson)
    {
        if (string.IsNullOrWhiteSpace(settingJson) ||
            settingJson.Length > CanvasMaxStoredTokenJsonChars)
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

    private static CanvasTokenValues? TryUnprotectStoredCanvasToken(
        StoredCanvasToken storedToken,
        IDataProtectionProvider dataProtectionProvider,
        IConfiguration? configuration)
    {
        var instanceUrl = GetAllowedCanvasInstanceUrl(storedToken.InstanceUrl, configuration);

        if (string.IsNullOrWhiteSpace(instanceUrl) || string.IsNullOrWhiteSpace(storedToken.ProtectedAccessToken))
        {
            return null;
        }

        try
        {
            // Keep the original protector purpose so existing manual-token rows remain readable.
            var protector = dataProtectionProvider.CreateProtector(CanvasTokenProtectorPurpose);
            var accessToken = protector.Unprotect(storedToken.ProtectedAccessToken);
            var refreshToken = string.IsNullOrWhiteSpace(storedToken.ProtectedRefreshToken)
                ? null
                : protector.Unprotect(storedToken.ProtectedRefreshToken);

            if (string.IsNullOrWhiteSpace(accessToken) || accessToken.Length > 8192 ||
                refreshToken?.Length > 8192)
            {
                return null;
            }

            return new CanvasTokenValues(
                instanceUrl,
                accessToken,
                refreshToken,
                GetStoredCanvasTokenSource(storedToken),
                storedToken.StartsAt,
                storedToken.ExpiresAt,
                storedToken.UpdatedAt,
                NormalizeCanvasDisplayValue(storedToken.UserName, CanvasMaxDisplayNameLength),
                NormalizeCanvasIdentifier(storedToken.CanvasUserId),
                NormalizeCanvasDisplayValue(storedToken.Scope, CanvasMaxOAuthScopeLength));
        }
        catch (CryptographicException)
        {
            return null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static string SerializeStoredCanvasToken(
        IDataProtectionProvider dataProtectionProvider,
        CanvasTokenValues tokenValues,
        DateTimeOffset fallbackUpdatedAt)
    {
        var protector = dataProtectionProvider.CreateProtector(CanvasTokenProtectorPurpose);

        return JsonSerializer.Serialize(
            new StoredCanvasToken(
                tokenValues.InstanceUrl,
                protector.Protect(tokenValues.AccessToken),
                tokenValues.StartsAt,
                tokenValues.ExpiresAt,
                tokenValues.UpdatedAt ?? fallbackUpdatedAt,
                NormalizeCanvasDisplayValue(tokenValues.UserName, CanvasMaxDisplayNameLength),
                tokenValues.TokenSource,
                string.IsNullOrWhiteSpace(tokenValues.RefreshToken)
                    ? null
                    : protector.Protect(tokenValues.RefreshToken),
                NormalizeCanvasIdentifier(tokenValues.CanvasUserId),
                NormalizeCanvasDisplayValue(tokenValues.Scope, CanvasMaxOAuthScopeLength)),
            JsonOptions);
    }

    private static async Task SaveStoredCanvasTokenAsync(
        string userKey,
        CanvasToDoDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        CanvasTokenValues tokenValues,
        CancellationToken cancellationToken)
    {
        var normalizedUserKey = userKey.Trim().ToLowerInvariant();
        var now = DateTimeOffset.UtcNow;
        var settingJson = SerializeStoredCanvasToken(dataProtectionProvider, tokenValues, now);

        // A single database statement handles concurrent first writes without exposing either
        // plaintext token and gives normal last-write-wins behavior for later token rotations.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO user_settings
                ("Id", "CreatedAt", "UpdatedAt", "UserKey", "SettingKey", "SettingJson")
            VALUES
                ({Guid.NewGuid()}, {now}, {now}, {normalizedUserKey}, {CanvasTokenSettingKey}, CAST({settingJson} AS jsonb))
            ON CONFLICT ("UserKey", "SettingKey") DO UPDATE SET
                "UpdatedAt" = EXCLUDED."UpdatedAt",
                "SettingJson" = EXCLUDED."SettingJson";
            """,
            cancellationToken);
    }

    private static bool ShouldRefreshCanvasOAuthToken(CanvasTokenValues tokenValues, DateTimeOffset now) =>
        tokenValues.ExpiresAt.HasValue &&
        tokenValues.ExpiresAt.Value <= now.Add(CanvasOAuthRefreshWindow);

    private static string GetStoredCanvasTokenSource(StoredCanvasToken storedToken) =>
        string.Equals(storedToken.TokenSource, "oauth", StringComparison.OrdinalIgnoreCase)
            ? "oauth"
            : "user";

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
            "expired" when connection.TokenSource == "oauth" => "The Canvas authorization expired and could not be refreshed. Connect Canvas again.",
            "expired" => "The stored Canvas API token is expired. Update it in Academy Settings.",
            "invalid" => "The stored Canvas connection is invalid, cannot be decrypted, or uses an institution that is not allowed.",
            _ => "Connect Canvas to view Academy calendar data.",
        };

        return Results.Problem(
            title: "Canvas LMS is not connected.",
            detail: detail,
            statusCode: StatusCodes.Status409Conflict);
    }

    private static IResult CreateManualCanvasTokenDisabledProblem() =>
        Results.Problem(
            title: "Manual Canvas tokens are disabled.",
            detail: "Connect Canvas with the institution OAuth sign-in instead of pasting a personal API token.",
            statusCode: StatusCodes.Status403Forbidden);

    private static IResult CreateCanvasOAuthNotConfiguredProblem() =>
        Results.Problem(
            title: "Canvas OAuth is not configured.",
            detail: "An administrator must enable Canvas OAuth and configure the SFU Canvas client credentials.",
            statusCode: StatusCodes.Status503ServiceUnavailable);

    private static IResult CreateCanvasRequestLimitProblem() =>
        Results.Problem(
            title: "Canvas calendar is too large.",
            detail: "Canvas returned more pages or items than this app can safely process. Choose a shorter date range and try again.",
            statusCode: StatusCodes.Status502BadGateway);

    private static IResult CreateCanvasCalendarTimeoutProblem() =>
        Results.Problem(
            title: "Canvas calendar timed out.",
            detail: "Canvas could not finish the bounded calendar request in time. Try a shorter date range.",
            statusCode: StatusCodes.Status504GatewayTimeout);

    private static bool IsCanvasManualTokenEnabled(IConfiguration? configuration) =>
        configuration?.GetValue<bool?>("Authentication:Canvas:ManualTokenEnabled") ?? false;

    private static CanvasOAuthOptions GetCanvasOAuthOptions(IConfiguration? configuration)
    {
        var enabled = configuration?.GetValue<bool?>("Authentication:Canvas:OAuth:Enabled") == true;
        var clientId = configuration?["Authentication:Canvas:OAuth:ClientId"]?.Trim() ?? string.Empty;
        var clientSecret = configuration?["Authentication:Canvas:OAuth:ClientSecret"]?.Trim() ?? string.Empty;
        var instanceUrl = GetAllowedCanvasInstanceUrl(DefaultCanvasInstanceUrl, configuration);

        return new CanvasOAuthOptions(
            instanceUrl ?? DefaultCanvasInstanceUrl,
            clientId,
            clientSecret,
            enabled &&
            instanceUrl is not null &&
            !string.IsNullOrWhiteSpace(clientId) &&
            !string.IsNullOrWhiteSpace(clientSecret));
    }

    private static string? GetAllowedCanvasInstanceUrl(string? instanceUrl, IConfiguration? configuration)
    {
        var normalizedOrigin = TryNormalizeCanvasOrigin(instanceUrl);

        if (normalizedOrigin is null)
        {
            return null;
        }

        return GetAllowedCanvasOrigins(configuration).Contains(normalizedOrigin)
            ? normalizedOrigin
            : null;
    }

    private static HashSet<string> GetAllowedCanvasOrigins(IConfiguration? configuration)
    {
        var configuredValues = new List<string>();

        if (configuration is not null)
        {
            foreach (var key in new[]
                     {
                         "Authentication:Canvas:AllowedOrigins",
                         "Authentication:Canvas:AllowedInstanceUrls",
                     })
            {
                var valuesForKey = configuration.GetSection(key)
                    .GetChildren()
                    .Select(child => child.Value)
                    .Where(value => !string.IsNullOrWhiteSpace(value))
                    .Select(value => value!)
                    .ToList();

                var scalarValue = configuration[key];

                if (!string.IsNullOrWhiteSpace(scalarValue))
                {
                    valuesForKey.AddRange(scalarValue.Split(
                        [',', ';'],
                        StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries));
                }

                if (valuesForKey.Count > 0)
                {
                    configuredValues.AddRange(valuesForKey);
                    break;
                }
            }
        }

        if (configuredValues.Count == 0)
        {
            configuredValues.Add(DefaultCanvasInstanceUrl);
        }

        return configuredValues
            .Select(TryNormalizeCanvasOrigin)
            .Where(origin => origin is not null)
            .Select(origin => origin!)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static string? TryNormalizeCanvasOrigin(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) ||
            !Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment) ||
            (uri.AbsolutePath.Length > 1 && uri.AbsolutePath != "/"))
        {
            return null;
        }

        if (uri.Scheme != Uri.UriSchemeHttps &&
            !(uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback))
        {
            return null;
        }

        var origin = uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');

        // Existing rows used SFU's vanity host; send future requests to the canonical Canvas origin.
        return origin.Equals(LegacyCanvasSfuInstanceUrl, StringComparison.OrdinalIgnoreCase)
            ? DefaultCanvasInstanceUrl
            : origin;
    }

    private static string BuildCanvasOAuthConnectUrl(HttpContext context)
    {
        var pathBase = context.Request.PathBase.HasValue
            ? context.Request.PathBase.Value!.TrimEnd('/')
            : string.Empty;
        return $"{pathBase}/api/canvas/oauth/login";
    }

    private static string BuildCanvasOAuthCallbackUrl(HttpContext context, IConfiguration configuration)
    {
        var configuredCallbackUrl = configuration["Authentication:Canvas:OAuth:CallbackUrl"]?.Trim();

        if (!string.IsNullOrWhiteSpace(configuredCallbackUrl))
        {
            return configuredCallbackUrl;
        }

        var pathBase = context.Request.PathBase.HasValue
            ? context.Request.PathBase.Value!.TrimEnd('/')
            : string.Empty;
        return $"{context.Request.Scheme}://{context.Request.Host}{pathBase}/api/canvas/oauth/callback";
    }

    private static bool IsSecureOAuthCallbackUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment))
        {
            return false;
        }

        return uri.Scheme == Uri.UriSchemeHttps ||
               (uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback);
    }

    private static string NormalizeCanvasReturnUrl(string? returnUrl, HttpContext context)
    {
        if (IsSafeCanvasReturnUrl(returnUrl))
        {
            return returnUrl!;
        }

        return context.Request.PathBase.HasValue
            ? $"{context.Request.PathBase.Value!.TrimEnd('/')}/"
            : "/";
    }

    private static bool IsSafeCanvasReturnUrl(string? returnUrl) =>
        !string.IsNullOrWhiteSpace(returnUrl) &&
        returnUrl.Length <= 2048 &&
        returnUrl.StartsWith('/') &&
        !returnUrl.StartsWith("//", StringComparison.Ordinal) &&
        !returnUrl.Contains('\\') &&
        !returnUrl.Any(char.IsControl);

    private static CanvasOAuthState? TryReadCanvasOAuthState(
        string? state,
        IDataProtectionProvider dataProtectionProvider)
    {
        if (string.IsNullOrWhiteSpace(state) || state.Length > 16384)
        {
            return null;
        }

        try
        {
            var protector = dataProtectionProvider.CreateProtector(CanvasOAuthStateProtectorPurpose);
            return JsonSerializer.Deserialize<CanvasOAuthState>(protector.Unprotect(state), JsonOptions);
        }
        catch (CryptographicException)
        {
            return null;
        }
        catch (FormatException)
        {
            return null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string TruncateForDisplay(string value, int maximumLength)
    {
        var sanitized = new string(value.Where(character => !char.IsControl(character)).ToArray()).Trim();
        return sanitized.Length <= maximumLength ? sanitized : sanitized[..maximumLength];
    }

    private static string? NormalizeCanvasDisplayValue(string? value, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = TruncateForDisplay(value, maximumLength);
        return normalized.Length == 0 ? null : normalized;
    }

    private static string? NormalizeCanvasBoundedValue(string? value, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = value.Trim();
        return normalized.Length <= maximumLength && !normalized.Any(char.IsControl)
            ? normalized
            : null;
    }

    private static string? NormalizeCanvasIdentifier(string? value) =>
        NormalizeCanvasBoundedValue(value, CanvasMaxIdentifierLength);

    private static string? NormalizeCanvasReturnedUrl(string? value)
    {
        var normalized = NormalizeCanvasBoundedValue(value, CanvasMaxUrlLength);
        return normalized is not null && IsAllowedCanvasRequestUri(normalized, _configuration)
            ? normalized
            : null;
    }

    private static string? GetUserKey(HttpContext context)
        => UserOwnerKeys.FromPrincipal(context.User);

    private static IResult? ValidateCanvasOwner(HttpContext context)
    {
        var userKey = GetUserKey(context);

        if (userKey is null)
        {
            return Results.Unauthorized();
        }

        var expectedOwner = context.Request.Headers[CanvasOwnerHeader].ToString().Trim();

        return string.Equals(expectedOwner, userKey, StringComparison.OrdinalIgnoreCase)
            ? null
            : Results.Problem(
                title: "Canvas session changed.",
                detail: "Reload Canvas data before accessing this account's connection or calendar.",
                statusCode: StatusCodes.Status409Conflict);
    }

    private static string GetCanvasCacheUserKey(HttpContext context, CanvasConnection connection)
    {
        var userKey = GetUserKey(context) ??
                      context.User.FindFirstValue(ClaimTypes.NameIdentifier) ??
                      "unknown";
        var connectionRevision = connection.UpdatedAt?.UtcDateTime.Ticks ?? 0;
        return $"{userKey}:{connectionRevision.ToString(CultureInfo.InvariantCulture)}";
    }

    private static async Task<CanvasCourseDto[]> GetCachedActiveStudentCoursesAsync(
        IMemoryCache memoryCache,
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        string userCacheKey,
        int resultLimit,
        CanvasRequestBudget? requestBudget,
        CancellationToken cancellationToken)
    {
        var safeResultLimit = Math.Clamp(resultLimit, 1, CanvasMaxActiveCourses);
        var courseCacheKey = string.Join(
            ':',
            "canvas-active-courses",
            "v5",
            userCacheKey,
            instanceUrl);

        if (memoryCache.TryGetValue(courseCacheKey, out CanvasCourseDto[]? courses) &&
            courses is not null)
        {
            return courses.Take(safeResultLimit).ToArray();
        }

        var cacheLock = GetStripedLock(CanvasActiveCourseCacheLocks, courseCacheKey);
        await cacheLock.WaitAsync(cancellationToken);

        try
        {
            if (memoryCache.TryGetValue(courseCacheKey, out courses) && courses is not null)
            {
                return courses.Take(safeResultLimit).ToArray();
            }

            courses = await GetActiveStudentCoursesAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                CanvasActiveCourseFetchPageSize,
                requestBudget,
                cancellationToken);

            memoryCache.Set(
                courseCacheKey,
                courses,
                new MemoryCacheEntryOptions
                {
                    Size = GetApproximateCacheSizeBytes(courses),
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5),
                    SlidingExpiration = TimeSpan.FromMinutes(1),
                });

            return courses.Take(safeResultLimit).ToArray();
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
        CanvasRequestBudget? requestBudget,
        CancellationToken cancellationToken)
    {
        var courses = new List<CanvasCourseDto>();
        var query = new List<KeyValuePair<string, string?>>
        {
            new("enrollment_type", "student"),
            new("enrollment_state", "active"),
            new("include[]", "term"),
            new("include[]", "total_scores"),
            new("state[]", "unpublished"),
            new("state[]", "available"),
            new("per_page", Math.Min(pageSize, CanvasActiveCourseFetchPageSize).ToString(CultureInfo.InvariantCulture)),
        };
        var requestUri = QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/courses", query);
        var pageCount = 0;

        while (!string.IsNullOrWhiteSpace(requestUri) &&
               courses.Count < CanvasMaxActiveCourses &&
               pageCount < CanvasMaxPaginationPages)
        {
            pageCount++;
            var page = await SendCanvasGetPageAsync(
                httpClientFactory,
                accessToken,
                requestUri,
                cancellationToken,
                requestBudget);

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

        if (courses.Count > CanvasMaxActiveCourses || !string.IsNullOrWhiteSpace(requestUri))
        {
            throw new CanvasRequestLimitException();
        }

        return courses
            .Take(CanvasMaxActiveCourses)
            .ToArray();
    }

    private static async Task<CanvasCourseDto[]> GetCachedCompletedStudentCoursesAsync(
        IMemoryCache memoryCache,
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        string userCacheKey,
        int resultLimit,
        CanvasRequestBudget? requestBudget,
        CancellationToken cancellationToken)
    {
        var safeResultLimit = Math.Clamp(resultLimit, 1, CanvasMaxActiveCourses);
        var courseCacheKey = string.Join(
            ':',
            "canvas-completed-courses",
            "v2",
            userCacheKey,
            instanceUrl);

        if (memoryCache.TryGetValue(courseCacheKey, out CanvasCourseDto[]? courses) && courses is not null)
        {
            return courses
                .OrderByDescending(course => course.TermEndAt ?? course.EndAt ?? course.StartAt)
                .Take(safeResultLimit)
                .ToArray();
        }

        var cacheLock = GetStripedLock(CanvasActiveCourseCacheLocks, courseCacheKey);
        await cacheLock.WaitAsync(cancellationToken);

        try
        {
            if (memoryCache.TryGetValue(courseCacheKey, out courses) && courses is not null)
            {
                return courses
                    .OrderByDescending(course => course.TermEndAt ?? course.EndAt ?? course.StartAt)
                    .Take(safeResultLimit)
                    .ToArray();
            }

            courses = await GetCompletedStudentCoursesAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                CanvasActiveCourseFetchPageSize,
                requestBudget,
                cancellationToken);

            memoryCache.Set(
                courseCacheKey,
                courses,
                new MemoryCacheEntryOptions
                {
                    Size = GetApproximateCacheSizeBytes(courses),
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5),
                    SlidingExpiration = TimeSpan.FromMinutes(1),
                });

            return courses
                .OrderByDescending(course => course.TermEndAt ?? course.EndAt ?? course.StartAt)
                .Take(safeResultLimit)
                .ToArray();
        }
        finally
        {
            cacheLock.Release();
        }
    }

    private static async Task<CanvasCourseDto[]> GetCompletedStudentCoursesAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        int pageSize,
        CanvasRequestBudget? requestBudget,
        CancellationToken cancellationToken)
    {
        var courses = new List<CanvasCourseDto>();
        var query = new List<KeyValuePair<string, string?>>
        {
            new("enrollment_type", "student"),
            new("enrollment_state", "completed"),
            new("include[]", "term"),
            new("include[]", "total_scores"),
            new("state[]", "unpublished"),
            new("state[]", "available"),
            new("state[]", "completed"),
            new("per_page", Math.Min(pageSize, CanvasActiveCourseFetchPageSize).ToString(CultureInfo.InvariantCulture)),
        };
        var requestUri = QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/courses", query);
        var pageCount = 0;

        while (!string.IsNullOrWhiteSpace(requestUri) &&
               courses.Count < CanvasMaxActiveCourses &&
               pageCount < CanvasMaxPaginationPages)
        {
            pageCount++;
            var page = await SendCanvasGetPageAsync(
                httpClientFactory,
                accessToken,
                requestUri,
                cancellationToken,
                requestBudget);

            using var document = JsonDocument.Parse(page.Payload);

            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                throw new CanvasApiRequestException(
                    "Canvas courses failed to load.",
                    "Canvas returned an unexpected completed-courses response.",
                    StatusCodes.Status502BadGateway);
            }

            courses.AddRange(document.RootElement
                .EnumerateArray()
                .Select(course => ParseCanvasCourse(course, instanceUrl))
                .Where(course => !string.IsNullOrWhiteSpace(course.Name)));

            requestUri = page.NextUrl;
        }

        if (courses.Count > CanvasMaxActiveCourses || !string.IsNullOrWhiteSpace(requestUri))
        {
            throw new CanvasRequestLimitException();
        }

        return courses.Take(CanvasMaxActiveCourses).ToArray();
    }

    private static CanvasCourseDto ParseCanvasCourse(JsonElement course, string instanceUrl)
    {
        var id = GetJsonStringOrNumber(course, "id") ?? "";
        var name =
            NormalizeCanvasDisplayValue(GetJsonString(course, "name"), CanvasMaxDisplayNameLength) ??
            NormalizeCanvasDisplayValue(GetJsonString(course, "original_name"), CanvasMaxDisplayNameLength) ??
            NormalizeCanvasDisplayValue(GetJsonString(course, "course_code"), CanvasMaxDisplayNameLength) ??
            "Untitled course";
        var htmlUrl = NormalizeCanvasReturnedUrl(GetJsonString(course, "html_url"));

        if (string.IsNullOrWhiteSpace(htmlUrl) && !string.IsNullOrWhiteSpace(id))
        {
            htmlUrl = $"{instanceUrl}/courses/{id}";
        }

        var grade = GetCanvasCourseGrade(course);
        var workflowState = NormalizeCanvasDisplayValue(
            GetJsonString(course, "workflow_state"),
            CanvasMaxWorkflowStateLength);
        var enrollmentState = GetCanvasCourseEnrollmentState(course);
        var accessRestrictedByDate = GetJsonBool(course, "access_restricted_by_date") == true;
        var accessClosed = accessRestrictedByDate ||
            string.Equals(enrollmentState, "inactive", StringComparison.OrdinalIgnoreCase);
        var term = GetJsonObject(course, "term");

        return new CanvasCourseDto(
            id,
            name,
            NormalizeCanvasDisplayValue(GetJsonString(course, "course_code"), CanvasMaxCourseCodeLength),
            GetCanvasTermName(course),
            workflowState,
            GetJsonDateTimeOffset(course, "start_at"),
            GetJsonDateTimeOffset(course, "end_at"),
            htmlUrl,
            grade.CurrentScore,
            grade.CurrentGrade,
            term.HasValue ? GetJsonDateTimeOffset(term.Value, "start_at") : null,
            term.HasValue ? GetJsonDateTimeOffset(term.Value, "end_at") : null,
            enrollmentState,
            accessRestrictedByDate,
            accessClosed,
            !string.Equals(workflowState, "unpublished", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(workflowState, "created", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(workflowState, "claimed", StringComparison.OrdinalIgnoreCase));
    }

    private static CanvasCoursePersonDto? ParseCanvasCoursePerson(JsonElement person)
    {
        var id = GetJsonStringOrNumber(person, "id");
        var name =
            NormalizeCanvasDisplayValue(GetJsonString(person, "name"), CanvasMaxDisplayNameLength) ??
            NormalizeCanvasDisplayValue(GetJsonString(person, "short_name"), CanvasMaxDisplayNameLength);

        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        var enrollments = person.TryGetProperty("enrollments", out var enrollmentsElement) &&
                          enrollmentsElement.ValueKind == JsonValueKind.Array
            ? enrollmentsElement.EnumerateArray().ToArray()
            : [];
        var roles = enrollments
            .Select(enrollment =>
                GetJsonString(enrollment, "role") ??
                GetJsonString(enrollment, "type"))
            .Select(role => NormalizeCanvasDisplayValue(role, CanvasMaxWorkflowStateLength))
            .Where(role => role is not null)
            .Select(role => role!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(16)
            .ToArray();

        var enrollmentStates = enrollments
            .Select(enrollment => NormalizeCanvasDisplayValue(
                GetJsonString(enrollment, "enrollment_state"),
                CanvasMaxWorkflowStateLength))
            .Where(state => state is not null)
            .Select(state => state!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(16)
            .ToArray();
        var sectionIds = enrollments
            .Select(enrollment => NormalizeCanvasIdentifier(GetJsonStringOrNumber(enrollment, "course_section_id")))
            .Where(sectionId => sectionId is not null)
            .Select(sectionId => sectionId!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(32)
            .ToArray();

        return new CanvasCoursePersonDto(
            id,
            name,
            NormalizeCanvasDisplayValue(GetJsonString(person, "short_name"), CanvasMaxDisplayNameLength),
            NormalizeCanvasDisplayValue(GetJsonString(person, "sortable_name"), CanvasMaxDisplayNameLength),
            roles,
            NormalizeCanvasDisplayValue(GetJsonString(person, "email"), 320),
            NormalizeCanvasReturnedUrl(GetJsonString(person, "avatar_url")),
            NormalizeCanvasDisplayValue(GetJsonString(person, "login_id"), CanvasMaxDisplayNameLength),
            NormalizeCanvasDisplayValue(GetJsonString(person, "bio"), CanvasMaxDisplayNameLength),
            enrollmentStates,
            sectionIds);
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
        courses.TryGetValue(courseId ?? string.Empty, out var course);
        var title =
            NormalizeCanvasDisplayValue(GetJsonString(activityItem, "title"), CanvasMaxDisplayNameLength) ??
            NormalizeCanvasDisplayValue(GetJsonString(activityItem, "subject"), CanvasMaxDisplayNameLength) ??
            "Canvas notification";

        return new CanvasInboxItemDto(
            $"canvas-inbox-{id}",
            title,
            NormalizeCanvasDisplayValue(GetJsonString(activityItem, "message"), 4000),
            NormalizeCanvasDisplayValue(GetJsonString(activityItem, "type"), CanvasMaxWorkflowStateLength) ??
                "notification",
            courseId,
            course?.CourseCode,
            course?.Name,
            GetJsonDateTimeOffset(activityItem, "created_at"),
            GetJsonDateTimeOffset(activityItem, "updated_at"),
            NormalizeCanvasReturnedUrl(
                GetJsonString(activityItem, "html_url") ??
                GetJsonString(activityItem, "url")),
            NormalizeCanvasDisplayValue(GetJsonString(activityItem, "read_state"), CanvasMaxWorkflowStateLength));
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
        CanvasRequestBudget requestBudget,
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
                var events = await GetCanvasCalendarEventsBatchAsync(
                    httpClientFactory,
                    instanceUrl,
                    accessToken,
                    type,
                    startAt,
                    endAt,
                    pageSize,
                    contextCodeBatch,
                    requestBudget,
                    cancellationToken);
                return new CanvasCalendarEventsResult(events, null);
            }
            catch (CanvasApiRequestException exception)
            {
                // An inaccessible batch must not discard successful course calendars.
                return new CanvasCalendarEventsResult([], exception);
            }
            finally
            {
                concurrencyGate.Release();
            }
        });
        var batchEvents = await Task.WhenAll(batchTasks);
        var events = batchEvents
            .SelectMany(batch => batch.Events)
            .Take(CanvasMaxPaginationItems + 1)
            .ToArray();

        if (events.Length > CanvasMaxPaginationItems)
        {
            throw new CanvasRequestLimitException();
        }

        return new CanvasCalendarEventsResult(events, GetMostRelevantCanvasError(batchEvents.Select(batch => batch.Error).ToArray()));
    }

    private static CanvasApiRequestException? GetMostRelevantCanvasError(params CanvasApiRequestException?[] errors) =>
        errors.OfType<CanvasApiRequestException>()
            .OrderBy(error => error.StatusCode is >= 400 and < 500 ? 0 : 1)
            .FirstOrDefault();

    private static async Task<JsonElement[]> GetCanvasCalendarEventsBatchAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        string type,
        DateTimeOffset startAt,
        DateTimeOffset endAt,
        int pageSize,
        string[] contextCodeBatch,
        CanvasRequestBudget requestBudget,
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
        var pageCount = 0;

        while (!string.IsNullOrWhiteSpace(requestUri) &&
               pageCount < CanvasMaxPaginationPages &&
               events.Count < CanvasMaxPaginationItems)
        {
            pageCount++;
            var page = await SendCanvasGetPageAsync(
                httpClientFactory,
                accessToken,
                requestUri,
                cancellationToken,
                requestBudget);

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

        if (events.Count > CanvasMaxPaginationItems || !string.IsNullOrWhiteSpace(requestUri))
        {
            throw new CanvasRequestLimitException();
        }

        return events.Take(CanvasMaxPaginationItems).ToArray();
    }

    private static async Task<CanvasCourseAssignmentItemsResult> GetCanvasCourseAssignmentCalendarItemsAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        CanvasCourseDto[] courses,
        DateTimeOffset startAt,
        DateTimeOffset endAt,
        IReadOnlyDictionary<string, CanvasSubmissionStatus> submissionLookup,
        CanvasRequestBudget requestBudget,
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
                    var items = await GetCanvasCourseAssignmentCalendarItemsForCourseAsync(
                        httpClientFactory,
                        instanceUrl,
                        accessToken,
                        course,
                        startAt,
                        endAt,
                        submissionLookup,
                        requestBudget,
                        cancellationToken);
                    return new CanvasCourseAssignmentItemsResult(items, true, true);
                }
                catch (CanvasApiRequestException)
                {
                    return new CanvasCourseAssignmentItemsResult([], false);
                }
                catch (CanvasRequestLimitException)
                {
                    return new CanvasCourseAssignmentItemsResult([], false);
                }
                finally
                {
                    concurrencyGate.Release();
                }
            });
        var courseItems = await Task.WhenAll(courseTasks);
        var items = courseItems
            .SelectMany(result => result.Items)
            .Take(CanvasMaxCalendarResponseItems + 1)
            .ToArray();

        return new CanvasCourseAssignmentItemsResult(
            items,
            items.Length <= CanvasMaxCalendarResponseItems &&
            courseItems.All(result => result.IsComplete),
            courseItems.Any(result => result.HasSuccessfulResponse));
    }

    private static async Task<CanvasCalendarItemDto[]> GetCanvasCourseAssignmentCalendarItemsForCourseAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        CanvasCourseDto course,
        DateTimeOffset startAt,
        DateTimeOffset endAt,
        IReadOnlyDictionary<string, CanvasSubmissionStatus> submissionLookup,
        CanvasRequestBudget requestBudget,
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
        var pageCount = 0;

        while (!string.IsNullOrWhiteSpace(requestUri) &&
               pageCount < CanvasMaxPaginationPages &&
               assignments.Count < CanvasMaxPaginationItems)
        {
            pageCount++;
            var page = await SendCanvasGetPageAsync(
                httpClientFactory,
                accessToken,
                requestUri,
                cancellationToken,
                requestBudget);

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

        if (assignments.Count > CanvasMaxPaginationItems || !string.IsNullOrWhiteSpace(requestUri))
        {
            throw new CanvasRequestLimitException();
        }

        return assignments.Take(CanvasMaxPaginationItems).ToArray();
    }

    private static CanvasCalendarItemDto? ParseCanvasAssignmentCalendarItem(
        JsonElement assignment,
        CanvasCourseDto course,
        DateTimeOffset startAt,
        DateTimeOffset endAt,
        IReadOnlyDictionary<string, CanvasSubmissionStatus> submissionLookup)
    {
        var assignmentId = GetJsonStringOrNumber(assignment, "id");
        var title = NormalizeCanvasDisplayValue(
            GetJsonString(assignment, "name"),
            CanvasMaxDisplayNameLength);
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
            NormalizeCanvasReturnedUrl(GetJsonString(assignment, "html_url")),
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
        CanvasRequestBudget requestBudget,
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
                requestBudget,
                timeoutCancellationToken.Token);

            return (lookup, true);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return (new Dictionary<string, CanvasSubmissionStatus>(StringComparer.OrdinalIgnoreCase), false);
        }
        catch (CanvasApiRequestException)
        {
            return (new Dictionary<string, CanvasSubmissionStatus>(StringComparer.OrdinalIgnoreCase), false);
        }
        catch (CanvasRequestLimitException)
        {
            return (new Dictionary<string, CanvasSubmissionStatus>(StringComparer.OrdinalIgnoreCase), false);
        }
    }

    private static async Task<IReadOnlyDictionary<string, CanvasSubmissionStatus>> GetCanvasAssignmentSubmissionLookupAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        JsonElement[] assignmentEvents,
        CanvasRequestBudget requestBudget,
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

        using var concurrencyGate = new SemaphoreSlim(6, 6);
        var submissionTasks = assignmentReferences.Select(async group =>
        {
            await concurrencyGate.WaitAsync(cancellationToken);

            try
            {
                return await GetCanvasCourseSubmissionLookupAsync(
                    httpClientFactory,
                    instanceUrl,
                    accessToken,
                    group.Key,
                    group.Select(reference => reference.AssignmentId).ToArray(),
                    requestBudget,
                    cancellationToken,
                    ignoreRequestFailures: false);
            }
            finally
            {
                concurrencyGate.Release();
            }
        });
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
        CanvasRequestBudget requestBudget,
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
                var pageCount = 0;

                while (!string.IsNullOrWhiteSpace(requestUri) && pageCount < CanvasMaxPaginationPages)
                {
                    pageCount++;
                    var page = await SendCanvasGetPageAsync(
                        httpClientFactory,
                        accessToken,
                        requestUri,
                        cancellationToken,
                        requestBudget);

                    using var document = JsonDocument.Parse(page.Payload);

                    if (document.RootElement.ValueKind != JsonValueKind.Array)
                    {
                        throw new CanvasApiRequestException(
                            "Canvas submissions failed to load.",
                            "Canvas returned an unexpected submissions response.",
                            StatusCodes.Status502BadGateway);
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

                if (!string.IsNullOrWhiteSpace(requestUri))
                {
                    throw new CanvasRequestLimitException();
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

        var contextCode = NormalizeCanvasBoundedValue(
            GetJsonString(calendarEvent, "context_code"),
            CanvasMaxContextCodeLength);
        var courseId = GetCourseId(contextCode) ??
            (assignment.HasValue ? GetJsonStringOrNumber(assignment.Value, "course_id") : null);
        courses.TryGetValue(courseId ?? "", out var course);
        var assignmentId = GetCanvasAssignmentReference(calendarEvent)?.AssignmentId;
        var submissionStatus = assignment.HasValue
            ? GetCanvasAssignmentSubmissionStatus(assignment.Value)
            : new CanvasSubmissionStatus(false, null);

        if (!string.IsNullOrWhiteSpace(courseId) && !string.IsNullOrWhiteSpace(assignmentId) &&
            submissionLookup.TryGetValue(GetAssignmentSubmissionLookupKey(courseId, assignmentId), out var lookupStatus))
        {
            submissionStatus = lookupStatus;
        }

        var title =
            NormalizeCanvasDisplayValue(GetJsonString(calendarEvent, "title"), CanvasMaxDisplayNameLength) ??
            (assignment.HasValue
                ? NormalizeCanvasDisplayValue(
                    GetJsonString(assignment.Value, "name"),
                    CanvasMaxDisplayNameLength)
                : null) ??
            "Canvas item";
        var allDayDate = GetJsonDateTimeOffset(calendarEvent, "all_day_date");
        var startAt = GetJsonDateTimeOffset(calendarEvent, "start_at") ?? allDayDate;
        var endAt = GetJsonDateTimeOffset(calendarEvent, "end_at") ?? allDayDate;
        var dueAt = assignment.HasValue ? GetJsonDateTimeOffset(assignment.Value, "due_at") : null;
        var htmlUrl =
            NormalizeCanvasReturnedUrl(GetJsonString(calendarEvent, "html_url")) ??
            (assignment.HasValue
                ? NormalizeCanvasReturnedUrl(GetJsonString(assignment.Value, "html_url"))
                : null);
        var submissionTypes = assignment.HasValue
            ? GetJsonStringArray(assignment.Value, "submission_types")
            : [];
        var type = GetCanvasCalendarItemType(title, calendarType, assignment);

        return new CanvasCalendarItemDto(
            !string.IsNullOrWhiteSpace(courseId) && !string.IsNullOrWhiteSpace(assignmentId)
                ? $"canvas-assignment-{courseId}-{assignmentId}"
                : $"canvas-{calendarType}-{id}",
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

    private static string GetAssignmentSubmissionLookupKey(string courseId, string assignmentId)
    {
        return $"{courseId}:{assignmentId}";
    }

    private static CanvasSubmissionStatus GetCanvasAssignmentSubmissionStatus(JsonElement assignment)
    {
        var submission = GetJsonObject(assignment, "submission");

        return submission.HasValue
            ? GetCanvasSubmissionStatus(submission.Value)
            : new CanvasSubmissionStatus(false, null);
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

    private static Task<CanvasOAuthTokenResult> ExchangeCanvasOAuthCodeAsync(
        IHttpClientFactory httpClientFactory,
        CanvasOAuthOptions options,
        string code,
        string redirectUri,
        CancellationToken cancellationToken) =>
        RequestCanvasOAuthTokenAsync(
            httpClientFactory,
            options,
            new Dictionary<string, string>
            {
                ["grant_type"] = "authorization_code",
                ["client_id"] = options.ClientId,
                ["client_secret"] = options.ClientSecret,
                ["redirect_uri"] = redirectUri,
                ["code"] = code,
            },
            requireRefreshToken: true,
            cancellationToken);

    private static Task<CanvasOAuthTokenResult> RefreshCanvasOAuthTokenAsync(
        IHttpClientFactory httpClientFactory,
        CanvasOAuthOptions options,
        string refreshToken,
        CancellationToken cancellationToken) =>
        RequestCanvasOAuthTokenAsync(
            httpClientFactory,
            options,
            new Dictionary<string, string>
            {
                ["grant_type"] = "refresh_token",
                ["client_id"] = options.ClientId,
                ["client_secret"] = options.ClientSecret,
                ["refresh_token"] = refreshToken,
            },
            requireRefreshToken: false,
            cancellationToken);

    private static async Task<CanvasOAuthTokenResult> RequestCanvasOAuthTokenAsync(
        IHttpClientFactory httpClientFactory,
        CanvasOAuthOptions options,
        IReadOnlyDictionary<string, string> fields,
        bool requireRefreshToken,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"{options.InstanceUrl}/login/oauth2/token")
        {
            Content = new FormUrlEncodedContent(fields),
        };
        request.Headers.TryAddWithoutValidation("User-Agent", CanvasUserAgent);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var timeoutCancellationToken = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCancellationToken.CancelAfter(CanvasRequestTimeout);

        try
        {
            using var response = await httpClientFactory
                .CreateClient("Canvas")
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeoutCancellationToken.Token);
            var finalRequestUrl = response.RequestMessage?.RequestUri;

            if (!HasSameOrigin(request.RequestUri, finalRequestUrl))
            {
                throw new CanvasOAuthRequestException("Canvas OAuth redirected to an unexpected origin.");
            }

            var responsePayload = await ReadCanvasResponsePayloadAsync(
                response.Content,
                timeoutCancellationToken.Token);

            if (!response.IsSuccessStatusCode)
            {
                throw new CanvasOAuthRequestException(GetCanvasOAuthError(responsePayload.Payload));
            }

            try
            {
                using var document = JsonDocument.Parse(responsePayload.Payload);
                var root = document.RootElement;

                if (root.ValueKind != JsonValueKind.Object)
                {
                    throw new CanvasOAuthRequestException("Canvas returned an invalid OAuth response.");
                }

                var accessToken = GetJsonString(root, "access_token")?.Trim();
                var refreshToken = GetJsonString(root, "refresh_token")?.Trim();

                if (string.IsNullOrWhiteSpace(accessToken) || accessToken.Length > 8192 ||
                    (requireRefreshToken && string.IsNullOrWhiteSpace(refreshToken)) ||
                    refreshToken?.Length > 8192)
                {
                    throw new CanvasOAuthRequestException("Canvas did not return usable OAuth credentials.");
                }

                var expiresIn = GetJsonLong(root, "expires_in") ?? 3600;
                expiresIn = Math.Clamp(expiresIn, 60, 24 * 60 * 60);
                var user = GetJsonObject(root, "user");

                return new CanvasOAuthTokenResult(
                    accessToken,
                    refreshToken,
                    expiresIn,
                    user.HasValue
                        ? GetJsonStringOrNumber(user.Value, "id")
                        : null,
                    user.HasValue
                        ? GetJsonString(user.Value, "name") ?? GetJsonString(user.Value, "short_name")
                        : null,
                    GetJsonString(root, "scope"));
            }
            catch (JsonException)
            {
                throw new CanvasOAuthRequestException("Canvas returned an invalid OAuth response.");
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new CanvasOAuthRequestException("Canvas OAuth timed out. Try connecting again.");
        }
        catch (HttpRequestException)
        {
            throw new CanvasOAuthRequestException("Canvas OAuth is temporarily unavailable. Try again.");
        }
        catch (InvalidDataException)
        {
            throw new CanvasOAuthRequestException("Canvas returned an oversized OAuth response.");
        }
    }

    private static string GetCanvasOAuthError(string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);

            if (document.RootElement.ValueKind == JsonValueKind.Object)
            {
                var description = GetJsonString(document.RootElement, "error_description") ??
                                  GetJsonString(document.RootElement, "error");

                if (!string.IsNullOrWhiteSpace(description))
                {
                    return TruncateForDisplay(description, 300);
                }
            }
        }
        catch (JsonException)
        {
            // Use the generic message below when Canvas did not return JSON.
        }

        return "Canvas rejected the OAuth request. Start the connection again.";
    }

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

    private static async Task<CanvasApiPage> SendCanvasGetPageAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUri,
        CancellationToken cancellationToken,
        CanvasRequestBudget? requestBudget = null)
    {
        if (!IsAllowedCanvasRequestUri(requestUri, _configuration))
        {
            throw new CanvasApiRequestException(
                "Canvas request was blocked.",
                "Canvas tried to use an institution URL outside the configured allowlist.",
                StatusCodes.Status502BadGateway);
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

            requestBudget?.ConsumePage();
            using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
            AddCanvasRequestHeaders(request, accessToken);
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
                        "Canvas redirected the request to a different origin.",
                        StatusCodes.Status502BadGateway);
                }

                if (!response.IsSuccessStatusCode)
                {
                    throw CreateCanvasRequestException(response.StatusCode);
                }

                var responsePayload = await ReadCanvasResponsePayloadAsync(
                    response.Content,
                    timeoutCancellationToken.Token);
                requestBudget?.RecordBytes(responsePayload.ByteCount);

                try
                {
                    using var _ = JsonDocument.Parse(responsePayload.Payload);
                }
                catch (JsonException)
                {
                    throw new CanvasApiRequestException(
                        "Canvas returned invalid data.",
                        "Canvas returned a malformed JSON response. Try again in a moment.",
                        StatusCodes.Status502BadGateway);
                }

                return new CanvasApiPage(
                    responsePayload.Payload,
                    GetNextLinkUrl(response, request.RequestUri!));
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new CanvasApiRequestException(
                    "Canvas request timed out.",
                    "Canvas took too long to respond. Try again in a moment.",
                    StatusCodes.Status504GatewayTimeout);
            }
            catch (HttpRequestException)
            {
                throw new CanvasApiRequestException(
                    "Canvas is unavailable.",
                    "The Canvas service could not be reached. Try again in a moment.",
                    StatusCodes.Status502BadGateway);
            }
            catch (InvalidDataException)
            {
                throw new CanvasApiRequestException(
                    "Canvas response was too large.",
                    "Canvas returned more data than this request can safely process.",
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

    private static CanvasApiRequestException CreateCanvasCapacityException() =>
        new(
            "Canvas is busy.",
            "Canvas request capacity is temporarily full. Try again in a moment.",
            StatusCodes.Status503ServiceUnavailable);

    private static long GetApproximateCacheSizeBytes<T>(T value)
        => GetApproximateCacheSizeBytes(GetSerializedSizeBytes(value));

    private static long GetApproximateCacheSizeBytes(long serializedSize)
    {
        // Serialized UTF-8 length is deterministic and bounded by the upstream
        // response budgets. The multiplier conservatively accounts for UTF-16
        // strings and managed-object overhead retained by the cache.
        return Math.Max(1, checked(serializedSize * 3));
    }

    private static long GetSerializedSizeBytes<T>(T value) =>
        JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions).LongLength;

    private static void EnsureSerializedOutputWithinLimit<T>(T value, long maximumBytes)
    {
        if (GetSerializedSizeBytes(value) > maximumBytes)
        {
            throw new CanvasRequestLimitException();
        }
    }

    private static void AddCanvasRequestHeaders(HttpRequestMessage request, string accessToken)
    {
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.TryAddWithoutValidation("User-Agent", CanvasUserAgent);
    }

    private static CanvasApiRequestException CreateCanvasRequestException(System.Net.HttpStatusCode statusCode)
    {
        if ((int)statusCode is >= 300 and < 400)
        {
            return new CanvasApiRequestException(
                "Canvas redirect was blocked.",
                "Canvas tried to redirect this request instead of returning API data.",
                StatusCodes.Status502BadGateway);
        }

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
                "Canvas asked the app to slow down. Wait a moment, then refresh.",
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

    private static async Task<CanvasResponsePayload> ReadCanvasResponsePayloadAsync(
        HttpContent content,
        CancellationToken cancellationToken)
    {
        if (content.Headers.ContentLength > CanvasMaxResponseBytes)
        {
            throw new InvalidDataException("Canvas response exceeds the configured limit.");
        }

        await using var responseStream = await content.ReadAsStreamAsync(cancellationToken);
        using var memoryStream = new MemoryStream();
        var buffer = new byte[64 * 1024];
        var totalBytes = 0;

        while (true)
        {
            var bytesRead = await responseStream.ReadAsync(buffer, cancellationToken);

            if (bytesRead == 0)
            {
                break;
            }

            totalBytes += bytesRead;

            if (totalBytes > CanvasMaxResponseBytes)
            {
                throw new InvalidDataException("Canvas response exceeds the configured limit.");
            }

            await memoryStream.WriteAsync(buffer.AsMemory(0, bytesRead), cancellationToken);
        }

        var payload = Encoding.UTF8.GetString(memoryStream.GetBuffer(), 0, totalBytes);
        return new CanvasResponsePayload(
            payload.Length > 0 && payload[0] == '\uFEFF' ? payload[1..] : payload,
            totalBytes);
    }

    private static bool IsAllowedCanvasRequestUri(string requestUri, IConfiguration? configuration)
    {
        if (requestUri.Length > 16384 ||
            !Uri.TryCreate(requestUri, UriKind.Absolute, out var uri) ||
            !string.IsNullOrEmpty(uri.UserInfo))
        {
            return false;
        }

        var origin = uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');
        return GetAllowedCanvasOrigins(configuration).Contains(origin);
    }

    private static bool HasSameOrigin(Uri? expectedUri, Uri? actualUri)
    {
        if (expectedUri is null || actualUri is null ||
            !expectedUri.IsAbsoluteUri || !actualUri.IsAbsoluteUri)
        {
            return false;
        }

        return expectedUri.Scheme.Equals(actualUri.Scheme, StringComparison.OrdinalIgnoreCase) &&
               expectedUri.Host.Equals(actualUri.Host, StringComparison.OrdinalIgnoreCase) &&
               expectedUri.Port == actualUri.Port;
    }

    private static string? GetNextLinkUrl(HttpResponseMessage response, Uri requestUri)
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
                    var rawNextUrl = sections[0][1..^1];

                    if (!Uri.TryCreate(requestUri, rawNextUrl, out var nextUri) ||
                        !HasSameOrigin(requestUri, nextUri) ||
                        !IsAllowedCanvasRequestUri(nextUri.AbsoluteUri, _configuration))
                    {
                        throw new CanvasApiRequestException(
                            "Canvas pagination was blocked.",
                            "Canvas returned a next-page link on a different or disallowed origin.",
                            StatusCodes.Status502BadGateway);
                    }

                    return nextUri.AbsoluteUri;
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

        return NormalizeCanvasDisplayValue(GetJsonString(term, "name"), CanvasMaxTermNameLength);
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
            grade = NormalizeCanvasDisplayValue(grade, CanvasMaxCourseCodeLength);

            if (score.HasValue || !string.IsNullOrWhiteSpace(grade))
            {
                return (score, grade);
            }
        }

        return (null, null);
    }

    private static string? GetCanvasCourseEnrollmentState(JsonElement course)
    {
        if (!course.TryGetProperty("enrollments", out var enrollments) ||
            enrollments.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        return enrollments
            .EnumerateArray()
            .Select(enrollment => NormalizeCanvasDisplayValue(
                GetJsonString(enrollment, "enrollment_state"),
                CanvasMaxWorkflowStateLength))
            .FirstOrDefault(state => !string.IsNullOrWhiteSpace(state));
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
            ? NormalizeCanvasIdentifier(contextCode[coursePrefix.Length..])
            : null;
    }

    private static bool TryParseCanvasDate(string? value, out DateTimeOffset? parsedValue)
    {
        parsedValue = null;

        if (string.IsNullOrWhiteSpace(value))
        {
            return true;
        }

        if (!DateOnly.TryParseExact(
            value.Trim(),
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out var parsedDate))
        {
            return false;
        }

        parsedValue = new DateTimeOffset(parsedDate.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc));
        return true;
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

        var value = property.ValueKind switch
        {
            JsonValueKind.String => property.GetString(),
            JsonValueKind.Number => property.TryGetInt64(out var numericValue)
                ? numericValue.ToString(CultureInfo.InvariantCulture)
                : property.GetRawText(),
            _ => null,
        };

        return NormalizeCanvasIdentifier(value);
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
            .Select(value => NormalizeCanvasDisplayValue(value, CanvasMaxSubmissionTypeLength))
            .Where(value => value is not null)
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(CanvasMaxSubmissionTypes)
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

    private static long? GetJsonLong(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt64(out var numberValue))
        {
            return numberValue;
        }

        if (property.ValueKind == JsonValueKind.String &&
            long.TryParse(property.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var stringValue))
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

    private static SemaphoreSlim[] CreateLockStripes() =>
        Enumerable.Range(0, 64)
            .Select(_ => new SemaphoreSlim(1, 1))
            .ToArray();

    private static SemaphoreSlim GetStripedLock(SemaphoreSlim[] locks, string key)
    {
        var index = (int)((uint)StringComparer.Ordinal.GetHashCode(key) % (uint)locks.Length);
        return locks[index];
    }

    private sealed record StoredCanvasToken(
        string InstanceUrl,
        string ProtectedAccessToken,
        DateTimeOffset? StartsAt,
        DateTimeOffset? ExpiresAt,
        DateTimeOffset? UpdatedAt,
        string? UserName,
        string? TokenSource = null,
        string? ProtectedRefreshToken = null,
        string? CanvasUserId = null,
        string? Scope = null);

    private sealed record CanvasTokenValues(
        string InstanceUrl,
        string AccessToken,
        string? RefreshToken,
        string TokenSource,
        DateTimeOffset? StartsAt,
        DateTimeOffset? ExpiresAt,
        DateTimeOffset? UpdatedAt,
        string? UserName,
        string? CanvasUserId,
        string? Scope);

    private sealed record CanvasTokenSettingRevision(
        Guid Id,
        DateTimeOffset UpdatedAt,
        string SettingJson);

    private sealed record CanvasTokenSnapshot(
        CanvasTokenSettingRevision Revision,
        StoredCanvasToken? StoredToken,
        CanvasTokenValues? TokenValues);

    private sealed record CanvasOAuthState(
        string UserKey,
        string ReturnUrl,
        string RedirectUri,
        DateTimeOffset IssuedAt,
        string Nonce);

    private sealed record CanvasOAuthOptions(
        string InstanceUrl,
        string ClientId,
        string ClientSecret,
        bool Configured);

    private sealed record CanvasOAuthTokenResult(
        string AccessToken,
        string? RefreshToken,
        long ExpiresInSeconds,
        string? UserId,
        string? UserName,
        string? Scope);

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

        public static CanvasConnection Invalid(string? instanceUrl = null, string tokenSource = "user") =>
            new(instanceUrl, null, tokenSource, "invalid", null, null, null, null);

        public static CanvasConnection Expired(
            string? instanceUrl,
            string tokenSource,
            DateTimeOffset? startsAt,
            DateTimeOffset? expiresAt,
            DateTimeOffset? updatedAt,
            string? userName) =>
            new(instanceUrl, null, tokenSource, "expired", startsAt, expiresAt, updatedAt, userName);
    }

    private sealed record CanvasApiPage(string Payload, string? NextUrl);
    private sealed record CanvasResponsePayload(string Payload, int ByteCount);
    private sealed record CanvasCalendarEventsResult(JsonElement[] Events, CanvasApiRequestException? Error);
    private sealed record CanvasCourseAssignmentItemsResult(CanvasCalendarItemDto[] Items, bool IsComplete, bool HasSuccessfulResponse = false);

    private sealed class CanvasRequestBudget(int maximumPages, long maximumBytes)
    {
        private int _remainingPages = maximumPages;
        private long _consumedBytes;

        public void ConsumePage()
        {
            if (Interlocked.Decrement(ref _remainingPages) < 0)
            {
                throw new CanvasRequestLimitException();
            }
        }

        public void RecordBytes(int byteCount)
        {
            if (Interlocked.Add(ref _consumedBytes, byteCount) > maximumBytes)
            {
                throw new CanvasRequestLimitException();
            }
        }
    }

    private sealed class CanvasRequestLimitException : Exception
    {
    }

    private sealed class CanvasApiRequestException(string title, string detail, int statusCode) : Exception(title)
    {
        public string Title { get; } = title;
        public string Detail { get; } = detail;
        public int StatusCode { get; } = statusCode;
    }

    private sealed class CanvasOAuthRequestException(string displayMessage) : Exception(displayMessage)
    {
        public string DisplayMessage { get; } = TruncateForDisplay(displayMessage, 300);
    }
}
