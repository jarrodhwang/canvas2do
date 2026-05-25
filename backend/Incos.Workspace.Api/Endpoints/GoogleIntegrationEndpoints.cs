using Incos.Workspace.Api.Contracts;
using Incos.Workspace.Api.Data;
using Incos.Workspace.Api.Domain.Entities;
using Incos.Workspace.Api.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Net.Mail;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Incos.Workspace.Api.Endpoints;

public static class GoogleIntegrationEndpoints
{
    private const string DriveFileFields =
        "files(id,name,mimeType,parents,webViewLink,iconLink,createdTime,modifiedTime,size)";
    private const string DriveFolderMimeType = "application/vnd.google-apps.folder";
    private const int FolderDownloadMaxFileCount = 200;
    private const long FolderDownloadMaxBytes = 500L * 1024L * 1024L;
    private const int GmailMessageSummaryConcurrency = 8;
    private const string ScheduledGmailStatusPending = "pending";
    private const string ScheduledGmailStatusSending = "sending";
    private const string ScheduledGmailStatusSent = "sent";
    private const string ScheduledGmailStatusFailed = "failed";
    private const string ScheduledGmailStatusCancelled = "cancelled";

    private sealed record GmailMessagesPage(
        GoogleGmailMessageDto[] Messages,
        string? NextPageToken,
        int? ResultSizeEstimate);

    private sealed record ScheduledGmailSendTokens(
        string AccessToken,
        string? RefreshToken,
        DateTimeOffset? ExpiresAt);

    private static readonly IReadOnlyDictionary<string, GoogleDriveExportFormat> ExportFormats =
        new Dictionary<string, GoogleDriveExportFormat>(StringComparer.OrdinalIgnoreCase)
        {
            ["application/vnd.google-apps.document"] = new(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".docx"),
            ["application/vnd.google-apps.spreadsheet"] = new(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ".xlsx"),
            ["application/vnd.google-apps.presentation"] = new(
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                ".pptx"),
            ["application/vnd.google-apps.drawing"] = new("application/pdf", ".pdf"),
            ["application/vnd.google-apps.script"] = new("application/vnd.google-apps.script+json", ".json"),
        };

    public static IEndpointRouteBuilder MapGoogleIntegrationEndpoints(this IEndpointRouteBuilder app)
    {
        var google = app.MapGroup("/api/google")
            .RequireAuthorization();

        google.MapGet("/integrations", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration) =>
            {
                var isConfigured =
                    !string.IsNullOrWhiteSpace(configuration["Authentication:Google:ClientId"]) &&
                    !string.IsNullOrWhiteSpace(configuration["Authentication:Google:ClientSecret"]);
                var grantedScopes = GetGrantedScopes(context.User);
                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    context.RequestAborted);

                return Results.Ok(new[]
                {
                    CreateStatus(
                        "google_calendar",
                        "Google Calendar",
                        isConfigured,
                        grantedScopes,
                        accessToken,
                        GoogleWorkspaceScopes.Calendar),
                    CreateStatus(
                        "google_drive",
                        "Google Drive",
                        isConfigured,
                        grantedScopes,
                        accessToken,
                        GoogleWorkspaceScopes.Drive),
                    CreateStatus(
                        "gmail",
                        "Gmail",
                        isConfigured,
                        grantedScopes,
                        accessToken,
                        GoogleWorkspaceScopes.Gmail),
                    CreateStatus(
                        "google_chat",
                        "Google Chat",
                        isConfigured,
                        grantedScopes,
                        accessToken,
                        GoogleWorkspaceScopes.Chat),
                });
            })
            .WithName("GetGoogleIntegrationStatuses");

        google.MapGet("/integrations/{provider}/connect", (string provider) =>
            {
                var returnUrl = provider switch
                {
                    "gmail" => "/?mode=project&item=email",
                    "google_chat" => "/?mode=project&item=chat",
                    "google_drive" => "/?integration=google_drive",
                    _ => "/",
                };
                var redirectUrl =
                    $"/api/auth/google/login?returnUrl={Uri.EscapeDataString(returnUrl)}&forceConsent=true";

                return Results.Redirect(redirectUrl);
            })
            .WithName("ConnectGoogleIntegration");

        google.MapGet("/drive/browser", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                IMemoryCache cache,
                string? view,
                string? folderId,
                string? driveId,
                string? search,
                int? pageSize,
                CancellationToken cancellationToken) =>
            {
                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return Results.Problem(
                        title: "Google Drive is not connected.",
                        detail: "Reconnect Google Drive so the API has an access token with Drive metadata scope.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                var safePageSize = Math.Clamp(pageSize ?? 36, 1, 80);
                var driveView = NormalizeDriveView(view);
                var requiresSharedDriveSelection =
                    driveView == "shared-drive" && string.IsNullOrWhiteSpace(driveId);
                var userCachePrefix = GetUserCachePrefix(context.User);
                var sharedDrivesCacheKey = $"{userCachePrefix}:drive:shared-drives";
                var sharedDrivesError = default(string);

                GoogleSharedDriveDto[] sharedDrives;

                try
                {
                    sharedDrives = await cache.GetOrCreateAsync(
                            sharedDrivesCacheKey,
                            async entry =>
                            {
                                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(2);
                                return await GetSharedDrivesAsync(
                                    httpClientFactory,
                                    accessToken,
                                    cancellationToken);
                            }) ??
                        [];
                }
                catch (GoogleApiRequestException exception)
                {
                    sharedDrives = [];
                    sharedDrivesError = exception.Detail;
                }

                GoogleDriveFileDto[] files = [];

                if (!requiresSharedDriveSelection)
                {
                    var cacheKey = CreateDriveBrowserCacheKey(
                        userCachePrefix,
                        driveView,
                        folderId,
                        driveId,
                        search,
                        safePageSize);

                    try
                    {
                        files = await cache.GetOrCreateAsync(
                                cacheKey,
                                async entry =>
                                {
                                    entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(45);
                                    return await GetDriveFilesAsync(
                                        httpClientFactory,
                                        accessToken,
                                        driveView,
                                        folderId,
                                        driveId,
                                        search,
                                        safePageSize,
                                        cancellationToken);
                                }) ??
                            [];
                    }
                    catch (GoogleApiRequestException exception)
                    {
                        return Results.Problem(
                            title: exception.Title,
                            detail: exception.Detail,
                            statusCode: exception.StatusCode);
                    }
                }

                return Results.Ok(new GoogleDriveBrowserDto(
                    driveView,
                    folderId,
                    driveId,
                    search,
                    requiresSharedDriveSelection,
                    files,
                    sharedDrives,
                    sharedDrivesError));
            })
            .WithName("GetGoogleDriveBrowser");

        google.MapGet("/drive/files", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string? view,
                string? folderId,
                string? driveId,
                string? search,
                int? pageSize,
                CancellationToken cancellationToken) =>
            {
                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return Results.Problem(
                        title: "Google Drive is not connected.",
                        detail: "Reconnect Google Drive so the API has an access token with Drive metadata scope.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                var safePageSize = Math.Clamp(pageSize ?? 24, 1, 50);
                var driveView = NormalizeDriveView(view);
                var parentId = GetParentId(driveView, folderId, driveId);
                var query = BuildDriveQuery(driveView, parentId, search);
                var queryParameters = new Dictionary<string, string?>
                {
                    ["pageSize"] = safePageSize.ToString(),
                    ["orderBy"] = driveView == "recent" ? "modifiedTime desc" : "folder,name",
                    ["q"] = query,
                    ["supportsAllDrives"] = "true",
                    ["fields"] = DriveFileFields,
                };

                if (driveView == "shared-drive")
                {
                    if (string.IsNullOrWhiteSpace(driveId))
                    {
                        return Results.BadRequest(new { message = "driveId is required for shared drive browsing." });
                    }

                    queryParameters["corpora"] = "drive";
                    queryParameters["driveId"] = driveId;
                    queryParameters["includeItemsFromAllDrives"] = "true";
                }
                else if (driveView is "shared-with-me" or "recent")
                {
                    queryParameters["corpora"] = "allDrives";
                    queryParameters["includeItemsFromAllDrives"] = "true";
                }
                else
                {
                    queryParameters["corpora"] = "user";
                }

                var requestUrl = QueryHelpers.AddQueryString(
                    "https://www.googleapis.com/drive/v3/files",
                    queryParameters);
                var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

                var response = await httpClientFactory
                    .CreateClient()
                    .SendAsync(request, cancellationToken);
                var payload = await response.Content.ReadAsStringAsync(cancellationToken);

                if (!response.IsSuccessStatusCode)
                {
                    return Results.Problem(
                        title: "Google Drive request failed.",
                        detail: payload,
                        statusCode: (int)response.StatusCode);
                }

                using var document = JsonDocument.Parse(payload);
                var files = document.RootElement.TryGetProperty("files", out var filesElement)
                    ? filesElement
                        .EnumerateArray()
                        .Select(CreateGoogleDriveFileDto)
                        .OrderByDescending(file => file.IsFolder)
                        .ThenBy(file => file.Name)
                        .ToArray()
                    : [];

                return Results.Ok(files);
            })
            .WithName("GetGoogleDriveFiles");

        google.MapGet("/drive/files/{fileId}/permissions", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string fileId,
                CancellationToken cancellationToken) =>
            {
                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return Results.Problem(
                        title: "Google Drive is not connected.",
                        detail: "Reconnect Google Drive so the API has an access token with Drive metadata scope.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                var requestUrl = QueryHelpers.AddQueryString(
                    $"https://www.googleapis.com/drive/v3/files/{Uri.EscapeDataString(fileId)}/permissions",
                    new Dictionary<string, string?>
                    {
                        ["supportsAllDrives"] = "true",
                        ["fields"] = "permissions(id,type,role,displayName,emailAddress,photoLink,deleted,allowFileDiscovery)",
                    });

                try
                {
                    var payload = await SendGoogleGetAsync(
                        httpClientFactory,
                        accessToken,
                        requestUrl,
                        "Google Drive permissions request failed.",
                        cancellationToken);
                    using var document = JsonDocument.Parse(payload);
                    var permissions = document.RootElement.TryGetProperty("permissions", out var permissionsElement)
                        ? permissionsElement
                            .EnumerateArray()
                            .Select(permission => new GoogleDrivePermissionDto(
                                GetJsonString(permission, "id") ?? string.Empty,
                                GetJsonString(permission, "type") ?? "user",
                                GetJsonString(permission, "role") ?? "reader",
                                GetJsonString(permission, "displayName"),
                                GetJsonString(permission, "emailAddress"),
                                GetJsonString(permission, "photoLink"),
                                GetJsonBool(permission, "deleted") ?? false,
                                GetJsonBool(permission, "allowFileDiscovery")))
                            .OrderBy(permission => permission.Type == "anyone" ? 1 : 0)
                            .ThenBy(permission => permission.DisplayName ?? permission.EmailAddress ?? permission.Type)
                            .ToArray()
                        : [];

                    return Results.Ok(new GoogleDrivePermissionsDto(fileId, permissions));
                }
                catch (GoogleApiRequestException exception)
                {
                    return Results.Problem(
                        title: exception.Title,
                        detail: exception.Detail,
                        statusCode: exception.StatusCode);
                }
            })
            .WithName("GetGoogleDrivePermissions");

        google.MapGet("/drive/files/{fileId}/download", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string fileId,
                bool? acknowledgeAbuse,
                CancellationToken cancellationToken) =>
            {
                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return Results.Problem(
                        title: "Google Drive is not connected.",
                        detail: "Reconnect Google Drive so the API has an access token with Drive download scope.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                try
                {
                    var metadata = await GetDriveFileMetadataAsync(
                        httpClientFactory,
                        accessToken,
                        fileId,
                        cancellationToken);
                    var download = metadata.IsFolder
                        ? await CreateFolderZipDownloadAsync(
                            httpClientFactory,
                            accessToken,
                            metadata,
                            acknowledgeAbuse == true,
                            cancellationToken)
                        : await DownloadSingleDriveFileAsync(
                            httpClientFactory,
                            accessToken,
                            metadata,
                            acknowledgeAbuse == true,
                            cancellationToken);

                    return Results.File(download.Content, download.ContentType, download.FileName);
                }
                catch (GoogleApiRequestException exception)
                {
                    return Results.Problem(
                        title: exception.StatusCode == StatusCodes.Status403Forbidden
                            ? "Google Drive permission denied."
                            : exception.Title,
                        detail: exception.Detail,
                        statusCode: exception.StatusCode);
                }
            })
            .WithName("DownloadGoogleDriveFile");

        google.MapGet("/drive/shared-drives", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                CancellationToken cancellationToken) =>
            {
                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return Results.Problem(
                        title: "Google Drive is not connected.",
                        detail: "Reconnect Google Drive so the API has an access token with Drive metadata scope.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                var requestUrl = QueryHelpers.AddQueryString(
                    "https://www.googleapis.com/drive/v3/drives",
                    new Dictionary<string, string?>
                    {
                        ["pageSize"] = "50",
                        ["fields"] = "drives(id,name)",
                    });
                var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

                var response = await httpClientFactory
                    .CreateClient()
                    .SendAsync(request, cancellationToken);
                var payload = await response.Content.ReadAsStringAsync(cancellationToken);

                if (!response.IsSuccessStatusCode)
                {
                    return Results.Problem(
                        title: "Google Shared Drives request failed.",
                        detail: payload,
                        statusCode: (int)response.StatusCode);
                }

                using var document = JsonDocument.Parse(payload);
                var drives = document.RootElement.TryGetProperty("drives", out var drivesElement)
                    ? drivesElement
                        .EnumerateArray()
                        .Select(drive => new GoogleSharedDriveDto(
                            GetJsonString(drive, "id") ?? string.Empty,
                            GetJsonString(drive, "name") ?? "Untitled shared drive"))
                        .OrderBy(drive => drive.Name)
                        .ToArray()
                    : [];

                return Results.Ok(drives);
            })
            .WithName("GetGoogleSharedDrives");

        google.MapGet("/gmail/messages", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string? search,
                string? label,
                string? pageToken,
                int? pageSize,
                CancellationToken cancellationToken) =>
            {
                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return Results.Problem(
                        title: "Gmail is not connected.",
                        detail: "Reconnect Gmail so the API has an access token with Gmail read scope.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                var safePageSize = Math.Clamp(pageSize ?? 50, 1, 100);

                try
                {
                    var messages = await GetGmailMessagesAsync(
                        httpClientFactory,
                        accessToken,
                        search,
                        label,
                        pageToken,
                        safePageSize,
                        cancellationToken);

                    return Results.Ok(new GoogleGmailMessagesDto(
                        search,
                        messages.Messages,
                        messages.NextPageToken,
                        messages.ResultSizeEstimate));
                }
                catch (GoogleApiRequestException exception)
                {
                    return Results.Problem(
                        title: exception.Title,
                        detail: exception.Detail,
                        statusCode: exception.StatusCode);
                }
            })
            .WithName("GetGoogleGmailMessages");

        google.MapGet("/gmail/messages/{messageId}", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string messageId,
                CancellationToken cancellationToken) =>
            {
                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return Results.Problem(
                        title: "Gmail is not connected.",
                        detail: "Reconnect Gmail so the API has an access token with Gmail read scope.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                try
                {
                    var message = await GetGmailMessageAsync(
                        httpClientFactory,
                        accessToken,
                        messageId,
                        cancellationToken);

                    return Results.Ok(message);
                }
                catch (GoogleApiRequestException exception)
                {
                    return Results.Problem(
                        title: exception.Title,
                        detail: exception.Detail,
                        statusCode: exception.StatusCode);
                }
            })
            .WithName("GetGoogleGmailMessage");

        google.MapPost("/gmail/messages/{messageId}/read", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string messageId,
                CancellationToken cancellationToken) =>
            {
                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return Results.Problem(
                        title: "Gmail is not connected.",
                        detail: "Reconnect Gmail so the API has an access token with Gmail modify scope.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                try
                {
                    await MarkGmailMessageReadAsync(
                        httpClientFactory,
                        accessToken,
                        messageId,
                        cancellationToken);

                    return Results.NoContent();
                }
                catch (GoogleApiRequestException exception)
                {
                    return Results.Problem(
                        title: exception.Title,
                        detail: exception.Detail,
                        statusCode: exception.StatusCode);
                }
            })
            .WithName("MarkGoogleGmailMessageRead");

        google.MapPost("/gmail/messages/{messageId}/unread", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string messageId,
                CancellationToken cancellationToken) =>
            {
                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return Results.Problem(
                        title: "Gmail is not connected.",
                        detail: "Reconnect Gmail so the API has an access token with Gmail modify scope.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                try
                {
                    await MarkGmailMessageUnreadAsync(
                        httpClientFactory,
                        accessToken,
                        messageId,
                        cancellationToken);

                    return Results.NoContent();
                }
                catch (GoogleApiRequestException exception)
                {
                    return Results.Problem(
                        title: exception.Title,
                        detail: exception.Detail,
                        statusCode: exception.StatusCode);
                }
            })
            .WithName("MarkGoogleGmailMessageUnread");

        google.MapPost("/gmail/messages/{messageId}/labels", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string messageId,
                GoogleGmailModifyLabelsRequestDto request,
                CancellationToken cancellationToken) =>
            {
                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return Results.Problem(
                        title: "Gmail is not connected.",
                        detail: "Reconnect Gmail so the API has an access token with Gmail modify scope.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                try
                {
                    await ModifyGmailMessageLabelsAsync(
                        httpClientFactory,
                        accessToken,
                        messageId,
                        request.AddLabelIds ?? [],
                        request.RemoveLabelIds ?? [],
                        cancellationToken);

                    return Results.NoContent();
                }
                catch (GoogleApiRequestException exception)
                {
                    return Results.Problem(
                        title: exception.Title,
                        detail: exception.Detail,
                        statusCode: exception.StatusCode);
                }
            })
            .WithName("ModifyGoogleGmailMessageLabels");

        google.MapPost("/gmail/messages/send", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                GoogleGmailSendRequestDto request,
                CancellationToken cancellationToken) =>
            {
                if (string.IsNullOrWhiteSpace(request.To))
                {
                    return Results.BadRequest(new { message = "Recipient is required." });
                }

                if (string.IsNullOrWhiteSpace(request.Body))
                {
                    return Results.BadRequest(new { message = "Message body is required." });
                }

                var normalizedTo = NormalizeMailAddressList(request.To);

                if (string.IsNullOrWhiteSpace(normalizedTo))
                {
                    return Results.BadRequest(new { message = "Add at least one valid recipient address." });
                }

                request = request with
                {
                    To = normalizedTo,
                    Cc = NormalizeMailAddressList(request.Cc),
                    Bcc = NormalizeMailAddressList(request.Bcc),
                };

                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return Results.Problem(
                        title: "Gmail is not connected.",
                        detail: "Reconnect Gmail so the API has an access token with Gmail send scope.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                try
                {
                    var sentMessage = await SendGmailMessageAsync(
                        httpClientFactory,
                        accessToken,
                        request,
                        cancellationToken);

                    return Results.Ok(sentMessage);
                }
                catch (GoogleApiRequestException exception)
                {
                    return Results.Problem(
                        title: exception.Title,
                        detail: exception.Detail,
                        statusCode: exception.StatusCode);
                }
            })
            .WithName("SendGoogleGmailMessage");

        google.MapPost("/gmail/messages/schedule", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                IncosWorkspaceDbContext db,
                GoogleGmailScheduleRequestDto request,
                CancellationToken cancellationToken) =>
            {
                var scheduledFor = request.ScheduledFor.ToUniversalTime();

                if (scheduledFor <= DateTimeOffset.UtcNow.AddSeconds(15))
                {
                    return Results.BadRequest(new { message = "Choose a scheduled send time at least 15 seconds from now." });
                }

                if (string.IsNullOrWhiteSpace(request.Body))
                {
                    return Results.BadRequest(new { message = "Message body is required." });
                }

                var normalizedTo = NormalizeMailAddressList(request.To);

                if (string.IsNullOrWhiteSpace(normalizedTo))
                {
                    return Results.BadRequest(new { message = "Add at least one valid recipient address." });
                }

                var tokens = await GetScheduledGmailSendTokensAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (tokens is null)
                {
                    return Results.Problem(
                        title: "Gmail is not connected.",
                        detail: "Reconnect Gmail so scheduled send has Gmail send access.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                var message = new ScheduledGmailMessage
                {
                    AccessToken = tokens.AccessToken,
                    AccessTokenExpiresAt = tokens.ExpiresAt,
                    AttachmentsJson = SerializeScheduledGmailAttachments(request.Attachments ?? []),
                    Bcc = NormalizeMailAddressList(request.Bcc),
                    Body = request.Body,
                    Cc = NormalizeMailAddressList(request.Cc),
                    RefreshToken = tokens.RefreshToken,
                    ScheduledFor = scheduledFor,
                    Status = ScheduledGmailStatusPending,
                    Subject = string.IsNullOrWhiteSpace(request.Subject) ? "(No subject)" : request.Subject.Trim(),
                    To = normalizedTo,
                    UserKey = GetCurrentUserKey(context.User),
                };

                db.ScheduledGmailMessages.Add(message);
                await db.SaveChangesAsync(cancellationToken);

                return Results.Ok(CreateScheduledGmailMessageDto(message));
            })
            .WithName("ScheduleGoogleGmailMessage");

        google.MapGet("/gmail/messages/scheduled", async (
                HttpContext context,
                IncosWorkspaceDbContext db,
                CancellationToken cancellationToken) =>
            {
                var userKey = GetCurrentUserKey(context.User);
                var messages = await db.ScheduledGmailMessages
                    .AsNoTracking()
                    .Where(message => message.UserKey == userKey && message.Status != ScheduledGmailStatusCancelled)
                    .OrderByDescending(message => message.CreatedAt)
                    .Take(100)
                    .ToArrayAsync(cancellationToken);

                return Results.Ok(messages.Select(CreateScheduledGmailMessageDto).ToArray());
            })
            .WithName("GetScheduledGoogleGmailMessages");

        google.MapPost("/gmail/messages/scheduled/{scheduledMessageId:guid}/send-now", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                IncosWorkspaceDbContext db,
                Guid scheduledMessageId,
                CancellationToken cancellationToken) =>
            {
                var userKey = GetCurrentUserKey(context.User);
                var message = await db.ScheduledGmailMessages
                    .FirstOrDefaultAsync(
                        scheduledMessage => scheduledMessage.Id == scheduledMessageId &&
                                            scheduledMessage.UserKey == userKey,
                        cancellationToken);

                if (message is null || message.Status == ScheduledGmailStatusCancelled)
                {
                    return Results.NotFound(new { message = "Scheduled email was not found." });
                }

                if (message.Status == ScheduledGmailStatusSent)
                {
                    return Results.Ok(CreateScheduledGmailMessageDto(message));
                }

                var sentMessage = await TrySendScheduledGmailMessageAsync(
                    message,
                    db,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                return Results.Ok(CreateScheduledGmailMessageDto(sentMessage));
            })
            .WithName("SendScheduledGoogleGmailMessageNow");

        google.MapDelete("/gmail/messages/scheduled/{scheduledMessageId:guid}", async (
                HttpContext context,
                IncosWorkspaceDbContext db,
                Guid scheduledMessageId,
                CancellationToken cancellationToken) =>
            {
                var userKey = GetCurrentUserKey(context.User);
                var message = await db.ScheduledGmailMessages
                    .FirstOrDefaultAsync(
                        scheduledMessage => scheduledMessage.Id == scheduledMessageId &&
                                            scheduledMessage.UserKey == userKey,
                        cancellationToken);

                if (message is null)
                {
                    return Results.NotFound(new { message = "Scheduled email was not found." });
                }

                if (message.Status == ScheduledGmailStatusSent)
                {
                    db.ScheduledGmailMessages.Remove(message);
                }
                else
                {
                    message.Status = ScheduledGmailStatusCancelled;
                    message.UpdatedAt = DateTimeOffset.UtcNow;
                }

                await db.SaveChangesAsync(cancellationToken);

                return Results.NoContent();
            })
            .WithName("CancelScheduledGoogleGmailMessage");

        google.MapGet("/gmail/messages/{messageId}/attachments/{attachmentId}", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string messageId,
                string attachmentId,
                string? mimeType,
                CancellationToken cancellationToken) =>
            {
                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return Results.Problem(
                        title: "Gmail is not connected.",
                        detail: "Reconnect Gmail so the API has an access token with Gmail read scope.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                try
                {
                    var bytes = await GetGmailAttachmentBytesAsync(
                        httpClientFactory,
                        accessToken,
                        messageId,
                        attachmentId,
                        cancellationToken);

                    return Results.File(
                        bytes,
                        string.IsNullOrWhiteSpace(mimeType) ? "application/octet-stream" : mimeType);
                }
                catch (GoogleApiRequestException exception)
                {
                    return Results.Problem(
                        title: exception.Title,
                        detail: exception.Detail,
                        statusCode: exception.StatusCode);
                }
            })
            .WithName("GetGoogleGmailAttachment");

        google.MapGet("/chat/spaces", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                IMemoryCache cache,
                string? search,
                int? pageSize,
                CancellationToken cancellationToken) =>
            {
                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return Results.Problem(
                        title: "Google Chat is not connected.",
                        detail: "Reconnect Google Chat so the API has access tokens with Chat spaces and message read scopes.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                var safePageSize = Math.Clamp(pageSize ?? 12, 1, 40);
                var cacheKey = string.Join(
                    ':',
                    GetUserCachePrefix(context.User),
                    "chat",
                    search?.Trim() ?? "spaces",
                    safePageSize);

                try
                {
                    var spaces = await cache.GetOrCreateAsync(
                            cacheKey,
                            async entry =>
                            {
                                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);
                                return await GetChatSpacesAsync(
                                    httpClientFactory,
                                    accessToken,
                                    search,
                                    safePageSize,
                                    cancellationToken);
                            }) ??
                        [];

                    return Results.Ok(new GoogleChatSpacesDto(search, spaces));
                }
                catch (GoogleApiRequestException exception)
                {
                    return Results.Problem(
                        title: exception.Title,
                        detail: exception.Detail,
                        statusCode: exception.StatusCode);
                }
            })
            .WithName("GetGoogleChatSpaces");

        return app;
    }

    private static async Task<string?> GetGoogleAccessTokenAsync(
        HttpContext context,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var accessToken = await context.GetTokenAsync("access_token");
        var expiresAt = await context.GetTokenAsync("expires_at");
        var shouldRefresh = ShouldRefreshAccessToken(accessToken, expiresAt);

        if (!shouldRefresh)
        {
            return accessToken;
        }

        var refreshToken = await context.GetTokenAsync("refresh_token");

        if (string.IsNullOrWhiteSpace(refreshToken))
        {
            return null;
        }

        var clientId = configuration["Authentication:Google:ClientId"];
        var clientSecret = configuration["Authentication:Google:ClientSecret"];

        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret))
        {
            return null;
        }

        GoogleTokenRefreshResult refreshedToken;

        try
        {
            refreshedToken = await RefreshGoogleAccessTokenAsync(
                httpClientFactory,
                clientId,
                clientSecret,
                refreshToken,
                cancellationToken);
        }
        catch (GoogleApiRequestException)
        {
            return null;
        }

        await StoreRefreshedGoogleTokenAsync(context, refreshedToken, refreshToken);

        return refreshedToken.AccessToken;
    }

    private static bool ShouldRefreshAccessToken(string? accessToken, string? expiresAt)
    {
        if (string.IsNullOrWhiteSpace(accessToken))
        {
            return true;
        }

        if (!DateTimeOffset.TryParse(
                expiresAt,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal,
                out var parsedExpiresAt))
        {
            return true;
        }

        return parsedExpiresAt <= DateTimeOffset.UtcNow.AddMinutes(5);
    }

    private static async Task<GoogleTokenRefreshResult> RefreshGoogleAccessTokenAsync(
        IHttpClientFactory httpClientFactory,
        string clientId,
        string clientSecret,
        string refreshToken,
        CancellationToken cancellationToken)
    {
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["client_secret"] = clientSecret,
            ["refresh_token"] = refreshToken,
            ["grant_type"] = "refresh_token",
        });
        var response = await httpClientFactory
            .CreateClient()
            .PostAsync("https://oauth2.googleapis.com/token", content, cancellationToken);
        var payload = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new GoogleApiRequestException(
                "Google token refresh failed.",
                payload,
                (int)response.StatusCode);
        }

        using var document = JsonDocument.Parse(payload);
        var accessToken = GetJsonString(document.RootElement, "access_token");

        if (string.IsNullOrWhiteSpace(accessToken))
        {
            throw new GoogleApiRequestException(
                "Google token refresh failed.",
                "Google did not return a new access token.",
                StatusCodes.Status401Unauthorized);
        }

        return new GoogleTokenRefreshResult(
            accessToken,
            GetJsonLong(document.RootElement, "expires_in") ?? 3600,
            GetJsonString(document.RootElement, "refresh_token"),
            GetJsonString(document.RootElement, "scope"));
    }

    private static async Task StoreRefreshedGoogleTokenAsync(
        HttpContext context,
        GoogleTokenRefreshResult refreshedToken,
        string previousRefreshToken)
    {
        var authenticateResult = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);

        if (!authenticateResult.Succeeded || authenticateResult.Principal is null)
        {
            return;
        }

        var properties = authenticateResult.Properties ?? new AuthenticationProperties();
        var tokens = properties.GetTokens().ToList();
        var expiresAt = DateTimeOffset.UtcNow
            .AddSeconds(Math.Max(60, refreshedToken.ExpiresIn - 60))
            .ToString("o", CultureInfo.InvariantCulture);

        StoreToken(tokens, "access_token", refreshedToken.AccessToken);
        StoreToken(tokens, "expires_at", expiresAt);
        StoreToken(tokens, "refresh_token", refreshedToken.RefreshToken ?? previousRefreshToken);

        if (!string.IsNullOrWhiteSpace(refreshedToken.Scope))
        {
            StoreToken(tokens, "scope", refreshedToken.Scope);
        }

        properties.StoreTokens(tokens);
        await context.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            authenticateResult.Principal,
            properties);
    }

    private static void StoreToken(List<AuthenticationToken> tokens, string name, string value)
    {
        var token = tokens.FirstOrDefault(currentToken => currentToken.Name == name);

        if (token is null)
        {
            tokens.Add(new AuthenticationToken
            {
                Name = name,
                Value = value,
            });
            return;
        }

        token.Value = value;
    }

    private static GoogleIntegrationStatusDto CreateStatus(
        string provider,
        string label,
        bool isConfigured,
        ISet<string> grantedScopes,
        string? accessToken,
        string[] requiredScopes)
    {
        var hasRequiredScopes = requiredScopes.All(grantedScopes.Contains);
        var isConnected = isConfigured && !string.IsNullOrWhiteSpace(accessToken) && hasRequiredScopes;

        return new GoogleIntegrationStatusDto(
            provider,
            label,
            isConfigured,
            isConnected,
            isConnected ? "connected" : "needs_connection",
            $"/api/google/integrations/{provider}/connect",
            requiredScopes);
    }

    private static HashSet<string> GetGrantedScopes(ClaimsPrincipal user)
    {
        var scopesClaim = user.FindFirstValue("urn:google:scopes");

        if (string.IsNullOrWhiteSpace(scopesClaim))
        {
            return [];
        }

        return scopesClaim
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static string GetCurrentUserKey(ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.Email) ??
        user.FindFirstValue(ClaimTypes.NameIdentifier) ??
        user.Identity?.Name ??
        "google-user";

    private static async Task<ScheduledGmailSendTokens?> GetScheduledGmailSendTokensAsync(
        HttpContext context,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var accessToken = await GetGoogleAccessTokenAsync(
            context,
            httpClientFactory,
            configuration,
            cancellationToken);

        if (string.IsNullOrWhiteSpace(accessToken))
        {
            return null;
        }

        var authenticateResult = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        var properties = authenticateResult.Properties;
        var refreshToken = properties?.GetTokenValue("refresh_token") ?? await context.GetTokenAsync("refresh_token");
        var expiresAtValue = properties?.GetTokenValue("expires_at") ?? await context.GetTokenAsync("expires_at");
        var expiresAt = TryParseTokenExpiresAt(expiresAtValue);

        return new ScheduledGmailSendTokens(accessToken, refreshToken, expiresAt);
    }

    private static DateTimeOffset? TryParseTokenExpiresAt(string? value) =>
        DateTimeOffset.TryParse(
            value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;

    private static string SerializeScheduledGmailAttachments(GoogleGmailSendAttachmentDto[] attachments) =>
        JsonSerializer.Serialize(
            attachments
                .Where(attachment =>
                    !string.IsNullOrWhiteSpace(attachment.FileName) &&
                    !string.IsNullOrWhiteSpace(attachment.ContentBase64))
                .ToArray());

    private static GoogleGmailSendAttachmentDto[] DeserializeScheduledGmailAttachments(string attachmentsJson)
    {
        try
        {
            return JsonSerializer.Deserialize<GoogleGmailSendAttachmentDto[]>(attachmentsJson) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static GoogleGmailScheduledMessageDto CreateScheduledGmailMessageDto(ScheduledGmailMessage message)
    {
        var attachments = DeserializeScheduledGmailAttachments(message.AttachmentsJson)
            .Select(attachment => new GoogleGmailScheduledAttachmentDto(
                attachment.FileName,
                attachment.MimeType,
                attachment.SizeBytes))
            .ToArray();

        return new GoogleGmailScheduledMessageDto(
            message.Id,
            message.To,
            message.Cc,
            message.Bcc,
            message.Subject,
            message.Body,
            message.ScheduledFor,
            message.CreatedAt,
            message.Status,
            attachments,
            message.Error,
            message.SentAt,
            message.GmailMessageId,
            message.GmailThreadId);
    }

    private static GoogleGmailSendRequestDto CreateScheduledGmailSendRequest(ScheduledGmailMessage message) =>
        new(
            message.To,
            message.Cc,
            message.Bcc,
            message.Subject,
            message.Body,
            DeserializeScheduledGmailAttachments(message.AttachmentsJson));

    private static async Task<string> GetScheduledGmailAccessTokenAsync(
        ScheduledGmailMessage message,
        IConfiguration configuration,
        IHttpClientFactory httpClientFactory,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(message.AccessToken) &&
            (!message.AccessTokenExpiresAt.HasValue ||
             message.AccessTokenExpiresAt.Value > DateTimeOffset.UtcNow.AddMinutes(5)))
        {
            return message.AccessToken;
        }

        if (string.IsNullOrWhiteSpace(message.RefreshToken))
        {
            throw new InvalidOperationException("Reconnect Gmail so scheduled send can refresh access.");
        }

        var clientId = configuration["Authentication:Google:ClientId"];
        var clientSecret = configuration["Authentication:Google:ClientSecret"];

        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret))
        {
            throw new InvalidOperationException("Google OAuth is not configured for scheduled send.");
        }

        var refreshedToken = await RefreshGoogleAccessTokenAsync(
            httpClientFactory,
            clientId,
            clientSecret,
            message.RefreshToken,
            cancellationToken);

        message.AccessToken = refreshedToken.AccessToken;
        message.RefreshToken = refreshedToken.RefreshToken ?? message.RefreshToken;
        message.AccessTokenExpiresAt = DateTimeOffset.UtcNow.AddSeconds(Math.Max(60, refreshedToken.ExpiresIn - 60));

        return message.AccessToken;
    }

    private static async Task<ScheduledGmailMessage> TrySendScheduledGmailMessageAsync(
        ScheduledGmailMessage message,
        IncosWorkspaceDbContext db,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        if (message.Status == ScheduledGmailStatusSent ||
            message.Status == ScheduledGmailStatusSending ||
            message.Status == ScheduledGmailStatusCancelled)
        {
            return message;
        }

        message.AttemptCount += 1;
        message.Error = null;
        message.LastAttemptAt = DateTimeOffset.UtcNow;
        message.Status = ScheduledGmailStatusSending;
        message.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        try
        {
            var accessToken = await GetScheduledGmailAccessTokenAsync(
                message,
                configuration,
                httpClientFactory,
                cancellationToken);
            var response = await SendGmailMessageAsync(
                httpClientFactory,
                accessToken,
                CreateScheduledGmailSendRequest(message),
                cancellationToken);

            message.Error = null;
            message.GmailMessageId = response.Id;
            message.GmailThreadId = response.ThreadId;
            message.SentAt = DateTimeOffset.UtcNow;
            message.Status = ScheduledGmailStatusSent;
        }
        catch (Exception exception) when (exception is GoogleApiRequestException or InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            message.Error = Truncate(exception is GoogleApiRequestException googleException
                ? googleException.Detail
                : exception.Message, 1800);
            message.Status = ScheduledGmailStatusFailed;
        }

        message.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return message;
    }

    public static Task EnsureScheduledGmailMessagesTableAsync(
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken = default) =>
        db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS scheduled_gmail_messages (
                "Id" uuid NOT NULL PRIMARY KEY,
                "CreatedAt" timestamp with time zone NOT NULL,
                "UpdatedAt" timestamp with time zone NOT NULL,
                "UserKey" character varying(320) NOT NULL,
                "To" character varying(1200) NOT NULL,
                "Cc" character varying(1200) NULL,
                "Bcc" character varying(1200) NULL,
                "Subject" character varying(998) NOT NULL,
                "Body" text NOT NULL,
                "AttachmentsJson" jsonb NOT NULL,
                "ScheduledFor" timestamp with time zone NOT NULL,
                "Status" character varying(40) NOT NULL,
                "AccessToken" text NOT NULL,
                "RefreshToken" text NULL,
                "AccessTokenExpiresAt" timestamp with time zone NULL,
                "AttemptCount" integer NOT NULL,
                "LastAttemptAt" timestamp with time zone NULL,
                "SentAt" timestamp with time zone NULL,
                "Error" text NULL,
                "GmailMessageId" character varying(120) NULL,
                "GmailThreadId" character varying(120) NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_scheduled_gmail_messages_UserKey_Status_ScheduledFor"
                ON scheduled_gmail_messages ("UserKey", "Status", "ScheduledFor");
            """,
            cancellationToken);

    private static async Task<GmailMessagesPage> GetGmailMessagesAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string? search,
        string? label,
        string? pageToken,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var queryParameters = new Dictionary<string, string?>
        {
            ["maxResults"] = pageSize.ToString(CultureInfo.InvariantCulture),
            ["fields"] = "messages(id,threadId),nextPageToken,resultSizeEstimate",
        };
        var labelId = NormalizeGmailLabelId(label);
        var mailboxQuery = CreateGmailMailboxQuery(label);

        if (!string.IsNullOrWhiteSpace(labelId))
        {
            queryParameters["labelIds"] = labelId;
        }

        var query = CombineGmailSearchQuery(mailboxQuery, search);

        if (!string.IsNullOrWhiteSpace(query))
        {
            queryParameters["q"] = query;
        }

        if (!string.IsNullOrWhiteSpace(pageToken))
        {
            queryParameters["pageToken"] = pageToken.Trim();
        }

        var requestUrl = QueryHelpers.AddQueryString(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            queryParameters);
        var payload = await SendGoogleGetAsync(
            httpClientFactory,
            accessToken,
            requestUrl,
            "Gmail messages request failed.",
            cancellationToken);

        using var listDocument = JsonDocument.Parse(payload);

        var nextPageToken = GetJsonString(listDocument.RootElement, "nextPageToken");
        int? resultSizeEstimate = listDocument.RootElement.TryGetProperty("resultSizeEstimate", out var resultSizeEstimateElement)
            ? resultSizeEstimateElement.GetInt32()
            : null;

        if (!listDocument.RootElement.TryGetProperty("messages", out var messagesElement))
        {
            return new GmailMessagesPage([], nextPageToken, resultSizeEstimate);
        }

        var messageIds = messagesElement
            .EnumerateArray()
            .Select(message => GetJsonString(message, "id"))
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id!)
            .Take(pageSize)
            .ToArray();

        var messages = new List<GoogleGmailMessageDto>(messageIds.Length);

        foreach (var messageIdBatch in messageIds.Chunk(GmailMessageSummaryConcurrency))
        {
            var batchMessages = await Task.WhenAll(messageIdBatch.Select(messageId =>
                GetGmailMessageSummaryAsync(httpClientFactory, accessToken, messageId, cancellationToken)));

            messages.AddRange(batchMessages);
        }

        return new GmailMessagesPage(
            messages
                .OrderByDescending(message => message.ReceivedAt)
                .ToArray(),
            nextPageToken,
            resultSizeEstimate);
    }

    private static async Task<GoogleGmailMessageDto> GetGmailMessageAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string messageId,
        CancellationToken cancellationToken)
    {
        var requestUrl = QueryHelpers.AddQueryString(
            $"https://gmail.googleapis.com/gmail/v1/users/me/messages/{Uri.EscapeDataString(messageId)}",
            new Dictionary<string, string?>
            {
                ["format"] = "full",
                ["metadataHeaders"] = "Subject",
                ["fields"] =
                    "id,threadId,labelIds,snippet,internalDate,payload(headers,body,parts(mimeType,filename,headers,body,parts(mimeType,filename,headers,body,parts(mimeType,filename,headers,body,parts(mimeType,filename,headers,body)))))",
            });
        var payload = await SendGoogleGetAsync(
            httpClientFactory,
            accessToken,
            requestUrl,
            "Gmail message request failed.",
            cancellationToken);

        using var document = JsonDocument.Parse(payload);

        return CreateGmailMessageDto(document.RootElement);
    }

    private static async Task<GoogleGmailMessageDto> GetGmailMessageSummaryAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string messageId,
        CancellationToken cancellationToken)
    {
        var queryParameters = new List<KeyValuePair<string, string?>>
        {
            new("format", "metadata"),
            new("metadataHeaders", "From"),
            new("metadataHeaders", "To"),
            new("metadataHeaders", "Subject"),
            new("metadataHeaders", "Date"),
            new("fields", "id,threadId,labelIds,snippet,internalDate,payload(headers)"),
        };
        var requestUrl = QueryHelpers.AddQueryString(
            $"https://gmail.googleapis.com/gmail/v1/users/me/messages/{Uri.EscapeDataString(messageId)}",
            queryParameters);
        var payload = await SendGoogleGetAsync(
            httpClientFactory,
            accessToken,
            requestUrl,
            "Gmail message summary request failed.",
            cancellationToken);

        using var document = JsonDocument.Parse(payload);

        return CreateGmailMessageSummaryDto(document.RootElement);
    }

    private static async Task<GoogleGmailSendResponseDto> SendGmailMessageAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        GoogleGmailSendRequestDto request,
        CancellationToken cancellationToken)
    {
        var rawMessage = CreateRawGmailMessage(request);
        var payload = await SendGooglePostAsync(
            httpClientFactory,
            accessToken,
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            new { raw = rawMessage },
            "Gmail send request failed.",
            cancellationToken);

        using var document = JsonDocument.Parse(payload);

        return new GoogleGmailSendResponseDto(
            GetJsonString(document.RootElement, "id") ?? string.Empty,
            GetJsonString(document.RootElement, "threadId") ?? string.Empty);
    }

    private static async Task MarkGmailMessageReadAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string messageId,
        CancellationToken cancellationToken)
    {
        await SendGooglePostAsync(
            httpClientFactory,
            accessToken,
            $"https://gmail.googleapis.com/gmail/v1/users/me/messages/{Uri.EscapeDataString(messageId)}/modify",
            new { removeLabelIds = new[] { "UNREAD" } },
            "Gmail mark-as-read request failed.",
            cancellationToken);
    }

    private static async Task MarkGmailMessageUnreadAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string messageId,
        CancellationToken cancellationToken)
    {
        await SendGooglePostAsync(
            httpClientFactory,
            accessToken,
            $"https://gmail.googleapis.com/gmail/v1/users/me/messages/{Uri.EscapeDataString(messageId)}/modify",
            new { addLabelIds = new[] { "UNREAD" } },
            "Gmail mark-as-unread request failed.",
            cancellationToken);
    }

    private static async Task ModifyGmailMessageLabelsAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string messageId,
        string[] addLabelIds,
        string[] removeLabelIds,
        CancellationToken cancellationToken)
    {
        await SendGooglePostAsync(
            httpClientFactory,
            accessToken,
            $"https://gmail.googleapis.com/gmail/v1/users/me/messages/{Uri.EscapeDataString(messageId)}/modify",
            new
            {
                addLabelIds = addLabelIds.Where(label => !string.IsNullOrWhiteSpace(label)).ToArray(),
                removeLabelIds = removeLabelIds.Where(label => !string.IsNullOrWhiteSpace(label)).ToArray(),
            },
            "Gmail label update failed.",
            cancellationToken);
    }

    private static string? NormalizeGmailLabelId(string? label)
    {
        if (string.IsNullOrWhiteSpace(label) ||
            string.Equals(label, "all", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(label, "scheduled", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(label, "snoozed", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return label.Trim().ToUpperInvariant().Replace('-', '_');
    }

    private static string? CreateGmailMailboxQuery(string? label)
    {
        if (string.IsNullOrWhiteSpace(label))
        {
            return null;
        }

        return label.Trim().ToLowerInvariant() switch
        {
            "all" => "in:anywhere",
            "scheduled" => "in:scheduled",
            "snoozed" => "in:snoozed",
            _ => null,
        };
    }

    private static string? CombineGmailSearchQuery(string? mailboxQuery, string? search)
    {
        var terms = new[]
        {
            mailboxQuery?.Trim(),
            search?.Trim(),
        }.Where(term => !string.IsNullOrWhiteSpace(term));

        var query = string.Join(' ', terms);

        return string.IsNullOrWhiteSpace(query) ? null : query;
    }

    private static async Task<byte[]> GetGmailAttachmentBytesAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string messageId,
        string attachmentId,
        CancellationToken cancellationToken)
    {
        var requestUrl =
            $"https://gmail.googleapis.com/gmail/v1/users/me/messages/{Uri.EscapeDataString(messageId)}/attachments/{Uri.EscapeDataString(attachmentId)}";
        var payload = await SendGoogleGetAsync(
            httpClientFactory,
            accessToken,
            requestUrl,
            "Gmail attachment request failed.",
            cancellationToken);

        using var document = JsonDocument.Parse(payload);
        var data = GetJsonString(document.RootElement, "data");

        return string.IsNullOrWhiteSpace(data)
            ? []
            : DecodeBase64UrlBytes(data);
    }

    private static string CreateRawGmailMessage(GoogleGmailSendRequestDto request)
    {
        var attachments = request.Attachments?
            .Where(attachment =>
                !string.IsNullOrWhiteSpace(attachment.FileName) &&
                !string.IsNullOrWhiteSpace(attachment.ContentBase64))
            .ToArray() ?? [];

        if (attachments.Length > 0)
        {
            return CreateMultipartRawGmailMessage(request, attachments);
        }

        var headers = new StringBuilder();
        headers.Append("To: ").AppendLine(SanitizeMailHeader(request.To));

        if (!string.IsNullOrWhiteSpace(request.Cc))
        {
            headers.Append("Cc: ").AppendLine(SanitizeMailHeader(request.Cc));
        }

        if (!string.IsNullOrWhiteSpace(request.Bcc))
        {
            headers.Append("Bcc: ").AppendLine(SanitizeMailHeader(request.Bcc));
        }

        headers.Append("Subject: ").AppendLine(EncodeMimeHeader(request.Subject));
        headers.AppendLine("MIME-Version: 1.0");
        headers.AppendLine("Content-Type: text/html; charset=UTF-8");
        headers.AppendLine("Content-Transfer-Encoding: base64");
        headers.AppendLine();
        headers.Append(Convert.ToBase64String(Encoding.UTF8.GetBytes(CreateGmailHtmlBody(request.Body))));

        return Convert.ToBase64String(Encoding.UTF8.GetBytes(headers.ToString()))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private static string CreateMultipartRawGmailMessage(
        GoogleGmailSendRequestDto request,
        GoogleGmailSendAttachmentDto[] attachments)
    {
        var boundary = $"incos_workspace_{Guid.NewGuid():N}";
        var headers = new StringBuilder();
        headers.Append("To: ").AppendLine(SanitizeMailHeader(request.To));

        if (!string.IsNullOrWhiteSpace(request.Cc))
        {
            headers.Append("Cc: ").AppendLine(SanitizeMailHeader(request.Cc));
        }

        if (!string.IsNullOrWhiteSpace(request.Bcc))
        {
            headers.Append("Bcc: ").AppendLine(SanitizeMailHeader(request.Bcc));
        }

        headers.Append("Subject: ").AppendLine(EncodeMimeHeader(request.Subject));
        headers.AppendLine("MIME-Version: 1.0");
        headers.Append("Content-Type: multipart/mixed; boundary=\"").Append(boundary).AppendLine("\"");
        headers.AppendLine();
        headers.Append("--").Append(boundary).AppendLine();
        headers.AppendLine("Content-Type: text/html; charset=UTF-8");
        headers.AppendLine("Content-Transfer-Encoding: base64");
        headers.AppendLine();
        headers.AppendLine(WrapBase64(Convert.ToBase64String(Encoding.UTF8.GetBytes(CreateGmailHtmlBody(request.Body)))));

        foreach (var attachment in attachments)
        {
            var safeMimeType = NormalizeMimeType(attachment.MimeType);
            var encodedFileName = Uri.EscapeDataString(SanitizeFileName(attachment.FileName));

            headers.Append("--").Append(boundary).AppendLine();
            headers.Append("Content-Type: ").Append(safeMimeType).Append("; name*=UTF-8''").Append(encodedFileName).AppendLine();
            headers.AppendLine("Content-Transfer-Encoding: base64");
            headers.Append("Content-Disposition: attachment; filename*=UTF-8''").Append(encodedFileName).AppendLine();
            headers.AppendLine();
            headers.AppendLine(WrapBase64(NormalizeAttachmentBase64(attachment.ContentBase64)));
        }

        headers.Append("--").Append(boundary).AppendLine("--");

        return Convert.ToBase64String(Encoding.UTF8.GetBytes(headers.ToString()))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private static string SanitizeMailHeader(string value) =>
        value.ReplaceLineEndings(" ").Trim();

    private static string NormalizeMailAddressList(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var addresses = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var token in value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!TryCreateMailAddress(token, out var address) || !seen.Add(address.Address))
            {
                continue;
            }

            addresses.Add(FormatMailAddress(address));
        }

        return string.Join(", ", addresses);
    }

    private static bool TryCreateMailAddress(string value, out MailAddress address)
    {
        try
        {
            address = new MailAddress(value);

            return !string.IsNullOrWhiteSpace(address.Address) && address.Address.Contains('@', StringComparison.Ordinal);
        }
        catch (FormatException)
        {
            var match = Regex.Match(value, @"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", RegexOptions.IgnoreCase);

            if (match.Success)
            {
                try
                {
                    address = new MailAddress(match.Value);

                    return true;
                }
                catch (FormatException)
                {
                    // Fall through to the invalid result below.
                }
            }
        }

        address = new MailAddress("invalid@example.invalid");

        return false;
    }

    private static string FormatMailAddress(MailAddress address)
    {
        if (string.IsNullOrWhiteSpace(address.DisplayName) ||
            string.Equals(address.DisplayName, address.Address, StringComparison.OrdinalIgnoreCase))
        {
            return address.Address;
        }

        var displayName = SanitizeMailHeader(address.DisplayName).Trim('"');
        var safeDisplayName = displayName.All(character => character <= 127)
            ? $"\"{displayName.Replace("\\", "\\\\").Replace("\"", "\\\"")}\""
            : EncodeMimeHeader(displayName);

        return $"{safeDisplayName} <{address.Address}>";
    }

    private static string NormalizeMimeType(string? value)
    {
        var safeValue = value?.Trim();

        return !string.IsNullOrWhiteSpace(safeValue) &&
               Regex.IsMatch(safeValue, @"^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$")
            ? safeValue
            : "application/octet-stream";
    }

    private static string NormalizeAttachmentBase64(string value)
    {
        var data = value.Contains(',', StringComparison.Ordinal) ? value[(value.IndexOf(',', StringComparison.Ordinal) + 1)..] : value;

        return Regex.Replace(data, @"\s+", string.Empty);
    }

    private static string WrapBase64(string value)
    {
        var normalized = Regex.Replace(value, @"\s+", string.Empty);
        var wrapped = new StringBuilder(normalized.Length + normalized.Length / 76 + 1);

        for (var index = 0; index < normalized.Length; index += 76)
        {
            wrapped.AppendLine(normalized.Substring(index, Math.Min(76, normalized.Length - index)));
        }

        return wrapped.ToString().TrimEnd();
    }

    private static string CreateGmailHtmlBody(string body)
    {
        if (body.Contains('<', StringComparison.Ordinal) && body.Contains('>', StringComparison.Ordinal))
        {
            return body;
        }

        return WebUtility.HtmlEncode(body).ReplaceLineEndings("<br>");
    }

    private static string EncodeMimeHeader(string? value)
    {
        var safeValue = SanitizeMailHeader(string.IsNullOrWhiteSpace(value) ? "(No subject)" : value);

        return safeValue.All(character => character <= 127)
            ? safeValue
            : $"=?UTF-8?B?{Convert.ToBase64String(Encoding.UTF8.GetBytes(safeValue))}?=";
    }

    private static GoogleGmailMessageDto CreateGmailMessageDto(JsonElement message)
    {
        var headers = message.TryGetProperty("payload", out var payload)
            ? GetGmailHeaders(payload)
            : new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var labels = GetJsonStringArray(message, "labelIds");
        var snippet = WebUtility.HtmlDecode(GetJsonString(message, "snippet") ?? string.Empty);
        var bodyText = payload.ValueKind == JsonValueKind.Object
            ? ExtractGmailBodyText(payload)
            : null;
        var bodyHtml = payload.ValueKind == JsonValueKind.Object
            ? ExtractGmailBodyHtml(payload)
            : null;
        var messageId = GetJsonString(message, "id") ?? string.Empty;
        var preparedBodyHtml = PrepareGmailBodyHtml(messageId, bodyHtml, payload);
        var previewSource = bodyText ??
                            (!string.IsNullOrWhiteSpace(bodyHtml)
                                ? StripHtml(bodyHtml)
                                : snippet);
        var bodyPreview = NormalizeEmailBody(previewSource);
        var attachments = payload.ValueKind == JsonValueKind.Object
            ? GetGmailAttachments(payload)
            : Array.Empty<GoogleGmailAttachmentDto>();

        return new GoogleGmailMessageDto(
            messageId,
            GetJsonString(message, "threadId") ?? string.Empty,
            headers.GetValueOrDefault("from") ?? "Unknown sender",
            headers.GetValueOrDefault("to"),
            string.IsNullOrWhiteSpace(headers.GetValueOrDefault("subject"))
                ? "(No subject)"
                : headers.GetValueOrDefault("subject")!,
            snippet,
            Truncate(bodyPreview, 12000),
            preparedBodyHtml,
            ParseGmailReceivedAt(headers.GetValueOrDefault("date"), GetJsonString(message, "internalDate")),
            labels.Contains("UNREAD", StringComparer.OrdinalIgnoreCase),
            labels,
            attachments);
    }

    private static GoogleGmailMessageDto CreateGmailMessageSummaryDto(JsonElement message)
    {
        var headers = message.TryGetProperty("payload", out var payload)
            ? GetGmailHeaders(payload)
            : new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var labels = GetJsonStringArray(message, "labelIds");
        var snippet = WebUtility.HtmlDecode(GetJsonString(message, "snippet") ?? string.Empty);

        return new GoogleGmailMessageDto(
            GetJsonString(message, "id") ?? string.Empty,
            GetJsonString(message, "threadId") ?? string.Empty,
            headers.GetValueOrDefault("from") ?? "Unknown sender",
            headers.GetValueOrDefault("to"),
            string.IsNullOrWhiteSpace(headers.GetValueOrDefault("subject"))
                ? "(No subject)"
                : headers.GetValueOrDefault("subject")!,
            snippet,
            snippet,
            null,
            ParseGmailReceivedAt(headers.GetValueOrDefault("date"), GetJsonString(message, "internalDate")),
            labels.Contains("UNREAD", StringComparer.OrdinalIgnoreCase),
            labels,
            []);
    }

    private static Dictionary<string, string> GetGmailHeaders(JsonElement payload)
    {
        if (!payload.TryGetProperty("headers", out var headersElement) ||
            headersElement.ValueKind != JsonValueKind.Array)
        {
            return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }

        return headersElement
            .EnumerateArray()
            .Select(header => new
            {
                Name = GetJsonString(header, "name"),
                Value = GetJsonString(header, "value"),
            })
            .Where(header => !string.IsNullOrWhiteSpace(header.Name) && header.Value is not null)
            .GroupBy(header => header.Name!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                group => group.Key,
                group => group.First().Value!,
                StringComparer.OrdinalIgnoreCase);
    }

    private static DateTimeOffset? ParseGmailReceivedAt(string? dateHeader, string? internalDate)
    {
        if (DateTimeOffset.TryParse(dateHeader, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var parsedDate))
        {
            return parsedDate;
        }

        return long.TryParse(internalDate, CultureInfo.InvariantCulture, out var internalDateMs)
            ? DateTimeOffset.FromUnixTimeMilliseconds(internalDateMs)
            : null;
    }

    private static string? ExtractGmailBodyText(JsonElement payload)
    {
        var mimeType = GetJsonString(payload, "mimeType") ?? string.Empty;
        var data = payload.TryGetProperty("body", out var body) ? GetJsonString(body, "data") : null;

        if (!string.IsNullOrWhiteSpace(data) &&
            mimeType.Equals("text/plain", StringComparison.OrdinalIgnoreCase))
        {
            return DecodeBase64UrlText(data);
        }

        if (payload.TryGetProperty("parts", out var partsElement) &&
            partsElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var part in partsElement.EnumerateArray())
            {
                var plainText = ExtractGmailBodyText(part);

                if (!string.IsNullOrWhiteSpace(plainText))
                {
                    return plainText;
                }
            }
        }

        if (!string.IsNullOrWhiteSpace(data) &&
            mimeType.Equals("text/html", StringComparison.OrdinalIgnoreCase))
        {
            var html = DecodeBase64UrlText(data);

            return string.IsNullOrWhiteSpace(html)
                ? null
                : StripHtml(html);
        }

        return null;
    }

    private static string? ExtractGmailBodyHtml(JsonElement payload)
    {
        var mimeType = GetJsonString(payload, "mimeType") ?? string.Empty;
        var data = payload.TryGetProperty("body", out var body) ? GetJsonString(body, "data") : null;

        if (!string.IsNullOrWhiteSpace(data) &&
            mimeType.Equals("text/html", StringComparison.OrdinalIgnoreCase))
        {
            return DecodeBase64UrlText(data);
        }

        if (!payload.TryGetProperty("parts", out var partsElement) ||
            partsElement.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var part in partsElement.EnumerateArray())
        {
            var html = ExtractGmailBodyHtml(part);

            if (!string.IsNullOrWhiteSpace(html))
            {
                return html;
            }
        }

        return null;
    }

    private static string? PrepareGmailBodyHtml(string messageId, string? html, JsonElement payload)
    {
        if (string.IsNullOrWhiteSpace(html))
        {
            return null;
        }

        var withoutScripts = Regex.Replace(
            html,
            @"<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>",
            string.Empty,
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
        var withoutForms = Regex.Replace(
            withoutScripts,
            @"<\/?(form|input|button|textarea|select|option)\b[^>]*>",
            string.Empty,
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
        var inlineImageSources = GetGmailInlineImageSources(messageId, payload);

        if (inlineImageSources.Count == 0)
        {
            return withoutForms;
        }

        return Regex.Replace(
            withoutForms,
            "cid:([^\"'\\s>)]+)",
            match =>
            {
                var contentId = WebUtility.UrlDecode(match.Groups[1].Value).Trim('<', '>');

                return inlineImageSources.TryGetValue(contentId, out var source)
                    ? source
                    : match.Value;
            },
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
    }

    private static Dictionary<string, string> GetGmailInlineImageSources(string messageId, JsonElement payload)
    {
        var sources = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        CollectGmailInlineImageSources(messageId, payload, sources);

        return sources;
    }

    private static void CollectGmailInlineImageSources(
        string messageId,
        JsonElement payload,
        IDictionary<string, string> sources)
    {
        var mimeType = GetJsonString(payload, "mimeType") ?? string.Empty;
        var contentId = GetGmailPartHeader(payload, "Content-ID")?.Trim('<', '>');

        if (!string.IsNullOrWhiteSpace(contentId) &&
            mimeType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) &&
            payload.TryGetProperty("body", out var body))
        {
            var data = GetJsonString(body, "data");
            var attachmentId = GetJsonString(body, "attachmentId");

            if (!string.IsNullOrWhiteSpace(data))
            {
                sources[contentId] = $"data:{mimeType};base64,{NormalizeBase64UrlData(data)}";
            }
            else if (!string.IsNullOrWhiteSpace(attachmentId))
            {
                var query = QueryHelpers.AddQueryString(
                    $"/api/google/gmail/messages/{Uri.EscapeDataString(messageId)}/attachments/{Uri.EscapeDataString(attachmentId)}",
                    new Dictionary<string, string?> { ["mimeType"] = mimeType });
                sources[contentId] = query;
            }
        }

        if (!payload.TryGetProperty("parts", out var partsElement) ||
            partsElement.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var part in partsElement.EnumerateArray())
        {
            CollectGmailInlineImageSources(messageId, part, sources);
        }
    }

    private static string? GetGmailPartHeader(JsonElement payload, string headerName)
    {
        if (!payload.TryGetProperty("headers", out var headersElement) ||
            headersElement.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var header in headersElement.EnumerateArray())
        {
            if (string.Equals(GetJsonString(header, "name"), headerName, StringComparison.OrdinalIgnoreCase))
            {
                return GetJsonString(header, "value");
            }
        }

        return null;
    }

    private static string? DecodeBase64UrlText(string data)
    {
        try
        {
            return Encoding.UTF8.GetString(DecodeBase64UrlBytes(data));
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static byte[] DecodeBase64UrlBytes(string data) =>
        Convert.FromBase64String(NormalizeBase64UrlData(data));

    private static string NormalizeBase64UrlData(string data)
    {
        var normalized = data.Replace('-', '+').Replace('_', '/');

        return normalized.PadRight(normalized.Length + ((4 - normalized.Length % 4) % 4), '=');
    }

    private static string StripHtml(string html)
    {
        var withoutTags = Regex.Replace(html, "<[^>]+>", " ", RegexOptions.Compiled);

        return WebUtility.HtmlDecode(withoutTags);
    }

    private static GoogleGmailAttachmentDto[] GetGmailAttachments(JsonElement payload)
    {
        var attachments = new List<GoogleGmailAttachmentDto>();

        CollectGmailAttachments(payload, attachments);

        return attachments
            .GroupBy(attachment => attachment.FileName, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToArray();
    }

    private static void CollectGmailAttachments(JsonElement payload, ICollection<GoogleGmailAttachmentDto> attachments)
    {
        var fileName = GetJsonString(payload, "filename");

        if (!string.IsNullOrWhiteSpace(fileName))
        {
            long? sizeBytes = null;

            if (payload.TryGetProperty("body", out var body) &&
                body.TryGetProperty("size", out var sizeElement) &&
                sizeElement.TryGetInt64(out var size))
            {
                sizeBytes = size;
            }

            attachments.Add(new GoogleGmailAttachmentDto(
                fileName,
                GetJsonString(payload, "mimeType") ?? "application/octet-stream",
                sizeBytes));
        }

        if (!payload.TryGetProperty("parts", out var partsElement) ||
            partsElement.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var part in partsElement.EnumerateArray())
        {
            CollectGmailAttachments(part, attachments);
        }
    }

    private static async Task<GoogleChatSpaceDto[]> GetChatSpacesAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string? search,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var requestUrl = QueryHelpers.AddQueryString(
            "https://chat.googleapis.com/v1/spaces",
            new Dictionary<string, string?>
            {
                ["pageSize"] = pageSize.ToString(CultureInfo.InvariantCulture),
                ["fields"] = "spaces(name,displayName,spaceType,type,lastActiveTime,spaceUri),nextPageToken",
            });
        var payload = await SendGoogleGetAsync(
            httpClientFactory,
            accessToken,
            requestUrl,
            "Google Chat spaces request failed.",
            cancellationToken);

        using var document = JsonDocument.Parse(payload);

        if (!document.RootElement.TryGetProperty("spaces", out var spacesElement))
        {
            return [];
        }

        var spaces = spacesElement
            .EnumerateArray()
            .Select(CreateGoogleChatSpaceSeed)
            .Where(space => string.IsNullOrWhiteSpace(search) ||
                            space.DisplayName.Contains(search.Trim(), StringComparison.OrdinalIgnoreCase))
            .Take(pageSize)
            .ToArray();
        var spacesWithMessages = await Task.WhenAll(spaces.Select(async space =>
        {
            var messages = await GetChatMessagesAsync(
                httpClientFactory,
                accessToken,
                space.Name,
                cancellationToken);

            return space with
            {
                Messages = messages,
                LastActiveTime = space.LastActiveTime ?? messages.FirstOrDefault()?.CreatedAt,
            };
        }));

        return spacesWithMessages
            .OrderByDescending(space => space.LastActiveTime)
            .ThenBy(space => space.DisplayName)
            .ToArray();
    }

    private static GoogleChatSpaceDto CreateGoogleChatSpaceSeed(JsonElement space)
    {
        var name = GetJsonString(space, "name") ?? string.Empty;
        var displayName = GetJsonString(space, "displayName");
        var spaceType = GetJsonString(space, "spaceType") ?? GetJsonString(space, "type") ?? "SPACE";

        return new GoogleChatSpaceDto(
            name,
            string.IsNullOrWhiteSpace(displayName)
                ? FormatChatSpaceFallbackName(name, spaceType)
                : displayName,
            spaceType,
            GetJsonDateTimeOffset(space, "lastActiveTime"),
            []);
    }

    private static async Task<GoogleChatMessageDto[]> GetChatMessagesAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string spaceName,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(spaceName))
        {
            return [];
        }

        try
        {
            var requestUrl = QueryHelpers.AddQueryString(
                $"https://chat.googleapis.com/v1/{spaceName}/messages",
                new Dictionary<string, string?>
                {
                    ["pageSize"] = "8",
                    ["orderBy"] = "createTime DESC",
                    ["fields"] = "messages(name,text,argumentText,formattedText,createTime,sender(displayName,email,type)),nextPageToken",
                });
            var payload = await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                requestUrl,
                "Google Chat messages request failed.",
                cancellationToken);

            using var document = JsonDocument.Parse(payload);

            return document.RootElement.TryGetProperty("messages", out var messagesElement)
                ? messagesElement
                    .EnumerateArray()
                    .Select(CreateGoogleChatMessageDto)
                    .OrderBy(message => message.CreatedAt)
                    .ToArray()
                : [];
        }
        catch (GoogleApiRequestException exception) when (exception.StatusCode is StatusCodes.Status403Forbidden or StatusCodes.Status404NotFound)
        {
            return [];
        }
    }

    private static GoogleChatMessageDto CreateGoogleChatMessageDto(JsonElement message)
    {
        var sender = message.TryGetProperty("sender", out var senderElement)
            ? GetJsonString(senderElement, "displayName") ?? GetJsonString(senderElement, "email")
            : null;
        var text = GetJsonString(message, "text") ??
                   GetJsonString(message, "argumentText") ??
                   GetJsonString(message, "formattedText") ??
                   "(No message text)";

        return new GoogleChatMessageDto(
            GetJsonString(message, "name") ?? string.Empty,
            string.IsNullOrWhiteSpace(sender) ? "Google Chat" : sender,
            NormalizeWhitespace(StripHtml(text)),
            GetJsonDateTimeOffset(message, "createTime"));
    }

    private static string FormatChatSpaceFallbackName(string name, string spaceType)
    {
        var suffix = name.Split('/', StringSplitOptions.RemoveEmptyEntries).LastOrDefault() ?? "space";

        return spaceType switch
        {
            "DIRECT_MESSAGE" => $"Direct message {suffix}",
            "GROUP_CHAT" => $"Group chat {suffix}",
            _ => $"Space {suffix}",
        };
    }

    private static bool IsGoogleChatConfigurationFailure(GoogleApiRequestException exception)
    {
        return exception.StatusCode == StatusCodes.Status404NotFound &&
               (exception.Title.Contains("Google Chat", StringComparison.OrdinalIgnoreCase) ||
                exception.Detail.Contains("Google Chat app not found", StringComparison.OrdinalIgnoreCase) ||
                exception.Detail.Contains("chat.googleapis.com", StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsGoogleRateLimitedResponse(HttpStatusCode statusCode, string payload)
    {
        return statusCode == HttpStatusCode.TooManyRequests ||
               payload.Contains("Too many concurrent requests", StringComparison.OrdinalIgnoreCase) ||
               payload.Contains("userRateLimitExceeded", StringComparison.OrdinalIgnoreCase) ||
               payload.Contains("rateLimitExceeded", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeWhitespace(string value)
    {
        return Regex.Replace(value, @"\s+", " ", RegexOptions.Compiled).Trim();
    }

    private static string NormalizeEmailBody(string value)
    {
        var normalizedLineEndings = value.ReplaceLineEndings("\n");
        var lines = normalizedLineEndings
            .Split('\n')
            .Select(line => Regex.Replace(line.TrimEnd(), @"[ \t]+", " ", RegexOptions.Compiled))
            .ToArray();

        return Regex.Replace(string.Join('\n', lines).Trim(), @"\n{3,}", "\n\n", RegexOptions.Compiled);
    }

    private static string Truncate(string value, int maxLength)
    {
        if (value.Length <= maxLength)
        {
            return value;
        }

        return $"{value[..Math.Max(0, maxLength - 1)]}…";
    }

    private static async Task<GoogleDriveFileDto[]> GetDriveFilesAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string driveView,
        string? folderId,
        string? driveId,
        string? search,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var parentId = GetParentId(driveView, folderId, driveId);
        var requestUrl = BuildDriveFilesRequestUrl(driveView, parentId, driveId, search, pageSize);
        var payload = await SendGoogleGetAsync(
            httpClientFactory,
            accessToken,
            requestUrl,
            "Google Drive request failed.",
            cancellationToken);

        using var document = JsonDocument.Parse(payload);

        var files = document.RootElement.TryGetProperty("files", out var filesElement)
            ? filesElement
                .EnumerateArray()
                .Select(CreateGoogleDriveFileDto)
                .OrderByDescending(file => file.IsFolder)
                .ThenBy(file => file.Name)
                .ToArray()
            : [];

        var parentNames = await GetParentNamesAsync(
            httpClientFactory,
            accessToken,
            files.SelectMany(file => file.Parents),
            cancellationToken);

        return files
            .Select(file => file with
            {
                ParentNames = file.Parents
                    .Select(parent => parentNames.GetValueOrDefault(parent))
                    .Where(name => !string.IsNullOrWhiteSpace(name))
                    .Select(name => name!)
                    .ToArray(),
            })
            .ToArray();
    }

    private static async Task<GoogleSharedDriveDto[]> GetSharedDrivesAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        CancellationToken cancellationToken)
    {
        var requestUrl = QueryHelpers.AddQueryString(
            "https://www.googleapis.com/drive/v3/drives",
            new Dictionary<string, string?>
            {
                ["pageSize"] = "50",
                ["fields"] = "drives(id,name)",
            });
        var payload = await SendGoogleGetAsync(
            httpClientFactory,
            accessToken,
            requestUrl,
            "Google Shared Drives request failed.",
            cancellationToken);

        using var document = JsonDocument.Parse(payload);

        return document.RootElement.TryGetProperty("drives", out var drivesElement)
            ? drivesElement
                .EnumerateArray()
                .Select(drive => new GoogleSharedDriveDto(
                    GetJsonString(drive, "id") ?? string.Empty,
                    GetJsonString(drive, "name") ?? "Untitled shared drive"))
                .OrderBy(drive => drive.Name)
                .ToArray()
            : [];
    }

    private static async Task<GoogleDriveFileDto> GetDriveFileMetadataAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string fileId,
        CancellationToken cancellationToken)
    {
        var requestUrl = QueryHelpers.AddQueryString(
            $"https://www.googleapis.com/drive/v3/files/{Uri.EscapeDataString(fileId)}",
            new Dictionary<string, string?>
            {
                ["supportsAllDrives"] = "true",
                ["fields"] = "id,name,mimeType,parents,webViewLink,iconLink,createdTime,modifiedTime,size",
            });
        var payload = await SendGoogleGetAsync(
            httpClientFactory,
            accessToken,
            requestUrl,
            "Google Drive file metadata request failed.",
            cancellationToken);

        using var document = JsonDocument.Parse(payload);

        return CreateGoogleDriveFileDto(document.RootElement);
    }

    private static async Task<DriveDownloadPayload> DownloadSingleDriveFileAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        GoogleDriveFileDto metadata,
        bool acknowledgeAbuse,
        CancellationToken cancellationToken)
    {
        if (ExportFormats.TryGetValue(metadata.MimeType, out var exportFormat))
        {
            var exportUrl = QueryHelpers.AddQueryString(
                $"https://www.googleapis.com/drive/v3/files/{Uri.EscapeDataString(metadata.Id)}/export",
                new Dictionary<string, string?>
                {
                    ["mimeType"] = exportFormat.MimeType,
                });
            var exportBytes = await SendGoogleBytesAsync(
                httpClientFactory,
                accessToken,
                exportUrl,
                "Google Drive export request failed.",
                cancellationToken);

            return new DriveDownloadPayload(
                exportBytes,
                exportFormat.MimeType,
                EnsureFileExtension(metadata.Name, exportFormat.Extension));
        }

        if (metadata.MimeType.StartsWith("application/vnd.google-apps.", StringComparison.OrdinalIgnoreCase))
        {
            throw new GoogleApiRequestException(
                "Google Drive file cannot be downloaded.",
                "This Google Workspace file type cannot be exported by the Drive API.",
                StatusCodes.Status415UnsupportedMediaType);
        }

        var mediaUrl = QueryHelpers.AddQueryString(
            $"https://www.googleapis.com/drive/v3/files/{Uri.EscapeDataString(metadata.Id)}",
            new Dictionary<string, string?>
            {
                ["alt"] = "media",
                ["supportsAllDrives"] = "true",
                ["acknowledgeAbuse"] = acknowledgeAbuse ? "true" : null,
            });
        var bytes = await SendGoogleBytesAsync(
            httpClientFactory,
            accessToken,
            mediaUrl,
            "Google Drive download request failed.",
            cancellationToken);

        return new DriveDownloadPayload(
            bytes,
            string.IsNullOrWhiteSpace(metadata.MimeType) ? "application/octet-stream" : metadata.MimeType,
            SanitizeFileName(metadata.Name));
    }

    private static async Task<DriveDownloadPayload> CreateFolderZipDownloadAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        GoogleDriveFileDto folder,
        bool acknowledgeAbuse,
        CancellationToken cancellationToken)
    {
        var state = new FolderDownloadState();
        using var buffer = new MemoryStream();

        using (var archive = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            await AddFolderContentsToZipAsync(
                httpClientFactory,
                accessToken,
                folder.Id,
                SanitizeZipPathSegment(folder.Name),
                archive,
                state,
                acknowledgeAbuse,
                cancellationToken);
        }

        return new DriveDownloadPayload(
            buffer.ToArray(),
            "application/zip",
            EnsureFileExtension(folder.Name, ".zip"));
    }

    private static async Task AddFolderContentsToZipAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string folderId,
        string folderPath,
        ZipArchive archive,
        FolderDownloadState state,
        bool acknowledgeAbuse,
        CancellationToken cancellationToken)
    {
        var children = await GetDriveFolderChildrenAsync(
            httpClientFactory,
            accessToken,
            folderId,
            cancellationToken);

        if (children.Length == 0)
        {
            archive.CreateEntry($"{folderPath}/");
            return;
        }

        foreach (var child in children)
        {
            if (child.IsFolder)
            {
                await AddFolderContentsToZipAsync(
                    httpClientFactory,
                    accessToken,
                    child.Id,
                    $"{folderPath}/{SanitizeZipPathSegment(child.Name)}",
                    archive,
                    state,
                    acknowledgeAbuse,
                    cancellationToken);
                continue;
            }

            state.FileCount++;

            if (state.FileCount > FolderDownloadMaxFileCount)
            {
                throw new GoogleApiRequestException(
                    "Google Drive folder is too large.",
                    $"Folder downloads are currently limited to {FolderDownloadMaxFileCount} files.",
                    StatusCodes.Status413PayloadTooLarge);
            }

            var fileDownload = await DownloadSingleDriveFileAsync(
                httpClientFactory,
                accessToken,
                child,
                acknowledgeAbuse,
                cancellationToken);
            state.TotalBytes += fileDownload.Content.Length;

            if (state.TotalBytes > FolderDownloadMaxBytes)
            {
                throw new GoogleApiRequestException(
                    "Google Drive folder is too large.",
                    "Folder downloads are currently limited to 500 MB.",
                    StatusCodes.Status413PayloadTooLarge);
            }

            var entry = archive.CreateEntry(
                $"{folderPath}/{SanitizeZipPathSegment(fileDownload.FileName)}",
                CompressionLevel.Fastest);
            await using var entryStream = entry.Open();
            await entryStream.WriteAsync(fileDownload.Content, cancellationToken);
        }
    }

    private static async Task<GoogleDriveFileDto[]> GetDriveFolderChildrenAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string folderId,
        CancellationToken cancellationToken)
    {
        var children = new List<GoogleDriveFileDto>();
        var pageToken = default(string);

        do
        {
            var requestUrl = QueryHelpers.AddQueryString(
                "https://www.googleapis.com/drive/v3/files",
                new Dictionary<string, string?>
                {
                    ["pageSize"] = "100",
                    ["pageToken"] = pageToken,
                    ["orderBy"] = "folder,name",
                    ["q"] = $"'{EscapeDriveQueryValue(folderId)}' in parents and trashed = false",
                    ["supportsAllDrives"] = "true",
                    ["includeItemsFromAllDrives"] = "true",
                    ["corpora"] = "allDrives",
                    ["fields"] = $"nextPageToken,{DriveFileFields}",
                });
            var payload = await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                requestUrl,
                "Google Drive folder request failed.",
                cancellationToken);
            using var document = JsonDocument.Parse(payload);

            if (document.RootElement.TryGetProperty("files", out var filesElement))
            {
                children.AddRange(filesElement.EnumerateArray().Select(CreateGoogleDriveFileDto));
            }

            pageToken = GetJsonString(document.RootElement, "nextPageToken");
        } while (!string.IsNullOrWhiteSpace(pageToken));

        return children.ToArray();
    }

    private static GoogleDriveFileDto CreateGoogleDriveFileDto(JsonElement file)
    {
        var mimeType = GetJsonString(file, "mimeType") ?? "application/octet-stream";

        return new GoogleDriveFileDto(
            GetJsonString(file, "id") ?? string.Empty,
            GetJsonString(file, "name") ?? "Untitled",
            mimeType,
            GetJsonStringArray(file, "parents"),
            [],
            GetJsonString(file, "webViewLink"),
            GetJsonString(file, "iconLink"),
            GetJsonDateTimeOffset(file, "createdTime"),
            GetJsonDateTimeOffset(file, "modifiedTime"),
            GetJsonLong(file, "size"),
            string.Equals(
                mimeType,
                "application/vnd.google-apps.folder",
                StringComparison.OrdinalIgnoreCase));
    }

    private static async Task<IReadOnlyDictionary<string, string>> GetParentNamesAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        IEnumerable<string> parentIds,
        CancellationToken cancellationToken)
    {
        var uniqueParentIds = parentIds
            .Where(parentId => !string.IsNullOrWhiteSpace(parentId))
            .Distinct(StringComparer.Ordinal)
            .Take(25)
            .ToArray();

        if (uniqueParentIds.Length == 0)
        {
            return new Dictionary<string, string>();
        }

        async Task<KeyValuePair<string, string>?> GetParentNameAsync(string parentId)
        {
            var requestUrl = QueryHelpers.AddQueryString(
                $"https://www.googleapis.com/drive/v3/files/{Uri.EscapeDataString(parentId)}",
                new Dictionary<string, string?>
                {
                    ["supportsAllDrives"] = "true",
                    ["fields"] = "id,name",
                });

            try
            {
                var payload = await SendGoogleGetAsync(
                    httpClientFactory,
                    accessToken,
                    requestUrl,
                    "Google Drive parent request failed.",
                    cancellationToken);
                using var document = JsonDocument.Parse(payload);
                var parentName = GetJsonString(document.RootElement, "name");

                return string.IsNullOrWhiteSpace(parentName)
                    ? null
                    : KeyValuePair.Create(parentId, parentName);
            }
            catch (GoogleApiRequestException)
            {
                return null;
            }
        }

        var parentNames = await Task.WhenAll(uniqueParentIds.Select(GetParentNameAsync));

        return parentNames
            .Where(parentName => parentName.HasValue)
            .Select(parentName => parentName!.Value)
            .ToDictionary(parentName => parentName.Key, parentName => parentName.Value);
    }

    private static async Task<string> SendGoogleGetAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUrl,
        string errorTitle,
        CancellationToken cancellationToken)
    {
        const int maxAttempts = 3;

        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

            var response = await httpClientFactory
                .CreateClient()
                .SendAsync(request, cancellationToken);
            var payload = await response.Content.ReadAsStringAsync(cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                return payload;
            }

            if (attempt < maxAttempts && IsGoogleRateLimitedResponse(response.StatusCode, payload))
            {
                await Task.Delay(TimeSpan.FromMilliseconds(350 * attempt), cancellationToken);
                continue;
            }

            throw new GoogleApiRequestException(errorTitle, payload, (int)response.StatusCode);
        }

        throw new GoogleApiRequestException(
            errorTitle,
            "Google request failed after retrying.",
            StatusCodes.Status503ServiceUnavailable);
    }

    private static async Task<string> SendGooglePostAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUrl,
        object body,
        string errorTitle,
        CancellationToken cancellationToken)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, requestUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Content = JsonContent.Create(body);

        var response = await httpClientFactory
            .CreateClient()
            .SendAsync(request, cancellationToken);
        var payload = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new GoogleApiRequestException(errorTitle, payload, (int)response.StatusCode);
        }

        return payload;
    }

    private static async Task<byte[]> SendGoogleBytesAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUrl,
        string errorTitle,
        CancellationToken cancellationToken)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        var response = await httpClientFactory
            .CreateClient()
            .SendAsync(request, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var payload = await response.Content.ReadAsStringAsync(cancellationToken);

            throw new GoogleApiRequestException(errorTitle, payload, (int)response.StatusCode);
        }

        return await response.Content.ReadAsByteArrayAsync(cancellationToken);
    }

    private static string BuildDriveFilesRequestUrl(
        string driveView,
        string? parentId,
        string? driveId,
        string? search,
        int pageSize)
    {
        var query = BuildDriveQuery(driveView, parentId, search);
        var queryParameters = new Dictionary<string, string?>
        {
            ["pageSize"] = pageSize.ToString(),
            ["orderBy"] = driveView == "recent" ? "modifiedTime desc" : "folder,name",
            ["q"] = query,
            ["supportsAllDrives"] = "true",
            ["fields"] = DriveFileFields,
        };

        if (driveView == "shared-drive")
        {
            queryParameters["corpora"] = "drive";
            queryParameters["driveId"] = driveId;
            queryParameters["includeItemsFromAllDrives"] = "true";
        }
        else if (driveView is "shared-with-me" or "recent")
        {
            queryParameters["corpora"] = "allDrives";
            queryParameters["includeItemsFromAllDrives"] = "true";
        }
        else
        {
            queryParameters["corpora"] = "user";
        }

        return QueryHelpers.AddQueryString(
            "https://www.googleapis.com/drive/v3/files",
            queryParameters);
    }

    private static string CreateDriveBrowserCacheKey(
        string userCachePrefix,
        string driveView,
        string? folderId,
        string? driveId,
        string? search,
        int pageSize)
    {
        return string.Join(
            ':',
            userCachePrefix,
            "drive",
            driveView,
            folderId ?? "root",
            driveId ?? "none",
            search?.Trim() ?? "none",
            pageSize);
    }

    private static string SanitizeFileName(string fileName)
    {
        var safeName = string.Join(
            "_",
            fileName.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));

        return string.IsNullOrWhiteSpace(safeName) ? "download" : safeName;
    }

    private static string SanitizeZipPathSegment(string pathSegment)
    {
        return SanitizeFileName(pathSegment)
            .Replace("/", "_", StringComparison.Ordinal)
            .Replace("\\", "_", StringComparison.Ordinal);
    }

    private static string EnsureFileExtension(string fileName, string extension)
    {
        var safeName = SanitizeFileName(fileName);

        return safeName.EndsWith(extension, StringComparison.OrdinalIgnoreCase)
            ? safeName
            : $"{safeName}{extension}";
    }

    private static string GetUserCachePrefix(ClaimsPrincipal user)
    {
        return user.FindFirstValue(ClaimTypes.NameIdentifier) ??
               user.FindFirstValue(ClaimTypes.Email) ??
               "anonymous";
    }

    private static string EscapeDriveQueryValue(string value)
    {
        return value.Trim().Replace("\\", "\\\\", StringComparison.Ordinal).Replace("'", "\\'", StringComparison.Ordinal);
    }

    private static string NormalizeDriveView(string? view)
    {
        return view switch
        {
            "shared-drive" => "shared-drive",
            "shared-with-me" => "shared-with-me",
            "recent" => "recent",
            _ => "my-drive",
        };
    }

    private static string? GetParentId(string driveView, string? folderId, string? driveId)
    {
        if (!string.IsNullOrWhiteSpace(folderId))
        {
            return folderId;
        }

        return driveView == "shared-drive" ? driveId : null;
    }

    private static string BuildDriveQuery(string driveView, string? parentId, string? search)
    {
        var query = driveView switch
        {
            "my-drive" => $"'{(parentId ?? "root")}' in parents and trashed = false",
            "shared-drive" when !string.IsNullOrWhiteSpace(parentId) => $"'{parentId}' in parents and trashed = false",
            "shared-with-me" when !string.IsNullOrWhiteSpace(parentId) => $"'{parentId}' in parents and trashed = false",
            "shared-with-me" => "sharedWithMe = true and trashed = false",
            "recent" => "trashed = false",
            _ => "trashed = false",
        };

        if (!string.IsNullOrWhiteSpace(search))
        {
            query += $" and name contains '{EscapeDriveQueryValue(search)}'";
        }

        return query;
    }

    private static string? GetJsonString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) &&
               property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
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

    private static DateTimeOffset? GetJsonDateTimeOffset(JsonElement element, string propertyName)
    {
        var value = GetJsonString(element, propertyName);

        return DateTimeOffset.TryParse(value, out var parsed) ? parsed : null;
    }

    private static long? GetJsonLong(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        return property.ValueKind switch
        {
            JsonValueKind.Number when property.TryGetInt64(out var number) => number,
            JsonValueKind.String when long.TryParse(property.GetString(), out var number) => number,
            _ => null,
        };
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
            _ => null,
        };
    }

    public sealed class GmailScheduledSendWorker(
        IServiceScopeFactory scopeFactory,
        ILogger<GmailScheduledSendWorker> logger) : BackgroundService
    {
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await SendDueMessagesAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception exception)
                {
                    logger.LogWarning(exception, "Scheduled Gmail send worker failed while checking due messages.");
                }

                await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);
            }
        }

        private async Task SendDueMessagesAsync(CancellationToken cancellationToken)
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IncosWorkspaceDbContext>();
            var httpClientFactory = scope.ServiceProvider.GetRequiredService<IHttpClientFactory>();
            var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
            var now = DateTimeOffset.UtcNow;
            var staleSendingCutoff = now.AddMinutes(-10);

            await EnsureScheduledGmailMessagesTableAsync(db, cancellationToken);

            var staleSendingMessages = await db.ScheduledGmailMessages
                .Where(message => message.Status == ScheduledGmailStatusSending &&
                                  message.LastAttemptAt < staleSendingCutoff)
                .ToArrayAsync(cancellationToken);

            foreach (var staleMessage in staleSendingMessages)
            {
                staleMessage.Status = ScheduledGmailStatusPending;
                staleMessage.UpdatedAt = now;
            }

            if (staleSendingMessages.Length > 0)
            {
                await db.SaveChangesAsync(cancellationToken);
            }

            var dueMessages = await db.ScheduledGmailMessages
                .Where(message => message.Status == ScheduledGmailStatusPending &&
                                  message.ScheduledFor <= now)
                .OrderBy(message => message.ScheduledFor)
                .Take(10)
                .ToArrayAsync(cancellationToken);

            foreach (var message in dueMessages)
            {
                await TrySendScheduledGmailMessageAsync(
                    message,
                    db,
                    httpClientFactory,
                    configuration,
                    cancellationToken);
            }
        }
    }

    private sealed class GoogleApiRequestException(string title, string detail, int statusCode) : Exception(title)
    {
        public string Title { get; } = title;
        public string Detail { get; } = detail;
        public int StatusCode { get; } = statusCode;
    }

    private sealed record GoogleDriveExportFormat(string MimeType, string Extension);

    private sealed record GoogleTokenRefreshResult(
        string AccessToken,
        long ExpiresIn,
        string? RefreshToken,
        string? Scope);

    private sealed record DriveDownloadPayload(byte[] Content, string ContentType, string FileName);

    private sealed class FolderDownloadState
    {
        public int FileCount { get; set; }
        public long TotalBytes { get; set; }
    }
}
