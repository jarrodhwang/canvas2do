using Incos.Workspace.Api.Data;
using Incos.Workspace.Api.Domain.Entities;
using Incos.Workspace.Api.Endpoints;
using Incos.Workspace.Api.Infrastructure;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
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
    });

if (isGoogleAuthenticationConfigured)
{
    authenticationBuilder.AddGoogle(options =>
    {
        var hostedDomain = googleSection["HostedDomain"];

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

        foreach (var scope in GoogleWorkspaceScopes.All)
        {
            if (!options.Scope.Contains(scope))
            {
                options.Scope.Add(scope);
            }
        }

        options.Events.OnRedirectToAuthorizationEndpoint = context =>
        {
            var redirectUri = context.RedirectUri;

            if (!string.IsNullOrWhiteSpace(hostedDomain))
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

            context.Identity?.AddClaim(
                new Claim("urn:google:scopes", string.Join(' ', GoogleWorkspaceScopes.All)));

            if (!string.IsNullOrWhiteSpace(hostedDomain))
            {
                var isWorkspaceUser =
                    string.Equals(userHostedDomain, hostedDomain, StringComparison.OrdinalIgnoreCase) ||
                    (!string.IsNullOrWhiteSpace(email) &&
                     email.EndsWith($"@{hostedDomain}", StringComparison.OrdinalIgnoreCase));

                if (!isWorkspaceUser)
                {
                    context.Fail($"Only Google Workspace accounts for {hostedDomain} can sign in.");
                }
            }

            context.Properties.IsPersistent = true;
            context.Properties.ExpiresUtc = DateTimeOffset.UtcNow.AddDays(14);

            if (!string.IsNullOrWhiteSpace(email) &&
                !string.IsNullOrWhiteSpace(context.AccessToken))
            {
                var db = context.HttpContext.RequestServices.GetRequiredService<IncosWorkspaceDbContext>();
                await GoogleIntegrationEndpoints.EnsureGoogleOAuthTokensTableAsync(db, context.HttpContext.RequestAborted);
                var userKey = email;
                var existingToken = await db.GoogleOAuthTokens
                    .FirstOrDefaultAsync(token => token.UserKey == userKey, context.HttpContext.RequestAborted);
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

                existingToken.Email = email;
                existingToken.AccessToken = context.AccessToken;
                existingToken.RefreshToken = string.IsNullOrWhiteSpace(context.RefreshToken)
                    ? existingToken.RefreshToken
                    : context.RefreshToken;
                existingToken.AccessTokenExpiresAt = context.ExpiresIn.HasValue
                    ? now.Add(context.ExpiresIn.Value)
                    : now.AddHours(1);
                existingToken.Scope = string.Join(' ', GoogleWorkspaceScopes.All);
                existingToken.UpdatedAt = now;

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
