using Incos.Workspace.Api.Data;
using Incos.Workspace.Api.Domain.Entities;
using Incos.Workspace.Api.Endpoints;
using Incos.Workspace.Api.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
var googleSection = builder.Configuration.GetSection("Authentication:Google");
var googleClientId = googleSection["ClientId"];
var googleClientSecret = googleSection["ClientSecret"];
var isGoogleAuthenticationConfigured =
    !string.IsNullOrWhiteSpace(googleClientId) &&
    !string.IsNullOrWhiteSpace(googleClientSecret);

builder.Services.AddOpenApi();
builder.Services.AddHttpClient();
builder.Services.AddMemoryCache();
var dataProtectionBuilder = builder.Services.AddDataProtection()
    .SetApplicationName("Incos.Workspace");
var dataProtectionKeysPath = builder.Configuration["DataProtection:KeysPath"];

if (!string.IsNullOrWhiteSpace(dataProtectionKeysPath))
{
    dataProtectionBuilder.PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeysPath));
}
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
});
builder.Services.AddCors(options =>
{
    options.AddPolicy("frontend", policy =>
        policy
            .WithOrigins(
                "http://localhost:5173",
                "http://localhost:4173",
                "http://localhost:6173",
                "http://localhost:8080")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials());
});

var authenticationBuilder = builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.DefaultSignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = CookieAuthenticationDefaults.AuthenticationScheme;
    })
    .AddCookie(options =>
    {
        options.Cookie.Name = "incos_workspace_auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.ExpireTimeSpan = TimeSpan.FromDays(14);
        options.SlidingExpiration = true;
        options.LoginPath = "/api/auth/google/login";
        options.LogoutPath = "/api/auth/logout";
        options.AccessDeniedPath = "/api/auth/denied";
        options.Events.OnRedirectToLogin = context =>
        {
            if (context.Request.Path.StartsWithSegments("/api"))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                context.Response.ContentType = "application/problem+json";
                return context.Response.WriteAsJsonAsync(new
                {
                    title = "Google Workspace sign-in required.",
                    detail = "Your workspace session expired. Sign in again, then refresh this view.",
                    status = StatusCodes.Status401Unauthorized,
                });
            }

            context.Response.Redirect(context.RedirectUri);
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            if (context.Request.Path.StartsWithSegments("/api"))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                context.Response.ContentType = "application/problem+json";
                return context.Response.WriteAsJsonAsync(new
                {
                    title = "Google Workspace access denied.",
                    detail = "Your account is signed in but does not have access to this workspace action.",
                    status = StatusCodes.Status403Forbidden,
                });
            }

            context.Response.Redirect(context.RedirectUri);
            return Task.CompletedTask;
        };
        options.Events.OnValidatePrincipal = async context =>
        {
            var email = context.Principal?.FindFirstValue(ClaimTypes.Email);

            if (string.IsNullOrWhiteSpace(email))
            {
                return;
            }

            var db = context.HttpContext.RequestServices.GetRequiredService<IncosWorkspaceDbContext>();
            await GoogleIntegrationEndpoints.EnsureAdminUsersTableAsync(db, context.HttpContext.RequestAborted);

            var normalizedEmail = email.Trim().ToLowerInvariant();
            var user = await db.AdminUsers
                .AsNoTracking()
                .FirstOrDefaultAsync(adminUser => adminUser.Email == normalizedEmail, context.HttpContext.RequestAborted);

            if (user is null || !string.Equals(user.Status, "inactive", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        };
    });

if (isGoogleAuthenticationConfigured)
{
    authenticationBuilder.AddGoogle(options =>
    {
        var hostedDomain = googleSection["HostedDomain"];
        var workspaceDataDomain = GetGoogleWorkspaceDataDomain(googleSection);
        var restrictToHostedDomain = googleSection.GetValue("RestrictToHostedDomain", false);

        options.ClientId = googleClientId!;
        options.ClientSecret = googleClientSecret!;
        options.CallbackPath = googleSection["CallbackPath"] ?? "/signin-google";
        options.CorrelationCookie.SameSite = SameSiteMode.Lax;
        options.CorrelationCookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.AccessType = "offline";
        options.SaveTokens = true;

        if (!options.Scope.Contains("profile"))
        {
            options.Scope.Add("profile");
        }

        if (!options.Scope.Contains("email"))
        {
            options.Scope.Add("email");
        }

        options.Events.OnRedirectToAuthorizationEndpoint = context =>
        {
            var redirectUri = context.RedirectUri;

            if (restrictToHostedDomain && !string.IsNullOrWhiteSpace(hostedDomain))
            {
                redirectUri = QueryHelpers.AddQueryString(redirectUri, "hd", hostedDomain);
            }

            context.Response.Redirect(redirectUri);
            return Task.CompletedTask;
        };

        options.Events.OnRemoteFailure = context =>
        {
            context.HandleResponse();

            var returnUrl = ExtractReturnUrlFromOAuthRedirect(context.Properties?.RedirectUri);
            var redirectUrl = QueryHelpers.AddQueryString(
                returnUrl,
                "authError",
                "Google sign-in could not be completed. Please sign in again.");

            context.Response.Redirect(redirectUrl);
            return Task.CompletedTask;
        };

        options.Events.OnCreatingTicket = async context =>
        {
            var email = context.Identity?.FindFirst(ClaimTypes.Email)?.Value;
            var userHostedDomain = TryGetJsonString(context.User, "hd");
            var pictureUrl = TryGetJsonString(context.User, "picture");

            if (!string.IsNullOrWhiteSpace(userHostedDomain))
            {
                context.Identity?.AddClaim(new Claim("hd", userHostedDomain));
            }

            if (!string.IsNullOrWhiteSpace(pictureUrl))
            {
                context.Identity?.AddClaim(new Claim("urn:google:picture", pictureUrl));
            }

            var requestedWorkspaceScopes = context.Properties.Items.TryGetValue(
                AuthEndpoints.GoogleRequestedWorkspaceScopesProperty,
                out var scopesValue)
                ? scopesValue ?? string.Empty
                : string.Empty;
            var tokenResponseScopes = context.TokenResponse.Response is null
                ? null
                : TryGetJsonString(context.TokenResponse.Response.RootElement, "scope");
            var effectiveWorkspaceScopes = GetEffectiveGoogleWorkspaceScopes(
                requestedWorkspaceScopes,
                tokenResponseScopes,
                context.Properties.RedirectUri);

            context.Identity?.AddClaim(new Claim("urn:google:scopes", effectiveWorkspaceScopes));

            if (!IsWorkspaceGoogleAccount(email, userHostedDomain, workspaceDataDomain))
            {
                context.Fail($"Use an {workspaceDataDomain} Google Workspace account for this login.");
                return;
            }

            if (restrictToHostedDomain && !string.IsNullOrWhiteSpace(hostedDomain))
            {
                var isWorkspaceUser =
                    string.Equals(userHostedDomain, hostedDomain, StringComparison.OrdinalIgnoreCase) ||
                    (!string.IsNullOrWhiteSpace(email) &&
                     email.EndsWith($"@{hostedDomain}", StringComparison.OrdinalIgnoreCase));

                if (!isWorkspaceUser)
                {
                    context.Fail($"Only Google Workspace accounts for {hostedDomain} can sign in.");
                    return;
                }
            }

            if (!string.IsNullOrWhiteSpace(email))
            {
                var db = context.HttpContext.RequestServices.GetRequiredService<IncosWorkspaceDbContext>();
                var displayName =
                    context.Identity?.FindFirst(ClaimTypes.Name)?.Value ??
                    TryGetJsonString(context.User, "name");
                var loginStatus = await GoogleIntegrationEndpoints.RecordGoogleWorkspaceLoginAsync(
                    db,
                    email,
                    displayName,
                    userHostedDomain,
                    pictureUrl,
                    context.HttpContext.RequestAborted);

                context.Identity?.AddClaim(new Claim("urn:incos:account_status", loginStatus));

                if (string.Equals(loginStatus, "inactive", StringComparison.OrdinalIgnoreCase))
                {
                    context.Fail("This Google Workspace account is inactive in Admin Console.");
                    return;
                }
            }

            context.Properties.IsPersistent = true;
            context.Properties.ExpiresUtc = DateTimeOffset.UtcNow.AddDays(14);

            if (!string.IsNullOrWhiteSpace(email) &&
                !string.IsNullOrWhiteSpace(effectiveWorkspaceScopes) &&
                !string.IsNullOrWhiteSpace(context.AccessToken))
            {
                var db = context.HttpContext.RequestServices.GetRequiredService<IncosWorkspaceDbContext>();
                await GoogleIntegrationEndpoints.EnsureGoogleOAuthTokensTableAsync(db, context.HttpContext.RequestAborted);
                var userKey = NormalizeGoogleUserKey(email);
                var existingToken = await db.GoogleOAuthTokens
                    .FirstOrDefaultAsync(
                        token => token.UserKey.ToLower() == userKey ||
                                 (token.Email != null && token.Email.ToLower() == userKey),
                        context.HttpContext.RequestAborted);
                var now = DateTimeOffset.UtcNow;

                if (existingToken is null)
                {
                    existingToken = new GoogleOAuthToken
                    {
                        Id = Guid.NewGuid(),
                        CreatedAt = now,
                        UserKey = userKey,
                    };
                    db.GoogleOAuthTokens.Add(existingToken);
                }

                existingToken.UserKey = userKey;
                existingToken.Email = userKey;
                existingToken.AccessToken = context.AccessToken;
                existingToken.RefreshToken = string.IsNullOrWhiteSpace(context.RefreshToken)
                    ? existingToken.RefreshToken
                    : context.RefreshToken;
                existingToken.AccessTokenExpiresAt = context.ExpiresIn.HasValue
                    ? now.Add(context.ExpiresIn.Value)
                    : now.AddHours(1);
                existingToken.Scope = effectiveWorkspaceScopes;
                existingToken.UpdatedAt = now;

                var authenticationTokens = context.Properties.GetTokens().ToList();
                StoreToken(authenticationTokens, "scope", effectiveWorkspaceScopes);
                context.Properties.StoreTokens(authenticationTokens);

                await db.SaveChangesAsync(context.HttpContext.RequestAborted);
            }
        };
    });
}
builder.Services.AddAuthorization();
builder.Services.AddHostedService<GoogleIntegrationEndpoints.GmailScheduledSendWorker>();

builder.Services.AddDbContext<IncosWorkspaceDbContext>(options =>
{
    var connectionString = builder.Configuration.GetConnectionString("IncosWorkspace")
        ?? "Host=localhost;Port=5432;Database=incos_workspace;Username=incos;Password=incos";

    options.UseNpgsql(connectionString);
});

var app = builder.Build();

app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        var isApiRequest = context.Request.Path.StartsWithSegments("/api");
        var isBrowserNavigation = IsBrowserNavigationRequest(context);
        var message = context.Request.Path.StartsWithSegments("/signin-google")
            ? "Google sign-in could not be completed. Please reconnect Google Workspace and allow the requested permissions."
            : "The workspace server hit an unexpected problem. Please refresh and try again.";

        if (isApiRequest && !isBrowserNavigation)
        {
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(new
            {
                title = "Workspace request failed.",
                detail = message,
                status = StatusCodes.Status500InternalServerError,
            });
            return;
        }

        var redirectUrl = QueryHelpers.AddQueryString(
            "/",
            "authError",
            message);
        context.Response.Redirect(redirectUrl);
    });
});

app.UseForwardedHeaders();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}
app.UseCors("frontend");
app.UseAuthentication();
app.UseAuthorization();
app.Use(async (context, next) =>
{
    if (!context.Request.Path.StartsWithSegments("/api") ||
        context.Request.Path.StartsWithSegments("/api/auth") ||
        context.User.Identity?.IsAuthenticated != true)
    {
        await next();
        return;
    }

    var email = context.User.FindFirstValue(ClaimTypes.Email);

    if (string.IsNullOrWhiteSpace(email))
    {
        await next();
        return;
    }

    var configuration = context.RequestServices.GetRequiredService<IConfiguration>();
    var workspaceDataDomain = GetGoogleWorkspaceDataDomain(configuration.GetSection("Authentication:Google"));

    if (!IsWorkspaceGoogleAccount(email, context.User.FindFirstValue("hd"), workspaceDataDomain))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        context.Response.ContentType = "application/problem+json";
        await context.Response.WriteAsJsonAsync(new
        {
            title = "Google Workspace account required.",
            detail = $"Use an {workspaceDataDomain} Google Workspace account to access INCOS Workspace.",
            status = StatusCodes.Status403Forbidden,
        });
        return;
    }

    var db = context.RequestServices.GetRequiredService<IncosWorkspaceDbContext>();
    await GoogleIntegrationEndpoints.EnsureAdminUsersTableAsync(db, context.RequestAborted);

    var normalizedEmail = email.Trim().ToLowerInvariant();
    var adminUser = await db.AdminUsers
        .AsNoTracking()
        .FirstOrDefaultAsync(user => user.Email == normalizedEmail, context.RequestAborted);
    var status = adminUser?.Status?.Trim().ToLowerInvariant() ?? "pending";

    if (status == "active")
    {
        await next();
        return;
    }

    context.Response.StatusCode = status == "inactive"
        ? StatusCodes.Status403Forbidden
        : StatusCodes.Status423Locked;
    context.Response.ContentType = "application/problem+json";
    await context.Response.WriteAsJsonAsync(new
    {
        title = status == "inactive" ? "Account inactive." : "Approval pending.",
        detail = status == "inactive"
            ? "This account is inactive in Admin Console."
            : "Your account is waiting for admin approval.",
        status = context.Response.StatusCode,
    });
});

app.MapAuthEndpoints();
app.MapCanvasIntegrationEndpoints();
app.MapGoogleIntegrationEndpoints();
app.MapMicrosoftIntegrationEndpoints();
app.MapWorkspaceEndpoints();

if (app.Configuration.GetValue("Database:EnsureCreated", false))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<IncosWorkspaceDbContext>();

    await db.Database.EnsureCreatedAsync();
    await GoogleIntegrationEndpoints.EnsureGoogleOAuthTokensTableAsync(db);
    await GoogleIntegrationEndpoints.EnsureAdminUsersTableAsync(db);
    await GoogleIntegrationEndpoints.EnsureAdminGroupsTableAsync(db);
    await GoogleIntegrationEndpoints.EnsureScheduledGmailMessagesTableAsync(db);
    await WorkspaceEndpoints.EnsureUserSettingsTableAsync(db);
    await SeedData.SeedAsync(db);
}

app.Run();

static string? TryGetJsonString(JsonElement element, string propertyName)
{
    return element.TryGetProperty(propertyName, out var property) &&
           property.ValueKind == JsonValueKind.String
        ? property.GetString()
        : null;
}

static string ExtractReturnUrlFromOAuthRedirect(string? redirectUri)
{
    if (string.IsNullOrWhiteSpace(redirectUri))
    {
        return "/";
    }

    var queryIndex = redirectUri.IndexOf("?", StringComparison.Ordinal);

    if (queryIndex < 0 || queryIndex == redirectUri.Length - 1)
    {
        return "/";
    }

    var query = QueryHelpers.ParseQuery(redirectUri[queryIndex..]);

    return query.TryGetValue("returnUrl", out var returnUrl)
        ? NormalizeLocalReturnUrl(returnUrl.ToString())
        : "/";
}

static string NormalizeLocalReturnUrl(string? returnUrl)
{
    return !string.IsNullOrWhiteSpace(returnUrl) &&
           returnUrl.StartsWith("/", StringComparison.Ordinal) &&
           !returnUrl.StartsWith("//", StringComparison.Ordinal)
        ? returnUrl
        : "/";
}

static bool IsBrowserNavigationRequest(HttpContext context)
{
    if (!HttpMethods.IsGet(context.Request.Method))
    {
        return false;
    }

    if (string.Equals(
            context.Request.Headers["Sec-Fetch-Mode"].ToString(),
            "navigate",
            StringComparison.OrdinalIgnoreCase))
    {
        return true;
    }

    var acceptHeader = context.Request.Headers.Accept.ToString();

    return acceptHeader.Contains("text/html", StringComparison.OrdinalIgnoreCase);
}

static string NormalizeGoogleUserKey(string email) => email.Trim().ToLowerInvariant();

static string GetEffectiveGoogleWorkspaceScopes(
    string requestedWorkspaceScopes,
    string? tokenResponseScopes,
    string? redirectUri)
{
    var tokenWorkspaceScopes = ParseScopes(tokenResponseScopes)
        .Where(scope => GoogleWorkspaceScopes.All.Contains(scope, StringComparer.OrdinalIgnoreCase))
        .ToArray();

    if (tokenWorkspaceScopes.Length > 0)
    {
        return string.Join(' ', tokenWorkspaceScopes);
    }

    if (!string.IsNullOrWhiteSpace(requestedWorkspaceScopes))
    {
        return requestedWorkspaceScopes;
    }

    return IsGoogleWorkspaceReconnectRedirect(redirectUri)
        ? string.Join(' ', GoogleWorkspaceScopes.All)
        : string.Empty;
}

static bool IsGoogleWorkspaceReconnectRedirect(string? redirectUri)
{
    if (string.IsNullOrWhiteSpace(redirectUri))
    {
        return false;
    }

    var queryIndex = redirectUri.IndexOf("?", StringComparison.Ordinal);

    if (queryIndex < 0 || queryIndex == redirectUri.Length - 1)
    {
        return false;
    }

    var query = QueryHelpers.ParseQuery(redirectUri[queryIndex..]);

    if (!query.TryGetValue("returnUrl", out var returnUrlValue))
    {
        return false;
    }

    var returnUrl = returnUrlValue.ToString();

    return returnUrl.Contains("integration=google_", StringComparison.OrdinalIgnoreCase) ||
           returnUrl.Contains("item=email", StringComparison.OrdinalIgnoreCase) ||
           returnUrl.Contains("item=chat", StringComparison.OrdinalIgnoreCase);
}

static IEnumerable<string> ParseScopes(string? scopes) =>
    string.IsNullOrWhiteSpace(scopes)
        ? []
        : scopes.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

static void StoreToken(List<AuthenticationToken> tokens, string name, string value)
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

static string GetGoogleWorkspaceDataDomain(IConfigurationSection googleSection)
{
    var configuredDomain = googleSection["WorkspaceDataDomain"] ?? googleSection["HostedDomain"];

    return string.IsNullOrWhiteSpace(configuredDomain)
        ? "incos.co.kr"
        : configuredDomain.Trim().TrimStart('@').ToLowerInvariant();
}

static bool IsWorkspaceGoogleAccount(string? email, string? hostedDomain, string workspaceDataDomain) =>
    (!string.IsNullOrWhiteSpace(hostedDomain) &&
     string.Equals(hostedDomain, workspaceDataDomain, StringComparison.OrdinalIgnoreCase)) ||
    (!string.IsNullOrWhiteSpace(email) &&
     email.EndsWith($"@{workspaceDataDomain}", StringComparison.OrdinalIgnoreCase));
