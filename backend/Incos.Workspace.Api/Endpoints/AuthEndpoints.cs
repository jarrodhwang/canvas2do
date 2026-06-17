using Incos.Workspace.Api.Data;
using Incos.Workspace.Api.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using System.Security.Cryptography;
using System.Security.Claims;
using System.Text.Json;

namespace Incos.Workspace.Api.Endpoints;

public static class AuthEndpoints
{
    public const string GoogleRequestedWorkspaceScopesProperty = "incos:google:requested_workspace_scopes";
    private const string MicrosoftOAuthStateCookie = "incos_microsoft_oauth_state";
    private const string MicrosoftOAuthReturnUrlCookie = "incos_microsoft_oauth_return_url";

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
                var hostedDomain = isAuthenticated ? user.FindFirstValue("hd") : null;
                var workspaceDataDomain = GetGoogleWorkspaceDataDomain(configuration);
                var isWorkspaceAccount = isAuthenticated &&
                    IsWorkspaceGoogleAccount(email, hostedDomain, workspaceDataDomain);
                var accountStatus = isAuthenticated
                    ? await GetAdminAccountStatusAsync(db, email, cancellationToken)
                    : null;
                var canAccessWorkspace = isWorkspaceAccount && accountStatus == "active";

                return Results.Ok(new
                {
                    isAuthenticated,
                    provider = isAuthenticated ? "google" : null,
                    displayName = isAuthenticated ? user.FindFirstValue(ClaimTypes.Name) : null,
                    email,
                    pictureUrl = isAuthenticated ? user.FindFirstValue("urn:google:picture") : null,
                    hostedDomain,
                    accountStatus,
                    requiresApproval = isWorkspaceAccount && accountStatus == "pending",
                    canAccessWorkspace,
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
                    hostedDomain = configuration["Authentication:Google:HostedDomain"],
                    workspaceDataDomain =
                        configuration["Authentication:Google:WorkspaceDataDomain"] ??
                        configuration["Authentication:Google:HostedDomain"] ??
                        "incos.co.kr",
                });
            })
            .WithName("GetAuthConfig");

        auth.MapGet("/google/login", (
                HttpContext context,
                IConfiguration configuration,
                string? returnUrl) => StartGoogleLogin(context, configuration, returnUrl))
            .WithName("StartGoogleWorkspaceLogin");

        auth.MapGet("/google/workspace/login", (
                HttpContext context,
                IConfiguration configuration,
                string? returnUrl) => StartGoogleLogin(context, configuration, returnUrl))
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

        auth.MapPost("/logout", async (HttpContext context) =>
            {
                await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                return Results.NoContent();
            })
            .WithName("Logout");

        return app;
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

    private static async Task<IResult> StartGoogleLogin(
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

        var forceConsent = string.Equals(context.Request.Query["forceConsent"], "true", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(context.Request.Query["forceLogin"], "true", StringComparison.OrdinalIgnoreCase);

        if (forceConsent)
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
            ExpiresUtc = DateTimeOffset.UtcNow.AddDays(14),
        };

        if (forceConsent)
        {
            properties.Prompt = "consent select_account";

            foreach (var scope in GetGoogleConsentScopes())
            {
                properties.Scope.Add(scope);
            }

            properties.Items[GoogleRequestedWorkspaceScopesProperty] = string.Join(' ', GoogleWorkspaceScopes.All);
        }

        return Results.Challenge(properties, [GoogleDefaults.AuthenticationScheme]);
    }

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
