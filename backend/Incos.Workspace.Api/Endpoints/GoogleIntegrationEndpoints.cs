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
using System.Security.Cryptography;
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
    private const int SearchCacheKeyMaxLength = 96;
    private const string AcademyAccountDomain = "academy.local";
    private const int ChatSpaceLoadConcurrency = 6;
    private const int ChatMemberProfileLookupLimit = 10;
    private const int ChatDirectoryProfileQueryLimit = 8;
    private const int ChatDirectoryProfileFallbackLimit = 4;
    private const int ChatAttachmentMetadataLimit = 10;
    private const int ChatAttachmentPreviewMaxBytes = 25 * 1024 * 1024;
    private const string LegacyAcademyUsersGroupName = "Academy Users";
    private const string LegacyAcademyUsersGroupDescription = "Academy-only users created from the ID/password signup flow.";
    private const string MainAdminGroupName = "Main Admin";
    private const string MainAdminEmail = "sj@incos.co.kr";
    private static readonly HashSet<string> AdminGroupPermissionKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "academy-view-courses",
        "academy-manage-courses",
        "academy-view-people",
        "academy-message-people",
        "academy-manage-inbox",
        "academy-manage-settings",
        "workspace-view-dashboard",
        "workspace-manage-calendar",
        "workspace-manage-files",
        "workspace-manage-email",
        "workspace-manage-chat",
        "admin-manage-users",
        "admin-manage-groups",
        "admin-manage-permissions",
        "admin-view-audit-logs",
        "admin-manage-workspace-mode",
        "admin-manage-billing",
        "admin-manage-products",
        "manage-users",
        "manage-groups",
        "manage-permissions",
        "view-audit-logs",
        "manage-billing",
        "manage-products",
    };
    private static readonly HashSet<string> AdminGroupSettingKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "academy-settings",
        "workspace-settings",
        "admin-general-settings",
        "admin-permissions-settings",
        "admin-audit-logs-settings",
        "admin-workspace-mode-settings",
        "general-settings",
        "workspace-mode",
        "integrations",
        "security",
        "notifications",
    };
    private static readonly HashSet<string> AdminGroupAccessKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "academy",
        "academy-dashboard",
        "academy-courses",
        "academy-grades",
        "academy-inbox",
        "academy-people",
        "academy-outlook",
        "academy-settings-page",
        "workspace",
        "workspace-dashboard",
        "workspace-project",
        "workspace-calendar",
        "workspace-board",
        "workspace-timeline",
        "workspace-issues",
        "workspace-bugs",
        "workspace-features",
        "workspace-customers",
        "workspace-colleagues",
        "workspace-categories",
        "workspace-drive",
        "workspace-email",
        "workspace-chat",
        "workspace-toptrack",
        "workspace-links",
        "workspace-settings",
        "admin-console",
        "admin-dashboard",
        "admin-users",
        "admin-groups",
        "admin-customers",
        "admin-licenses",
        "admin-products",
        "admin-invoices",
        "admin-settings-general",
        "admin-permissions",
        "admin-audit-logs",
        "admin-workspace-mode",
        "api",
        "dashboard",
        "customers",
        "licenses",
        "products",
        "invoices",
    };
    private static readonly TimeSpan ChatProfileCacheDuration = TimeSpan.FromHours(8);
    private static readonly TimeSpan ChatProfileMissCacheDuration = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan ChatPeopleQuotaCooldown = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan ChatAttachmentMetadataCacheDuration = TimeSpan.FromMinutes(30);
    private const string ChatMessageFields =
        "messages(name,text,argumentText,formattedText,createTime,sender(name,displayName,email,type),attachment(name,contentName,contentType,thumbnailUri,downloadUri,source,attachmentDataRef(resourceName),driveDataRef(driveFileId))),nextPageToken";
    private const string ChatMessageFieldsWithAvatar =
        "messages(name,text,argumentText,formattedText,createTime,sender(name,displayName,email,type,avatarUrl),attachment(name,contentName,contentType,thumbnailUri,downloadUri,source,attachmentDataRef(resourceName),driveDataRef(driveFileId))),nextPageToken";

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

        google.AddEndpointFilter(async (context, next) =>
        {
            var httpContext = context.HttpContext;

            if (IsGoogleIntegrationStatusRequest(httpContext) ||
                IsGoogleIntegrationConnectRequest(httpContext) ||
                await CanUseGoogleApiDataAsync(
                    httpContext.User,
                    httpContext.RequestServices.GetRequiredService<IConfiguration>(),
                    httpContext.RequestServices.GetRequiredService<IncosWorkspaceDbContext>(),
                    httpContext.RequestAborted))
            {
                return await next(context);
            }

            return Results.Problem(
                title: "Google API access is disabled.",
                detail: "Google API access is not enabled for your account. Ask an administrator to enable API access in Admin Console.",
                statusCode: StatusCodes.Status403Forbidden);
        });

        google.MapGet("/integrations", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                IncosWorkspaceDbContext db) =>
            {
                if (!await CanUseGoogleApiDataAsync(context.User, configuration, db, context.RequestAborted))
                {
                    return Results.Ok(new[]
                    {
                        CreateDisabledStatus("google_calendar", "Google Calendar"),
                        CreateDisabledStatus("google_drive", "Google Drive"),
                        CreateDisabledStatus("gmail", "Gmail"),
                        CreateDisabledStatus("google_chat", "Google Chat"),
                    });
                }

                var isConfigured =
                    !string.IsNullOrWhiteSpace(configuration["Authentication:Google:ClientId"]) &&
                    !string.IsNullOrWhiteSpace(configuration["Authentication:Google:ClientSecret"]);
                var grantedScopes = GetGrantedScopes(context.User);
                var accessToken = await GetGoogleAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    context.RequestAborted);
                var storedToken = await GetStoredGoogleOAuthTokenAsync(db, context.User, context.RequestAborted);

                if (!string.IsNullOrWhiteSpace(accessToken))
                {
                    var tokenScopes = await GetGoogleAccessTokenScopesAsync(
                            httpClientFactory,
                            accessToken,
                            context.RequestAborted);

                    if (tokenScopes.Count > 0)
                    {
                        grantedScopes = tokenScopes;
                    }
                }

                if (grantedScopes.Count == 0)
                {
                    AddGrantedScopes(grantedScopes, await context.GetTokenAsync("scope"));
                    AddGrantedScopes(grantedScopes, storedToken?.Scope);
                }

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

        google.MapGet("/integrations/{provider}/connect", async (
                HttpContext context,
                string provider,
                IConfiguration configuration,
                IncosWorkspaceDbContext db,
                CancellationToken cancellationToken) =>
            {
                var returnUrl = provider switch
                {
                    "gmail" => "/?mode=project&item=email",
                    "google_chat" => "/?mode=project&item=chat",
                    "google_drive" => "/?integration=google_drive",
                    _ => "/",
                };

                if (context.User.Identity?.IsAuthenticated == true &&
                    !await CanUseGoogleApiDataAsync(context.User, configuration, db, cancellationToken))
                {
                    return Results.Redirect(QueryHelpers.AddQueryString(
                        returnUrl,
                        "authError",
                        "Google API access is not enabled for your account. Ask an administrator to enable API access in Admin Console."));
                }

                if (context.User.Identity?.IsAuthenticated == true)
                {
                    await DeleteStoredGoogleOAuthTokenAsync(db, context.User, cancellationToken);
                }

                var redirectUrl =
                    $"/api/auth/google/workspace/login?returnUrl={Uri.EscapeDataString(returnUrl)}&forceConsent=true&forceLogin=true";

                return Results.Redirect(redirectUrl);
            })
            .AllowAnonymous()
            .WithName("ConnectGoogleIntegration");

        var admin = app.MapGroup("/api/admin")
            .RequireAuthorization();

        admin.MapGet("/users", async (
                HttpContext context,
                IncosWorkspaceDbContext db,
                IConfiguration configuration,
                CancellationToken cancellationToken) =>
            {
                await EnsureAdminUsersTableAsync(db, cancellationToken);
                await EnsureAdminUsersFromKnownLoginsAsync(db, context.User, configuration, cancellationToken);

                var users = await GetAdminUserDtosAsync(db, cancellationToken);

                return Results.Ok(new AdminUsersResponseDto(users, null, null));
            })
            .WithName("GetAdminUsers");

        admin.MapGet("/users/{userId:guid}", async (
                Guid userId,
                IncosWorkspaceDbContext db,
                CancellationToken cancellationToken) =>
            {
                await EnsureAdminUsersTableAsync(db, cancellationToken);
                await EnsureAdminGroupsTableAsync(db, cancellationToken);
                await AuthEndpoints.EnsureAcademyCredentialAccountsTableAsync(db, cancellationToken);

                var detail = await GetAdminUserDetailDtoAsync(db, userId, cancellationToken);

                return detail is null ? Results.NotFound() : Results.Ok(detail);
            })
            .WithName("GetAdminUserDetail");

        admin.MapPatch("/users/{userId:guid}", async (
                Guid userId,
                UpdateAdminUserRequest request,
                IncosWorkspaceDbContext db,
                CancellationToken cancellationToken) =>
            {
                await EnsureAdminUsersTableAsync(db, cancellationToken);
                await AuthEndpoints.EnsureAcademyCredentialAccountsTableAsync(db, cancellationToken);

                var user = await db.AdminUsers
                    .FirstOrDefaultAsync(adminUser => adminUser.Id == userId, cancellationToken);

                if (user is null)
                {
                    return Results.NotFound();
                }

                var now = DateTimeOffset.UtcNow;
                var oldEmail = user.Email;
                var nextStatus = NormalizeAdminUserStatus(request.Status);
                var academyAccount = await db.AcademyCredentialAccounts
                    .FirstOrDefaultAsync(account => account.AdminUserId == user.Id, cancellationToken);

                if (request.DisplayName is not null)
                {
                    var nextDisplayName = request.DisplayName.Trim();

                    if (string.IsNullOrWhiteSpace(nextDisplayName) || nextDisplayName.Length > 160)
                    {
                        return Results.ValidationProblem(new Dictionary<string, string[]>
                        {
                            ["displayName"] = ["Display name is required and must be 160 characters or less."],
                        });
                    }

                    user.DisplayName = nextDisplayName;
                }

                if (request.PhotoUrl is not null)
                {
                    user.PhotoUrl = NormalizeOptionalText(request.PhotoUrl);
                }

                if (request.Role is not null)
                {
                    user.Role = NormalizeAdminUserRole(request.Role, academyAccount is not null);
                }

                if (request.LoginId is not null)
                {
                    if (academyAccount is null)
                    {
                        return Results.Problem(
                            title: "ID cannot be changed.",
                            detail: "Only Academy credential users have a local login ID.",
                            statusCode: StatusCodes.Status409Conflict);
                    }

                    var nextLoginId = AuthEndpoints.NormalizeAcademyLoginId(request.LoginId);

                    if (!AuthEndpoints.IsValidAcademyLoginId(nextLoginId))
                    {
                        return Results.ValidationProblem(new Dictionary<string, string[]>
                        {
                            ["loginId"] = ["Use 3-64 lowercase letters, numbers, dot, hyphen, or underscore. Start with a letter or number."],
                        });
                    }

                    if (!string.Equals(nextLoginId, academyAccount.LoginId, StringComparison.OrdinalIgnoreCase))
                    {
                        var duplicateExists = await db.AcademyCredentialAccounts
                                .AnyAsync(
                                    account => account.Id != academyAccount.Id && account.LoginId == nextLoginId,
                                    cancellationToken) ||
                            await db.AdminUsers
                                .AnyAsync(
                                    adminUser => adminUser.Id != user.Id &&
                                        adminUser.Email == AuthEndpoints.GetAcademyAccountKey(nextLoginId),
                                    cancellationToken);

                        if (duplicateExists)
                        {
                            return Results.Problem(
                                title: "ID is already used.",
                                detail: "Choose a different Academy ID.",
                                statusCode: StatusCodes.Status409Conflict);
                        }

                        academyAccount.LoginId = nextLoginId;
                        academyAccount.UpdatedAt = now;
                        user.Email = AuthEndpoints.GetAcademyAccountKey(nextLoginId);
                        user.HostedDomain = "academy.local";
                    }
                }

                if (request.ContactEmail is not null)
                {
                    if (academyAccount is null)
                    {
                        return Results.Problem(
                            title: "Contact email cannot be changed.",
                            detail: "Google Workspace email is managed by Google.",
                            statusCode: StatusCodes.Status409Conflict);
                    }

                    var nextContactEmail = AuthEndpoints.NormalizeContactEmail(request.ContactEmail);

                    if (!string.IsNullOrWhiteSpace(nextContactEmail))
                    {
                        if (!AuthEndpoints.IsValidContactEmail(nextContactEmail))
                        {
                            return Results.ValidationProblem(new Dictionary<string, string[]>
                            {
                                ["contactEmail"] = ["Enter a valid email address."],
                            });
                        }

                        var duplicateEmailExists = await db.AdminUsers
                            .AsNoTracking()
                            .AnyAsync(
                                adminUser => adminUser.Id != user.Id &&
                                    (adminUser.Email == nextContactEmail || adminUser.ContactEmail == nextContactEmail),
                                cancellationToken);

                        if (duplicateEmailExists)
                        {
                            return Results.Problem(
                                title: "Email is already used.",
                                detail: "Choose a different email address.",
                                statusCode: StatusCodes.Status409Conflict);
                        }
                    }

                    user.ContactEmail = nextContactEmail;
                }

                if (!string.IsNullOrWhiteSpace(request.Password))
                {
                    if (academyAccount is null)
                    {
                        return Results.Problem(
                            title: "Password cannot be changed.",
                            detail: "Google Workspace passwords are managed by Google.",
                            statusCode: StatusCodes.Status409Conflict);
                    }

                    if (request.Password.Length < 8 || request.Password.Length > 256)
                    {
                        return Results.ValidationProblem(new Dictionary<string, string[]>
                        {
                            ["password"] = ["Use a password between 8 and 256 characters."],
                        });
                    }

                    academyAccount.PasswordHash = AuthEndpoints.HashPassword(request.Password);
                    academyAccount.UpdatedAt = now;
                    user.SessionRevokedAt = now;
                }

                if (!string.IsNullOrWhiteSpace(nextStatus))
                {
                    if (string.Equals(user.Email, MainAdminEmail, StringComparison.OrdinalIgnoreCase) &&
                        nextStatus == "inactive")
                    {
                        return Results.Problem(
                            title: "Main Admin cannot be deactivated.",
                            detail: "Keep sj@incos.co.kr active so the Admin Console remains recoverable.",
                            statusCode: StatusCodes.Status409Conflict);
                    }

                    user.Status = nextStatus;

                    if (nextStatus == "inactive")
                    {
                        user.ApiAccessEnabled = false;

                        await EnsureGoogleOAuthTokensTableAsync(db, cancellationToken);
                        await db.GoogleOAuthTokens
                            .Where(token => token.UserKey == user.Email || token.Email == user.Email)
                            .ExecuteDeleteAsync(cancellationToken);
                    }
                    else if (nextStatus == "pending")
                    {
                        user.ApiAccessEnabled = false;
                    }
                }

                if (request.ApiAccessEnabled.HasValue)
                {
                    user.ApiAccessEnabled = request.ApiAccessEnabled.Value &&
                        user.Status == "active" &&
                        !user.IsDirectorySuspended;
                }
                else if (user.Status != "active" || user.IsDirectorySuspended)
                {
                    user.ApiAccessEnabled = false;
                }

                if (string.Equals(user.Email, MainAdminEmail, StringComparison.OrdinalIgnoreCase))
                {
                    user.Status = "active";
                    user.ApiAccessEnabled = true;
                }

                user.UpdatedAt = now;
                await db.SaveChangesAsync(cancellationToken);

                if (!string.Equals(oldEmail, user.Email, StringComparison.OrdinalIgnoreCase))
                {
                    await MoveAdminUserKeyAsync(db, oldEmail, user.Email, cancellationToken);
                }

                return Results.Ok(ToAdminUserDto(user));
            })
            .WithName("UpdateAdminUserAccess");

        admin.MapPost("/users/{userId:guid}/sign-out", async (
                Guid userId,
                IncosWorkspaceDbContext db,
                CancellationToken cancellationToken) =>
            {
                await EnsureAdminUsersTableAsync(db, cancellationToken);

                var user = await db.AdminUsers
                    .FirstOrDefaultAsync(adminUser => adminUser.Id == userId, cancellationToken);

                if (user is null)
                {
                    return Results.NotFound();
                }

                var now = DateTimeOffset.UtcNow;
                user.SessionRevokedAt = now;
                user.UpdatedAt = now;

                await EnsureGoogleOAuthTokensTableAsync(db, cancellationToken);
                await db.GoogleOAuthTokens
                    .Where(token => token.UserKey == user.Email || token.Email == user.Email)
                    .ExecuteDeleteAsync(cancellationToken);
                await db.SaveChangesAsync(cancellationToken);

                return Results.Ok(ToAdminUserDto(user));
            })
            .WithName("SignOutAdminUserNow");

        admin.MapGet("/groups", async (
                HttpContext context,
                IncosWorkspaceDbContext db,
                CancellationToken cancellationToken) =>
            {
                await EnsureAdminGroupsTableAsync(db, cancellationToken);
                await EnsureDefaultAdminGroupAsync(db, cancellationToken);
                await RemoveLegacyAcademyUsersGroupAsync(db, cancellationToken);

                var canViewProtectedGroups = await CanViewMainAdminGroupAsync(db, context.User, cancellationToken);
                var groups = await GetAdminGroupDtosAsync(db, canViewProtectedGroups, cancellationToken);

                return Results.Ok(new AdminGroupsResponseDto(groups));
            })
            .WithName("GetAdminGroups");

        admin.MapPost("/groups", async (
                UpsertAdminGroupRequest request,
                IncosWorkspaceDbContext db,
                CancellationToken cancellationToken) =>
            {
                await EnsureAdminGroupsTableAsync(db, cancellationToken);

                var name = request.Name?.Trim();

                if (string.IsNullOrWhiteSpace(name))
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["name"] = ["Group name is required."],
                    });
                }

                var nameExists = await db.AdminGroups
                    .AnyAsync(group => group.Name.ToLower() == name.ToLower(), cancellationToken);

                if (nameExists)
                {
                    return Results.Problem(
                        title: "Group already exists.",
                        detail: "Choose a different group name.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                var nextPermissions = NormalizeAdminGroupValues(request.Permissions, AdminGroupPermissionKeys);
                var nextSettings = NormalizeAdminGroupValues(request.Settings, AdminGroupSettingKeys);
                var nextAccess = NormalizeAdminGroupValues(request.Access, AdminGroupAccessKeys);
                var memberIds = (request.MemberIds ?? []).Distinct().ToArray();
                var academyCompatibilityError = await ValidateAcademyGroupGrantCompatibilityAsync(
                    db,
                    memberIds,
                    nextPermissions,
                    nextSettings,
                    nextAccess,
                    cancellationToken);

                if (academyCompatibilityError is not null)
                {
                    return Results.Problem(
                        title: "Academy group assignment is invalid.",
                        detail: academyCompatibilityError,
                        statusCode: StatusCodes.Status400BadRequest);
                }

                var now = DateTimeOffset.UtcNow;
                var group = new AdminGroup
                {
                    Id = Guid.NewGuid(),
                    CreatedAt = now,
                    UpdatedAt = now,
                    Name = name,
                    Description = NormalizeOptionalText(request.Description),
                    PhotoUrl = NormalizeOptionalText(request.PhotoUrl),
                    Status = NormalizeAdminGroupStatus(request.Status),
                    PermissionJson = JsonSerializer.Serialize(nextPermissions),
                    SettingJson = JsonSerializer.Serialize(nextSettings),
                    AccessJson = JsonSerializer.Serialize(nextAccess),
                };

                db.AdminGroups.Add(group);
                await ApplyAdminGroupMembersAsync(db, group, memberIds, false, cancellationToken);
                await db.SaveChangesAsync(cancellationToken);

                var createdGroup = await GetAdminGroupDtoAsync(db, group.Id, cancellationToken);

                return Results.Created($"/api/admin/groups/{group.Id}", createdGroup);
            })
            .WithName("CreateAdminGroup");

        admin.MapPatch("/groups/{groupId:guid}", async (
                Guid groupId,
                UpsertAdminGroupRequest request,
                HttpContext context,
                IncosWorkspaceDbContext db,
                CancellationToken cancellationToken) =>
            {
                await EnsureAdminGroupsTableAsync(db, cancellationToken);

                var group = await db.AdminGroups
                    .FirstOrDefaultAsync(adminGroup => adminGroup.Id == groupId, cancellationToken);

                if (group is null)
                {
                    return Results.NotFound();
                }

                var isProtectedGroup = IsProtectedAdminGroup(group);

                if (isProtectedGroup &&
                    !await CanViewMainAdminGroupAsync(db, context.User, cancellationToken))
                {
                    return Results.NotFound();
                }

                var nextName = request.Name?.Trim();

                if (nextName is not null && !isProtectedGroup)
                {
                    if (string.IsNullOrWhiteSpace(nextName))
                    {
                        return Results.ValidationProblem(new Dictionary<string, string[]>
                        {
                            ["name"] = ["Group name is required."],
                        });
                    }

                    var nameExists = await db.AdminGroups
                        .AnyAsync(adminGroup =>
                            adminGroup.Id != groupId &&
                            adminGroup.Name.ToLower() == nextName.ToLower(),
                            cancellationToken);

                    if (nameExists)
                    {
                        return Results.Problem(
                            title: "Group already exists.",
                            detail: "Choose a different group name.",
                            statusCode: StatusCodes.Status409Conflict);
                    }

                    group.Name = nextName;
                }

                if (request.Description is not null)
                {
                    group.Description = NormalizeOptionalText(request.Description);
                }

                if (request.PhotoUrl is not null)
                {
                    group.PhotoUrl = NormalizeOptionalText(request.PhotoUrl);
                }

                if (request.Status is not null)
                {
                    group.Status = isProtectedGroup
                        ? "active"
                        : NormalizeAdminGroupStatus(request.Status);
                }

                var nextPermissions = isProtectedGroup
                    ? NormalizeAdminGroupValues(AdminGroupPermissionKeys, AdminGroupPermissionKeys)
                    : request.Permissions is not null
                        ? NormalizeAdminGroupValues(request.Permissions, AdminGroupPermissionKeys)
                        : ParseAdminGroupValues(group.PermissionJson, AdminGroupPermissionKeys);
                var nextSettings = isProtectedGroup
                    ? NormalizeAdminGroupValues(AdminGroupSettingKeys, AdminGroupSettingKeys)
                    : request.Settings is not null
                        ? NormalizeAdminGroupValues(request.Settings, AdminGroupSettingKeys)
                        : ParseAdminGroupValues(group.SettingJson, AdminGroupSettingKeys);
                var nextAccess = isProtectedGroup
                    ? NormalizeAdminGroupValues(AdminGroupAccessKeys, AdminGroupAccessKeys)
                    : request.Access is not null
                        ? NormalizeAdminGroupValues(request.Access, AdminGroupAccessKeys)
                        : ParseAdminGroupValues(group.AccessJson, AdminGroupAccessKeys);
                var memberIds = isProtectedGroup || request.MemberIds is not null
                    ? (request.MemberIds ?? []).Distinct().ToArray()
                    : await db.AdminGroupMembers
                        .Where(member => member.AdminGroupId == group.Id)
                        .Select(member => member.AdminUserId)
                        .ToArrayAsync(cancellationToken);

                if (isProtectedGroup)
                {
                    var mainAdminId = await db.AdminUsers
                        .Where(user => user.Email == MainAdminEmail)
                        .Select(user => user.Id)
                        .FirstOrDefaultAsync(cancellationToken);

                    if (mainAdminId != Guid.Empty)
                    {
                        memberIds = memberIds.Append(mainAdminId).Distinct().ToArray();
                    }
                }

                if (!isProtectedGroup)
                {
                    var academyCompatibilityError = await ValidateAcademyGroupGrantCompatibilityAsync(
                        db,
                        memberIds,
                        nextPermissions,
                        nextSettings,
                        nextAccess,
                        cancellationToken);

                    if (academyCompatibilityError is not null)
                    {
                        return Results.Problem(
                            title: "Academy group assignment is invalid.",
                            detail: academyCompatibilityError,
                            statusCode: StatusCodes.Status400BadRequest);
                    }
                }

                if (request.Permissions is not null)
                {
                    group.PermissionJson = JsonSerializer.Serialize(nextPermissions);
                }

                if (request.Settings is not null)
                {
                    group.SettingJson = JsonSerializer.Serialize(nextSettings);
                }

                if (request.Access is not null)
                {
                    group.AccessJson = JsonSerializer.Serialize(nextAccess);
                }

                if (isProtectedGroup)
                {
                    group.Name = MainAdminGroupName;
                    group.Status = "active";
                    group.PermissionJson = JsonSerializer.Serialize(nextPermissions);
                    group.SettingJson = JsonSerializer.Serialize(nextSettings);
                    group.AccessJson = JsonSerializer.Serialize(nextAccess);
                }

                if (request.MemberIds is not null || isProtectedGroup)
                {
                    await ApplyAdminGroupMembersAsync(
                        db,
                        group,
                        memberIds,
                        isProtectedGroup,
                        cancellationToken);
                }

                group.UpdatedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(cancellationToken);

                var updatedGroup = await GetAdminGroupDtoAsync(db, group.Id, cancellationToken);

                return updatedGroup is null ? Results.NotFound() : Results.Ok(updatedGroup);
            })
            .WithName("UpdateAdminGroup");

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
                        return CreateGoogleApiProblem(exception);
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
                    return CreateGoogleApiProblem(exception);
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
                    return CreateGoogleApiProblem(exception);
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
                    return CreateGoogleApiProblem(exception);
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
                    return CreateGoogleApiProblem(exception);
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
                    return CreateGoogleApiProblem(exception);
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
                    return CreateGoogleApiProblem(exception);
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
                    return CreateGoogleApiProblem(exception);
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
                    return CreateGoogleApiProblem(exception);
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

                var tokenScopes = await GetGoogleAccessTokenScopesAsync(
                    httpClientFactory,
                    accessToken,
                    cancellationToken);
                var missingChatScopes = tokenScopes.Count > 0
                    ? GoogleWorkspaceScopes.Chat
                        .Where(scope => !tokenScopes.Contains(scope))
                        .ToArray()
                    : [];

                if (missingChatScopes.Length > 0)
                {
                    return Results.Problem(
                        title: "Google Chat needs profile permission.",
                        detail: "Reconnect Google Chat so sender names and Workspace profile photos can be resolved.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                var userCachePrefix = GetUserCachePrefix(context.User);
                var currentUserKey = GetCurrentUserKey(context.User);
                var profileResolutionCacheKey = $"{userCachePrefix}:chat:profile-resolution";
                var profileResolution = await cache.GetOrCreateAsync(
                        profileResolutionCacheKey,
                        async entry =>
                        {
                            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);
                            return await CheckGoogleChatProfileResolutionAsync(
                                httpClientFactory,
                                accessToken,
                                tokenScopes,
                                currentUserKey,
                                cancellationToken);
                        }) ??
                    new GoogleChatProfileResolutionStatus(true, null, null);

                if (!profileResolution.Available)
                {
                    return Results.Problem(
                        title: profileResolution.Title,
                        detail: profileResolution.Detail,
                        statusCode: StatusCodes.Status409Conflict);
                }

                var safePageSize = Math.Clamp(pageSize ?? 120, 1, 250);
                var cacheKey = string.Join(
                    ':',
                    userCachePrefix,
                    "chat-v2",
                    NormalizeSearchCacheKey(search, "spaces"),
                    safePageSize);

                try
                {
                    var spaces = await cache.GetOrCreateAsync(
                            cacheKey,
                            async entry =>
                            {
                                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(2);
                                return await GetChatSpacesAsync(
                                    httpClientFactory,
                                    cache,
                                    accessToken,
                                    context.User,
                                    userCachePrefix,
                                    search,
                                    safePageSize,
                                    cancellationToken);
                            }) ??
                        [];

                    return Results.Ok(new GoogleChatSpacesDto(search, spaces));
                }
                catch (GoogleApiRequestException exception)
                {
                    return CreateGoogleApiProblem(exception);
                }
            })
            .WithName("GetGoogleChatSpaces");

        google.MapGet("/chat/avatar", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string url,
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
                        detail: "Reconnect Google Chat so profile images can be loaded.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                try
                {
                    var avatar = await GetGoogleAvatarImageAsync(
                        httpClientFactory,
                        accessToken,
                        url,
                        cancellationToken);

                    return Results.File(
                        avatar.Content,
                        avatar.ContentType,
                        enableRangeProcessing: false);
                }
                catch (GoogleApiRequestException exception)
                {
                    return CreateGoogleApiProblem(exception);
                }
            })
            .WithName("GetGoogleChatAvatar");

        google.MapGet("/chat/attachment-preview", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string url,
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
                        detail: "Reconnect Google Chat so attachment previews can be loaded.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                try
                {
                    var preview = TryParseChatMediaPreviewToken(url, out var previewRequest)
                        ? await GetGoogleChatAttachmentPreviewPayloadAsync(
                            httpClientFactory,
                            accessToken,
                            previewRequest.ResourceName,
                            previewRequest.FileName,
                            previewRequest.ContentType,
                            cancellationToken)
                        : await GetGoogleAvatarImagePayloadAsync(
                            httpClientFactory,
                            accessToken,
                            url,
                            cancellationToken);

                    return Results.File(
                        preview.Content,
                        preview.ContentType,
                        enableRangeProcessing: false);
                }
                catch (GoogleApiRequestException exception) when (exception.StatusCode is
                    StatusCodes.Status403Forbidden or
                    StatusCodes.Status404NotFound)
                {
                    return Results.NotFound();
                }
                catch (GoogleApiRequestException exception)
                {
                    return CreateGoogleApiProblem(exception);
                }
            })
            .WithName("GetGoogleChatAttachmentPreview");

        google.MapGet("/chat/attachment-content", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string resourceName,
                string? fileName,
                string? contentType,
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
                        detail: "Reconnect Google Chat so attachment previews can be loaded.",
                        statusCode: StatusCodes.Status409Conflict);
                }

                try
                {
                    var media = await GetGoogleChatAttachmentMediaAsync(
                        httpClientFactory,
                        accessToken,
                        resourceName,
                        fileName,
                        contentType,
                        cancellationToken);

                    return Results.File(
                        media.Content,
                        media.ContentType,
                        enableRangeProcessing: false);
                }
                catch (GoogleApiRequestException exception)
                {
                    return CreateGoogleApiProblem(exception);
                }
            })
            .WithName("GetGoogleChatAttachmentContent");

        return app;
    }

    private static async Task EnsureAdminUsersFromKnownLoginsAsync(
        IncosWorkspaceDbContext db,
        ClaimsPrincipal currentUser,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        await EnsureGoogleOAuthTokensTableAsync(db, cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var hostedDomain = configuration["Authentication:Google:HostedDomain"]?.Trim();
        var existingUsers = await db.AdminUsers
            .ToDictionaryAsync(user => user.Email.ToLowerInvariant(), cancellationToken);
        var hasChanges = false;

        void UpsertKnownLogin(
            string? email,
            string? displayName,
            string? photoUrl,
            string? domain,
            DateTimeOffset lastLoginAt,
            bool apiAccessEnabled)
        {
            if (string.IsNullOrWhiteSpace(email))
            {
                return;
            }

            var normalizedEmail = email.Trim().ToLowerInvariant();

            if (!string.IsNullOrWhiteSpace(hostedDomain) &&
                !normalizedEmail.EndsWith($"@{hostedDomain}", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            if (!existingUsers.TryGetValue(normalizedEmail, out var user))
            {
                user = new AdminUser
                {
                    Id = Guid.NewGuid(),
                    CreatedAt = now,
                    Email = normalizedEmail,
                    DisplayName = string.IsNullOrWhiteSpace(displayName)
                        ? CreateDisplayNameFromEmail(normalizedEmail)
                        : displayName.Trim(),
                    PhotoUrl = string.IsNullOrWhiteSpace(photoUrl) ? null : photoUrl,
                    HostedDomain = string.IsNullOrWhiteSpace(domain) ? hostedDomain : domain,
                    Status = "active",
                    ApiAccessEnabled = apiAccessEnabled,
                    LastLoginAt = lastLoginAt,
                    UpdatedAt = now,
                };
                existingUsers[normalizedEmail] = user;
                db.AdminUsers.Add(user);
                hasChanges = true;

                return;
            }

            if (string.IsNullOrWhiteSpace(user.DisplayName))
            {
                user.DisplayName = string.IsNullOrWhiteSpace(displayName)
                    ? CreateDisplayNameFromEmail(normalizedEmail)
                    : displayName.Trim();
                hasChanges = true;
            }

            if (string.IsNullOrWhiteSpace(user.PhotoUrl) && !string.IsNullOrWhiteSpace(photoUrl))
            {
                user.PhotoUrl = photoUrl;
                hasChanges = true;
            }

            if (string.IsNullOrWhiteSpace(user.HostedDomain) &&
                (!string.IsNullOrWhiteSpace(domain) || !string.IsNullOrWhiteSpace(hostedDomain)))
            {
                user.HostedDomain = string.IsNullOrWhiteSpace(domain) ? hostedDomain : domain;
                hasChanges = true;
            }

            if (!user.LastLoginAt.HasValue)
            {
                user.LastLoginAt = lastLoginAt;
                user.UpdatedAt = now;
                hasChanges = true;
            }
        }

        UpsertKnownLogin(
            currentUser.FindFirstValue(ClaimTypes.Email),
            currentUser.FindFirstValue(ClaimTypes.Name),
            currentUser.FindFirstValue("urn:google:picture"),
            hostedDomain,
            now,
            true);

        var tokenUsers = await db.GoogleOAuthTokens
            .AsNoTracking()
            .Select(token => new
            {
                token.Email,
                token.UserKey,
                token.CreatedAt,
                token.UpdatedAt,
            })
            .ToArrayAsync(cancellationToken);

        foreach (var tokenUser in tokenUsers)
        {
            var email = !string.IsNullOrWhiteSpace(tokenUser.Email)
                ? tokenUser.Email
                : tokenUser.UserKey.Contains('@', StringComparison.Ordinal) ? tokenUser.UserKey : null;
            var lastLoginAt = tokenUser.UpdatedAt == default ? tokenUser.CreatedAt : tokenUser.UpdatedAt;

            UpsertKnownLogin(email, null, null, hostedDomain, lastLoginAt, true);
        }

        if (hasChanges)
        {
            await db.SaveChangesAsync(cancellationToken);
        }
    }

    public static async Task<string> RecordGoogleWorkspaceLoginAsync(
        IncosWorkspaceDbContext db,
        string email,
        string? displayName,
        string? hostedDomain,
        string? photoUrl,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return "active";
        }

        await EnsureAdminUsersTableAsync(db, cancellationToken);

        var normalizedEmail = email.Trim().ToLowerInvariant();
        var now = DateTimeOffset.UtcNow;
        var user = await db.AdminUsers
            .FirstOrDefaultAsync(adminUser => adminUser.Email == normalizedEmail, cancellationToken);

        if (user is null)
        {
            user = new AdminUser
            {
                Id = Guid.NewGuid(),
                CreatedAt = now,
                Email = normalizedEmail,
                Status = string.Equals(normalizedEmail, MainAdminEmail, StringComparison.OrdinalIgnoreCase)
                    ? "active"
                    : "pending",
            };
            db.AdminUsers.Add(user);
        }

        if (string.Equals(normalizedEmail, MainAdminEmail, StringComparison.OrdinalIgnoreCase))
        {
            user.Status = "active";
            user.ApiAccessEnabled = true;
        }

        if (user.Status == "inactive" || user.IsDirectorySuspended)
        {
            return "inactive";
        }

        user.DisplayName = string.IsNullOrWhiteSpace(displayName)
            ? CreateDisplayNameFromEmail(normalizedEmail)
            : displayName.Trim();
        user.PhotoUrl = string.IsNullOrWhiteSpace(photoUrl) ? user.PhotoUrl : photoUrl;
        user.HostedDomain = string.IsNullOrWhiteSpace(hostedDomain) ? user.HostedDomain : hostedDomain;
        user.LastLoginAt = now;
        if (!string.Equals(user.Status, "active", StringComparison.OrdinalIgnoreCase))
        {
            user.ApiAccessEnabled = false;
        }
        user.UpdatedAt = now;

        await db.SaveChangesAsync(cancellationToken);

        return NormalizeAdminUserStatus(user.Status) ?? "pending";
    }

    private static async Task<DateTimeOffset> SyncAdminUsersFromGoogleDirectoryAsync(
        IncosWorkspaceDbContext db,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        string accessToken,
        CancellationToken cancellationToken)
    {
        var hostedDomain = configuration["Authentication:Google:HostedDomain"]?.Trim();
        var users = await GetGoogleDirectoryUsersAsync(
            httpClientFactory,
            accessToken,
            hostedDomain,
            cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var existingUsers = await db.AdminUsers
            .ToDictionaryAsync(user => user.Email.ToLowerInvariant(), cancellationToken);

        foreach (var directoryUser in users)
        {
            var normalizedEmail = directoryUser.Email.Trim().ToLowerInvariant();

            if (string.IsNullOrWhiteSpace(normalizedEmail))
            {
                continue;
            }

            if (!string.IsNullOrWhiteSpace(hostedDomain) &&
                !normalizedEmail.EndsWith($"@{hostedDomain}", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!existingUsers.TryGetValue(normalizedEmail, out var user))
            {
                user = new AdminUser
                {
                    Id = Guid.NewGuid(),
                    CreatedAt = now,
                    Email = normalizedEmail,
                    Status = directoryUser.IsSuspended ? "inactive" : "pending",
                    ApiAccessEnabled = false,
                };
                existingUsers[normalizedEmail] = user;
                db.AdminUsers.Add(user);
            }

            user.GoogleUserId = directoryUser.GoogleUserId;
            user.DisplayName = string.IsNullOrWhiteSpace(directoryUser.DisplayName)
                ? CreateDisplayNameFromEmail(normalizedEmail)
                : directoryUser.DisplayName;
            user.PhotoUrl = directoryUser.PhotoUrl;
            user.HostedDomain = hostedDomain;
            user.IsDirectorySuspended = directoryUser.IsSuspended;
            user.GoogleLastLoginAt = directoryUser.GoogleLastLoginAt;
            user.DirectorySyncedAt = now;
            user.UpdatedAt = now;

            if (directoryUser.IsSuspended)
            {
                user.Status = "inactive";
                user.ApiAccessEnabled = false;
            }
            else if (NormalizeAdminUserStatus(user.Status) is null)
            {
                user.Status = user.LastLoginAt.HasValue ? "active" : "pending";
            }
        }

        await db.SaveChangesAsync(cancellationToken);

        return now;
    }

    private static async Task<GoogleDirectoryUserSnapshot[]> GetGoogleDirectoryUsersAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string? hostedDomain,
        CancellationToken cancellationToken)
    {
        var users = new List<GoogleDirectoryUserSnapshot>();
        string? pageToken = null;

        do
        {
            var query = new Dictionary<string, string?>
            {
                ["domain"] = string.IsNullOrWhiteSpace(hostedDomain) ? null : hostedDomain,
                ["customer"] = string.IsNullOrWhiteSpace(hostedDomain) ? "my_customer" : null,
                ["maxResults"] = "500",
                ["orderBy"] = "email",
                ["projection"] = "basic",
                ["pageToken"] = pageToken,
                ["fields"] = "users(id,primaryEmail,name(fullName),thumbnailPhotoUrl,suspended,archived,lastLoginTime),nextPageToken",
            };
            var requestUrl = QueryHelpers.AddQueryString(
                "https://admin.googleapis.com/admin/directory/v1/users",
                query);
            var payload = await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                requestUrl,
                "Google Workspace users could not be loaded.",
                cancellationToken);

            using var document = JsonDocument.Parse(payload);

            if (document.RootElement.TryGetProperty("users", out var usersElement) &&
                usersElement.ValueKind == JsonValueKind.Array)
            {
                users.AddRange(usersElement
                    .EnumerateArray()
                    .Select(ParseGoogleDirectoryUser)
                    .Where(user => !string.IsNullOrWhiteSpace(user.Email)));
            }

            pageToken = GetJsonString(document.RootElement, "nextPageToken");
        }
        while (!string.IsNullOrWhiteSpace(pageToken));

        return users
            .OrderBy(user => user.Email, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static GoogleDirectoryUserSnapshot ParseGoogleDirectoryUser(JsonElement user)
    {
        var email = GetJsonString(user, "primaryEmail") ?? string.Empty;
        var displayName = default(string);

        if (user.TryGetProperty("name", out var nameElement) &&
            nameElement.ValueKind == JsonValueKind.Object)
        {
            displayName = GetJsonString(nameElement, "fullName");
        }

        return new GoogleDirectoryUserSnapshot(
            GetJsonString(user, "id"),
            email,
            string.IsNullOrWhiteSpace(displayName) ? CreateDisplayNameFromEmail(email) : displayName,
            GetJsonString(user, "thumbnailPhotoUrl"),
            GetJsonBool(user, "suspended") == true || GetJsonBool(user, "archived") == true,
            ParseGoogleDirectoryLastLogin(GetJsonString(user, "lastLoginTime")));
    }

    private static DateTimeOffset? ParseGoogleDirectoryLastLogin(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) ||
            string.Equals(value, "Never", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (!DateTimeOffset.TryParse(
                value,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal,
                out var parsedValue))
        {
            return null;
        }

        return parsedValue.Year <= 1971 ? null : parsedValue;
    }

    private static async Task<AdminUserDto[]> GetAdminUserDtosAsync(
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken) =>
        (await db.AdminUsers
            .AsNoTracking()
            .Where(user => user.LastLoginAt.HasValue)
            .OrderBy(user => user.Status == "pending" ? 0 : user.Status == "active" ? 1 : 2)
            .ThenBy(user => user.DisplayName)
            .ToArrayAsync(cancellationToken))
        .Select(ToAdminUserDto)
        .ToArray();

    private static AdminUserDto ToAdminUserDto(AdminUser user)
    {
        var status = user.IsDirectorySuspended
            ? "inactive"
            : NormalizeAdminUserStatus(user.Status) ?? (user.LastLoginAt.HasValue ? "active" : "pending");

        return new AdminUserDto(
            user.Id,
            user.Email,
            user.ContactEmail,
            string.IsNullOrWhiteSpace(user.DisplayName)
                ? CreateDisplayNameFromEmail(user.Email)
                : user.DisplayName,
            user.PhotoUrl,
            user.Role,
            status,
            IsAcademyAccountEmail(user.Email),
            user.ApiAccessEnabled && status != "inactive",
            user.LastLoginAt.HasValue,
            user.IsDirectorySuspended,
            user.LastLoginAt,
            user.GoogleLastLoginAt,
            user.DirectorySyncedAt,
            user.SessionRevokedAt);
    }

    private static async Task<AdminUserDetailDto?> GetAdminUserDetailDtoAsync(
        IncosWorkspaceDbContext db,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var user = await db.AdminUsers
            .AsNoTracking()
            .FirstOrDefaultAsync(adminUser => adminUser.Id == userId, cancellationToken);

        if (user is null)
        {
            return null;
        }

        var academyLoginId = await db.AcademyCredentialAccounts
            .AsNoTracking()
            .Where(account => account.AdminUserId == user.Id)
            .Select(account => account.LoginId)
            .FirstOrDefaultAsync(cancellationToken);
        var groups = await (
            from member in db.AdminGroupMembers.AsNoTracking()
            join adminGroup in db.AdminGroups.AsNoTracking() on member.AdminGroupId equals adminGroup.Id
            where member.AdminUserId == user.Id
            orderby adminGroup.Name
            select adminGroup.Name)
            .ToArrayAsync(cancellationToken);

        return new AdminUserDetailDto(
            ToAdminUserDto(user),
            academyLoginId,
            groups,
            CreateAdminUserLogs(user, groups));
    }

    private static AdminUserLogDto[] CreateAdminUserLogs(AdminUser user, IReadOnlyCollection<string> groups)
    {
        var logs = new List<AdminUserLogDto>
        {
            new("Account created", user.CreatedAt, user.Email),
        };

        if (user.LastLoginAt.HasValue)
        {
            logs.Add(new("Last app login", user.LastLoginAt.Value, null));
        }

        if (user.GoogleLastLoginAt.HasValue)
        {
            logs.Add(new("Google last login", user.GoogleLastLoginAt.Value, null));
        }

        if (user.DirectorySyncedAt.HasValue)
        {
            logs.Add(new("Directory synced", user.DirectorySyncedAt.Value, null));
        }

        if (user.SessionRevokedAt.HasValue)
        {
            logs.Add(new("Sessions revoked", user.SessionRevokedAt.Value, null));
        }

        if (groups.Count > 0)
        {
            logs.Add(new("Group assignment", user.UpdatedAt, string.Join(", ", groups)));
        }

        logs.Add(new("Profile updated", user.UpdatedAt, user.Status));

        return logs
            .OrderByDescending(log => log.At)
            .ToArray();
    }

    private static async Task<AdminGroupDto[]> GetAdminGroupDtosAsync(
        IncosWorkspaceDbContext db,
        bool includeProtectedGroups,
        CancellationToken cancellationToken) =>
        (await db.AdminGroups
            .AsNoTracking()
            .Include(group => group.Members)
            .ThenInclude(member => member.AdminUser)
            .OrderBy(group => group.Status == "active" ? 0 : 1)
            .ThenBy(group => group.Name)
            .ToArrayAsync(cancellationToken))
        .Where(group => includeProtectedGroups || !IsProtectedAdminGroup(group))
        .Select(ToAdminGroupDto)
        .ToArray();

    private static async Task<AdminGroupDto?> GetAdminGroupDtoAsync(
        IncosWorkspaceDbContext db,
        Guid groupId,
        CancellationToken cancellationToken)
    {
        var group = await db.AdminGroups
            .AsNoTracking()
            .Include(adminGroup => adminGroup.Members)
            .ThenInclude(member => member.AdminUser)
            .FirstOrDefaultAsync(adminGroup => adminGroup.Id == groupId, cancellationToken);

        return group is null ? null : ToAdminGroupDto(group);
    }

    private static AdminGroupDto ToAdminGroupDto(AdminGroup group) =>
        new(
            group.Id,
            group.Name,
            group.Description,
            group.PhotoUrl,
            NormalizeAdminGroupStatus(group.Status),
            IsProtectedAdminGroup(group),
            ParseAdminGroupValues(group.PermissionJson, AdminGroupPermissionKeys),
            ParseAdminGroupValues(group.SettingJson, AdminGroupSettingKeys),
            ParseAdminGroupValues(group.AccessJson, AdminGroupAccessKeys),
            group.Members
                .Where(member => member.AdminUser is not null)
                .OrderBy(member => member.AdminUser!.DisplayName)
                .Select(member => new AdminGroupMemberDto(
                    member.AdminUserId,
                    member.AdminUser!.Email,
                    string.IsNullOrWhiteSpace(member.AdminUser.DisplayName)
                        ? CreateDisplayNameFromEmail(member.AdminUser.Email)
                        : member.AdminUser.DisplayName,
                    member.AdminUser.PhotoUrl,
                    NormalizeAdminUserStatus(member.AdminUser.Status) ?? "pending"))
                .ToArray(),
            group.CreatedAt,
            group.UpdatedAt);

    private static bool IsProtectedAdminGroup(AdminGroup group) =>
        string.Equals(group.Name, MainAdminGroupName, StringComparison.OrdinalIgnoreCase);

    private static bool IsAcademyAccountEmail(string? email) =>
        !string.IsNullOrWhiteSpace(email) &&
        email.Trim().EndsWith($"@{AcademyAccountDomain}", StringComparison.OrdinalIgnoreCase);

    private static async Task<bool> CanViewMainAdminGroupAsync(
        IncosWorkspaceDbContext db,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        var email = user.FindFirstValue(ClaimTypes.Email)?.Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(email))
        {
            return false;
        }

        return await (
            from member in db.AdminGroupMembers
            join adminGroup in db.AdminGroups on member.AdminGroupId equals adminGroup.Id
            join adminUser in db.AdminUsers on member.AdminUserId equals adminUser.Id
            where adminGroup.Name == MainAdminGroupName && adminUser.Email == email
            select member.Id)
            .AnyAsync(cancellationToken);
    }

    public static async Task EnsureDefaultAdminGroupAsync(
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        await EnsureAdminUsersTableAsync(db, cancellationToken);
        await EnsureAdminGroupsTableAsync(db, cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var mainAdmin = await db.AdminUsers
            .FirstOrDefaultAsync(user => user.Email == MainAdminEmail, cancellationToken);

        if (mainAdmin is null)
        {
            mainAdmin = new AdminUser
            {
                Id = Guid.NewGuid(),
                CreatedAt = now,
                Email = MainAdminEmail,
                DisplayName = CreateDisplayNameFromEmail(MainAdminEmail),
                HostedDomain = "incos.co.kr",
                Status = "active",
                ApiAccessEnabled = true,
                LastLoginAt = now,
                UpdatedAt = now,
            };
            db.AdminUsers.Add(mainAdmin);
        }
        else
        {
            mainAdmin.Status = "active";
            mainAdmin.ApiAccessEnabled = true;
            mainAdmin.UpdatedAt = now;
        }

        var group = await db.AdminGroups
            .Include(adminGroup => adminGroup.Members)
            .FirstOrDefaultAsync(
                adminGroup => adminGroup.Name.ToLower() == MainAdminGroupName.ToLower(),
                cancellationToken);

        if (group is null)
        {
            group = new AdminGroup
            {
                Id = Guid.NewGuid(),
                CreatedAt = now,
                Name = MainAdminGroupName,
            };
            db.AdminGroups.Add(group);
        }

        group.Description = "Default protected administrator group.";
        group.Status = "active";
        group.PermissionJson = SerializeAdminGroupValues(AdminGroupPermissionKeys, AdminGroupPermissionKeys);
        group.SettingJson = SerializeAdminGroupValues(AdminGroupSettingKeys, AdminGroupSettingKeys);
        group.AccessJson = SerializeAdminGroupValues(AdminGroupAccessKeys, AdminGroupAccessKeys);
        group.UpdatedAt = now;

        if (!group.Members.Any(member => member.AdminUserId == mainAdmin.Id))
        {
            db.AdminGroupMembers.Add(new AdminGroupMember
            {
                Id = Guid.NewGuid(),
                CreatedAt = now,
                UpdatedAt = now,
                AdminGroupId = group.Id,
                AdminUserId = mainAdmin.Id,
            });
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    public static async Task RemoveLegacyAcademyUsersGroupAsync(
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        await EnsureAdminGroupsTableAsync(db, cancellationToken);

        var group = await db.AdminGroups
            .FirstOrDefaultAsync(
                adminGroup => adminGroup.Name.ToLower() == LegacyAcademyUsersGroupName.ToLower(),
                cancellationToken);

        if (group is null ||
            !string.Equals(group.Description, LegacyAcademyUsersGroupDescription, StringComparison.Ordinal))
        {
            return;
        }

        var permissions = ParseAdminGroupValues(group.PermissionJson, AdminGroupPermissionKeys);
        var settings = ParseAdminGroupValues(group.SettingJson, AdminGroupSettingKeys);
        var access = ParseAdminGroupValues(group.AccessJson, AdminGroupAccessKeys);
        var isUnmodifiedLegacyGroup =
            permissions.Length > 0 &&
            settings.Length > 0 &&
            access.Length > 0 &&
            permissions.All(IsAcademyPermissionValue) &&
            settings.All(IsAcademySettingValue) &&
            access.All(IsAcademyAccessValue);

        if (!isUnmodifiedLegacyGroup)
        {
            return;
        }

        var members = await db.AdminGroupMembers
            .Where(member => member.AdminGroupId == group.Id)
            .ToArrayAsync(cancellationToken);

        db.AdminGroupMembers.RemoveRange(members);
        db.AdminGroups.Remove(group);
        await db.SaveChangesAsync(cancellationToken);
    }

    private static async Task ApplyAdminGroupMembersAsync(
        IncosWorkspaceDbContext db,
        AdminGroup group,
        IEnumerable<Guid>? memberIds,
        bool preserveMainAdmin,
        CancellationToken cancellationToken)
    {
        var normalizedMemberIds = new HashSet<Guid>(memberIds ?? [], EqualityComparer<Guid>.Default);

        if (preserveMainAdmin)
        {
            var mainAdminId = await db.AdminUsers
                .Where(user => user.Email == MainAdminEmail)
                .Select(user => user.Id)
                .FirstOrDefaultAsync(cancellationToken);

            if (mainAdminId != Guid.Empty)
            {
                normalizedMemberIds.Add(mainAdminId);
            }
        }

        var validMemberIds = await db.AdminUsers
            .Where(user => normalizedMemberIds.Contains(user.Id))
            .Select(user => user.Id)
            .ToArrayAsync(cancellationToken);
        var validMemberIdSet = validMemberIds.ToHashSet();
        var existingMembers = await db.AdminGroupMembers
            .Where(member => member.AdminGroupId == group.Id)
            .ToArrayAsync(cancellationToken);

        foreach (var existingMember in existingMembers)
        {
            if (!validMemberIdSet.Contains(existingMember.AdminUserId))
            {
                db.AdminGroupMembers.Remove(existingMember);
            }
        }

        var existingMemberIds = existingMembers
            .Where(member => validMemberIdSet.Contains(member.AdminUserId))
            .Select(member => member.AdminUserId)
            .ToHashSet();
        var now = DateTimeOffset.UtcNow;

        foreach (var userId in validMemberIds)
        {
            if (existingMemberIds.Contains(userId))
            {
                continue;
            }

            db.AdminGroupMembers.Add(new AdminGroupMember
            {
                Id = Guid.NewGuid(),
                CreatedAt = now,
                UpdatedAt = now,
                AdminGroupId = group.Id,
                AdminUserId = userId,
            });
        }
    }

    private static async Task<string?> ValidateAcademyGroupGrantCompatibilityAsync(
        IncosWorkspaceDbContext db,
        IReadOnlyCollection<Guid> memberIds,
        IReadOnlyCollection<string> permissions,
        IReadOnlyCollection<string> settings,
        IReadOnlyCollection<string> access,
        CancellationToken cancellationToken)
    {
        if (memberIds.Count == 0)
        {
            return null;
        }

        var selectedMemberEmails = await db.AdminUsers
            .AsNoTracking()
            .Where(user => memberIds.Contains(user.Id))
            .Select(user => user.Email)
            .ToArrayAsync(cancellationToken);
        var hasAcademyMember = selectedMemberEmails.Any(IsAcademyAccountEmail);

        if (!hasAcademyMember)
        {
            return null;
        }

        var hasWorkspaceOrAdminGrant =
            permissions.Any(value => !IsAcademyPermissionValue(value)) ||
            settings.Any(value => !IsAcademySettingValue(value)) ||
            access.Any(value => !IsAcademyAccessValue(value));

        return hasWorkspaceOrAdminGrant
            ? "Academy credential users can only be assigned Academy access, permissions, and settings. Remove Workspace/Admin grants or remove Academy users from this group."
            : null;
    }

    private static bool IsAcademyAccessValue(string value) =>
        string.Equals(value, "academy", StringComparison.OrdinalIgnoreCase) ||
        value.StartsWith("academy-", StringComparison.OrdinalIgnoreCase);

    private static bool IsAcademyPermissionValue(string value) =>
        value.StartsWith("academy-", StringComparison.OrdinalIgnoreCase);

    private static bool IsAcademySettingValue(string value) =>
        string.Equals(value, "academy-settings", StringComparison.OrdinalIgnoreCase);

    private static string? NormalizeAdminUserStatus(string? status)
    {
        if (string.IsNullOrWhiteSpace(status))
        {
            return null;
        }

        return status.Trim().ToLowerInvariant() switch
        {
            "active" or "activated" or "approved" => "active",
            "inactive" or "deactivated" or "disabled" or "blocked" => "inactive",
            "pending" => "pending",
            _ => null,
        };
    }

    private static string CreateDisplayNameFromEmail(string email)
    {
        var localPart = email.Split('@', 2)[0];

        return string.IsNullOrWhiteSpace(localPart)
            ? email
            : CultureInfo.InvariantCulture.TextInfo.ToTitleCase(localPart.Replace('.', ' ').Replace('_', ' '));
    }

    private static string NormalizeAdminGroupStatus(string? status) =>
        status?.Trim().ToLowerInvariant() switch
        {
            "inactive" or "deactivated" or "disabled" => "inactive",
            _ => "active",
        };

    private static string? NormalizeAdminUserRole(string? role, bool isAcademyUser)
    {
        var normalizedRole = role?.Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(normalizedRole))
        {
            return isAcademyUser ? "academy" : null;
        }

        return normalizedRole switch
        {
            "academy" => "academy",
            "workspace" => "workspace",
            "admin" => "admin",
            "viewer" => "viewer",
            _ => isAcademyUser ? "academy" : null,
        };
    }

    private static string? NormalizeOptionalText(string? value)
    {
        var trimmedValue = value?.Trim();

        return string.IsNullOrWhiteSpace(trimmedValue) ? null : trimmedValue;
    }

    private static async Task MoveAdminUserKeyAsync(
        IncosWorkspaceDbContext db,
        string oldUserKey,
        string newUserKey,
        CancellationToken cancellationToken)
    {
        var oldNormalizedKey = oldUserKey.Trim().ToLowerInvariant();
        var newNormalizedKey = newUserKey.Trim().ToLowerInvariant();

        if (string.Equals(oldNormalizedKey, newNormalizedKey, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        await WorkspaceEndpoints.EnsureUserSettingsTableAsync(db, cancellationToken);
        await db.UserSettings
            .Where(setting => setting.UserKey == oldNormalizedKey)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(setting => setting.UserKey, newNormalizedKey),
                cancellationToken);

        await EnsureGoogleOAuthTokensTableAsync(db, cancellationToken);
        await db.GoogleOAuthTokens
            .Where(token => token.UserKey == oldNormalizedKey || token.Email == oldNormalizedKey)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(token => token.UserKey, newNormalizedKey)
                    .SetProperty(token => token.Email, newNormalizedKey),
                cancellationToken);

        await EnsureScheduledGmailMessagesTableAsync(db, cancellationToken);
        await db.ScheduledGmailMessages
            .Where(message => message.UserKey == oldNormalizedKey)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(message => message.UserKey, newNormalizedKey),
                cancellationToken);
    }

    private static string SerializeAdminGroupValues(
        IEnumerable<string>? values,
        IReadOnlySet<string> allowedValues) =>
        JsonSerializer.Serialize(NormalizeAdminGroupValues(values, allowedValues));

    private static string[] ParseAdminGroupValues(
        string? json,
        IReadOnlySet<string> allowedValues)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            return NormalizeAdminGroupValues(
                JsonSerializer.Deserialize<string[]>(json) ?? [],
                allowedValues);
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static string[] NormalizeAdminGroupValues(
        IEnumerable<string>? values,
        IReadOnlySet<string> allowedValues)
    {
        var normalizedValues = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var value in values ?? [])
        {
            var normalizedValue = value.Trim().ToLowerInvariant();

            if (allowedValues.Contains(normalizedValue))
            {
                normalizedValues.Add(normalizedValue);
            }
        }

        return allowedValues
            .Where(normalizedValues.Contains)
            .ToArray();
    }

    private static async Task<string?> GetGoogleAccessTokenAsync(
        HttpContext context,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var db = context.RequestServices.GetService<IncosWorkspaceDbContext>();
        var storedToken = db is null
            ? null
            : await GetStoredGoogleOAuthTokenAsync(db, context.User, cancellationToken);
        var canUseStoredWorkspaceToken = CanUseStoredGoogleWorkspaceToken(storedToken);
        var cookieScopes = await context.GetTokenAsync("scope");
        var canUseCookieWorkspaceToken = HasAnyGoogleWorkspaceScope(cookieScopes);

        if (storedToken is not null && !canUseStoredWorkspaceToken && db is not null)
        {
            await DeleteStoredGoogleOAuthTokenAsync(db, context.User, cancellationToken);
        }

        if (canUseStoredWorkspaceToken &&
            !ShouldRefreshAccessToken(
                storedToken!.AccessToken,
                storedToken.AccessTokenExpiresAt?.ToString("o", CultureInfo.InvariantCulture)))
        {
            await StoreGoogleTokenInCookieAsync(context, storedToken);
            return storedToken.AccessToken;
        }

        var accessToken = await context.GetTokenAsync("access_token");
        var expiresAt = await context.GetTokenAsync("expires_at");
        var shouldRefresh = ShouldRefreshAccessToken(accessToken, expiresAt);

        if (!shouldRefresh && !canUseStoredWorkspaceToken && canUseCookieWorkspaceToken)
        {
            return accessToken;
        }

        if (!canUseStoredWorkspaceToken && !canUseCookieWorkspaceToken)
        {
            return null;
        }

        var refreshToken = canUseStoredWorkspaceToken
            ? storedToken?.RefreshToken
            : await context.GetTokenAsync("refresh_token");

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

        var refreshedScope = GetRefreshedGoogleWorkspaceScope(
            refreshedToken.Scope,
            canUseStoredWorkspaceToken ? storedToken?.Scope : cookieScopes);

        if (!HasAnyGoogleWorkspaceScope(refreshedScope))
        {
            return null;
        }

        refreshedToken = refreshedToken with { Scope = refreshedScope };

        await StoreRefreshedGoogleTokenAsync(context, refreshedToken, refreshToken);
        if (db is not null)
        {
            await StoreRefreshedGoogleTokenAsync(
                db,
                context.User,
                refreshedToken,
                refreshToken,
                cancellationToken);
        }

        return refreshedToken.AccessToken;
    }

    private static bool CanUseStoredGoogleWorkspaceToken(GoogleOAuthToken? storedToken)
    {
        if (storedToken is null || string.IsNullOrWhiteSpace(storedToken.AccessToken))
        {
            return false;
        }

        return HasAnyGoogleWorkspaceScope(storedToken.Scope);
    }

    private static bool HasAnyGoogleWorkspaceScope(string? scopes) =>
        !string.IsNullOrWhiteSpace(scopes) &&
        scopes
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(scope => GoogleWorkspaceScopes.All.Contains(scope, StringComparer.OrdinalIgnoreCase));

    private static string? GetRefreshedGoogleWorkspaceScope(
        string? refreshedScope,
        string? previousScope)
    {
        if (HasAnyGoogleWorkspaceScope(refreshedScope))
        {
            return refreshedScope;
        }

        return HasAnyGoogleWorkspaceScope(previousScope)
            ? previousScope
            : null;
    }

    private static async Task<HashSet<string>> GetGoogleAccessTokenScopesAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        CancellationToken cancellationToken)
    {
        var requestUrl = QueryHelpers.AddQueryString(
            "https://www.googleapis.com/oauth2/v3/tokeninfo",
            new Dictionary<string, string?>
            {
                ["access_token"] = accessToken,
            });
        string payload;

        try
        {
            payload = await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                requestUrl,
                "Google token scope check failed.",
                cancellationToken);
        }
        catch (GoogleApiRequestException)
        {
            return [];
        }

        using var document = JsonDocument.Parse(payload);
        var scopes = GetJsonString(document.RootElement, "scope");

        return string.IsNullOrWhiteSpace(scopes)
            ? []
            : scopes
                .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
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
        RemoveGoogleOAuthTokens(properties);
        await context.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            authenticateResult.Principal,
            properties);
    }

    private static async Task<GoogleOAuthToken?> GetStoredGoogleOAuthTokenAsync(
        IncosWorkspaceDbContext db,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        await EnsureGoogleOAuthTokensTableAsync(db, cancellationToken);
        var userKey = GetCurrentUserKey(user);
        var email = user.FindFirstValue(ClaimTypes.Email)?.Trim().ToLowerInvariant();

        return await db.GoogleOAuthTokens
            .AsNoTracking()
            .FirstOrDefaultAsync(
                token => token.UserKey.ToLower() == userKey ||
                         (token.Email != null && token.Email.ToLower() == email),
                cancellationToken);
    }

    private static async Task DeleteStoredGoogleOAuthTokenAsync(
        IncosWorkspaceDbContext db,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        await EnsureGoogleOAuthTokensTableAsync(db, cancellationToken);
        var userKey = GetCurrentUserKey(user);
        var email = user.FindFirstValue(ClaimTypes.Email)?.Trim().ToLowerInvariant();

        await db.GoogleOAuthTokens
            .Where(token => token.UserKey.ToLower() == userKey ||
                            (token.Email != null && token.Email.ToLower() == email))
            .ExecuteDeleteAsync(cancellationToken);
    }

    private static async Task StoreRefreshedGoogleTokenAsync(
        IncosWorkspaceDbContext db,
        ClaimsPrincipal user,
        GoogleTokenRefreshResult refreshedToken,
        string previousRefreshToken,
        CancellationToken cancellationToken)
    {
        await EnsureGoogleOAuthTokensTableAsync(db, cancellationToken);
        var userKey = GetCurrentUserKey(user);
        var email = user.FindFirstValue(ClaimTypes.Email)?.Trim().ToLowerInvariant();
        var now = DateTimeOffset.UtcNow;
        var token = await db.GoogleOAuthTokens
            .FirstOrDefaultAsync(
                currentToken => currentToken.UserKey.ToLower() == userKey ||
                                (currentToken.Email != null && currentToken.Email.ToLower() == email),
                cancellationToken);

        if (token is null)
        {
            token = new GoogleOAuthToken
            {
                Id = Guid.NewGuid(),
                CreatedAt = now,
                UserKey = userKey,
                Email = email,
            };
            db.GoogleOAuthTokens.Add(token);
        }

        token.UserKey = userKey;
        token.Email = email;
        token.AccessToken = refreshedToken.AccessToken;
        token.RefreshToken = refreshedToken.RefreshToken ?? previousRefreshToken;
        token.AccessTokenExpiresAt = now.AddSeconds(Math.Max(60, refreshedToken.ExpiresIn - 60));
        token.Scope = string.IsNullOrWhiteSpace(refreshedToken.Scope)
            ? token.Scope
            : refreshedToken.Scope;
        token.UpdatedAt = now;

        await db.SaveChangesAsync(cancellationToken);
    }

    private static async Task StoreGoogleTokenInCookieAsync(HttpContext context, GoogleOAuthToken storedToken)
    {
        var authenticateResult = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);

        if (!authenticateResult.Succeeded || authenticateResult.Principal is null)
        {
            return;
        }

        var properties = authenticateResult.Properties ?? new AuthenticationProperties();
        var configuration = context.RequestServices.GetRequiredService<IConfiguration>();
        properties.IsPersistent = true;
        properties.ExpiresUtc = DateTimeOffset.UtcNow.Add(GetWorkspaceSessionDuration(configuration));
        RemoveGoogleOAuthTokens(properties);
        await context.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            authenticateResult.Principal,
            properties);
    }

    private static void RemoveGoogleOAuthTokens(AuthenticationProperties properties)
    {
        var tokens = properties.GetTokens()
            .Where(token => token.Name is not "access_token" and not "refresh_token" and not "id_token" and not "expires_at" and not "token_type" and not "scope")
            .ToArray();

        properties.StoreTokens(tokens);
    }

    private static TimeSpan GetWorkspaceSessionDuration(IConfiguration configuration)
    {
        return AuthEndpoints.GetWorkspaceSessionDuration(configuration);
    }

    private static bool IsGoogleIntegrationStatusRequest(HttpContext context) =>
        string.Equals(context.Request.Method, HttpMethods.Get, StringComparison.OrdinalIgnoreCase) &&
        string.Equals(context.Request.Path.Value, "/api/google/integrations", StringComparison.OrdinalIgnoreCase);

    private static bool IsGoogleIntegrationConnectRequest(HttpContext context) =>
        string.Equals(context.Request.Method, HttpMethods.Get, StringComparison.OrdinalIgnoreCase) &&
        context.Request.Path.StartsWithSegments("/api/google/integrations") &&
        context.Request.Path.Value?.EndsWith("/connect", StringComparison.OrdinalIgnoreCase) == true;

    private static bool CanUseGoogleWorkspaceData(ClaimsPrincipal user, IConfiguration configuration)
    {
        var workspaceDataDomain = GetGoogleWorkspaceDataDomain(configuration);
        var email = user.FindFirstValue(ClaimTypes.Email);
        var hostedDomain = user.FindFirstValue("hd");

        return (!string.IsNullOrWhiteSpace(hostedDomain) &&
                string.Equals(hostedDomain, workspaceDataDomain, StringComparison.OrdinalIgnoreCase)) ||
               (!string.IsNullOrWhiteSpace(email) &&
                email.EndsWith($"@{workspaceDataDomain}", StringComparison.OrdinalIgnoreCase));
    }

    private static async Task<bool> CanUseGoogleApiDataAsync(
        ClaimsPrincipal user,
        IConfiguration configuration,
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        if (!CanUseGoogleWorkspaceData(user, configuration))
        {
            return false;
        }

        var email = user.FindFirstValue(ClaimTypes.Email)?.Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(email))
        {
            return false;
        }

        await EnsureAdminUsersTableAsync(db, cancellationToken);
        var adminUser = await db.AdminUsers
            .AsNoTracking()
            .FirstOrDefaultAsync(currentUser => currentUser.Email == email, cancellationToken);

        return adminUser is not null &&
            adminUser.ApiAccessEnabled &&
            !adminUser.IsDirectorySuspended &&
            string.Equals(adminUser.Status, "active", StringComparison.OrdinalIgnoreCase);
    }

    private static string GetGoogleWorkspaceDataDomain(IConfiguration configuration)
    {
        var configuredDomain =
            configuration["Authentication:Google:WorkspaceDataDomain"] ??
            configuration["Authentication:Google:HostedDomain"];

        return string.IsNullOrWhiteSpace(configuredDomain)
            ? "incos.co.kr"
            : configuredDomain.Trim().TrimStart('@').ToLowerInvariant();
    }

    private static GoogleIntegrationStatusDto CreateDisabledStatus(
        string provider,
        string label) =>
        new(
            provider,
            label,
            false,
            false,
            "disabled",
            string.Empty,
            []);

    private static IResult CreateGoogleApiProblem(GoogleApiRequestException exception)
    {
        if (IsInsufficientGoogleScope(exception))
        {
            var label = exception.Title.Contains("Chat", StringComparison.OrdinalIgnoreCase)
                ? "Google Chat"
                : exception.Title.Contains("Drive", StringComparison.OrdinalIgnoreCase)
                    ? "Google Drive"
                    : exception.Title.Contains("Gmail", StringComparison.OrdinalIgnoreCase)
                        ? "Gmail"
                        : "Google";

            return Results.Problem(
                title: $"{label} is not connected.",
                detail: $"Reconnect {label} to grant the required Google scopes.",
                statusCode: StatusCodes.Status409Conflict);
        }

        return Results.Problem(
            title: exception.Title,
            detail: exception.Detail,
            statusCode: exception.StatusCode);
    }

    private static bool IsInsufficientGoogleScope(GoogleApiRequestException exception)
    {
        if (exception.StatusCode is not StatusCodes.Status401Unauthorized and not StatusCodes.Status403Forbidden)
        {
            return false;
        }

        return exception.Detail.Contains("insufficient authentication scopes", StringComparison.OrdinalIgnoreCase) ||
            exception.Detail.Contains("ACCESS_TOKEN_SCOPE_INSUFFICIENT", StringComparison.OrdinalIgnoreCase) ||
            exception.Detail.Contains("insufficientPermissions", StringComparison.OrdinalIgnoreCase) ||
            (exception.Detail.Contains("scope", StringComparison.OrdinalIgnoreCase) &&
             exception.Detail.Contains("insufficient", StringComparison.OrdinalIgnoreCase));
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

    private static void AddGrantedScopes(HashSet<string> grantedScopes, string? scopes)
    {
        if (string.IsNullOrWhiteSpace(scopes))
        {
            return;
        }

        foreach (var scope in scopes.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            grantedScopes.Add(scope);
        }
    }

    private static void AddGrantedScopes(HashSet<string> grantedScopes, IEnumerable<string> scopes)
    {
        foreach (var scope in scopes)
        {
            if (!string.IsNullOrWhiteSpace(scope))
            {
                grantedScopes.Add(scope);
            }
        }
    }

    private static async Task<GoogleChatProfileResolutionStatus> CheckGoogleChatProfileResolutionAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        HashSet<string> tokenScopes,
        string currentUserKey,
        CancellationToken cancellationToken)
    {
        var peopleStatus = await CheckGooglePeopleDirectoryAvailableAsync(
            httpClientFactory,
            accessToken,
            cancellationToken);

        if (peopleStatus.Available)
        {
            return peopleStatus;
        }

        if (tokenScopes.Contains(GoogleWorkspaceScopes.AdminDirectoryUserReadonly))
        {
            var adminStatus = await CheckGoogleAdminDirectoryAvailableAsync(
                httpClientFactory,
                accessToken,
                currentUserKey,
                cancellationToken);

            if (adminStatus.Available)
            {
                return adminStatus;
            }
        }

        return peopleStatus with
        {
            Title = "Google Chat profiles cannot be resolved.",
            Detail = peopleStatus.Detail,
        };
    }

    private static async Task<GoogleChatProfileResolutionStatus> CheckGooglePeopleDirectoryAvailableAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        CancellationToken cancellationToken)
    {
        var requestUrl = QueryHelpers.AddQueryString(
            "https://people.googleapis.com/v1/people:listDirectoryPeople",
            new Dictionary<string, string?>
            {
                ["readMask"] = "names",
                ["sources"] = "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
                ["pageSize"] = "1",
                ["fields"] = "people(resourceName,names(displayName)),nextPageToken",
            });

        try
        {
            await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                requestUrl,
                "Google People directory check failed.",
                cancellationToken);

            return new GoogleChatProfileResolutionStatus(true, null, null);
        }
        catch (GoogleApiRequestException exception) when (exception.StatusCode is
            StatusCodes.Status400BadRequest or
            StatusCodes.Status403Forbidden or
            StatusCodes.Status404NotFound)
        {
            return new GoogleChatProfileResolutionStatus(
                false,
                "Google People API must be enabled.",
                CreateGooglePeopleSetupDetail(exception.Detail));
        }
        catch (GoogleApiRequestException exception) when (IsGooglePeopleQuotaExceeded(exception))
        {
            return new GoogleChatProfileResolutionStatus(true, null, null);
        }
    }

    private static async Task<GoogleChatProfileResolutionStatus> CheckGoogleAdminDirectoryAvailableAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string currentUserKey,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(currentUserKey) ||
            !currentUserKey.Contains('@', StringComparison.Ordinal))
        {
            return new GoogleChatProfileResolutionStatus(
                false,
                "Google Workspace Directory cannot be checked.",
                "The signed-in Google account email was not available.");
        }

        var requestUrl = QueryHelpers.AddQueryString(
            $"https://admin.googleapis.com/admin/directory/v1/users/{Uri.EscapeDataString(currentUserKey)}",
            new Dictionary<string, string?>
            {
                ["projection"] = "basic",
                ["fields"] = "id",
            });

        try
        {
            await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                requestUrl,
                "Google Workspace Admin Directory check failed.",
                cancellationToken);

            return new GoogleChatProfileResolutionStatus(true, null, null);
        }
        catch (GoogleApiRequestException exception) when (exception.StatusCode is
            StatusCodes.Status400BadRequest or
            StatusCodes.Status403Forbidden or
            StatusCodes.Status404NotFound)
        {
            return new GoogleChatProfileResolutionStatus(
                false,
                "Google Workspace Directory permission is unavailable.",
                "The signed-in account cannot read Workspace Directory profiles through Admin SDK.");
        }
    }

    private static string CreateGooglePeopleSetupDetail(string googleErrorDetail)
    {
        var googleMessage = ExtractGoogleErrorMessage(googleErrorDetail);

        if (googleMessage.Contains("has not been used", StringComparison.OrdinalIgnoreCase) ||
            googleMessage.Contains("disabled", StringComparison.OrdinalIgnoreCase))
        {
            return "Enable Google People API in the Google Cloud project used by this app, then refresh Chat. Google Chat only returns user IDs, so People API or Admin Directory is required for real names and profile photos.";
        }

        return string.IsNullOrWhiteSpace(googleMessage)
            ? "Google Chat only returns user IDs. Enable Google People API, or grant Workspace Directory read access, so names and profile photos can be resolved."
            : googleMessage;
    }

    private static string CreateAdminDirectorySetupDetail(string googleErrorDetail)
    {
        var googleMessage = ExtractGoogleErrorMessage(googleErrorDetail);

        if (googleMessage.Contains("has not been used", StringComparison.OrdinalIgnoreCase) ||
            googleMessage.Contains("disabled", StringComparison.OrdinalIgnoreCase) ||
            googleMessage.Contains("accessNotConfigured", StringComparison.OrdinalIgnoreCase))
        {
            var projectMatch = Regex.Match(
                googleMessage,
                @"(?:project=|project\s+)(?<project>[A-Za-z0-9-]+)",
                RegexOptions.IgnoreCase);
            var projectId = projectMatch.Success ? projectMatch.Groups["project"].Value : string.Empty;
            var enableUrl = string.IsNullOrWhiteSpace(projectId)
                ? "https://console.cloud.google.com/apis/library/admin.googleapis.com"
                : $"https://console.developers.google.com/apis/api/admin.googleapis.com/overview?project={Uri.EscapeDataString(projectId)}";

            return $"Admin SDK API is disabled for this Google Cloud project. Enable it at {enableUrl}, wait a few minutes if it was just enabled, then refresh Users.";
        }

        return string.IsNullOrWhiteSpace(googleMessage)
            ? "Google Workspace users could not be synced. Confirm Admin SDK API is enabled and Directory read access is granted."
            : googleMessage;
    }

    private static string ExtractGoogleErrorMessage(string googleErrorDetail)
    {
        if (string.IsNullOrWhiteSpace(googleErrorDetail))
        {
            return string.Empty;
        }

        try
        {
            using var document = JsonDocument.Parse(googleErrorDetail);

            if (document.RootElement.TryGetProperty("error", out var errorElement) &&
                errorElement.ValueKind == JsonValueKind.Object)
            {
                return GetJsonString(errorElement, "message") ?? googleErrorDetail;
            }
        }
        catch (JsonException)
        {
            return googleErrorDetail;
        }

        return googleErrorDetail;
    }

    private static string GetCurrentUserKey(ClaimsPrincipal user)
    {
        var email = user.FindFirstValue(ClaimTypes.Email);

        if (!string.IsNullOrWhiteSpace(email))
        {
            return email.Trim().ToLowerInvariant();
        }

        return user.FindFirstValue(ClaimTypes.NameIdentifier) ??
               user.Identity?.Name ??
               "google-user";
    }

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

    public static Task EnsureGoogleOAuthTokensTableAsync(
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken = default) =>
        db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS google_oauth_tokens (
                "Id" uuid NOT NULL PRIMARY KEY,
                "CreatedAt" timestamp with time zone NOT NULL,
                "UpdatedAt" timestamp with time zone NOT NULL,
                "UserKey" character varying(320) NOT NULL,
                "Email" character varying(320) NULL,
                "AccessToken" text NOT NULL,
                "RefreshToken" text NULL,
                "AccessTokenExpiresAt" timestamp with time zone NULL,
                "Scope" text NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_google_oauth_tokens_UserKey"
                ON google_oauth_tokens ("UserKey");
            """,
            cancellationToken);

    public static Task EnsureAdminUsersTableAsync(
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken = default) =>
        db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS admin_users (
                "Id" uuid NOT NULL PRIMARY KEY,
                "CreatedAt" timestamp with time zone NOT NULL,
                "UpdatedAt" timestamp with time zone NOT NULL,
                "GoogleUserId" character varying(120) NULL,
                "Email" character varying(320) NOT NULL,
                "ContactEmail" character varying(320) NULL,
                "DisplayName" character varying(160) NOT NULL,
                "PhotoUrl" text NULL,
                "HostedDomain" character varying(160) NULL,
                "Role" character varying(120) NULL,
                "Status" character varying(40) NOT NULL,
                "ApiAccessEnabled" boolean NOT NULL,
                "IsDirectorySuspended" boolean NOT NULL,
                "LastLoginAt" timestamp with time zone NULL,
                "GoogleLastLoginAt" timestamp with time zone NULL,
                "DirectorySyncedAt" timestamp with time zone NULL,
                "SessionRevokedAt" timestamp with time zone NULL
            );
            ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS "SessionRevokedAt" timestamp with time zone NULL;
            ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS "ContactEmail" character varying(320) NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_admin_users_Email"
                ON admin_users ("Email");
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_admin_users_ContactEmail"
                ON admin_users ("ContactEmail")
                WHERE "ContactEmail" IS NOT NULL;
            CREATE INDEX IF NOT EXISTS "IX_admin_users_GoogleUserId"
                ON admin_users ("GoogleUserId");
            """,
            cancellationToken);

    public static Task EnsureAdminGroupsTableAsync(
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken = default) =>
        db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS admin_groups (
                "Id" uuid NOT NULL PRIMARY KEY,
                "CreatedAt" timestamp with time zone NOT NULL,
                "UpdatedAt" timestamp with time zone NOT NULL,
                "Name" character varying(160) NOT NULL,
                "Description" character varying(600) NULL,
                "PhotoUrl" text NULL,
                "Status" character varying(40) NOT NULL,
                "PermissionJson" jsonb NOT NULL,
                "SettingJson" jsonb NOT NULL,
                "AccessJson" jsonb NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_admin_groups_Name"
                ON admin_groups ("Name");
            CREATE TABLE IF NOT EXISTS admin_group_members (
                "Id" uuid NOT NULL PRIMARY KEY,
                "CreatedAt" timestamp with time zone NOT NULL,
                "UpdatedAt" timestamp with time zone NOT NULL,
                "AdminGroupId" uuid NOT NULL,
                "AdminUserId" uuid NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_admin_group_members_AdminGroupId_AdminUserId"
                ON admin_group_members ("AdminGroupId", "AdminUserId");
            CREATE INDEX IF NOT EXISTS "IX_admin_group_members_AdminUserId"
                ON admin_group_members ("AdminUserId");
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
        IMemoryCache cache,
        string accessToken,
        ClaimsPrincipal currentUser,
        string userCachePrefix,
        string? search,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var currentUserKey = GetCurrentUserKey(currentUser);
        var currentUserProfile = await GetGoogleUserInfoProfileAsync(
                httpClientFactory,
                accessToken,
                cancellationToken) ??
            CreateCurrentGoogleProfileFromClaims(currentUser);
        var searchTerm = search?.Trim();
        var spaces = await GetChatSpaceSeedsAsync(
            httpClientFactory,
            accessToken,
            pageSize,
            cancellationToken);
        var currentChatUserName = await GetCurrentChatUserNameAsync(
            httpClientFactory,
            accessToken,
            spaces.FirstOrDefault()?.Name,
            currentUserProfile.Email ?? currentUserKey,
            cancellationToken);
        using var loadSemaphore = new SemaphoreSlim(ChatSpaceLoadConcurrency);
        var spacesWithMessages = await Task.WhenAll(spaces.Select(async space =>
        {
            await loadSemaphore.WaitAsync(cancellationToken);

            try
            {
                var messages = await GetChatMessagesAsync(
                    httpClientFactory,
                    cache,
                    accessToken,
                    userCachePrefix,
                    space.Name,
                    cancellationToken);
                var members = await GetChatMembersAsync(
                    httpClientFactory,
                    accessToken,
                    space.Name,
                    cancellationToken);
                var senderResourceNames = GetChatSenderResourceNames(messages);
                var enrichedMembers = await EnrichChatMembersWithGoogleProfilesAsync(
                    httpClientFactory,
                    cache,
                    accessToken,
                    userCachePrefix,
                    members,
                    senderResourceNames,
                    cancellationToken);
                enrichedMembers = ApplyCurrentUserProfileToChatMembers(
                    enrichedMembers,
                    currentChatUserName,
                    currentUserProfile);
                messages = ApplyCurrentUserProfileToMessages(
                    messages,
                    currentChatUserName,
                    currentUserProfile);
                messages = ApplyChatMemberProfilesToMessages(messages, enrichedMembers);
                var primaryMember = SelectPrimaryChatMember(
                    space,
                    enrichedMembers,
                    messages,
                    currentUserKey,
                    currentChatUserName);

                var enrichedSpace = space with
                {
                    Messages = messages,
                    Members = enrichedMembers,
                    PrimaryMember = primaryMember,
                    DisplayName = CreateChatSpaceDisplayName(space, messages, primaryMember, currentChatUserName),
                    LastActiveTime = space.LastActiveTime ?? messages.LastOrDefault()?.CreatedAt,
                };

                return SanitizeChatSpaceForDisplay(enrichedSpace);
            }
            finally
            {
                loadSemaphore.Release();
            }
        }));

        return spacesWithMessages
            .Where(space => string.IsNullOrWhiteSpace(searchTerm) || MatchesChatSearch(space, searchTerm))
            .OrderByDescending(space => space.LastActiveTime)
            .ThenBy(space => space.DisplayName)
            .ToArray();
    }

    private static async Task<GoogleChatSpaceDto[]> GetChatSpaceSeedsAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        int maxSpaces,
        CancellationToken cancellationToken)
    {
        var spaces = new List<GoogleChatSpaceDto>();
        var pageToken = (string?)null;

        do
        {
            var remaining = Math.Max(1, maxSpaces - spaces.Count);
            var requestUrl = QueryHelpers.AddQueryString(
                "https://chat.googleapis.com/v1/spaces",
                new Dictionary<string, string?>
                {
                    ["pageSize"] = Math.Min(100, remaining).ToString(CultureInfo.InvariantCulture),
                    ["pageToken"] = pageToken,
                    ["fields"] = "spaces(name,displayName,spaceType,type,lastActiveTime,spaceUri),nextPageToken",
                });
            var payload = await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                requestUrl,
                "Google Chat spaces request failed.",
                cancellationToken);

            using var document = JsonDocument.Parse(payload);

            if (document.RootElement.TryGetProperty("spaces", out var spacesElement) &&
                spacesElement.ValueKind == JsonValueKind.Array)
            {
                spaces.AddRange(spacesElement
                    .EnumerateArray()
                    .Select(CreateGoogleChatSpaceSeed));
            }

            pageToken = GetJsonString(document.RootElement, "nextPageToken");
        }
        while (!string.IsNullOrWhiteSpace(pageToken) && spaces.Count < maxSpaces);

        return spaces
            .GroupBy(space => space.Name, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Take(maxSpaces)
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
        IMemoryCache cache,
        string accessToken,
        string userCachePrefix,
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
                    ["pageSize"] = "20",
                    ["orderBy"] = "createTime DESC",
                    ["fields"] = ChatMessageFieldsWithAvatar,
                });
            string payload;

            try
            {
                payload = await SendGoogleGetAsync(
                    httpClientFactory,
                    accessToken,
                    requestUrl,
                    "Google Chat messages request failed.",
                    cancellationToken);
            }
            catch (GoogleApiRequestException exception) when (exception.StatusCode == StatusCodes.Status400BadRequest)
            {
                var fallbackRequestUrl = QueryHelpers.AddQueryString(
                    $"https://chat.googleapis.com/v1/{spaceName}/messages",
                    new Dictionary<string, string?>
                    {
                        ["pageSize"] = "20",
                        ["orderBy"] = "createTime DESC",
                        ["fields"] = ChatMessageFields,
                    });
                payload = await SendGoogleGetAsync(
                    httpClientFactory,
                    accessToken,
                    fallbackRequestUrl,
                    "Google Chat messages request failed.",
                    cancellationToken);
            }

            using var document = JsonDocument.Parse(payload);

            if (!document.RootElement.TryGetProperty("messages", out var messagesElement))
            {
                return [];
            }

            var messages = messagesElement
                .EnumerateArray()
                .Select(CreateGoogleChatMessageDto)
                .OrderBy(message => message.CreatedAt)
                .ToArray();
            messages = await EnrichChatAttachmentsWithDriveMetadataAsync(
                httpClientFactory,
                cache,
                accessToken,
                userCachePrefix,
                messages,
                cancellationToken);

            var profileEnrichedMessages = await EnrichChatMessagesWithGoogleProfilesAsync(
                httpClientFactory,
                cache,
                accessToken,
                userCachePrefix,
                messages,
                cancellationToken);
            var directoryEnrichedMessages = await EnrichChatMessagesWithDirectoryProfilesAsync(
                httpClientFactory,
                cache,
                accessToken,
                userCachePrefix,
                profileEnrichedMessages,
                cancellationToken);

            return await EnrichChatMessagesWithDrivePermissionPhotosAsync(
                httpClientFactory,
                accessToken,
                directoryEnrichedMessages,
                cancellationToken);
        }
        catch (GoogleApiRequestException exception) when (exception.StatusCode is StatusCodes.Status403Forbidden or StatusCodes.Status404NotFound)
        {
            return [];
        }
    }

    private static async Task<GoogleChatMemberDto[]> GetChatMembersAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string spaceName,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(spaceName))
        {
            return [];
        }

        var memberships = await GetChatMembershipsAsync(
            httpClientFactory,
            accessToken,
            spaceName,
            includeAvatar: true,
            cancellationToken);

        if (memberships.Length == 0)
        {
            memberships = await GetChatMembershipsAsync(
                httpClientFactory,
                accessToken,
                spaceName,
                includeAvatar: false,
                cancellationToken);
        }

        return memberships
            .Where(membership =>
            {
                var state = GetJsonString(membership, "state");

                return string.IsNullOrWhiteSpace(state) ||
                       string.Equals(state, "JOINED", StringComparison.OrdinalIgnoreCase);
            })
            .Select(CreateGoogleChatMemberDto)
            .Where(member => !string.IsNullOrWhiteSpace(member.Name))
            .GroupBy(member => member.Name, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToArray();
    }

    private static async Task<JsonElement[]> GetChatMembershipsAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string spaceName,
        bool includeAvatar,
        CancellationToken cancellationToken)
    {
        var memberships = new List<JsonElement>();
        var pageToken = (string?)null;

        do
        {
            var requestUrl = QueryHelpers.AddQueryString(
                $"https://chat.googleapis.com/v1/{spaceName}/members",
                new Dictionary<string, string?>
                {
                    ["pageSize"] = "100",
                    ["pageToken"] = pageToken,
                    ["filter"] = "member.type = \"HUMAN\"",
                    ["fields"] = includeAvatar
                        ? "memberships(member(name,displayName,email,type,avatarUrl),state),nextPageToken"
                        : "memberships(member(name,displayName,type),state),nextPageToken",
                });
            string payload;

            try
            {
                payload = await SendGoogleGetAsync(
                    httpClientFactory,
                    accessToken,
                    requestUrl,
                    "Google Chat members request failed.",
                    cancellationToken);
            }
            catch (GoogleApiRequestException exception) when (exception.StatusCode is
                StatusCodes.Status400BadRequest or
                StatusCodes.Status403Forbidden or
                StatusCodes.Status404NotFound)
            {
                return [];
            }
            catch (GoogleApiRequestException exception) when (IsGooglePeopleQuotaExceeded(exception))
            {
                return [];
            }

            using var document = JsonDocument.Parse(payload);

            if (document.RootElement.TryGetProperty("memberships", out var membershipsElement) &&
                membershipsElement.ValueKind == JsonValueKind.Array)
            {
                memberships.AddRange(membershipsElement
                    .EnumerateArray()
                    .Select(membership => membership.Clone()));
            }

            pageToken = GetJsonString(document.RootElement, "nextPageToken");
        }
        while (!string.IsNullOrWhiteSpace(pageToken));

        return memberships.ToArray();
    }

    private static GoogleChatMemberDto CreateGoogleChatMemberDto(JsonElement membership)
    {
        if (!membership.TryGetProperty("member", out var memberElement) ||
            memberElement.ValueKind != JsonValueKind.Object)
        {
            return new GoogleChatMemberDto(string.Empty, string.Empty);
        }

        var name = GetJsonString(memberElement, "name") ?? string.Empty;
        var displayName = CleanChatSenderName(GetJsonString(memberElement, "displayName")) ?? string.Empty;
        var email = GetJsonString(memberElement, "email");

        return new GoogleChatMemberDto(
            name,
            string.IsNullOrWhiteSpace(displayName) ? email ?? "Google Chat user" : displayName,
            email,
            GetJsonString(memberElement, "avatarUrl"),
            GetJsonString(memberElement, "type"));
    }

    private static async Task<GoogleChatMemberDto[]> EnrichChatMembersWithGoogleProfilesAsync(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        string accessToken,
        string userCachePrefix,
        GoogleChatMemberDto[] members,
        string[] priorityMemberNames,
        CancellationToken cancellationToken)
    {
        if (members.Length == 0)
        {
            return members;
        }

        var priorityMemberNamesSet = priorityMemberNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var priorityCandidates = members
            .Where(member => priorityMemberNamesSet.Contains(member.Name) && NeedsChatMemberProfileEnrichment(member));
        var remainingCandidates = members
            .Where(member => !priorityMemberNamesSet.Contains(member.Name) && NeedsChatMemberProfileEnrichment(member))
            .Take(ChatMemberProfileLookupLimit);
        var enrichmentCandidates = priorityCandidates
            .Concat(remainingCandidates)
            .DistinctBy(member => member.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (enrichmentCandidates.Length == 0)
        {
            return members;
        }

        var profileTasks = enrichmentCandidates.Select(async member => new
        {
            member.Name,
            Member = await EnrichChatMemberWithGoogleProfileAsync(
                httpClientFactory,
                cache,
                accessToken,
                userCachePrefix,
                member,
                cancellationToken),
        });
        var enrichedMembers = (await Task.WhenAll(profileTasks))
            .ToDictionary(result => result.Name, result => result.Member, StringComparer.OrdinalIgnoreCase);

        return members
            .Select(member => enrichedMembers.TryGetValue(member.Name, out var enrichedMember)
                ? enrichedMember
                : member)
            .ToArray();
    }

    private static bool NeedsChatMemberProfileEnrichment(GoogleChatMemberDto member) =>
        string.IsNullOrWhiteSpace(member.AvatarUrl) ||
        string.IsNullOrWhiteSpace(member.Email) ||
        string.IsNullOrWhiteSpace(CleanChatSenderName(member.DisplayName));

    private static async Task<GoogleChatMemberDto> EnrichChatMemberWithGoogleProfileAsync(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        string accessToken,
        string userCachePrefix,
        GoogleChatMemberDto member,
        CancellationToken cancellationToken)
    {
        var enrichedMember = member;

        if (IsGoogleHumanUserResourceName(member.Name))
        {
            var profile = await GetCachedGoogleWorkspaceProfileAsync(
                httpClientFactory,
                cache,
                accessToken,
                userCachePrefix,
                member.Name,
                cancellationToken);
            enrichedMember = ApplyGoogleProfileToChatMember(enrichedMember, profile);
        }

        if (!string.IsNullOrWhiteSpace(enrichedMember.AvatarUrl) &&
            !string.IsNullOrWhiteSpace(enrichedMember.Email) &&
            !IsGoogleHumanUserResourceName(enrichedMember.DisplayName))
        {
            return enrichedMember;
        }

        var directoryQuery = enrichedMember.Email ??
                             (IsGoogleHumanUserResourceName(enrichedMember.DisplayName)
                                 ? null
                                 : enrichedMember.DisplayName);

        if (string.IsNullOrWhiteSpace(directoryQuery))
        {
            return enrichedMember;
        }

        var directoryProfile = await GetCachedGoogleDirectoryProfileAsync(
            httpClientFactory,
            cache,
            accessToken,
            userCachePrefix,
            directoryQuery,
            cancellationToken);

        return ApplyGoogleProfileToChatMember(enrichedMember, directoryProfile);
    }

    private static GoogleChatMemberDto ApplyGoogleProfileToChatMember(
        GoogleChatMemberDto member,
        GoogleWorkspaceProfile? profile)
    {
        if (profile is null)
        {
            return member;
        }

        return member with
        {
            DisplayName = CleanChatSenderName(profile.DisplayName) ??
                          CleanChatSenderName(member.DisplayName) ??
                          "Google Chat user",
            Email = string.IsNullOrWhiteSpace(profile.Email) ? member.Email : profile.Email,
            AvatarUrl = string.IsNullOrWhiteSpace(profile.PhotoUrl) ? member.AvatarUrl : profile.PhotoUrl,
        };
    }

    private static GoogleChatMemberDto[] ApplyCurrentUserProfileToChatMembers(
        GoogleChatMemberDto[] members,
        string? currentChatUserName,
        GoogleWorkspaceProfile currentUserProfile)
    {
        if (string.IsNullOrWhiteSpace(currentChatUserName))
        {
            return members;
        }

        return members
            .Select(member => string.Equals(member.Name, currentChatUserName, StringComparison.OrdinalIgnoreCase)
                ? ApplyGoogleProfileToChatMember(member, currentUserProfile)
                : member)
            .ToArray();
    }

    private static GoogleChatMessageDto[] ApplyChatMemberProfilesToMessages(
        GoogleChatMessageDto[] messages,
        GoogleChatMemberDto[] members)
    {
        if (members.Length == 0)
        {
            return messages;
        }

        var membersByName = members.ToDictionary(member => member.Name, StringComparer.OrdinalIgnoreCase);

        return messages
            .Select(message =>
            {
                if (string.IsNullOrWhiteSpace(message.SenderName) ||
                    !membersByName.TryGetValue(message.SenderName, out var member))
                {
                    return message;
                }

                return message with
                {
                    Sender = CleanChatSenderName(member.DisplayName) ??
                             CleanChatSenderName(message.Sender) ??
                             "Google Chat user",
                    SenderEmail = string.IsNullOrWhiteSpace(member.Email) ? message.SenderEmail : member.Email,
                    SenderAvatarUrl = string.IsNullOrWhiteSpace(member.AvatarUrl) ? message.SenderAvatarUrl : member.AvatarUrl,
                };
            })
            .ToArray();
    }

    private static GoogleChatMessageDto[] ApplyCurrentUserProfileToMessages(
        GoogleChatMessageDto[] messages,
        string? currentChatUserName,
        GoogleWorkspaceProfile currentUserProfile)
    {
        if (string.IsNullOrWhiteSpace(currentChatUserName))
        {
            return messages;
        }

        return messages
            .Select(message =>
            {
                if (!string.Equals(message.SenderName, currentChatUserName, StringComparison.OrdinalIgnoreCase))
                {
                    return message;
                }

                return message with
                {
                    Sender = CleanChatSenderName(currentUserProfile.DisplayName) ??
                             CleanChatSenderName(message.Sender) ??
                             "You",
                    SenderEmail = string.IsNullOrWhiteSpace(currentUserProfile.Email)
                        ? message.SenderEmail
                        : currentUserProfile.Email,
                    SenderAvatarUrl = string.IsNullOrWhiteSpace(currentUserProfile.PhotoUrl)
                        ? message.SenderAvatarUrl
                        : currentUserProfile.PhotoUrl,
                };
            })
            .ToArray();
    }

    private static async Task<GoogleChatMessageDto[]> EnrichChatAttachmentsWithDriveMetadataAsync(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        string accessToken,
        string userCachePrefix,
        GoogleChatMessageDto[] messages,
        CancellationToken cancellationToken)
    {
        var driveFileIds = messages
            .SelectMany(message => message.Attachments ?? [])
            .Select(attachment => attachment.DriveFileId)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(ChatAttachmentMetadataLimit)
            .ToArray();

        if (driveFileIds.Length == 0)
        {
            return messages;
        }

        var metadataTasks = driveFileIds.Select(async fileId => new
        {
            FileId = fileId,
            Metadata = await GetCachedChatAttachmentMetadataAsync(
                httpClientFactory,
                cache,
                accessToken,
                userCachePrefix,
                fileId,
                cancellationToken),
        });
        var metadataByFileId = (await Task.WhenAll(metadataTasks))
            .Where(result => result.Metadata is not null)
            .ToDictionary(
                result => result.FileId,
                result => result.Metadata!,
                StringComparer.OrdinalIgnoreCase);

        if (metadataByFileId.Count == 0)
        {
            return messages;
        }

        return messages
            .Select(message => message with
            {
                Attachments = message.Attachments?
                    .Select(attachment => EnrichChatAttachment(attachment, metadataByFileId))
                    .ToArray(),
            })
            .ToArray();
    }

    private static GoogleChatAttachmentDto EnrichChatAttachment(
        GoogleChatAttachmentDto attachment,
        IReadOnlyDictionary<string, GoogleChatAttachmentMetadata> metadataByFileId)
    {
        if (string.IsNullOrWhiteSpace(attachment.DriveFileId) ||
            !metadataByFileId.TryGetValue(attachment.DriveFileId, out var metadata))
        {
            return attachment;
        }

        return attachment with
        {
            FileName = string.IsNullOrWhiteSpace(metadata.Name) ? attachment.FileName : metadata.Name,
            ContentType = string.IsNullOrWhiteSpace(metadata.MimeType) ? attachment.ContentType : metadata.MimeType,
            ThumbnailUri = string.IsNullOrWhiteSpace(attachment.ThumbnailUri)
                ? metadata.ThumbnailLink
                : attachment.ThumbnailUri,
            DownloadUri = string.IsNullOrWhiteSpace(attachment.DownloadUri)
                ? metadata.WebContentLink
                : attachment.DownloadUri,
            AttachmentResourceName = attachment.AttachmentResourceName,
            WebViewLink = metadata.WebViewLink,
            IconLink = metadata.IconLink,
            SizeBytes = metadata.SizeBytes,
        };
    }

    private static async Task<GoogleChatAttachmentMetadata?> GetCachedChatAttachmentMetadataAsync(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        string accessToken,
        string userCachePrefix,
        string fileId,
        CancellationToken cancellationToken)
    {
        var cacheKey = $"{userCachePrefix}:chat:attachment:{fileId}";

        return await cache.GetOrCreateAsync(
            cacheKey,
            async entry =>
            {
                try
                {
                    var metadata = await GetChatAttachmentMetadataAsync(
                        httpClientFactory,
                        accessToken,
                        fileId,
                        cancellationToken);
                    entry.AbsoluteExpirationRelativeToNow = ChatAttachmentMetadataCacheDuration;

                    return metadata;
                }
                catch (GoogleApiRequestException exception) when (exception.StatusCode is
                    StatusCodes.Status400BadRequest or
                    StatusCodes.Status403Forbidden or
                    StatusCodes.Status404NotFound)
                {
                    entry.AbsoluteExpirationRelativeToNow = ChatProfileMissCacheDuration;

                    return null;
                }
            });
    }

    private static async Task<GoogleChatAttachmentMetadata?> GetChatAttachmentMetadataAsync(
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
                ["fields"] = "id,name,mimeType,webViewLink,webContentLink,iconLink,thumbnailLink,size",
            });
        var payload = await SendGoogleGetAsync(
            httpClientFactory,
            accessToken,
            requestUrl,
            "Google Drive attachment metadata request failed.",
            cancellationToken);

        using var document = JsonDocument.Parse(payload);

        return new GoogleChatAttachmentMetadata(
            GetJsonString(document.RootElement, "name"),
            GetJsonString(document.RootElement, "mimeType"),
            GetJsonString(document.RootElement, "webViewLink"),
            GetJsonString(document.RootElement, "webContentLink"),
            GetJsonString(document.RootElement, "iconLink"),
            GetJsonString(document.RootElement, "thumbnailLink"),
            GetJsonLong(document.RootElement, "size"));
    }

    private static string[] GetChatSenderResourceNames(GoogleChatMessageDto[] messages) =>
        messages
            .Select(message => message.SenderName)
            .Where(IsGoogleHumanUserResourceName)
            .Select(senderName => senderName!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

    private static GoogleChatMemberDto? SelectPrimaryChatMember(
        GoogleChatSpaceDto space,
        GoogleChatMemberDto[] members,
        GoogleChatMessageDto[] messages,
        string currentUserKey,
        string? currentChatUserName)
    {
        if (members.Length == 0)
        {
            var latestHumanMessage = messages.LastOrDefault(message =>
                !IsGoogleChatFallbackSender(message) &&
                !IsCurrentGoogleChatSender(message.SenderName, currentChatUserName));

            return latestHumanMessage is null
                ? null
                : new GoogleChatMemberDto(
                    latestHumanMessage.SenderName ?? string.Empty,
                    latestHumanMessage.Sender,
                    latestHumanMessage.SenderEmail,
                    latestHumanMessage.SenderAvatarUrl,
                    latestHumanMessage.SenderType);
        }

        if (space.SpaceType == "DIRECT_MESSAGE")
        {
            var otherMember = members.FirstOrDefault(member =>
                !IsCurrentGoogleChatMember(member, currentUserKey, currentChatUserName) &&
                !IsUnresolvedChatMember(member));
            var unresolvedOtherMember = members.FirstOrDefault(member =>
                !IsCurrentGoogleChatMember(member, currentUserKey, currentChatUserName));

            if (otherMember is not null || unresolvedOtherMember is not null)
            {
                return otherMember ?? unresolvedOtherMember;
            }

            var latestOtherHumanMessage = messages.LastOrDefault(message =>
                !IsGoogleChatFallbackSender(message) &&
                !IsGoogleChatAppSender(message.SenderName, message.SenderType) &&
                !IsCurrentGoogleChatSender(message.SenderName, currentChatUserName));

            return latestOtherHumanMessage is null
                ? null
                : new GoogleChatMemberDto(
                    latestOtherHumanMessage.SenderName ?? string.Empty,
                    latestOtherHumanMessage.Sender,
                    latestOtherHumanMessage.SenderEmail,
                    latestOtherHumanMessage.SenderAvatarUrl,
                    latestOtherHumanMessage.SenderType);
        }

        return members.FirstOrDefault(member => !string.IsNullOrWhiteSpace(member.AvatarUrl)) ??
               members.FirstOrDefault();
    }

    private static bool IsGoogleChatFallbackSender(GoogleChatMessageDto message) =>
        string.Equals(message.Sender, "Google Chat", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(message.Sender, "Google Chat user", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(message.Sender, "Unknown user", StringComparison.OrdinalIgnoreCase);

    private static bool IsUnresolvedChatMember(GoogleChatMemberDto member) =>
        IsUnresolvedChatDisplayName(member.DisplayName);

    private static bool IsUnresolvedChatDisplayName(string? value) =>
        string.IsNullOrWhiteSpace(value) ||
        string.Equals(value, "Google Chat user", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(value, "Unknown user", StringComparison.OrdinalIgnoreCase) ||
        IsOpaqueGoogleIdentity(value);

    private static bool IsCurrentGoogleChatMember(
        GoogleChatMemberDto member,
        string currentUserKey,
        string? currentChatUserName)
    {
        if (!string.IsNullOrWhiteSpace(currentChatUserName) &&
            string.Equals(member.Name, currentChatUserName, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (string.IsNullOrWhiteSpace(currentUserKey))
        {
            return false;
        }

        return string.Equals(member.Email, currentUserKey, StringComparison.OrdinalIgnoreCase) ||
               string.Equals(member.DisplayName, currentUserKey, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsCurrentGoogleChatSender(string? senderName, string? currentChatUserName) =>
        !string.IsNullOrWhiteSpace(currentChatUserName) &&
        string.Equals(senderName, currentChatUserName, StringComparison.OrdinalIgnoreCase);

    private static GoogleChatMessageDto CreateGoogleChatMessageDto(JsonElement message)
    {
        var senderName = string.Empty;
        var senderEmail = (string?)null;
        var senderType = (string?)null;
        var senderAvatarUrl = (string?)null;
        var sender = (string?)null;

        if (message.TryGetProperty("sender", out var senderElement))
        {
            senderName = GetJsonString(senderElement, "name") ?? string.Empty;
            senderEmail = GetJsonString(senderElement, "email");
            senderType = GetJsonString(senderElement, "type");
            senderAvatarUrl = GetJsonString(senderElement, "avatarUrl");
            sender = GetJsonString(senderElement, "displayName") ?? senderEmail;
        }

        var text = GetJsonString(message, "text") ??
                   GetJsonString(message, "argumentText") ??
                   GetJsonString(message, "formattedText") ??
                   string.Empty;
        var attachments = GetChatAttachments(message);
        var normalizedText = NormalizeChatText(StripHtml(text));
        var cleanedSender = CleanChatSenderName(sender);
        var isAppSender = IsGoogleChatAppSender(senderName, senderType);
        var displaySender = isAppSender
            ? InferGoogleChatAppSenderName(normalizedText)
            : IsGoogleHumanUserResourceName(cleanedSender)
                ? null
                : cleanedSender;

        return new GoogleChatMessageDto(
            GetJsonString(message, "name") ?? string.Empty,
            string.IsNullOrWhiteSpace(displaySender)
                ? (isAppSender ? "Google Chat" : "Google Chat user")
                : displaySender,
            string.IsNullOrWhiteSpace(text) && attachments.Length > 0
                ? string.Empty
                : normalizedText,
            GetJsonDateTimeOffset(message, "createTime"),
            senderName,
            senderEmail,
            senderType,
            senderAvatarUrl,
            attachments);
    }

    private static bool IsGoogleChatAppSender(string? senderName, string? senderType) =>
        string.Equals(senderType, "BOT", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(senderName, "users/app", StringComparison.OrdinalIgnoreCase);

    private static string InferGoogleChatAppSenderName(string text)
    {
        if (text.Contains("figma", StringComparison.OrdinalIgnoreCase))
        {
            return "Figma";
        }

        if (text.Contains("google drive", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("공유", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("shared", StringComparison.OrdinalIgnoreCase))
        {
            return "Google Drive";
        }

        return "Google Chat";
    }

    private static async Task<GoogleChatMessageDto[]> EnrichChatMessagesWithGoogleProfilesAsync(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        string accessToken,
        string userCachePrefix,
        GoogleChatMessageDto[] messages,
        CancellationToken cancellationToken)
    {
        var senderResourceNames = messages
            .Select(message => message.SenderName)
            .Where(IsGoogleHumanUserResourceName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (senderResourceNames.Length == 0)
        {
            return messages;
        }

        var profileTasks = senderResourceNames.Select(async senderResourceName => new
        {
            SenderResourceName = senderResourceName!,
            Profile = await GetCachedGoogleWorkspaceProfileAsync(
                httpClientFactory,
                cache,
                accessToken,
                userCachePrefix,
                senderResourceName!,
                cancellationToken),
        });
        var profiles = (await Task.WhenAll(profileTasks))
            .Where(result => result.Profile is not null)
            .ToDictionary(
                result => result.SenderResourceName,
                result => result.Profile!,
                StringComparer.OrdinalIgnoreCase);

        if (profiles.Count < senderResourceNames.Length)
        {
            var missingSenderResourceNames = senderResourceNames
                .Where(senderResourceName => !profiles.ContainsKey(senderResourceName!))
                .Select(senderResourceName => senderResourceName!)
                .ToArray();
            if (missingSenderResourceNames.Length <= ChatDirectoryProfileFallbackLimit)
            {
                var directoryProfiles = await GetGoogleDirectoryProfilesByResourceNamesAsync(
                    httpClientFactory,
                    accessToken,
                    missingSenderResourceNames,
                    cancellationToken);

                foreach (var profile in directoryProfiles)
                {
                    foreach (var senderResourceName in GetChatUserNamesForGoogleProfile(profile))
                    {
                        profiles.TryAdd(senderResourceName, profile);
                    }
                }
            }
        }

        if (profiles.Count == 0)
        {
            return messages;
        }

        return messages
            .Select(message =>
            {
                if (string.IsNullOrWhiteSpace(message.SenderName) ||
                    !profiles.TryGetValue(message.SenderName, out var profile))
                {
                    return message;
                }

                return message with
                {
                    Sender = CleanChatSenderName(profile.DisplayName) ??
                             CleanChatSenderName(message.Sender) ??
                             "Google Chat user",
                    SenderEmail = string.IsNullOrWhiteSpace(profile.Email) ? message.SenderEmail : profile.Email,
                    SenderAvatarUrl = string.IsNullOrWhiteSpace(profile.PhotoUrl) ? message.SenderAvatarUrl : profile.PhotoUrl,
                };
            })
            .ToArray();
    }

    private static bool IsGoogleHumanUserResourceName(string? senderResourceName) =>
        !string.IsNullOrWhiteSpace(senderResourceName) &&
        senderResourceName.StartsWith("users/", StringComparison.OrdinalIgnoreCase) &&
        !string.Equals(senderResourceName, "users/app", StringComparison.OrdinalIgnoreCase);

    private static string? ConvertChatUserNameToPeopleResourceName(string? senderResourceName)
    {
        if (!IsGoogleHumanUserResourceName(senderResourceName))
        {
            return null;
        }

        var personId = senderResourceName!["users/".Length..].Trim();

        return string.IsNullOrWhiteSpace(personId)
            ? null
            : $"people/{personId}";
    }

    private static string? GetChatUserId(string? senderResourceName)
    {
        if (!IsGoogleHumanUserResourceName(senderResourceName))
        {
            return null;
        }

        var personId = senderResourceName!["users/".Length..].Trim();

        return string.IsNullOrWhiteSpace(personId) ? null : personId;
    }

    private static string? ConvertPeopleResourceNameToChatUserName(string? peopleResourceName)
    {
        if (string.IsNullOrWhiteSpace(peopleResourceName) ||
            !peopleResourceName.StartsWith("people/", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var personId = peopleResourceName["people/".Length..].Trim();

        return string.IsNullOrWhiteSpace(personId)
            ? null
            : $"users/{personId}";
    }

    private static async Task<string?> GetCurrentChatUserNameAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string? spaceName,
        string? currentUserEmail,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(spaceName) ||
            string.IsNullOrWhiteSpace(currentUserEmail) ||
            !currentUserEmail.Contains('@', StringComparison.Ordinal))
        {
            return null;
        }

        var requestUrl = QueryHelpers.AddQueryString(
            $"https://chat.googleapis.com/v1/{spaceName}/members/{Uri.EscapeDataString(currentUserEmail)}",
            new Dictionary<string, string?>
            {
                ["fields"] = "member(name,type),state",
            });
        string payload;

        try
        {
            payload = await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                requestUrl,
                "Google Chat current user membership request failed.",
                cancellationToken);
        }
        catch (GoogleApiRequestException exception) when (exception.StatusCode is
            StatusCodes.Status400BadRequest or
            StatusCodes.Status403Forbidden or
            StatusCodes.Status404NotFound)
        {
            return null;
        }

        using var document = JsonDocument.Parse(payload);

        return document.RootElement.TryGetProperty("member", out var memberElement) &&
               memberElement.ValueKind == JsonValueKind.Object
            ? GetJsonString(memberElement, "name")
            : null;
    }

    private static string[] GetChatUserNamesForGoogleProfile(GoogleWorkspaceProfile profile)
    {
        var names = new List<string>();
        var resourceName = ConvertPeopleResourceNameToChatUserName(profile.ResourceName);

        if (!string.IsNullOrWhiteSpace(resourceName))
        {
            names.Add(resourceName);
        }

        foreach (var sourceId in profile.SourceIds ?? [])
        {
            if (!string.IsNullOrWhiteSpace(sourceId))
            {
                names.Add($"users/{sourceId}");
            }
        }

        return names
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static async Task<GoogleWorkspaceProfile?> GetCachedGoogleWorkspaceProfileAsync(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        string accessToken,
        string userCachePrefix,
        string senderResourceName,
        CancellationToken cancellationToken)
    {
        if (!IsGoogleHumanUserResourceName(senderResourceName))
        {
            return null;
        }

        var cacheKey = $"{userCachePrefix}:chat:profile:resource:{senderResourceName}";
        var profileEntry = await cache.GetOrCreateAsync(
            cacheKey,
            async entry =>
            {
                try
                {
                    var profile = await GetGoogleWorkspaceProfileAsync(
                        httpClientFactory,
                        accessToken,
                        senderResourceName,
                        cancellationToken);
                    entry.AbsoluteExpirationRelativeToNow = profile is null
                        ? ChatProfileMissCacheDuration
                        : ChatProfileCacheDuration;

                    return new GoogleWorkspaceProfileCacheEntry(profile);
                }
                catch (GoogleApiRequestException exception) when (IsGooglePeopleQuotaExceeded(exception))
                {
                    entry.AbsoluteExpirationRelativeToNow = ChatPeopleQuotaCooldown;

                    return new GoogleWorkspaceProfileCacheEntry(null);
                }
            });

        return profileEntry?.Profile;
    }

    private static async Task<GoogleWorkspaceProfile?> GetCachedGoogleDirectoryProfileAsync(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        string accessToken,
        string userCachePrefix,
        string query,
        CancellationToken cancellationToken)
    {
        var normalizedQuery = NormalizeCacheKey(query);

        if (string.IsNullOrWhiteSpace(normalizedQuery))
        {
            return null;
        }

        var cacheKey = $"{userCachePrefix}:chat:profile:directory:{normalizedQuery}";
        var profileEntry = await cache.GetOrCreateAsync(
            cacheKey,
            async entry =>
            {
                try
                {
                    var profile = await GetGoogleDirectoryProfileAsync(
                        httpClientFactory,
                        accessToken,
                        query,
                        cancellationToken);
                    entry.AbsoluteExpirationRelativeToNow = profile is null
                        ? ChatProfileMissCacheDuration
                        : ChatProfileCacheDuration;

                    return new GoogleWorkspaceProfileCacheEntry(profile);
                }
                catch (GoogleApiRequestException exception) when (IsGooglePeopleQuotaExceeded(exception))
                {
                    entry.AbsoluteExpirationRelativeToNow = ChatPeopleQuotaCooldown;

                    return new GoogleWorkspaceProfileCacheEntry(null);
                }
            });

        return profileEntry?.Profile;
    }

    private static async Task<GoogleWorkspaceProfile?> GetGoogleWorkspaceProfileAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string senderResourceName,
        CancellationToken cancellationToken)
    {
        var personId = senderResourceName["users/".Length..].Trim();

        if (string.IsNullOrWhiteSpace(personId))
        {
            return null;
        }

        var requestUrl = QueryHelpers.AddQueryString(
            $"https://people.googleapis.com/v1/people/{Uri.EscapeDataString(personId)}",
            new Dictionary<string, string?>
            {
                ["personFields"] = "metadata,names,emailAddresses,photos",
                ["sources"] = "READ_SOURCE_TYPE_PROFILE",
                ["fields"] = "resourceName,metadata(sources(type,id)),names(displayName),emailAddresses(value),photos(url,default)",
            });
        string payload;

        try
        {
            payload = await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                requestUrl,
                "Google Workspace profile request failed.",
                cancellationToken);
        }
        catch (GoogleApiRequestException exception) when (exception.StatusCode is
            StatusCodes.Status400BadRequest or
            StatusCodes.Status403Forbidden or
            StatusCodes.Status404NotFound)
        {
            return await GetGoogleProfileAsync(
                httpClientFactory,
                accessToken,
                personId,
                cancellationToken);
        }

        using var document = JsonDocument.Parse(payload);

        var directoryProfile = CreateGoogleWorkspaceProfile(document.RootElement);

        return IsEmptyGoogleWorkspaceProfile(directoryProfile)
            ? await GetGoogleProfileAsync(httpClientFactory, accessToken, personId, cancellationToken)
            : directoryProfile;
    }

    private static async Task<GoogleWorkspaceProfile?> GetGoogleUserInfoProfileAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        CancellationToken cancellationToken)
    {
        string payload;

        try
        {
            payload = await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                "https://www.googleapis.com/oauth2/v3/userinfo",
                "Google user profile request failed.",
                cancellationToken);
        }
        catch (GoogleApiRequestException exception) when (exception.StatusCode is
            StatusCodes.Status400BadRequest or
            StatusCodes.Status401Unauthorized or
            StatusCodes.Status403Forbidden or
            StatusCodes.Status404NotFound)
        {
            return null;
        }

        using var document = JsonDocument.Parse(payload);

        return new GoogleWorkspaceProfile(
            GetJsonString(document.RootElement, "name"),
            GetJsonString(document.RootElement, "email"),
            GetJsonString(document.RootElement, "picture"),
            GetJsonString(document.RootElement, "sub"));
    }

    private static GoogleWorkspaceProfile CreateCurrentGoogleProfileFromClaims(ClaimsPrincipal user) =>
        new(
            user.FindFirstValue(ClaimTypes.Name) ??
            user.FindFirstValue("name") ??
            user.FindFirstValue(ClaimTypes.Email),
            user.FindFirstValue(ClaimTypes.Email),
            user.FindFirstValue("urn:google:picture"));

    private static async Task<GoogleWorkspaceProfile?> GetGoogleProfileAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string personId,
        CancellationToken cancellationToken)
    {
        var requestUrl = QueryHelpers.AddQueryString(
            $"https://people.googleapis.com/v1/people/{Uri.EscapeDataString(personId)}",
            new Dictionary<string, string?>
            {
                ["personFields"] = "metadata,names,emailAddresses,photos",
                ["fields"] = "resourceName,metadata(sources(type,id)),names(displayName),emailAddresses(value),photos(url,default)",
            });
        string payload;

        try
        {
            payload = await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                requestUrl,
                "Google profile request failed.",
                cancellationToken);
        }
        catch (GoogleApiRequestException exception) when (exception.StatusCode is
            StatusCodes.Status400BadRequest or
            StatusCodes.Status403Forbidden or
            StatusCodes.Status404NotFound)
        {
            return await GetAdminDirectoryProfileAsync(
                httpClientFactory,
                accessToken,
                personId,
                cancellationToken);
        }

        using var document = JsonDocument.Parse(payload);

        var profile = CreateGoogleWorkspaceProfile(document.RootElement);

        return IsEmptyGoogleWorkspaceProfile(profile)
            ? await GetAdminDirectoryProfileAsync(httpClientFactory, accessToken, personId, cancellationToken)
            : profile;
    }

    private static async Task<GoogleWorkspaceProfile?> GetAdminDirectoryProfileAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string userKey,
        CancellationToken cancellationToken)
    {
        var userProfileTask = GetAdminDirectoryUserProfileAsync(
            httpClientFactory,
            accessToken,
            userKey,
            cancellationToken);
        var userPhotoTask = GetAdminDirectoryUserPhotoUrlAsync(
            httpClientFactory,
            accessToken,
            userKey,
            cancellationToken);

        await Task.WhenAll(userProfileTask, userPhotoTask);

        var profile = await userProfileTask;
        var photoUrl = await userPhotoTask;

        return profile is null && string.IsNullOrWhiteSpace(photoUrl)
            ? null
            : new GoogleWorkspaceProfile(
                profile?.DisplayName,
                profile?.Email,
                string.IsNullOrWhiteSpace(photoUrl) ? profile?.PhotoUrl : photoUrl,
                profile?.ResourceName);
    }

    private static async Task<GoogleWorkspaceProfile?> GetAdminDirectoryUserProfileAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string userKey,
        CancellationToken cancellationToken)
    {
        var requestUrl = QueryHelpers.AddQueryString(
            $"https://admin.googleapis.com/admin/directory/v1/users/{Uri.EscapeDataString(userKey)}",
            new Dictionary<string, string?>
            {
                ["projection"] = "basic",
                ["fields"] = "id,primaryEmail,name(fullName),thumbnailPhotoUrl",
            });
        string payload;

        try
        {
            payload = await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                requestUrl,
                "Google Workspace Admin Directory user request failed.",
                cancellationToken);
        }
        catch (GoogleApiRequestException exception) when (exception.StatusCode is
            StatusCodes.Status400BadRequest or
            StatusCodes.Status403Forbidden or
            StatusCodes.Status404NotFound)
        {
            return null;
        }

        using var document = JsonDocument.Parse(payload);
        var name = document.RootElement.TryGetProperty("name", out var nameElement) &&
                   nameElement.ValueKind == JsonValueKind.Object
            ? GetJsonString(nameElement, "fullName")
            : null;

        return new GoogleWorkspaceProfile(
            name,
            GetJsonString(document.RootElement, "primaryEmail"),
            GetJsonString(document.RootElement, "thumbnailPhotoUrl"),
            $"people/{userKey}");
    }

    private static async Task<string?> GetAdminDirectoryUserPhotoUrlAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string userKey,
        CancellationToken cancellationToken)
    {
        var requestUrl = QueryHelpers.AddQueryString(
            $"https://admin.googleapis.com/admin/directory/v1/users/{Uri.EscapeDataString(userKey)}/photos/thumbnail",
            new Dictionary<string, string?>
            {
                ["fields"] = "mimeType,photoData",
            });
        string payload;

        try
        {
            payload = await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                requestUrl,
                "Google Workspace Admin Directory user photo request failed.",
                cancellationToken);
        }
        catch (GoogleApiRequestException exception) when (exception.StatusCode is
            StatusCodes.Status400BadRequest or
            StatusCodes.Status403Forbidden or
            StatusCodes.Status404NotFound)
        {
            return null;
        }

        using var document = JsonDocument.Parse(payload);
        var photoData = GetJsonString(document.RootElement, "photoData");

        return string.IsNullOrWhiteSpace(photoData)
            ? null
            : $"data:{GetJsonString(document.RootElement, "mimeType") ?? "image/jpeg"};base64,{NormalizeGooglePhotoData(photoData)}";
    }

    private static string NormalizeGooglePhotoData(string photoData)
    {
        var normalized = photoData.Replace('-', '+').Replace('_', '/');
        var padding = normalized.Length % 4;

        return padding == 0
            ? normalized
            : normalized.PadRight(normalized.Length + 4 - padding, '=');
    }

    private static bool IsEmptyGoogleWorkspaceProfile(GoogleWorkspaceProfile profile) =>
        string.IsNullOrWhiteSpace(profile.DisplayName) &&
        string.IsNullOrWhiteSpace(profile.Email) &&
        string.IsNullOrWhiteSpace(profile.PhotoUrl);

    private static GoogleWorkspaceProfile CreateGoogleWorkspaceProfile(JsonElement person) =>
        new(
            GetPeopleDisplayName(person),
            GetPeopleEmail(person),
            GetPeoplePhotoUrl(person),
            GetPeopleResourceName(person),
            GetPeopleSourceIds(person));

    private static bool MatchesWantedGoogleProfile(
        GoogleWorkspaceProfile profile,
        HashSet<string> wantedPeopleResourceNames,
        HashSet<string> wantedSourceIds)
    {
        if (!string.IsNullOrWhiteSpace(profile.ResourceName) &&
            wantedPeopleResourceNames.Contains(profile.ResourceName))
        {
            return true;
        }

        return (profile.SourceIds ?? [])
            .Any(sourceId => wantedSourceIds.Contains(sourceId));
    }

    private static async Task<GoogleWorkspaceProfile[]> GetGoogleDirectoryProfilesByResourceNamesAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string[] senderResourceNames,
        CancellationToken cancellationToken)
    {
        var wantedPeopleResourceNames = senderResourceNames
            .Select(ConvertChatUserNameToPeopleResourceName)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var wantedSourceIds = senderResourceNames
            .Select(GetChatUserId)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (wantedPeopleResourceNames.Count == 0 && wantedSourceIds.Count == 0)
        {
            return [];
        }

        var profiles = new List<GoogleWorkspaceProfile>();
        var pageToken = (string?)null;
        var pageCount = 0;

        do
        {
            var requestUrl = QueryHelpers.AddQueryString(
                "https://people.googleapis.com/v1/people:listDirectoryPeople",
                new Dictionary<string, string?>
                {
                    ["readMask"] = "metadata,names,emailAddresses,photos",
                    ["sources"] = "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
                    ["pageSize"] = "500",
                    ["pageToken"] = pageToken,
                    ["fields"] = "people(resourceName,metadata(sources(type,id)),names(displayName),emailAddresses(value),photos(url,default)),nextPageToken",
                });
            string payload;

            try
            {
                payload = await SendGoogleGetAsync(
                    httpClientFactory,
                    accessToken,
                    requestUrl,
                    "Google Workspace directory list request failed.",
                    cancellationToken);
            }
            catch (GoogleApiRequestException exception) when (exception.StatusCode is
                StatusCodes.Status400BadRequest or
                StatusCodes.Status403Forbidden or
                StatusCodes.Status404NotFound)
            {
                return [];
            }

            using var document = JsonDocument.Parse(payload);

            if (document.RootElement.TryGetProperty("people", out var peopleElement) &&
                peopleElement.ValueKind == JsonValueKind.Array)
            {
                profiles.AddRange(peopleElement
                    .EnumerateArray()
                    .Select(CreateGoogleWorkspaceProfile)
                    .Where(profile => MatchesWantedGoogleProfile(profile, wantedPeopleResourceNames, wantedSourceIds)));
            }

            pageToken = GetJsonString(document.RootElement, "nextPageToken");
            pageCount += 1;
        }
        while (!string.IsNullOrWhiteSpace(pageToken) &&
               pageCount < 10 &&
               profiles.Count < Math.Max(wantedPeopleResourceNames.Count, wantedSourceIds.Count));

        return profiles
            .GroupBy(profile => profile.ResourceName, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToArray();
    }

    private static string? GetPeopleDisplayName(JsonElement person) =>
        person.TryGetProperty("names", out var namesElement) &&
        namesElement.ValueKind == JsonValueKind.Array
            ? namesElement
                .EnumerateArray()
                .Select(name => GetJsonString(name, "displayName"))
                .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))
            : null;

    private static string? GetPeopleResourceName(JsonElement person) =>
        GetJsonString(person, "resourceName");

    private static string[] GetPeopleSourceIds(JsonElement person)
    {
        if (!person.TryGetProperty("metadata", out var metadataElement) ||
            metadataElement.ValueKind != JsonValueKind.Object ||
            !metadataElement.TryGetProperty("sources", out var sourcesElement) ||
            sourcesElement.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return sourcesElement
            .EnumerateArray()
            .Select(source => GetJsonString(source, "id"))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string? GetPeopleEmail(JsonElement person) =>
        person.TryGetProperty("emailAddresses", out var emailsElement) &&
        emailsElement.ValueKind == JsonValueKind.Array
            ? emailsElement
                .EnumerateArray()
                .Select(email => GetJsonString(email, "value"))
                .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))
            : null;

    private static string? GetPeoplePhotoUrl(JsonElement person)
    {
        if (!person.TryGetProperty("photos", out var photosElement) ||
            photosElement.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var photos = photosElement.EnumerateArray().ToArray();
        var nonDefaultPhoto = photos.FirstOrDefault(photo =>
            GetJsonBool(photo, "default") != true &&
            !string.IsNullOrWhiteSpace(GetJsonString(photo, "url")));
        var photoUrl = nonDefaultPhoto.ValueKind == JsonValueKind.Object
            ? GetJsonString(nonDefaultPhoto, "url")
            : null;

        return string.IsNullOrWhiteSpace(photoUrl)
            ? photos
                .Select(photo => GetJsonString(photo, "url"))
                .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))
            : photoUrl;
    }

    private static async Task<GoogleChatMessageDto[]> EnrichChatMessagesWithDirectoryProfilesAsync(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        string accessToken,
        string userCachePrefix,
        GoogleChatMessageDto[] messages,
        CancellationToken cancellationToken)
    {
        var queries = messages
            .SelectMany(CreateDirectoryProfileQueries)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(ChatDirectoryProfileQueryLimit)
            .ToArray();

        if (queries.Length == 0)
        {
            return messages;
        }

        var profileTasks = queries.Select(query => GetCachedGoogleDirectoryProfileAsync(
            httpClientFactory,
            cache,
            accessToken,
            userCachePrefix,
            query,
            cancellationToken));
        var profiles = (await Task.WhenAll(profileTasks))
            .Where(profile => profile is not null)
            .Select(profile => profile!)
            .GroupBy(
                profile => profile.Email ?? profile.DisplayName ?? profile.PhotoUrl,
                StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToArray();

        if (profiles.Length == 0)
        {
            return messages;
        }

        return messages
            .Select(message =>
            {
                var matchedProfile = FindMatchingGoogleWorkspaceProfile(message, profiles);

                if (matchedProfile is null)
                {
                    return message;
                }

                return message with
                {
                    Sender = CleanChatSenderName(matchedProfile.DisplayName) ??
                             CleanChatSenderName(message.Sender) ??
                             "Google Chat user",
                    SenderEmail = string.IsNullOrWhiteSpace(matchedProfile.Email)
                        ? message.SenderEmail
                        : matchedProfile.Email,
                    SenderAvatarUrl = string.IsNullOrWhiteSpace(matchedProfile.PhotoUrl)
                        ? message.SenderAvatarUrl
                        : matchedProfile.PhotoUrl,
                };
            })
            .ToArray();
    }

    private static IEnumerable<string?> CreateDirectoryProfileQueries(GoogleChatMessageDto message)
    {
        yield return message.SenderEmail;

        if (!IsGoogleChatFallbackSender(message) &&
            !IsGoogleChatAppSender(message.SenderName, message.SenderType))
        {
            yield return message.Sender;
        }
    }

    private static async Task<GoogleWorkspaceProfile?> GetGoogleDirectoryProfileAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string query,
        CancellationToken cancellationToken)
    {
        var requestUrl = QueryHelpers.AddQueryString(
            "https://people.googleapis.com/v1/people:searchDirectoryPeople",
            new Dictionary<string, string?>
            {
                ["query"] = query,
                ["readMask"] = "metadata,names,emailAddresses,photos",
                ["sources"] = "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
                ["pageSize"] = "5",
                ["fields"] = "people(resourceName,metadata(sources(type,id)),names(displayName),emailAddresses(value),photos(url,default))",
            });
        string payload;

        try
        {
            payload = await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                requestUrl,
                "Google Workspace directory profile request failed.",
                cancellationToken);
        }
        catch (GoogleApiRequestException exception) when (exception.StatusCode is
            StatusCodes.Status400BadRequest or
            StatusCodes.Status403Forbidden or
            StatusCodes.Status404NotFound)
        {
            return null;
        }

        using var document = JsonDocument.Parse(payload);

        if (!document.RootElement.TryGetProperty("people", out var peopleElement) ||
            peopleElement.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var profiles = peopleElement
            .EnumerateArray()
            .Select(CreateGoogleWorkspaceProfile)
            .ToArray();

        return FindBestGoogleWorkspaceProfile(query, profiles);
    }

    private static GoogleWorkspaceProfile? FindBestGoogleWorkspaceProfile(
        string query,
        GoogleWorkspaceProfile[] profiles)
    {
        var queryEmail = ExtractEmailAddress(query) ?? (query.Contains('@', StringComparison.Ordinal) ? query : null);
        var normalizedQuery = NormalizeIdentityName(query);

        return profiles.FirstOrDefault(profile =>
                   !string.IsNullOrWhiteSpace(queryEmail) &&
                   string.Equals(profile.Email, queryEmail, StringComparison.OrdinalIgnoreCase)) ??
               profiles.FirstOrDefault(profile =>
                   !string.IsNullOrWhiteSpace(normalizedQuery) &&
                   string.Equals(NormalizeIdentityName(profile.DisplayName), normalizedQuery, StringComparison.OrdinalIgnoreCase)) ??
               profiles.FirstOrDefault(profile => !string.IsNullOrWhiteSpace(profile.PhotoUrl));
    }

    private static GoogleWorkspaceProfile? FindMatchingGoogleWorkspaceProfile(
        GoogleChatMessageDto message,
        GoogleWorkspaceProfile[] profiles)
    {
        var senderEmail = message.SenderEmail;

        if (!string.IsNullOrWhiteSpace(senderEmail))
        {
            var emailMatch = profiles.FirstOrDefault(profile =>
                string.Equals(profile.Email, senderEmail, StringComparison.OrdinalIgnoreCase));

            if (emailMatch is not null)
            {
                return emailMatch;
            }
        }

        if (IsGoogleChatFallbackSender(message) ||
            IsGoogleChatAppSender(message.SenderName, message.SenderType))
        {
            return null;
        }

        var senderName = NormalizeIdentityName(message.Sender);

        if (string.IsNullOrWhiteSpace(senderName))
        {
            return null;
        }

        return profiles.FirstOrDefault(profile =>
        {
            var profileName = NormalizeIdentityName(profile.DisplayName);

            return !string.IsNullOrWhiteSpace(profileName) &&
                   (profileName.Contains(senderName, StringComparison.OrdinalIgnoreCase) ||
                    senderName.Contains(profileName, StringComparison.OrdinalIgnoreCase));
        });
    }

    private static async Task<GoogleChatMessageDto[]> EnrichChatMessagesWithDrivePermissionPhotosAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        GoogleChatMessageDto[] messages,
        CancellationToken cancellationToken)
    {
        var driveFileIds = messages
            .SelectMany(message => message.Attachments ?? [])
            .Select(attachment => attachment.DriveFileId)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(12)
            .ToArray();

        if (driveFileIds.Length == 0)
        {
            return messages;
        }

        var permissionTasks = driveFileIds.Select(fileId => GetGoogleDrivePermissionProfilesAsync(
            httpClientFactory,
            accessToken,
            fileId!,
            cancellationToken));
        var permissionProfiles = (await Task.WhenAll(permissionTasks))
            .SelectMany(profile => profile)
            .Where(profile => !string.IsNullOrWhiteSpace(profile.PhotoLink))
            .GroupBy(
                profile => profile.EmailAddress ?? profile.DisplayName ?? profile.PhotoLink,
                StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToArray();

        if (permissionProfiles.Length == 0)
        {
            return messages;
        }

        return messages
            .Select(message =>
            {
                var matchedProfile = FindMatchingDrivePermissionProfile(message, permissionProfiles);

                if (matchedProfile is null)
                {
                    return message;
                }

                return message with
                {
                    Sender = CleanChatSenderName(matchedProfile.DisplayName) ??
                             CleanChatSenderName(message.Sender) ??
                             "Google Chat user",
                    SenderEmail = string.IsNullOrWhiteSpace(matchedProfile.EmailAddress)
                        ? message.SenderEmail
                        : matchedProfile.EmailAddress,
                    SenderAvatarUrl = string.IsNullOrWhiteSpace(matchedProfile.PhotoLink)
                        ? message.SenderAvatarUrl
                        : matchedProfile.PhotoLink,
                };
            })
            .ToArray();
    }

    private static async Task<GoogleDrivePermissionProfile[]> GetGoogleDrivePermissionProfilesAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string fileId,
        CancellationToken cancellationToken)
    {
        var requestUrl = QueryHelpers.AddQueryString(
            $"https://www.googleapis.com/drive/v3/files/{Uri.EscapeDataString(fileId)}/permissions",
            new Dictionary<string, string?>
            {
                ["supportsAllDrives"] = "true",
                ["fields"] = "permissions(type,displayName,emailAddress,photoLink,deleted)",
            });
        string payload;

        try
        {
            payload = await SendGoogleGetAsync(
                httpClientFactory,
                accessToken,
                requestUrl,
                "Google Drive permissions request failed.",
                cancellationToken);
        }
        catch (GoogleApiRequestException exception) when (exception.StatusCode is
            StatusCodes.Status400BadRequest or
            StatusCodes.Status403Forbidden or
            StatusCodes.Status404NotFound)
        {
            return [];
        }

        using var document = JsonDocument.Parse(payload);

        return document.RootElement.TryGetProperty("permissions", out var permissionsElement) &&
               permissionsElement.ValueKind == JsonValueKind.Array
            ? permissionsElement
                .EnumerateArray()
                .Where(permission =>
                    string.Equals(GetJsonString(permission, "type"), "user", StringComparison.OrdinalIgnoreCase) &&
                    GetJsonBool(permission, "deleted") != true)
                .Select(permission => new GoogleDrivePermissionProfile(
                    GetJsonString(permission, "displayName"),
                    GetJsonString(permission, "emailAddress"),
                    GetJsonString(permission, "photoLink")))
                .Where(profile => !string.IsNullOrWhiteSpace(profile.PhotoLink))
                .ToArray()
            : [];
    }

    private static GoogleDrivePermissionProfile? FindMatchingDrivePermissionProfile(
        GoogleChatMessageDto message,
        GoogleDrivePermissionProfile[] permissionProfiles)
    {
        var senderEmail = message.SenderEmail;

        if (!string.IsNullOrWhiteSpace(senderEmail))
        {
            var emailMatch = permissionProfiles.FirstOrDefault(profile =>
                string.Equals(profile.EmailAddress, senderEmail, StringComparison.OrdinalIgnoreCase));

            if (emailMatch is not null)
            {
                return emailMatch;
            }
        }

        if (IsGoogleChatFallbackSender(message) ||
            IsGoogleChatAppSender(message.SenderName, message.SenderType))
        {
            return null;
        }

        var senderName = NormalizeIdentityName(message.Sender);

        if (string.IsNullOrWhiteSpace(senderName))
        {
            return null;
        }

        return permissionProfiles.FirstOrDefault(profile =>
        {
            var profileName = NormalizeIdentityName(profile.DisplayName);

            return !string.IsNullOrWhiteSpace(profileName) &&
                   (profileName.Contains(senderName, StringComparison.OrdinalIgnoreCase) ||
                    senderName.Contains(profileName, StringComparison.OrdinalIgnoreCase));
        });
    }

    private static string? ExtractEmailAddress(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var emailMatch = Regex.Match(
            text,
            @"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        return emailMatch.Success ? emailMatch.Value : null;
    }

    private static string? NormalizeIdentityName(string? value)
    {
        var cleanedValue = CleanChatSenderName(value);

        return string.IsNullOrWhiteSpace(cleanedValue)
            ? null
            : Regex.Replace(cleanedValue.ToUpperInvariant(), @"[^\p{L}\p{N}]+", "", RegexOptions.Compiled);
    }

    private static GoogleChatAttachmentDto[] GetChatAttachments(JsonElement message)
    {
        if (!message.TryGetProperty("attachment", out var attachmentsElement) ||
            attachmentsElement.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return attachmentsElement
            .EnumerateArray()
            .Select(attachment =>
            {
                var driveFileId = attachment.TryGetProperty("driveDataRef", out var driveDataRef)
                    ? GetJsonString(driveDataRef, "driveFileId")
                    : null;
                var attachmentResourceName = attachment.TryGetProperty("attachmentDataRef", out var attachmentDataRef)
                    ? GetJsonString(attachmentDataRef, "resourceName")
                    : null;
                var fileName = GetJsonString(attachment, "contentName");

                return new GoogleChatAttachmentDto(
                    GetJsonString(attachment, "name") ?? string.Empty,
                    string.IsNullOrWhiteSpace(fileName) ? "Attachment" : fileName,
                    GetJsonString(attachment, "contentType") ?? "application/octet-stream",
                    GetJsonString(attachment, "source") ?? "UPLOADED_CONTENT",
                    GetJsonString(attachment, "thumbnailUri"),
                    GetJsonString(attachment, "downloadUri"),
                    driveFileId,
                    attachmentResourceName);
            })
            .ToArray();
    }

    private static string CreateChatSpaceDisplayName(
        GoogleChatSpaceDto space,
        GoogleChatMessageDto[] messages,
        GoogleChatMemberDto? primaryMember,
        string? currentChatUserName)
    {
        if (!IsGeneratedChatSpaceDisplayName(space.DisplayName, space.SpaceType))
        {
            return space.DisplayName;
        }

        if (primaryMember is not null &&
            !IsUnresolvedChatDisplayName(primaryMember.DisplayName))
        {
            return primaryMember.DisplayName;
        }

        var inferredName = messages
            .LastOrDefault(message =>
                !IsGoogleChatFallbackSender(message) &&
                !IsGoogleChatAppSender(message.SenderName, message.SenderType) &&
                !IsCurrentGoogleChatSender(message.SenderName, currentChatUserName))
            ?.Sender;

        if (!string.IsNullOrWhiteSpace(inferredName) &&
            !IsUnresolvedChatDisplayName(inferredName))
        {
            return inferredName;
        }

        var latestAppMessage = messages.LastOrDefault(message =>
            IsGoogleChatAppSender(message.SenderName, message.SenderType));

        if (latestAppMessage is not null)
        {
            return InferGoogleChatAppSenderName(latestAppMessage.Text);
        }

        return space.SpaceType switch
        {
            "DIRECT_MESSAGE" => "Direct message",
            "GROUP_CHAT" => "Group chat",
            _ => "Space",
        };
    }

    private static GoogleChatSpaceDto SanitizeChatSpaceForDisplay(GoogleChatSpaceDto space)
    {
        var messages = space.Messages
            .Select(SanitizeChatMessageForDisplay)
            .ToArray();
        var members = space.Members?
            .Select(SanitizeChatMemberForDisplay)
            .ToArray();
        var primaryMember = space.PrimaryMember is null
            ? null
            : SanitizeChatMemberForDisplay(space.PrimaryMember);
        var displayName = CleanChatSenderName(space.DisplayName) ?? space.DisplayName;

        if (IsOpaqueGoogleIdentity(displayName))
        {
            displayName = FormatChatSpaceFallbackName(space.Name, space.SpaceType);
        }

        return space with
        {
            DisplayName = displayName,
            Messages = messages,
            Members = members,
            PrimaryMember = primaryMember,
        };
    }

    private static GoogleChatMessageDto SanitizeChatMessageForDisplay(GoogleChatMessageDto message)
    {
        if (IsGoogleChatAppSender(message.SenderName, message.SenderType))
        {
            return message with
            {
                Sender = CleanChatSenderName(message.Sender) ?? "Google Chat",
            };
        }

        return message with
        {
            Sender = CleanChatSenderName(message.Sender) ?? "Google Chat user",
        };
    }

    private static GoogleChatMemberDto SanitizeChatMemberForDisplay(GoogleChatMemberDto member) =>
        member with
        {
            DisplayName = CleanChatSenderName(member.DisplayName) ?? "Google Chat user",
        };

    private static bool IsGeneratedChatSpaceDisplayName(string displayName, string spaceType) =>
        displayName.StartsWith("Direct message ", StringComparison.OrdinalIgnoreCase) ||
        displayName.StartsWith("Group chat ", StringComparison.OrdinalIgnoreCase) ||
        displayName.StartsWith("Space ", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(displayName, FormatChatSpaceFallbackName(string.Empty, spaceType), StringComparison.OrdinalIgnoreCase);

    private static bool MatchesChatSearch(GoogleChatSpaceDto space, string searchTerm) =>
        space.DisplayName.Contains(searchTerm, StringComparison.OrdinalIgnoreCase) ||
        space.Messages.Any(message =>
            message.Sender.Contains(searchTerm, StringComparison.OrdinalIgnoreCase) ||
            (message.SenderEmail?.Contains(searchTerm, StringComparison.OrdinalIgnoreCase) ?? false) ||
            message.Text.Contains(searchTerm, StringComparison.OrdinalIgnoreCase) ||
            (message.Attachments?.Any(attachment =>
                attachment.FileName.Contains(searchTerm, StringComparison.OrdinalIgnoreCase)) ?? false));

    private static string? CleanChatSenderName(string? sender)
    {
        if (string.IsNullOrWhiteSpace(sender))
        {
            return null;
        }

        var withoutEmailParentheses = Regex.Replace(
            sender,
            @"\s*\([^)]*@[^)]*\)\s*",
            " ",
            RegexOptions.Compiled);

        var cleanedSender = NormalizeWhitespace(withoutEmailParentheses);

        return IsOpaqueGoogleIdentity(cleanedSender)
            ? null
            : cleanedSender;
    }

    private static bool IsOpaqueGoogleIdentity(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        (IsGoogleHumanUserResourceName(value) ||
         value.StartsWith("people/", StringComparison.OrdinalIgnoreCase));

    private static string NormalizeChatText(string value)
    {
        var normalizedLineEndings = value.ReplaceLineEndings("\n");
        var lines = normalizedLineEndings
            .Split('\n')
            .Select(line => Regex.Replace(line.Trim(), @"[ \t]+", " ", RegexOptions.Compiled))
            .ToArray();

        return Regex.Replace(string.Join('\n', lines).Trim(), @"\n{3,}", "\n\n", RegexOptions.Compiled);
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

    private static bool IsGooglePeopleQuotaExceeded(GoogleApiRequestException exception)
    {
        return exception.StatusCode == StatusCodes.Status429TooManyRequests ||
               (exception.Detail.Contains("people.googleapis.com", StringComparison.OrdinalIgnoreCase) &&
                exception.Detail.Contains("Quota exceeded", StringComparison.OrdinalIgnoreCase)) ||
               exception.Detail.Contains("Critical read requests", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeWhitespace(string value)
    {
        return Regex.Replace(value, @"\s+", " ", RegexOptions.Compiled).Trim();
    }

    private static string NormalizeCacheKey(string value)
    {
        return Regex.Replace(value.Trim().ToLowerInvariant(), @"[^\w@.\-/]+", "_", RegexOptions.Compiled);
    }

    private static string NormalizeSearchCacheKey(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return fallback;
        }

        var normalizedValue = NormalizeCacheKey(value);

        if (string.IsNullOrWhiteSpace(normalizedValue))
        {
            return fallback;
        }

        if (normalizedValue.Length <= SearchCacheKeyMaxLength)
        {
            return normalizedValue;
        }

        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalizedValue)))
            .ToLowerInvariant();

        return $"{normalizedValue[..SearchCacheKeyMaxLength]}-{hash[..16]}";
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

    private static async Task<GoogleAvatarImage> GetGoogleAvatarImageAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string avatarUrl,
        CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(avatarUrl, UriKind.Absolute, out var uri) ||
            !IsAllowedGoogleAvatarUri(uri))
        {
            throw new GoogleApiRequestException(
                "Google avatar URL was invalid.",
                "The profile image URL was not a trusted Google image URL.",
                StatusCodes.Status400BadRequest);
        }

        var avatar = await TryFetchGoogleAvatarImageAsync(
            httpClientFactory,
            uri,
            accessToken,
            cancellationToken);

        if (avatar is not null)
        {
            return avatar;
        }

        avatar = await TryFetchGoogleAvatarImageAsync(
            httpClientFactory,
            uri,
            accessToken: null,
            cancellationToken);

        if (avatar is not null)
        {
            return avatar;
        }

        throw new GoogleApiRequestException(
            "Google avatar could not be loaded.",
            "The profile image could not be fetched from Google.",
            StatusCodes.Status502BadGateway);
    }

    private static async Task<DriveDownloadPayload> GetGoogleAvatarImagePayloadAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string avatarUrl,
        CancellationToken cancellationToken)
    {
        var avatar = await GetGoogleAvatarImageAsync(
            httpClientFactory,
            accessToken,
            avatarUrl,
            cancellationToken);

        return new DriveDownloadPayload(avatar.Content, avatar.ContentType, "preview");
    }

    private static async Task<GoogleAvatarImage?> TryFetchGoogleAvatarImageAsync(
        IHttpClientFactory httpClientFactory,
        Uri uri,
        string? accessToken,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);

        if (!string.IsNullOrWhiteSpace(accessToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        }

        using var response = await httpClientFactory
            .CreateClient()
            .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            return null;
        }

        var contentType = response.Content.Headers.ContentType?.MediaType ?? "image/jpeg";

        if (!contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var content = await response.Content.ReadAsByteArrayAsync(cancellationToken);

        return content.Length is > 0 and <= 2_000_000
            ? new GoogleAvatarImage(content, contentType)
            : null;
    }

    private static bool IsAllowedGoogleAvatarUri(Uri uri)
    {
        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var host = uri.Host;

        return host.Equals("googleusercontent.com", StringComparison.OrdinalIgnoreCase) ||
               host.EndsWith(".googleusercontent.com", StringComparison.OrdinalIgnoreCase) ||
               host.Equals("google.com", StringComparison.OrdinalIgnoreCase) ||
               host.EndsWith(".google.com", StringComparison.OrdinalIgnoreCase) ||
               host.Equals("googleapis.com", StringComparison.OrdinalIgnoreCase) ||
               host.EndsWith(".googleapis.com", StringComparison.OrdinalIgnoreCase);
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

    private static async Task<DriveDownloadPayload> GetGoogleChatAttachmentMediaAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string resourceName,
        string? fileName,
        string? contentType,
        CancellationToken cancellationToken)
    {
        ValidateGoogleChatAttachmentResourceName(resourceName);

        var requestUrl = QueryHelpers.AddQueryString(
            $"https://chat.googleapis.com/v1/media/{EscapeGoogleResourcePath(resourceName)}",
            new Dictionary<string, string?>
            {
                ["alt"] = "media",
            });
        using var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        using var response = await httpClientFactory
            .CreateClient()
            .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var payload = await response.Content.ReadAsStringAsync(cancellationToken);

            throw new GoogleApiRequestException(
                "Google Chat attachment download failed.",
                payload,
                (int)response.StatusCode);
        }

        if (response.Content.Headers.ContentLength > ChatAttachmentPreviewMaxBytes)
        {
            throw new GoogleApiRequestException(
                "Google Chat attachment is too large to preview.",
                "This attachment is too large to preview inline.",
                StatusCodes.Status413PayloadTooLarge);
        }

        var content = await response.Content.ReadAsByteArrayAsync(cancellationToken);

        if (content.Length > ChatAttachmentPreviewMaxBytes)
        {
            throw new GoogleApiRequestException(
                "Google Chat attachment is too large to preview.",
                "This attachment is too large to preview inline.",
                StatusCodes.Status413PayloadTooLarge);
        }

        return new DriveDownloadPayload(
            content,
            response.Content.Headers.ContentType?.MediaType ??
            (string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType),
            SanitizeFileName(string.IsNullOrWhiteSpace(fileName) ? "attachment" : fileName));
    }

    private static async Task<DriveDownloadPayload> GetGoogleChatAttachmentPreviewPayloadAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string resourceName,
        string? fileName,
        string? contentType,
        CancellationToken cancellationToken)
    {
        var media = await GetGoogleChatAttachmentMediaAsync(
            httpClientFactory,
            accessToken,
            resourceName,
            fileName,
            contentType,
            cancellationToken);

        if (media.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            return media;
        }

        if (media.ContentType.Equals("application/pdf", StringComparison.OrdinalIgnoreCase))
        {
            return media;
        }

        if (TryExtractOfficeThumbnail(media.Content, out var thumbnail))
        {
            return new DriveDownloadPayload(thumbnail.Content, thumbnail.ContentType, "preview");
        }

        throw new GoogleApiRequestException(
            "Google Chat attachment preview was unavailable.",
            "Google Chat did not provide a thumbnail for this attachment.",
            StatusCodes.Status404NotFound);
    }

    private static bool TryExtractOfficeThumbnail(byte[] content, out GoogleAvatarImage thumbnail)
    {
        thumbnail = default!;

        try
        {
            using var stream = new MemoryStream(content);
            using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
            var thumbnailEntry = archive.Entries.FirstOrDefault(entry =>
                string.Equals(entry.FullName, "docProps/thumbnail.jpeg", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(entry.FullName, "docProps/thumbnail.jpg", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(entry.FullName, "docProps/thumbnail.png", StringComparison.OrdinalIgnoreCase));

            if (thumbnailEntry is null ||
                thumbnailEntry.Length <= 0 ||
                thumbnailEntry.Length > 2_000_000)
            {
                return false;
            }

            using var thumbnailStream = thumbnailEntry.Open();
            using var buffer = new MemoryStream();
            thumbnailStream.CopyTo(buffer);
            var extension = Path.GetExtension(thumbnailEntry.FullName);
            var contentType = string.Equals(extension, ".png", StringComparison.OrdinalIgnoreCase)
                ? "image/png"
                : "image/jpeg";

            thumbnail = new GoogleAvatarImage(buffer.ToArray(), contentType);
            return true;
        }
        catch (InvalidDataException)
        {
            return false;
        }
    }

    private static bool TryParseChatMediaPreviewToken(string value, out ChatAttachmentPreviewRequest previewRequest)
    {
        previewRequest = default!;
        const string prefix = "chat-media:";

        if (string.IsNullOrWhiteSpace(value) ||
            !value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var parts = value[prefix.Length..].Split('|');

        if (parts.Length < 1)
        {
            return false;
        }

        var resourceName = Uri.UnescapeDataString(parts[0]);

        if (string.IsNullOrWhiteSpace(resourceName))
        {
            return false;
        }

        previewRequest = new ChatAttachmentPreviewRequest(
            resourceName,
            parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : null,
            parts.Length > 2 ? Uri.UnescapeDataString(parts[2]) : null);

        return true;
    }

    private static void ValidateGoogleChatAttachmentResourceName(string resourceName)
    {
        if (string.IsNullOrWhiteSpace(resourceName) ||
            !resourceName.StartsWith("spaces/", StringComparison.OrdinalIgnoreCase) ||
            !resourceName.Contains("/messages/", StringComparison.OrdinalIgnoreCase) ||
            !resourceName.Contains("/attachments/", StringComparison.OrdinalIgnoreCase))
        {
            throw new GoogleApiRequestException(
                "Google Chat attachment resource was invalid.",
                "The attachment resource name was not recognized.",
                StatusCodes.Status400BadRequest);
        }
    }

    private static string EscapeGoogleResourcePath(string resourceName)
    {
        return string.Join(
            '/',
            resourceName
                .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(Uri.EscapeDataString));
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
            NormalizeSearchCacheKey(search, "none"),
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

    private sealed record GoogleDirectoryUserSnapshot(
        string? GoogleUserId,
        string Email,
        string DisplayName,
        string? PhotoUrl,
        bool IsSuspended,
        DateTimeOffset? GoogleLastLoginAt);

    private sealed record GoogleWorkspaceProfile(
        string? DisplayName,
        string? Email,
        string? PhotoUrl,
        string? ResourceName = null,
        string[]? SourceIds = null);

    private sealed record GoogleWorkspaceProfileCacheEntry(GoogleWorkspaceProfile? Profile);

    private sealed record GoogleChatProfileResolutionStatus(
        bool Available,
        string? Title,
        string? Detail);

    private sealed record GoogleDrivePermissionProfile(
        string? DisplayName,
        string? EmailAddress,
        string? PhotoLink);

    private sealed record GoogleChatAttachmentMetadata(
        string? Name,
        string? MimeType,
        string? WebViewLink,
        string? WebContentLink,
        string? IconLink,
        string? ThumbnailLink,
        long? SizeBytes);

    private sealed record ChatAttachmentPreviewRequest(
        string ResourceName,
        string? FileName,
        string? ContentType);

    private sealed record GoogleAvatarImage(byte[] Content, string ContentType);

    private sealed record DriveDownloadPayload(byte[] Content, string ContentType, string FileName);

    private sealed class FolderDownloadState
    {
        public int FileCount { get; set; }
        public long TotalBytes { get; set; }
    }
}
