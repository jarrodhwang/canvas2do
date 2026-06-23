using Incos.Workspace.Api.Contracts;
using Incos.Workspace.Api.Data;
using Incos.Workspace.Api.Domain.Entities;
using Incos.Workspace.Api.Infrastructure;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using System.Security.Cryptography;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Incos.Workspace.Api.Endpoints;

public static class AuthEndpoints
{
    public const string GoogleForceLoginProperty = "incos:google:force_login";
    public const string GoogleRequestedWorkspaceScopesProperty = "incos:google:requested_workspace_scopes";
    public const string AcademyCredentialProvider = "academy";
    private const string PreviewModeClaim = "incos:preview";
    private const string PreviewAdminEmailClaim = "incos:preview_admin_email";
    private const string PreviewAdminNameClaim = "incos:preview_admin_name";
    private const string PreviewOriginalSessionProperty = "incos:preview:original_session";
    private const string MicrosoftOAuthStateCookie = "incos_microsoft_oauth_state";
    private const string MicrosoftOAuthReturnUrlCookie = "incos_microsoft_oauth_return_url";
    private const string AcademyAccountDomain = "academy.local";
    private const int PasswordHashIterations = 210_000;
    private const int PasswordSaltSizeBytes = 16;
    private const int PasswordHashSizeBytes = 32;
    private const double DefaultWorkspaceSessionHours = 24 * 14;
    private const double MinimumWorkspaceSessionHours = 1;
    private const double MaximumWorkspaceSessionHours = 24 * 14;
    private static readonly Regex AcademyLoginIdRegex = new("^[a-z0-9][a-z0-9._-]{2,63}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly string[] AcademyOnlyAccessKeys =
    [
        "academy",
        "academy-dashboard",
        "academy-courses",
        "academy-grades",
        "academy-inbox",
        "academy-people",
        "academy-outlook",
        "academy-settings-page",
    ];
    private static readonly string[] AcademyOnlyPermissionKeys =
    [
        "academy-view-courses",
        "academy-manage-courses",
        "academy-view-people",
        "academy-message-people",
        "academy-manage-inbox",
        "academy-manage-settings",
    ];
    private static readonly string[] AcademyOnlySettingKeys =
    [
        "academy-settings",
    ];

    public sealed record AdminAccessGrantSet(string[] Access, string[] Permissions, string[] Settings)
    {
        public static readonly AdminAccessGrantSet Empty = new([], [], []);
    }

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth");

        auth.MapGet("/session", async (
                HttpContext context,
                IConfiguration configuration,
                IncosWorkspaceDbContext db,
                CancellationToken cancellationToken) =>
            {
                var user = context.User;
                var isAuthenticated = user.Identity?.IsAuthenticated == true;
                var email = isAuthenticated ? user.FindFirstValue(ClaimTypes.Email) : null;
                var isSessionRevoked = isAuthenticated &&
                    await IsCurrentSessionRevokedAsync(context, db, email, cancellationToken);

                if (isSessionRevoked)
                {
                    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);

                    return Results.Ok(new
                    {
                        isAuthenticated = false,
                        provider = (string?)null,
                        displayName = (string?)null,
                        email = (string?)null,
                        loginId = (string?)null,
                        pictureUrl = (string?)null,
                        hostedDomain = (string?)null,
                        accountStatus = (string?)null,
                        requiresApproval = false,
                        requiresAssignment = false,
                        canAccessWorkspace = false,
                        access = Array.Empty<string>(),
                        permissions = Array.Empty<string>(),
                        settings = Array.Empty<string>(),
                        isPreview = false,
                        previewAdminEmail = (string?)null,
                        previewAdminDisplayName = (string?)null,
                    });
                }

                var hostedDomain = isAuthenticated ? user.FindFirstValue("hd") : null;
                var authProvider = isAuthenticated
                    ? user.FindFirstValue("incos:auth_provider")
                    : null;
                var isPreview = isAuthenticated && IsPreviewPrincipal(user);
                var isAcademyCredentialAccount = IsAcademyCredentialProvider(authProvider);
                var workspaceDataDomain = GetGoogleWorkspaceDataDomain(configuration);
                var isWorkspaceAccount = isAuthenticated &&
                    IsWorkspaceGoogleAccount(email, hostedDomain, workspaceDataDomain);
                var accountStatus = isAuthenticated
                    ? await GetAdminAccountStatusAsync(db, email, cancellationToken)
                    : null;
                var canAccessWorkspace = (isWorkspaceAccount || isAcademyCredentialAccount) && accountStatus == "active";
                var grants = canAccessWorkspace
                    ? await GetAdminAccessGrantsAsync(db, email, cancellationToken)
                    : AdminAccessGrantSet.Empty;
                grants = isAcademyCredentialAccount
                    ? FilterAcademyOnlyGrants(grants)
                    : grants;

                return Results.Ok(new
                {
                    isAuthenticated,
                    provider = isAuthenticated
                        ? isAcademyCredentialAccount ? AcademyCredentialProvider : "google"
                        : null,
                    displayName = isAuthenticated ? user.FindFirstValue(ClaimTypes.Name) : null,
                    email,
                    loginId = isAuthenticated ? user.FindFirstValue("incos:login_id") : null,
                    pictureUrl = isAuthenticated ? user.FindFirstValue("urn:google:picture") : null,
                    hostedDomain,
                    accountStatus,
                    requiresApproval = (isWorkspaceAccount || isAcademyCredentialAccount) && accountStatus == "pending",
                    requiresAssignment = canAccessWorkspace && grants.Access.Length == 0,
                    canAccessWorkspace,
                    access = grants.Access,
                    permissions = grants.Permissions,
                    settings = grants.Settings,
                    isPreview,
                    previewAdminEmail = isPreview ? user.FindFirstValue(PreviewAdminEmailClaim) : null,
                    previewAdminDisplayName = isPreview ? user.FindFirstValue(PreviewAdminNameClaim) : null,
                });
            })
            .WithName("GetAuthSession");

        auth.MapGet("/config", (IConfiguration configuration) =>
            {
                var clientId = configuration["Authentication:Google:ClientId"];
                var clientSecret = configuration["Authentication:Google:ClientSecret"];
                var microsoftClientId = configuration["Authentication:Microsoft:ClientId"];
                var microsoftClientSecret = configuration["Authentication:Microsoft:ClientSecret"];

                return Results.Ok(new
                {
                    googleConfigured =
                        !string.IsNullOrWhiteSpace(clientId) &&
                        !string.IsNullOrWhiteSpace(clientSecret),
                    microsoftConfigured =
                        !string.IsNullOrWhiteSpace(microsoftClientId) &&
                        !string.IsNullOrWhiteSpace(microsoftClientSecret),
                    academyCredentialsConfigured = true,
                    hostedDomain = configuration["Authentication:Google:HostedDomain"],
                    workspaceDataDomain =
                        configuration["Authentication:Google:WorkspaceDataDomain"] ??
                        configuration["Authentication:Google:HostedDomain"] ??
                        "incos.co.kr",
                });
            })
            .WithName("GetAuthConfig");

        auth.MapGet("/academy/id-available", async (
                string? id,
                IncosWorkspaceDbContext db,
                CancellationToken cancellationToken) =>
            {
                var normalizedLoginId = NormalizeAcademyLoginId(id);

                if (!IsValidAcademyLoginId(normalizedLoginId))
                {
                    return Results.Ok(new AcademyCredentialIdAvailabilityDto(normalizedLoginId, false));
                }

                await EnsureAcademyCredentialAccountsTableAsync(db, cancellationToken);
                var exists = await db.AcademyCredentialAccounts
                    .AsNoTracking()
                    .AnyAsync(account => account.LoginId == normalizedLoginId, cancellationToken);

                return Results.Ok(new AcademyCredentialIdAvailabilityDto(normalizedLoginId, !exists));
            })
            .WithName("CheckAcademyLoginIdAvailability");

        auth.MapPost("/academy/signup", SignUpAcademyAccountAsync)
            .AllowAnonymous()
            .WithName("SignUpAcademyAccount");

        auth.MapPost("/academy/login", LoginAcademyAccountAsync)
            .AllowAnonymous()
            .WithName("LoginAcademyAccount");

        auth.MapGet("/google/login", RedirectLegacyGoogleLogin)
            .WithName("RedirectLegacyGoogleLogin");

        auth.MapGet("/google/workspace/login", (
                HttpContext context,
                IConfiguration configuration,
                string? returnUrl) => StartGoogleWorkspaceLogin(context, configuration, returnUrl))
            .WithName("StartIncosWorkspaceGoogleLogin");

        auth.MapGet("/google/callback", (string? returnUrl) =>
                Results.Redirect(NormalizeReturnUrl(returnUrl)))
            .WithName("CompleteGoogleWorkspaceLogin");

        auth.MapGet("/microsoft/login", (
                HttpContext context,
                IConfiguration configuration,
                string? returnUrl) =>
            {
                if (context.User.Identity?.IsAuthenticated != true)
                {
                    return Results.Unauthorized();
                }

                var clientId = configuration["Authentication:Microsoft:ClientId"];
                var clientSecret = configuration["Authentication:Microsoft:ClientSecret"];

                if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret))
                {
                    return Results.Problem(
                        title: "Microsoft Outlook integration is not configured.",
                        detail:
                            "Set Authentication:Microsoft:ClientId and Authentication:Microsoft:ClientSecret on the ASP.NET Core API.",
                        statusCode: StatusCodes.Status503ServiceUnavailable);
                }

                var state = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
                var safeReturnUrl = NormalizeReturnUrl(returnUrl);
                var cookieOptions = new CookieOptions
                {
                    HttpOnly = true,
                    IsEssential = true,
                    MaxAge = TimeSpan.FromMinutes(10),
                    SameSite = SameSiteMode.Lax,
                    Secure = context.Request.IsHttps,
                };

                context.Response.Cookies.Append(MicrosoftOAuthStateCookie, state, cookieOptions);
                context.Response.Cookies.Append(MicrosoftOAuthReturnUrlCookie, safeReturnUrl, cookieOptions);

                var authorizationEndpoint = GetMicrosoftAuthorizationEndpoint(configuration);
                var redirectUri = BuildAbsoluteUri(context, "/api/auth/microsoft/callback");
                var query = new Dictionary<string, string?>
                {
                    ["client_id"] = clientId,
                    ["response_type"] = "code",
                    ["redirect_uri"] = redirectUri,
                    ["response_mode"] = "query",
                    ["scope"] = string.Join(' ', MicrosoftGraphScopes.Authorization),
                    ["state"] = state,
                };

                if (string.Equals(context.Request.Query["forceConsent"], "true", StringComparison.OrdinalIgnoreCase))
                {
                    query["prompt"] = "consent";
                }

                return Results.Redirect(QueryHelpers.AddQueryString(authorizationEndpoint, query));
            })
            .WithName("StartMicrosoftOutlookLogin");

        auth.MapGet("/microsoft/callback", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string? code,
                string? state,
                string? error,
                string? error_description,
                CancellationToken cancellationToken) =>
            {
                var returnUrl = NormalizeReturnUrl(context.Request.Cookies[MicrosoftOAuthReturnUrlCookie]);
                context.Response.Cookies.Delete(MicrosoftOAuthStateCookie);
                context.Response.Cookies.Delete(MicrosoftOAuthReturnUrlCookie);

                if (!string.IsNullOrWhiteSpace(error))
                {
                    return Results.Problem(
                        title: "Microsoft Outlook connection failed.",
                        detail: error_description ?? error,
                        statusCode: StatusCodes.Status400BadRequest);
                }

                if (string.IsNullOrWhiteSpace(code) ||
                    string.IsNullOrWhiteSpace(state) ||
                    !string.Equals(state, context.Request.Cookies[MicrosoftOAuthStateCookie], StringComparison.Ordinal))
                {
                    return Results.Problem(
                        title: "Microsoft Outlook connection failed.",
                        detail: "The Microsoft OAuth callback state was invalid or expired.",
                        statusCode: StatusCodes.Status400BadRequest);
                }

                var clientId = configuration["Authentication:Microsoft:ClientId"];
                var clientSecret = configuration["Authentication:Microsoft:ClientSecret"];

                if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret))
                {
                    return Results.Problem(
                        title: "Microsoft Outlook integration is not configured.",
                        detail:
                            "Set Authentication:Microsoft:ClientId and Authentication:Microsoft:ClientSecret on the ASP.NET Core API.",
                        statusCode: StatusCodes.Status503ServiceUnavailable);
                }

                var redirectUri = BuildAbsoluteUri(context, "/api/auth/microsoft/callback");
                MicrosoftTokenResponse tokenResponse;

                try
                {
                    tokenResponse = await ExchangeMicrosoftCodeAsync(
                        httpClientFactory,
                        configuration,
                        clientId,
                        clientSecret,
                        redirectUri,
                        code,
                        cancellationToken);
                }
                catch (InvalidOperationException exception)
                {
                    return Results.Problem(
                        title: "Microsoft Outlook connection failed.",
                        detail: exception.Message,
                        statusCode: StatusCodes.Status400BadRequest);
                }

                var authResult = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);

                if (!authResult.Succeeded || authResult.Principal is null)
                {
                    return Results.Unauthorized();
                }

                var principal = await AddMicrosoftProfileClaimsAsync(
                    authResult.Principal,
                    httpClientFactory,
                    tokenResponse.AccessToken,
                    cancellationToken);
                var properties = authResult.Properties ?? new AuthenticationProperties();
                var tokens = properties.GetTokens().ToList();
                var expiresAt = DateTimeOffset.UtcNow
                    .AddSeconds(Math.Max(60, tokenResponse.ExpiresIn - 60))
                    .ToString("o", CultureInfo.InvariantCulture);

                StoreToken(tokens, "microsoft_access_token", tokenResponse.AccessToken);
                StoreToken(tokens, "microsoft_expires_at", expiresAt);
                StoreToken(tokens, "microsoft_refresh_token", tokenResponse.RefreshToken);
                StoreToken(tokens, "microsoft_scope", tokenResponse.Scope);

                properties.StoreTokens(tokens);
                await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, properties);

                return Results.Redirect(returnUrl);
            })
            .WithName("CompleteMicrosoftOutlookLogin");

        auth.MapGet("/denied", () =>
                Results.Problem(
                    title: "Google Workspace sign-in denied.",
                    detail: "This account is not allowed to access INCOS Workspace.",
                    statusCode: StatusCodes.Status403Forbidden))
            .WithName("GoogleWorkspaceAccessDenied");

        auth.MapPost("/preview/users/{userId:guid}", StartUserPreviewAsync)
            .WithName("StartAdminUserPreview");

        auth.MapPost("/preview/exit", (Func<HttpContext, Task<IResult>>)ExitUserPreviewAsync)
            .WithName("ExitAdminUserPreview");

        auth.MapPost("/logout", async (HttpContext context) =>
            {
                await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                return Results.NoContent();
            })
            .WithName("Logout");

        return app;
    }

    private static async Task<IResult> SignUpAcademyAccountAsync(
        HttpContext context,
        IHttpClientFactory httpClientFactory,
        IncosWorkspaceDbContext db,
        IDataProtectionProvider dataProtectionProvider,
        AcademyCredentialSignupRequest request,
        CancellationToken cancellationToken)
    {
        var displayName = request.Name?.Trim();
        var loginId = NormalizeAcademyLoginId(request.LoginId);
        var password = request.Password ?? string.Empty;
        var confirmPassword = request.ConfirmPassword ?? string.Empty;
        var profileImageDataUrl = NormalizeProfileImageDataUrl(request.ProfileImageDataUrl);

        if (string.IsNullOrWhiteSpace(displayName) || displayName.Length > 160)
        {
            return Results.BadRequest(new
            {
                title = "Name is invalid.",
                detail = "Enter a display name up to 160 characters.",
            });
        }

        if (!IsValidAcademyLoginId(loginId))
        {
            return Results.BadRequest(new
            {
                title = "ID is invalid.",
                detail = "Use 3-64 lowercase letters, numbers, dot, hyphen, or underscore. Start with a letter or number.",
            });
        }

        if (password.Length < 8 || password.Length > 256)
        {
            return Results.BadRequest(new
            {
                title = "Password is invalid.",
                detail = "Use a password between 8 and 256 characters.",
            });
        }

        if (!string.Equals(password, confirmPassword, StringComparison.Ordinal))
        {
            return Results.BadRequest(new
            {
                title = "Passwords do not match.",
                detail = "Enter the same password twice.",
            });
        }

        if (profileImageDataUrl is null && !string.IsNullOrWhiteSpace(request.ProfileImageDataUrl))
        {
            return Results.BadRequest(new
            {
                title = "Profile image is invalid.",
                detail = "Upload a PNG, JPEG, GIF, or WebP image under 750 KB.",
            });
        }

        await EnsureAcademyCredentialAccountsTableAsync(db, cancellationToken);

        var accountKey = GetAcademyAccountKey(loginId);
        var duplicateExists = await db.AcademyCredentialAccounts
                .AsNoTracking()
                .AnyAsync(account => account.LoginId == loginId, cancellationToken) ||
            await db.AdminUsers
                .AsNoTracking()
                .AnyAsync(user => user.Email == accountKey, cancellationToken);

        if (duplicateExists)
        {
            return Results.Conflict(new
            {
                title = "ID is already used.",
                detail = "Choose a different Academy ID.",
            });
        }

        var now = DateTimeOffset.UtcNow;
        var adminUser = new AdminUser
        {
            Id = Guid.NewGuid(),
            CreatedAt = now,
            UpdatedAt = now,
            Email = accountKey,
            DisplayName = displayName,
            PhotoUrl = profileImageDataUrl,
            HostedDomain = AcademyAccountDomain,
            Role = "academy",
            Status = "pending",
            ApiAccessEnabled = false,
            IsDirectorySuspended = false,
        };
        var account = new AcademyCredentialAccount
        {
            Id = Guid.NewGuid(),
            CreatedAt = now,
            UpdatedAt = now,
            AdminUserId = adminUser.Id,
            LoginId = loginId,
            PasswordHash = HashPassword(password),
        };

        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

            db.AdminUsers.Add(adminUser);
            db.AcademyCredentialAccounts.Add(account);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            return Results.Conflict(new
            {
                title = "ID is already used.",
                detail = "Choose a different Academy ID.",
            });
        }

        var canvasTokenConfigured = false;
        if (!string.IsNullOrWhiteSpace(request.CanvasAccessToken))
        {
            var tokenResult = await CanvasIntegrationEndpoints.UpdateCanvasTokenForUserKeyAsync(
                accountKey,
                httpClientFactory,
                db,
                dataProtectionProvider,
                new UpdateCanvasTokenRequest(
                    string.IsNullOrWhiteSpace(request.CanvasInstanceUrl) ? "https://canvas.sfu.ca" : request.CanvasInstanceUrl,
                    request.CanvasAccessToken,
                    request.CanvasTokenStartsAt,
                    request.CanvasTokenExpiresAt),
                cancellationToken);

            canvasTokenConfigured = tokenResult is not IStatusCodeHttpResult statusResult ||
                statusResult.StatusCode is null or (>= 200 and < 300);
        }

        return Results.Created(
            "/api/auth/academy/signup",
            new AcademyCredentialSignupDto(loginId, adminUser.Status, canvasTokenConfigured));
    }

    private static async Task<IResult> LoginAcademyAccountAsync(
        HttpContext context,
        IConfiguration configuration,
        IncosWorkspaceDbContext db,
        AcademyCredentialLoginRequest request,
        CancellationToken cancellationToken)
    {
        var loginId = NormalizeAcademyLoginId(request.LoginId);

        if (!IsValidAcademyLoginId(loginId) || string.IsNullOrEmpty(request.Password))
        {
            return Results.Unauthorized();
        }

        await EnsureAcademyCredentialAccountsTableAsync(db, cancellationToken);

        var account = await db.AcademyCredentialAccounts
            .Include(credentialAccount => credentialAccount.AdminUser)
            .FirstOrDefaultAsync(credentialAccount => credentialAccount.LoginId == loginId, cancellationToken);

        if (account?.AdminUser is null || !VerifyPassword(request.Password, account.PasswordHash))
        {
            return Results.Unauthorized();
        }

        var status = account.AdminUser.Status.Trim().ToLowerInvariant();

        if (status == "inactive")
        {
            return Results.Problem(
                title: "Account inactive.",
                detail: "This Academy account is inactive in Admin Console.",
                statusCode: StatusCodes.Status403Forbidden);
        }

        account.AdminUser.LastLoginAt = DateTimeOffset.UtcNow;
        account.AdminUser.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        var principal = CreateAcademyCredentialPrincipal(account.AdminUser, loginId);
        var sessionDuration = await GetUserSessionDurationAsync(
            configuration,
            db,
            GetAcademyAccountKey(loginId),
            cancellationToken);
        var properties = new AuthenticationProperties
        {
            IsPersistent = true,
            ExpiresUtc = DateTimeOffset.UtcNow.Add(sessionDuration),
        };

        await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, properties);

        return Results.Ok(new
        {
            loginId,
            accountStatus = status,
            requiresApproval = status == "pending",
            canAccessWorkspace = status == "active",
        });
    }

    private static async Task<IResult> StartUserPreviewAsync(
        HttpContext context,
        IConfiguration configuration,
        IncosWorkspaceDbContext db,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var authResult = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);

        if (!authResult.Succeeded || authResult.Principal is null)
        {
            return Results.Unauthorized();
        }

        if (IsPreviewPrincipal(authResult.Principal))
        {
            return Results.Problem(
                title: "Already previewing a user.",
                detail: "Exit the current preview before starting another one.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var adminEmail = authResult.Principal.FindFirstValue(ClaimTypes.Email);
        var adminStatus = await GetAdminAccountStatusAsync(db, adminEmail, cancellationToken);

        if (!string.Equals(adminStatus, "active", StringComparison.OrdinalIgnoreCase))
        {
            return Results.Forbid();
        }

        var adminGrants = await GetAdminAccessGrantsAsync(db, adminEmail, cancellationToken);
        var adminAuthProvider = authResult.Principal.FindFirstValue("incos:auth_provider");
        adminGrants = IsAcademyCredentialProvider(adminAuthProvider)
            ? FilterAcademyOnlyGrants(adminGrants)
            : adminGrants;

        if (!adminGrants.Access.Contains("admin-users", StringComparer.OrdinalIgnoreCase))
        {
            return Results.Forbid();
        }

        await GoogleIntegrationEndpoints.EnsureAdminUsersTableAsync(db, cancellationToken);
        await EnsureAcademyCredentialAccountsTableAsync(db, cancellationToken);

        var targetUser = await db.AdminUsers
            .AsNoTracking()
            .FirstOrDefaultAsync(user => user.Id == userId, cancellationToken);

        if (targetUser is null)
        {
            return Results.NotFound();
        }

        var credentialAccount = await db.AcademyCredentialAccounts
            .AsNoTracking()
            .FirstOrDefaultAsync(account => account.AdminUserId == targetUser.Id, cancellationToken);
        var previewPrincipal = CreatePreviewPrincipal(targetUser, credentialAccount?.LoginId, authResult.Principal);
        var targetUserKey = !string.IsNullOrWhiteSpace(credentialAccount?.LoginId)
            ? GetAcademyAccountKey(credentialAccount.LoginId)
            : targetUser.Email;
        var now = DateTimeOffset.UtcNow;
        var sessionDuration = await GetUserSessionDurationAsync(
            configuration,
            db,
            targetUserKey,
            cancellationToken);
        var properties = new AuthenticationProperties
        {
            IsPersistent = true,
            IssuedUtc = now,
            ExpiresUtc = now.Add(sessionDuration),
        };
        properties.Items[PreviewOriginalSessionProperty] = SerializeOriginalSession(authResult);

        await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, previewPrincipal, properties);

        return Results.Ok(new
        {
            isPreview = true,
        });
    }

    private static async Task<IResult> ExitUserPreviewAsync(HttpContext context)
    {
        var authResult = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);

        if (!authResult.Succeeded ||
            authResult.Principal is null ||
            !IsPreviewPrincipal(authResult.Principal))
        {
            return Results.NoContent();
        }

        var serializedSession = authResult.Properties?.Items.TryGetValue(PreviewOriginalSessionProperty, out var value) == true
            ? value
            : null;

        if (!TryRestoreOriginalSession(
                serializedSession,
                out var originalPrincipal,
                out var originalProperties))
        {
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);

            return Results.Problem(
                title: "Unable to exit preview.",
                detail: "The original admin session could not be restored. Sign in again.",
                statusCode: StatusCodes.Status409Conflict);
        }

        await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, originalPrincipal, originalProperties);

        return Results.Ok(new
        {
            isPreview = false,
        });
    }

    private static string NormalizeReturnUrl(string? returnUrl)
    {
        if (string.IsNullOrWhiteSpace(returnUrl))
        {
            return "/";
        }

        return returnUrl.StartsWith('/') && !returnUrl.StartsWith("//", StringComparison.Ordinal)
            ? returnUrl
            : "/";
    }

    private static IResult RedirectLegacyGoogleLogin(HttpContext context)
    {
        var queryString = context.Request.QueryString.HasValue
            ? context.Request.QueryString.Value
            : string.Empty;

        return Results.Redirect($"/api/auth/google/workspace/login{queryString}");
    }

    private static async Task<IResult> StartGoogleWorkspaceLogin(
        HttpContext context,
        IConfiguration configuration,
        string? returnUrl)
    {
        var clientId = configuration["Authentication:Google:ClientId"];
        var clientSecret = configuration["Authentication:Google:ClientSecret"];

        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret))
        {
            return Results.Problem(
                title: "Google sign-in is not configured.",
                detail:
                    "Set Authentication:Google:ClientId and Authentication:Google:ClientSecret on the ASP.NET Core API.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var forceConsent = string.Equals(context.Request.Query["forceConsent"], "true", StringComparison.OrdinalIgnoreCase);
        var forceLogin = forceConsent ||
            string.Equals(context.Request.Query["forceLogin"], "true", StringComparison.OrdinalIgnoreCase);

        if (forceLogin)
        {
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        }

        var safeReturnUrl = NormalizeReturnUrl(returnUrl);
        var callbackUrl = $"/api/auth/google/callback?returnUrl={Uri.EscapeDataString(safeReturnUrl)}";
        var properties = new GoogleChallengeProperties
        {
            RedirectUri = callbackUrl,
            AccessType = "offline",
            IncludeGrantedScopes = !forceConsent,
            IsPersistent = true,
            ExpiresUtc = DateTimeOffset.UtcNow.Add(GetWorkspaceSessionDuration(configuration)),
        };
        properties.Scope ??= [];

        if (forceLogin)
        {
            properties.Prompt = forceConsent ? "consent select_account" : "select_account";
            properties.Items[GoogleForceLoginProperty] = "true";
        }

        foreach (var scope in GetGoogleConsentScopes())
        {
            if (!properties.Scope.Any(existingScope =>
                    string.Equals(existingScope, scope, StringComparison.OrdinalIgnoreCase)))
            {
                properties.Scope.Add(scope);
            }
        }

        properties.Items[GoogleRequestedWorkspaceScopesProperty] = string.Join(' ', GoogleWorkspaceScopes.All);

        return Results.Challenge(properties, [GoogleDefaults.AuthenticationScheme]);
    }

    public static TimeSpan GetWorkspaceSessionDuration(IConfiguration configuration)
    {
        var hours = configuration.GetValue<double?>("Authentication:Google:WorkspaceSessionHours") ??
                    DefaultWorkspaceSessionHours;

        return TimeSpan.FromHours(Math.Clamp(hours, MinimumWorkspaceSessionHours, MaximumWorkspaceSessionHours));
    }

    public static async Task<TimeSpan> GetUserSessionDurationAsync(
        IConfiguration configuration,
        IncosWorkspaceDbContext db,
        string? userKey,
        CancellationToken cancellationToken = default)
    {
        var fallback = GetWorkspaceSessionDuration(configuration);

        if (string.IsNullOrWhiteSpace(userKey))
        {
            return fallback;
        }

        await WorkspaceEndpoints.EnsureUserSettingsTableAsync(db, cancellationToken);

        var normalizedUserKey = userKey.Trim().ToLowerInvariant();
        var setting = await db.UserSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(
                userSetting =>
                    userSetting.UserKey.ToLower() == normalizedUserKey &&
                    userSetting.SettingKey == WorkspaceEndpoints.AcademyPreferencesSettingKey,
                cancellationToken);

        return GetSessionDurationFromAcademyPreferencesJson(setting?.SettingJson, fallback);
    }

    public static TimeSpan GetSessionDurationFromAcademyPreferencesJson(string? settingJson, TimeSpan fallback)
    {
        if (string.IsNullOrWhiteSpace(settingJson))
        {
            return fallback;
        }

        try
        {
            using var document = JsonDocument.Parse(settingJson);

            if (!document.RootElement.TryGetProperty("calendarSettings", out var calendarSettings) ||
                calendarSettings.ValueKind != JsonValueKind.Object)
            {
                return fallback;
            }

            var configuredHours = TryGetJsonDouble(calendarSettings, "sessionDurationHours");

            if (!configuredHours.HasValue && TryGetJsonDouble(calendarSettings, "sessionDurationDays") is { } days)
            {
                configuredHours = days * 24;
            }

            if (!configuredHours.HasValue)
            {
                return fallback;
            }

            return TimeSpan.FromHours(Math.Clamp(
                configuredHours.Value,
                MinimumWorkspaceSessionHours,
                MaximumWorkspaceSessionHours));
        }
        catch (JsonException)
        {
            return fallback;
        }
    }

    private static double? TryGetJsonDouble(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        if (property.ValueKind == JsonValueKind.Number && property.TryGetDouble(out var number))
        {
            return number;
        }

        if (property.ValueKind == JsonValueKind.String &&
            double.TryParse(property.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }

        return null;
    }

    public static Task EnsureAcademyCredentialAccountsTableAsync(
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken = default) =>
        db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS academy_credential_accounts (
                "Id" uuid NOT NULL PRIMARY KEY,
                "CreatedAt" timestamp with time zone NOT NULL,
                "UpdatedAt" timestamp with time zone NOT NULL,
                "AdminUserId" uuid NOT NULL,
                "LoginId" character varying(80) NOT NULL,
                "PasswordHash" text NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_academy_credential_accounts_LoginId"
                ON academy_credential_accounts ("LoginId");
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_academy_credential_accounts_AdminUserId"
                ON academy_credential_accounts ("AdminUserId");
            """,
            cancellationToken);

    private static async Task<string> GetAdminAccountStatusAsync(
        IncosWorkspaceDbContext db,
        string? email,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return "pending";
        }

        await GoogleIntegrationEndpoints.EnsureAdminUsersTableAsync(db, cancellationToken);
        var normalizedEmail = email.Trim().ToLowerInvariant();
        var adminUser = await db.AdminUsers
            .AsNoTracking()
            .FirstOrDefaultAsync(user => user.Email == normalizedEmail, cancellationToken);
        var status = adminUser?.Status?.Trim().ToLowerInvariant();

        return status is "active" or "inactive" or "pending"
            ? status
            : "pending";
    }

    private static async Task<bool> IsCurrentSessionRevokedAsync(
        HttpContext context,
        IncosWorkspaceDbContext db,
        string? email,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return false;
        }

        await GoogleIntegrationEndpoints.EnsureAdminUsersTableAsync(db, cancellationToken);

        var normalizedEmail = email.Trim().ToLowerInvariant();
        var sessionRevokedAt = await db.AdminUsers
            .AsNoTracking()
            .Where(user => user.Email == normalizedEmail)
            .Select(user => user.SessionRevokedAt)
            .FirstOrDefaultAsync(cancellationToken);

        if (!sessionRevokedAt.HasValue)
        {
            return false;
        }

        var authenticateResult = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        var issuedAt = authenticateResult.Properties?.IssuedUtc;

        return !issuedAt.HasValue || issuedAt.Value <= sessionRevokedAt.Value;
    }

    public static async Task<AdminAccessGrantSet> GetAdminAccessGrantsAsync(
        IncosWorkspaceDbContext db,
        string? email,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return AdminAccessGrantSet.Empty;
        }

        await GoogleIntegrationEndpoints.EnsureDefaultAdminGroupAsync(db, cancellationToken);
        await GoogleIntegrationEndpoints.RemoveLegacyAcademyUsersGroupAsync(db, cancellationToken);

        var normalizedEmail = email.Trim().ToLowerInvariant();
        var groups = await (
            from member in db.AdminGroupMembers
            join adminGroup in db.AdminGroups on member.AdminGroupId equals adminGroup.Id
            join adminUser in db.AdminUsers on member.AdminUserId equals adminUser.Id
            where adminUser.Email == normalizedEmail && adminGroup.Status == "active"
            select new
            {
                adminGroup.AccessJson,
                adminGroup.PermissionJson,
                adminGroup.SettingJson,
            })
            .AsNoTracking()
            .ToArrayAsync(cancellationToken);

        if (groups.Length == 0)
        {
            return AdminAccessGrantSet.Empty;
        }

        var access = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var permissions = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var settings = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var group in groups)
        {
            access.UnionWith(ParseGrantValues(group.AccessJson));
            permissions.UnionWith(ParseGrantValues(group.PermissionJson));
            settings.UnionWith(ParseGrantValues(group.SettingJson));
        }

        return new AdminAccessGrantSet(
            access.OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToArray(),
            permissions.OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToArray(),
            settings.OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToArray());
    }

    private static string[] ParseGrantValues(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            return (JsonSerializer.Deserialize<string[]>(json) ?? [])
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public static AdminAccessGrantSet FilterAcademyOnlyGrants(AdminAccessGrantSet grants) =>
        new(
            grants.Access
                .Where(value => IsAcademyAccessValue(value))
                .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            grants.Permissions
                .Where(value => value.StartsWith("academy-", StringComparison.OrdinalIgnoreCase))
                .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            grants.Settings
                .Where(value => string.Equals(value, "academy-settings", StringComparison.OrdinalIgnoreCase))
                .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
                .ToArray());

    private static bool IsAcademyAccessValue(string value) =>
        string.Equals(value, "academy", StringComparison.OrdinalIgnoreCase) ||
        value.StartsWith("academy-", StringComparison.OrdinalIgnoreCase);

    private static ClaimsPrincipal CreatePreviewPrincipal(
        AdminUser targetUser,
        string? academyLoginId,
        ClaimsPrincipal adminPrincipal)
    {
        var principal = !string.IsNullOrWhiteSpace(academyLoginId)
            ? CreateAcademyCredentialPrincipal(targetUser, academyLoginId)
            : CreateGoogleWorkspacePrincipal(targetUser);

        if (principal.Identity is ClaimsIdentity identity)
        {
            identity.AddClaim(new Claim(PreviewModeClaim, "true"));

            if (adminPrincipal.FindFirstValue(ClaimTypes.Email) is { Length: > 0 } adminEmail)
            {
                identity.AddClaim(new Claim(PreviewAdminEmailClaim, adminEmail));
            }

            if (adminPrincipal.FindFirstValue(ClaimTypes.Name) is { Length: > 0 } adminName)
            {
                identity.AddClaim(new Claim(PreviewAdminNameClaim, adminName));
            }
        }

        return principal;
    }

    private static ClaimsPrincipal CreateGoogleWorkspacePrincipal(AdminUser user)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, string.IsNullOrWhiteSpace(user.GoogleUserId) ? user.Email : user.GoogleUserId),
            new(ClaimTypes.Email, user.Email),
            new(ClaimTypes.Name, string.IsNullOrWhiteSpace(user.DisplayName) ? user.Email : user.DisplayName),
        };

        if (!string.IsNullOrWhiteSpace(user.HostedDomain))
        {
            claims.Add(new Claim("hd", user.HostedDomain));
        }

        if (!string.IsNullOrWhiteSpace(user.PhotoUrl))
        {
            claims.Add(new Claim("urn:google:picture", user.PhotoUrl));
        }

        return new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
    }

    private static bool IsPreviewPrincipal(ClaimsPrincipal principal) =>
        principal.HasClaim(PreviewModeClaim, "true");

    private static string SerializeOriginalSession(AuthenticateResult authResult)
    {
        var properties = authResult.Properties ?? new AuthenticationProperties();
        var claims = (authResult.Principal?.Claims ?? [])
            .Select(claim => new StoredPreviewClaim(
                claim.Type,
                claim.Value,
                claim.ValueType,
                claim.Issuer,
                claim.OriginalIssuer))
            .ToArray();
        var tokens = properties.GetTokens()
            .Where(token => !string.IsNullOrWhiteSpace(token.Name))
            .Select(token => new StoredPreviewToken(token.Name, token.Value ?? string.Empty))
            .ToArray();

        return JsonSerializer.Serialize(new StoredPreviewSession(
            claims,
            tokens,
            properties.IssuedUtc?.ToString("o", CultureInfo.InvariantCulture),
            properties.ExpiresUtc?.ToString("o", CultureInfo.InvariantCulture),
            properties.IsPersistent,
            properties.AllowRefresh));
    }

    private static bool TryRestoreOriginalSession(
        string? serializedSession,
        out ClaimsPrincipal principal,
        out AuthenticationProperties properties)
    {
        principal = new ClaimsPrincipal();
        properties = new AuthenticationProperties();

        if (string.IsNullOrWhiteSpace(serializedSession))
        {
            return false;
        }

        StoredPreviewSession? storedSession;

        try
        {
            storedSession = JsonSerializer.Deserialize<StoredPreviewSession>(serializedSession);
        }
        catch (JsonException)
        {
            return false;
        }

        if (storedSession is null || storedSession.Claims.Length == 0)
        {
            return false;
        }

        var identity = new ClaimsIdentity(
            storedSession.Claims.Select(claim => new Claim(
                claim.Type,
                claim.Value,
                claim.ValueType,
                claim.Issuer,
                claim.OriginalIssuer)),
            CookieAuthenticationDefaults.AuthenticationScheme);

        principal = new ClaimsPrincipal(identity);
        properties = new AuthenticationProperties
        {
            IsPersistent = storedSession.IsPersistent,
            AllowRefresh = storedSession.AllowRefresh,
        };

        if (DateTimeOffset.TryParse(
                storedSession.IssuedUtc,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out var issuedUtc))
        {
            properties.IssuedUtc = issuedUtc;
        }

        if (DateTimeOffset.TryParse(
                storedSession.ExpiresUtc,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out var expiresUtc))
        {
            properties.ExpiresUtc = expiresUtc;
        }

        properties.StoreTokens(storedSession.Tokens.Select(token => new AuthenticationToken
        {
            Name = token.Name,
            Value = token.Value,
        }));

        return true;
    }

    private static ClaimsPrincipal CreateAcademyCredentialPrincipal(AdminUser user, string loginId)
    {
        var accountKey = GetAcademyAccountKey(loginId);
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, accountKey),
            new(ClaimTypes.Email, accountKey),
            new(ClaimTypes.Name, user.DisplayName),
            new("incos:auth_provider", AcademyCredentialProvider),
            new("incos:login_id", loginId),
        };

        if (!string.IsNullOrWhiteSpace(user.PhotoUrl))
        {
            claims.Add(new Claim("urn:google:picture", user.PhotoUrl));
        }

        return new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
    }

    private sealed record StoredPreviewSession(
        StoredPreviewClaim[] Claims,
        StoredPreviewToken[] Tokens,
        string? IssuedUtc,
        string? ExpiresUtc,
        bool IsPersistent,
        bool? AllowRefresh);

    private sealed record StoredPreviewClaim(
        string Type,
        string Value,
        string ValueType,
        string Issuer,
        string OriginalIssuer);

    private sealed record StoredPreviewToken(string Name, string Value);

    public static bool IsAcademyCredentialProvider(string? authProvider) =>
        string.Equals(authProvider, AcademyCredentialProvider, StringComparison.OrdinalIgnoreCase);

    public static string NormalizeAcademyLoginId(string? loginId) =>
        string.IsNullOrWhiteSpace(loginId)
            ? string.Empty
            : loginId.Trim().ToLowerInvariant();

    public static bool IsValidAcademyLoginId(string loginId) =>
        AcademyLoginIdRegex.IsMatch(loginId);

    public static string GetAcademyAccountKey(string loginId) =>
        $"{NormalizeAcademyLoginId(loginId)}@{AcademyAccountDomain}";

    private static string? NormalizeProfileImageDataUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = value.Trim();

        if (normalized.Length > 1_100_000 ||
            !normalized.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase) ||
            normalized.IndexOf(";base64,", StringComparison.OrdinalIgnoreCase) < 0)
        {
            return null;
        }

        return normalized;
    }

    public static string HashPassword(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(PasswordSaltSizeBytes);
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password),
            salt,
            PasswordHashIterations,
            HashAlgorithmName.SHA256,
            PasswordHashSizeBytes);

        return string.Join(
            ':',
            "pbkdf2-sha256",
            PasswordHashIterations.ToString(CultureInfo.InvariantCulture),
            Convert.ToBase64String(salt),
            Convert.ToBase64String(hash));
    }

    private static bool VerifyPassword(string password, string storedHash)
    {
        var parts = storedHash.Split(':', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (parts.Length != 4 ||
            !string.Equals(parts[0], "pbkdf2-sha256", StringComparison.Ordinal) ||
            !int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var iterations) ||
            iterations < 100_000)
        {
            return false;
        }

        try
        {
            var salt = Convert.FromBase64String(parts[2]);
            var expectedHash = Convert.FromBase64String(parts[3]);
            var actualHash = Rfc2898DeriveBytes.Pbkdf2(
                Encoding.UTF8.GetBytes(password),
                salt,
                iterations,
                HashAlgorithmName.SHA256,
                expectedHash.Length);

            return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
        }
        catch (FormatException)
        {
            return false;
        }
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

    private static bool IsWorkspaceGoogleAccount(string? email, string? hostedDomain, string workspaceDataDomain) =>
        (!string.IsNullOrWhiteSpace(hostedDomain) &&
         string.Equals(hostedDomain, workspaceDataDomain, StringComparison.OrdinalIgnoreCase)) ||
        (!string.IsNullOrWhiteSpace(email) &&
         email.EndsWith($"@{workspaceDataDomain}", StringComparison.OrdinalIgnoreCase));

    private static IEnumerable<string> GetGoogleConsentScopes()
    {
        yield return "profile";
        yield return "email";

        foreach (var scope in GoogleWorkspaceScopes.All)
        {
            yield return scope;
        }
    }

    private static string GetMicrosoftTenantId(IConfiguration configuration)
    {
        var tenantId = configuration["Authentication:Microsoft:TenantId"];

        return string.IsNullOrWhiteSpace(tenantId) ? "common" : tenantId.Trim();
    }

    private static string GetMicrosoftAuthorizationEndpoint(IConfiguration configuration) =>
        $"https://login.microsoftonline.com/{Uri.EscapeDataString(GetMicrosoftTenantId(configuration))}/oauth2/v2.0/authorize";

    private static string GetMicrosoftTokenEndpoint(IConfiguration configuration) =>
        $"https://login.microsoftonline.com/{Uri.EscapeDataString(GetMicrosoftTenantId(configuration))}/oauth2/v2.0/token";

    private static string BuildAbsoluteUri(HttpContext context, string path)
    {
        return $"{context.Request.Scheme}://{context.Request.Host}{context.Request.PathBase}{path}";
    }

    private static async Task<MicrosoftTokenResponse> ExchangeMicrosoftCodeAsync(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        string clientId,
        string clientSecret,
        string redirectUri,
        string code,
        CancellationToken cancellationToken)
    {
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["client_secret"] = clientSecret,
            ["redirect_uri"] = redirectUri,
            ["code"] = code,
            ["grant_type"] = "authorization_code",
        });
        var response = await httpClientFactory
            .CreateClient()
            .PostAsync(GetMicrosoftTokenEndpoint(configuration), content, cancellationToken);
        var payload = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(payload);
        }

        return ParseMicrosoftTokenResponse(payload);
    }

    private static MicrosoftTokenResponse ParseMicrosoftTokenResponse(string payload)
    {
        using var document = JsonDocument.Parse(payload);
        var accessToken = GetJsonString(document.RootElement, "access_token");
        var refreshToken = GetJsonString(document.RootElement, "refresh_token");

        if (string.IsNullOrWhiteSpace(accessToken) || string.IsNullOrWhiteSpace(refreshToken))
        {
            throw new InvalidOperationException("Microsoft did not return the expected OAuth tokens.");
        }

        return new MicrosoftTokenResponse(
            accessToken,
            refreshToken,
            GetJsonLong(document.RootElement, "expires_in") ?? 3600,
            GetJsonString(document.RootElement, "scope") ?? "");
    }

    private static async Task<ClaimsPrincipal> AddMicrosoftProfileClaimsAsync(
        ClaimsPrincipal principal,
        IHttpClientFactory httpClientFactory,
        string accessToken,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://graph.microsoft.com/v1.0/me");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);

        var response = await httpClientFactory.CreateClient().SendAsync(request, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            return principal;
        }

        var payload = await response.Content.ReadAsStringAsync(cancellationToken);
        using var document = JsonDocument.Parse(payload);
        var displayName = GetJsonString(document.RootElement, "displayName");
        var email =
            GetJsonString(document.RootElement, "mail") ??
            GetJsonString(document.RootElement, "userPrincipalName");

        if (principal.Identity is not ClaimsIdentity identity)
        {
            return principal;
        }

        ReplaceClaim(identity, "urn:microsoft:name", displayName);
        ReplaceClaim(identity, "urn:microsoft:email", email);

        return principal;
    }

    private static void ReplaceClaim(ClaimsIdentity identity, string claimType, string? value)
    {
        foreach (var claim in identity.FindAll(claimType).ToArray())
        {
            identity.RemoveClaim(claim);
        }

        if (!string.IsNullOrWhiteSpace(value))
        {
            identity.AddClaim(new Claim(claimType, value));
        }
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

    private static string? GetJsonString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) &&
               property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
    }

    private static long? GetJsonLong(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) &&
               property.ValueKind == JsonValueKind.Number &&
               property.TryGetInt64(out var value)
            ? value
            : null;
    }

    private sealed record MicrosoftTokenResponse(
        string AccessToken,
        string RefreshToken,
        long ExpiresIn,
        string Scope);
}
