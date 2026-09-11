using CanvasToDo.Api.Data;
using CanvasToDo.Api.Domain.Identity;
using CanvasToDo.Api.Endpoints;
using CanvasToDo.Api.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Facebook;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.OAuth.Claims;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System.Security.Claims;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);
var migrateOnly = args.Any(argument =>
    string.Equals(argument, "--migrate-only", StringComparison.OrdinalIgnoreCase));
var trustForwardedHeaders = builder.Configuration.GetValue("ReverseProxy:TrustForwardedHeaders", false);
var connectionString = builder.Configuration.GetConnectionString("CanvasToDo");

builder.WebHost.ConfigureKestrel(options =>
{
    // The retained API accepts JSON preferences and small credential envelopes only.
    // A tight global cap prevents oversized unauthenticated and preference requests.
    options.Limits.MaxRequestBodySize = 1024 * 1024;
});

if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException(
        "Configure ConnectionStrings:CanvasToDo with a PostgreSQL connection string.");
}

builder.Services.AddOpenApi();
builder.Services.ConfigureHttpJsonOptions(options =>
{
    // Optional Canvas fields are common. Omitting null properties trims API payloads
    // without changing the SPA's existing undefined/null handling.
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});
builder.Services
    .AddHttpClient("Canvas")
    .ConfigurePrimaryHttpMessageHandler(static () => new SocketsHttpHandler
    {
        // Validate redirects before following them so an allowed Canvas host cannot
        // bounce server-side requests to another origin or an internal service.
        AllowAutoRedirect = false,
        // The handler is pooled across users. Bearer-only API requests must never
        // retain or replay a Canvas response cookie from another user's request.
        UseCookies = false,
    });
builder.Services.AddMemoryCache(options =>
{
    // Canvas responses are user-specific and can be large. A process-wide size
    // budget keeps varied calendar ranges from turning the short-lived cache
    // into unbounded application memory growth.
    var configuredSizeMb = builder.Configuration.GetValue("Performance:MemoryCacheSizeMb", 32);
    options.SizeLimit = Math.Clamp(configuredSizeMb, 8, 128) * 1024L * 1024L;
    options.CompactionPercentage = 0.25;
    options.ExpirationScanFrequency = TimeSpan.FromMinutes(1);
});
builder.Services.Configure<AccountEmailOptions>(builder.Configuration.GetSection("Email"));
builder.Services.AddSingleton<IAccountEmailSender, SmtpAccountEmailSender>();
builder.Services.AddScoped<PasswordChangeService>();

// Existing sessions and encrypted Canvas tokens depend on this application name.
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
    options.ForwardLimit = 1;

    if (trustForwardedHeaders)
    {
        // Compose publishes the API only on loopback; Nginx is the sole public ingress.
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
    }
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

builder.Services.AddDbContext<CanvasToDoDbContext>(options =>
    options.UseNpgsql(connectionString));
builder.Services.AddDbContext<AuthDbContext>(options =>
    options.UseNpgsql(
        connectionString,
        npgsql => npgsql.MigrationsHistoryTable("__auth_migrations_history")));

builder.Services
    .AddIdentity<ApplicationUser, IdentityRole<Guid>>(options =>
    {
        options.User.RequireUniqueEmail = true;
        options.SignIn.RequireConfirmedAccount = false;
        options.SignIn.RequireConfirmedEmail = true;

        options.Password.RequiredLength = 10;
        options.Password.RequiredUniqueChars = 4;
        options.Password.RequireLowercase = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireDigit = true;
        options.Password.RequireNonAlphanumeric = false;

        options.Lockout.AllowedForNewUsers = true;
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
    })
    .AddEntityFrameworkStores<AuthDbContext>()
    .AddClaimsPrincipalFactory<ApplicationUserClaimsPrincipalFactory>()
    .AddDefaultTokenProviders();

builder.Services.Configure<DataProtectionTokenProviderOptions>(options =>
{
    options.TokenLifespan = TimeSpan.FromHours(2);
});

builder.Services.Configure<SecurityStampValidatorOptions>(options =>
{
    // Deactivation, role changes, and explicit revocation take effect on the next request.
    options.ValidationInterval = TimeSpan.Zero;
});
builder.Services.ConfigureApplicationCookie(options =>
{
    options.Cookie.Name = "canvas_to_do_auth";
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
        ? CookieSecurePolicy.SameAsRequest
        : CookieSecurePolicy.Always;
    options.ExpireTimeSpan = AuthEndpoints.GetSessionDuration(builder.Configuration);
    options.SlidingExpiration = true;
    options.LoginPath = "/";
    options.AccessDeniedPath = "/api/auth/denied";
    options.Events.OnRedirectToLogin = context => WriteApiAuthenticationFailureAsync(
        context,
        StatusCodes.Status401Unauthorized,
        "Sign-in required.",
        "Your session expired or is missing. Sign in again to continue.");
    options.Events.OnRedirectToAccessDenied = context => WriteApiAuthenticationFailureAsync(
        context,
        StatusCodes.Status403Forbidden,
        "Access denied.",
        "Your account does not have permission for this action.");
    options.Events.OnValidatePrincipal = ValidateApplicationCookieAsync;
});

var authenticationBuilder = builder.Services.AddAuthentication();

var googleSection = builder.Configuration.GetSection("Authentication:Google");
var googleClientId = googleSection["ClientId"];
var googleClientSecret = googleSection["ClientSecret"];

if (!string.IsNullOrWhiteSpace(googleClientId) && !string.IsNullOrWhiteSpace(googleClientSecret))
{
    authenticationBuilder.AddGoogle(options =>
    {
        options.ClientId = googleClientId;
        options.ClientSecret = googleClientSecret;
        options.CallbackPath = googleSection["CallbackPath"] ?? "/api/auth/google/oauth-callback";
        options.SaveTokens = false;
        options.AccessType = "online";
        options.Scope.Clear();
        options.Scope.Add("openid");
        options.Scope.Add("profile");
        options.Scope.Add("email");
        options.ClaimActions.MapJsonKey("email_verified", "email_verified");
        options.ClaimActions.MapJsonKey("urn:google:verified_email", "verified_email");
        options.CorrelationCookie.SameSite = SameSiteMode.Lax;
        options.CorrelationCookie.SecurePolicy = builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.SameAsRequest
            : CookieSecurePolicy.Always;
        options.Events.OnRemoteFailure = context => HandleExternalFailureAsync(context, "Google");
    });
}

var facebookSection = builder.Configuration.GetSection("Authentication:Facebook");
var facebookClientId = facebookSection["ClientId"];
var facebookClientSecret = facebookSection["ClientSecret"];

if (!string.IsNullOrWhiteSpace(facebookClientId) && !string.IsNullOrWhiteSpace(facebookClientSecret))
{
    authenticationBuilder.AddFacebook(options =>
    {
        options.AppId = facebookClientId;
        options.AppSecret = facebookClientSecret;
        options.CallbackPath = facebookSection["CallbackPath"] ?? "/api/auth/facebook/oauth-callback";
        options.SaveTokens = false;
        options.Scope.Clear();
        options.Scope.Add("public_profile");
        options.Scope.Add("email");
        options.Fields.Add("name");
        options.Fields.Add("email");
        options.CorrelationCookie.SameSite = SameSiteMode.Lax;
        options.CorrelationCookie.SecurePolicy = builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.SameAsRequest
            : CookieSecurePolicy.Always;
        options.Events.OnRemoteFailure = context => HandleExternalFailureAsync(context, "Facebook");
    });
}

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("Admin", policy =>
        policy
            .RequireAuthenticatedUser()
            .RequireRole(ApplicationRoles.Admin));
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth-write", context => RateLimitPartition.GetFixedWindowLimiter(
        GetRateLimitPartitionKey(context),
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));
    options.AddPolicy("auth-sensitive", context => RateLimitPartition.GetFixedWindowLimiter(
        GetRateLimitPartitionKey(context),
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(5),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));
    options.AddPolicy("admin-write", context => RateLimitPartition.GetFixedWindowLimiter(
        GetAdminRateLimitPartitionKey(context),
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 30,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));
    options.AddPolicy("canvas-read", context => RateLimitPartition.GetFixedWindowLimiter(
        GetAdminRateLimitPartitionKey(context),
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 60,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));
    options.AddPolicy("canvas-write", context => RateLimitPartition.GetFixedWindowLimiter(
        GetRateLimitPartitionKey(context),
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 12,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));
    options.AddPolicy("canvas-calendar", context =>
    {
        var forceRefresh = bool.TryParse(context.Request.Query["forceRefresh"], out var requestedForceRefresh) &&
                           requestedForceRefresh;

        return RateLimitPartition.GetFixedWindowLimiter(
            $"{GetAdminRateLimitPartitionKey(context)}:{(forceRefresh ? "force" : "read")}",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = forceRefresh ? 2 : 12,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true,
            });
    });
    options.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.ContentType = "application/problem+json";
        await context.HttpContext.Response.WriteAsJsonAsync(new
        {
            title = "Too many requests.",
            detail = "Wait a moment before trying again.",
            status = StatusCodes.Status429TooManyRequests,
        }, cancellationToken);
    };
});

var app = builder.Build();

app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        var isApiRequest = context.Request.Path.StartsWithSegments("/api");

        if (isApiRequest && !IsBrowserNavigationRequest(context))
        {
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(new
            {
                title = "Request failed.",
                detail = "The server hit an unexpected problem. Please try again.",
                status = StatusCodes.Status500InternalServerError,
            });
            return;
        }

        context.Response.Redirect(QueryHelpers.AddQueryString(
            GetApplicationRoot(context),
            "authError",
            "Sign-in could not be completed. Please try again."));
    });
});

app.UseForwardedHeaders();
app.Use(async (context, next) =>
{
    if (trustForwardedHeaders &&
        context.Request.PathBase == PathString.Empty &&
        context.Request.Headers.TryGetValue("X-Forwarded-Prefix", out var forwardedPrefix))
    {
        var prefix = forwardedPrefix.FirstOrDefault()?.TrimEnd('/');

        if (!string.IsNullOrWhiteSpace(prefix) &&
            prefix.StartsWith('/') &&
            !prefix.StartsWith("//", StringComparison.Ordinal))
        {
            context.Request.PathBase = prefix;
        }
    }

    await next();
});

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}
else
{
    app.UseHttpsRedirection();
}

app.UseCors("frontend");
app.Use(ApiRequestVerification.EnforceAsync);
app.UseAuthentication();
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api") &&
        context.User.Identity?.IsAuthenticated == true)
    {
        // Authenticated responses can contain account, Canvas, or administrator data.
        // Keep browser/proxy caches from replaying one account's response after sign-out.
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.Pragma = "no-cache";
    }

    await next(context);
});
app.UseRateLimiter();
app.UseAuthorization();
app.Use(EnforceApplicationAccessAsync);
app.Use(UserActivityTracking.TrackAsync);

app.MapAuthEndpoints();
app.MapAdminAuthEndpoints();
app.MapCanvasIntegrationEndpoints();
app.MapAcademyPreferenceEndpoints();
app.MapGet("/api/health", () => Results.Ok(new
{
    service = "canvas-to-do API",
    status = "ok",
})).WithName("Health");

app.MapGet("/api/health/ready", async (
    CanvasToDoDbContext db,
    CancellationToken cancellationToken) =>
{
    try
    {
        return await db.Database.CanConnectAsync(cancellationToken)
            ? Results.Ok(new { status = "ready" })
            : Results.Problem(
                title: "Database unavailable.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
    }
    catch (Exception exception) when (exception is NpgsqlException or InvalidOperationException)
    {
        return Results.Problem(
            title: "Database unavailable.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
}).WithName("Readiness");

if (migrateOnly)
{
    await InitializeDatabasesAsync(app);
    return;
}

if (app.Configuration.GetValue("Database:InitializeOnStartup", true))
{
    await InitializeDatabasesAsync(app);
}

app.Run();

static async Task InitializeDatabasesAsync(WebApplication app)
{
    using var scope = app.Services.CreateScope();
    var cancellationToken = app.Lifetime.ApplicationStopping;
    var applicationDb = scope.ServiceProvider.GetRequiredService<CanvasToDoDbContext>();
    var initializationConnectionString = applicationDb.Database.GetConnectionString() ??
        throw new InvalidOperationException("The database initialization connection string is unavailable.");
    var lockConnectionString = new NpgsqlConnectionStringBuilder(initializationConnectionString)
    {
        // A physically closed connection guarantees that PostgreSQL releases the
        // session advisory lock even if explicit unlock fails during shutdown.
        Pooling = false,
    }.ConnectionString;
    await using var initializationLockConnection = new NpgsqlConnection(lockConnectionString);
    await initializationLockConnection.OpenAsync(cancellationToken);
    await using (var lockCommand = initializationLockConnection.CreateCommand())
    {
        lockCommand.CommandText =
            "SELECT pg_advisory_lock(hashtextextended(@lock_name, 0));";
        lockCommand.CommandTimeout = 120;
        lockCommand.Parameters.AddWithValue(
            "lock_name",
            "canvas-to-do:database-initialization:v1");
        await lockCommand.ExecuteNonQueryAsync(cancellationToken);
    }

    try
    {
        // Optional settings schema creation runs before Auth migrations for a brand-new database.
        if (app.Configuration.GetValue("Database:EnsureCreated", false))
        {
            await applicationDb.Database.EnsureCreatedAsync(cancellationToken);
        }

        // Bootstrap user_settings once at startup instead of executing DDL on every
        // preference or Canvas-token request; Identity migrations manage separate tables.
        await AcademyPreferenceEndpoints.EnsureTableAsync(applicationDb, cancellationToken);

        if (app.Configuration.GetValue("Database:MigrateAuth", true))
        {
            var authDb = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
            await authDb.Database.MigrateAsync(cancellationToken);
        }

        await AuthBootstrapper.InitializeAsync(
            scope.ServiceProvider,
            app.Configuration,
            cancellationToken);
    }
    finally
    {
        try
        {
            await using var unlockCommand = initializationLockConnection.CreateCommand();
            unlockCommand.CommandText =
                "SELECT pg_advisory_unlock(hashtextextended(@lock_name, 0));";
            unlockCommand.CommandTimeout = 5;
            unlockCommand.Parameters.AddWithValue(
                "lock_name",
                "canvas-to-do:database-initialization:v1");
            await unlockCommand.ExecuteNonQueryAsync(CancellationToken.None);
        }
        catch (Exception exception) when (exception is NpgsqlException or InvalidOperationException)
        {
            // Pooling is disabled for this dedicated connection, so disposal below
            // still releases the lock. Keep the original initialization exception.
            app.Logger.LogWarning(
                exception,
                "Database initialization lock could not be explicitly released; closing its dedicated connection.");
        }
    }
}

static async Task EnforceApplicationAccessAsync(HttpContext context, RequestDelegate next)
{
    if (!context.Request.Path.StartsWithSegments("/api") ||
        context.Request.Path.StartsWithSegments("/api/auth") ||
        context.User.Identity?.IsAuthenticated != true)
    {
        await next(context);
        return;
    }

    var userManager = context.RequestServices.GetRequiredService<UserManager<ApplicationUser>>();
    var signInManager = context.RequestServices.GetRequiredService<SignInManager<ApplicationUser>>();
    var user = await userManager.GetUserAsync(context.User);

    if (user is null ||
        !user.EmailConfirmed ||
        !string.Equals(user.Status, UserStatuses.Active, StringComparison.OrdinalIgnoreCase))
    {
        await signInManager.SignOutAsync();
        await WriteProblemAsync(
            context,
            StatusCodes.Status403Forbidden,
            "Account inactive.",
            "Contact an administrator to restore this account.");
        return;
    }

    if (await userManager.IsInRoleAsync(user, ApplicationRoles.Admin) ||
        IsStandardUserApiAllowed(context.Request))
    {
        await next(context);
        return;
    }

    await WriteProblemAsync(
        context,
        StatusCodes.Status403Forbidden,
        "Access denied.",
        "Standard accounts can access only their Academy calendar and account settings.");
}

static bool IsStandardUserApiAllowed(HttpRequest request)
{
    var path = request.Path;

    if (path.StartsWithSegments(new PathString("/api/health")) ||
        path.Equals(new PathString("/api/canvas/integration")) ||
        path.Equals(new PathString("/api/canvas/token")) ||
        path.Equals(new PathString("/api/academy/preferences")))
    {
        return true;
    }

    return HttpMethods.IsGet(request.Method) &&
           (path.Equals(new PathString("/api/canvas/calendar-items")) ||
            path.Equals(new PathString("/api/canvas/courses")) ||
            path.Equals(new PathString("/api/canvas/oauth/login")) ||
            path.Equals(new PathString("/api/canvas/oauth/callback")));
}

static string GetRateLimitPartitionKey(HttpContext context) =>
    context.User.FindFirstValue(ClaimTypes.NameIdentifier) is { Length: > 0 } userId
        ? $"user:{userId}"
        : $"ip:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown-client"}";

static string GetAdminRateLimitPartitionKey(HttpContext context) =>
    GetRateLimitPartitionKey(context);

static async Task ValidateApplicationCookieAsync(CookieValidatePrincipalContext context)
{
    await SecurityStampValidator.ValidatePrincipalAsync(context);

    if (context.Principal?.Identity?.IsAuthenticated != true)
    {
        return;
    }

    var userManager = context.HttpContext.RequestServices.GetRequiredService<UserManager<ApplicationUser>>();
    var user = await userManager.GetUserAsync(context.Principal);

    if (user is not null &&
        user.EmailConfirmed &&
        string.Equals(user.Status, UserStatuses.Active, StringComparison.OrdinalIgnoreCase))
    {
        return;
    }

    context.RejectPrincipal();
    await context.HttpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
}

static Task WriteApiAuthenticationFailureAsync(
    RedirectContext<CookieAuthenticationOptions> context,
    int statusCode,
    string title,
    string detail)
{
    if (!context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.Redirect(context.RedirectUri);
        return Task.CompletedTask;
    }

    return WriteProblemAsync(context.HttpContext, statusCode, title, detail);
}

static Task WriteProblemAsync(
    HttpContext context,
    int statusCode,
    string title,
    string detail)
{
    context.Response.StatusCode = statusCode;
    context.Response.ContentType = "application/problem+json";

    return context.Response.WriteAsJsonAsync(new { title, detail, status = statusCode });
}

static Task HandleExternalFailureAsync(RemoteFailureContext context, string provider)
{
    context.HandleResponse();
    context.Response.Redirect(QueryHelpers.AddQueryString(
        GetApplicationRoot(context.HttpContext),
        "authError",
        $"{provider} sign-in could not be completed. Please try again."));
    return Task.CompletedTask;
}

static string GetApplicationRoot(HttpContext context) =>
    context.Request.PathBase.HasValue
        ? $"{context.Request.PathBase.Value!.TrimEnd('/')}/"
        : "/";

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

    return context.Request.Headers.Accept.ToString()
        .Contains("text/html", StringComparison.OrdinalIgnoreCase);
}
