using CanvasToDo.Api.Data;
using CanvasToDo.Api.Domain.Identity;
using CanvasToDo.Api.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using System.Data;
using System.Security.Claims;
using System.Text;

namespace CanvasToDo.Api.Endpoints;

public static class AuthEndpoints
{
    private const double DefaultSessionHours = 24 * 14;
    private const double MinimumSessionHours = 1;
    private const double MaximumSessionHours = 24 * 14;
    private const int MaximumEmailLength = 256;
    private const string AuthenticatorIssuer = "canvas-to-do";
    private static readonly EmailAddressAttribute EmailValidator = new();

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth");

        auth.MapGet("/session", GetSessionAsync).WithName("GetAuthSession");
        auth.MapGet("/config", GetConfig).WithName("GetAuthConfig");

        auth.MapPost("/signup", SignUpAsync)
            .AllowAnonymous()
            .RequireRateLimiting("auth-write")
            .WithName("SignUp");
        auth.MapPost("/login", LoginAsync)
            .AllowAnonymous()
            .RequireRateLimiting("auth-write")
            .WithName("Login");
        auth.MapPost("/confirm-email", ConfirmEmailAsync)
            .AllowAnonymous()
            .RequireRateLimiting("auth-sensitive")
            .WithName("ConfirmEmail");
        auth.MapPost("/resend-confirmation", ResendConfirmationAsync)
            .AllowAnonymous()
            .RequireRateLimiting("auth-sensitive")
            .WithName("ResendEmailConfirmation");
        auth.MapPost("/forgot-password", ForgotPasswordAsync)
            .AllowAnonymous()
            .RequireRateLimiting("auth-sensitive")
            .WithName("ForgotPassword");
        auth.MapPost("/reset-password/request", RequestPasswordResetAsync)
            .AllowAnonymous()
            .RequireRateLimiting("auth-sensitive")
            .WithName("RequestPasswordReset");
        auth.MapPost("/reset-password", ResetPasswordAsync)
            .AllowAnonymous()
            .RequireRateLimiting("auth-sensitive")
            .WithName("ResetPassword");

        auth.MapGet("/{provider}/login", StartExternalLoginAsync)
            .AllowAnonymous()
            .RequireRateLimiting("auth-write")
            .WithName("StartExternalLogin");
        auth.MapGet("/external/callback", CompleteExternalLoginAsync)
            .AllowAnonymous()
            .RequireRateLimiting("auth-write")
            .WithName("CompleteExternalLogin");
        auth.MapGet("/profile", GetProfileAsync)
            .RequireAuthorization()
            .WithName("GetProfile");
        auth.MapPatch("/profile", UpdateProfileAsync)
            .RequireAuthorization()
            .RequireRateLimiting("auth-sensitive")
            .WithName("UpdateProfile");
        auth.MapPost("/change-password", ChangePasswordAsync)
            .RequireAuthorization()
            .RequireRateLimiting("auth-sensitive")
            .WithName("ChangeOwnPassword");

        auth.MapGet("/2fa/status", GetTwoFactorStatusAsync)
            .RequireAuthorization()
            .WithName("GetTwoFactorStatus");
        auth.MapPost("/2fa/setup", SetUpAuthenticatorAsync)
            .RequireAuthorization()
            .RequireRateLimiting("auth-sensitive")
            .WithName("SetUpAuthenticator");
        auth.MapPost("/2fa/confirm", ConfirmAuthenticatorAsync)
            .RequireAuthorization()
            .RequireRateLimiting("auth-sensitive")
            .WithName("ConfirmAuthenticator");
        auth.MapPost("/2fa/disable", DisableAuthenticatorAsync)
            .RequireAuthorization()
            .RequireRateLimiting("auth-sensitive")
            .WithName("DisableAuthenticator");
        auth.MapPost("/2fa/login", CompleteTwoFactorLoginAsync)
            .AllowAnonymous()
            .RequireRateLimiting("auth-sensitive")
            .WithName("CompleteTwoFactorLogin");
        auth.MapPost("/2fa/recovery", CompleteRecoveryCodeLoginAsync)
            .AllowAnonymous()
            .RequireRateLimiting("auth-sensitive")
            .WithName("CompleteRecoveryCodeLogin");

        auth.MapPost("/logout", LogoutAsync)
            .RequireRateLimiting("auth-write")
            .WithName("Logout");
        auth.MapGet("/denied", () => Results.Forbid()).WithName("AuthDenied");

        return app;
    }

    private static object GetConfig(
        IConfiguration configuration,
        IAccountEmailSender emailSender) => new
        {
            googleConfigured = HasClientCredentials(configuration, "Authentication:Google"),
            facebookConfigured = HasClientCredentials(configuration, "Authentication:Facebook"),
            passwordLoginConfigured = true,
            twoFactorAvailable = true,
            emailDeliveryConfigured = emailSender.Availability.IsAvailable,
            registrationApprovalRequired = true,
        };

    private static async Task<IResult> GetSessionAsync(
        HttpContext context,
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager)
    {
        context.Response.Headers.CacheControl = "no-store";

        if (!signInManager.IsSignedIn(context.User))
        {
            return Results.Ok(AnonymousSession());
        }

        var user = await userManager.GetUserAsync(context.User);

        if (user is null ||
            !user.EmailConfirmed ||
            !string.Equals(user.Status, UserStatuses.Active, StringComparison.OrdinalIgnoreCase))
        {
            await signInManager.SignOutAsync();
            return Results.Ok(AnonymousSession());
        }

        return Results.Ok(await BuildSessionAsync(user, context.User, userManager));
    }

    private static async Task<IResult> SignUpAsync(
        SignUpRequest request,
        HttpContext context,
        UserManager<ApplicationUser> userManager,
        ILoggerFactory loggerFactory)
    {
        context.Response.Headers.CacheControl = "no-store";
        var email = NormalizeEmail(request.Email);
        var displayName = request.DisplayName?.Trim() ?? string.Empty;
        var validationErrors = new Dictionary<string, string[]>();

        if (!IsValidEmail(email))
        {
            validationErrors["email"] = ["Enter a valid email address."];
        }

        if (string.IsNullOrWhiteSpace(displayName) || displayName.Length > 160)
        {
            validationErrors["displayName"] = ["Display name is required and must be 160 characters or less."];
        }

        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length > 256)
        {
            validationErrors["password"] = ["Password is required and must be 256 characters or less."];
        }

        if (validationErrors.Count > 0)
        {
            return Results.ValidationProblem(validationErrors);
        }

        var passwordValidation = await ValidatePasswordAsync(
            userManager,
            new ApplicationUser { UserName = email, Email = email },
            request.Password);

        if (!passwordValidation.Succeeded)
        {
            return IdentityValidationProblem(passwordValidation);
        }

        var existingUser = await userManager.FindByEmailAsync(email);

        if (existingUser is not null)
        {
            return RegistrationPendingAccepted();
        }

        var now = DateTimeOffset.UtcNow;
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = email,
            Email = email,
            DisplayName = displayName,
            Status = UserStatuses.Pending,
            CreatedAt = now,
            UpdatedAt = now,
            LastLoginAt = null,
        };
        var createResult = await userManager.CreateAsync(user, request.Password);

        if (!createResult.Succeeded)
        {
            return IdentityValidationProblem(createResult);
        }

        var roleResult = await userManager.AddToRoleAsync(user, ApplicationRoles.User);

        if (!roleResult.Succeeded)
        {
            await userManager.DeleteAsync(user);
            return IdentityValidationProblem(roleResult);
        }

        loggerFactory.CreateLogger("RegistrationAudit").LogInformation(
            "User {UserId} registered and is awaiting administrator approval.",
            user.Id);

        return RegistrationPendingAccepted();
    }

    private static async Task<IResult> ConfirmEmailAsync(
        EmailTokenRequest request,
        UserManager<ApplicationUser> userManager)
    {
        if (!Guid.TryParse(request.UserId, out var userId) || !TryDecodeToken(request.Code, out var token))
        {
            return InvalidEmailConfirmation();
        }

        var user = await userManager.FindByIdAsync(userId.ToString());

        if (user is null ||
            !string.Equals(user.Status, UserStatuses.Active, StringComparison.OrdinalIgnoreCase))
        {
            return InvalidEmailConfirmation();
        }

        var result = await userManager.ConfirmEmailAsync(user, token);

        if (!result.Succeeded)
        {
            return InvalidEmailConfirmation();
        }

        return Results.Ok(new
        {
            message = "Your email is confirmed. You can now sign in.",
        });
    }

    private static async Task<IResult> ResendConfirmationAsync(
        EmailRequest request,
        HttpContext context,
        UserManager<ApplicationUser> userManager,
        IAccountEmailSender emailSender,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        context.Response.Headers.CacheControl = "no-store";

        if (!emailSender.Availability.IsAvailable)
        {
            return EmailDeliveryUnavailable(emailSender.Availability);
        }

        var email = NormalizeEmail(request.Email);
        AccountEmailSendResult? sendResult = null;

        if (IsValidEmail(email) && await userManager.FindByEmailAsync(email) is { } user &&
            !user.EmailConfirmed &&
            string.Equals(user.Status, UserStatuses.Active, StringComparison.OrdinalIgnoreCase))
        {
            sendResult = await SendConfirmationEmailAsync(
                user,
                userManager,
                emailSender,
                loggerFactory,
                cancellationToken);
        }

        // The response intentionally does not reveal whether an account exists, is active,
        // or is already confirmed. Delivery failures are recorded server-side for the same reason.
        return GenericConfirmationAccepted(sendResult);
    }

    private static async Task<IResult> ForgotPasswordAsync(
        EmailRequest request,
        HttpContext context,
        UserManager<ApplicationUser> userManager,
        IAccountEmailSender emailSender,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        context.Response.Headers.CacheControl = "no-store";

        if (!emailSender.Availability.IsAvailable)
        {
            return EmailDeliveryUnavailable(emailSender.Availability);
        }

        var email = NormalizeEmail(request.Email);
        AccountEmailSendResult? sendResult = null;

        if (IsValidEmail(email) && await userManager.FindByEmailAsync(email) is { } user &&
            user.EmailConfirmed &&
            string.Equals(user.Status, UserStatuses.Active, StringComparison.OrdinalIgnoreCase) &&
            await userManager.HasPasswordAsync(user))
        {
            var token = await userManager.GeneratePasswordResetTokenAsync(user);
            sendResult = await emailSender.SendPasswordResetAsync(user, token, cancellationToken);

            if (!sendResult.Succeeded)
            {
                LogEmailDeliveryFailure(loggerFactory, "password reset", sendResult.Status);
            }
        }

        // Keep the same status and message for unknown, inactive, external-only, and eligible users.
        return GenericPasswordResetAccepted(sendResult);
    }

    private static async Task<IResult> RequestPasswordResetAsync(
        PasswordResetApprovalRequest request, HttpContext context, PasswordChangeService passwords)
    {
        context.Response.Headers.CacheControl = "no-store";
        var email = NormalizeEmail(request.Email);
        if (!IsValidEmail(email))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["email"] = ["Enter a valid email address."] });
        return await passwords.RequestResetAsync(email, request.NewPassword, request.ConfirmPassword);
    }

    private static async Task<IResult> ChangePasswordAsync(
        ChangeOwnPasswordRequest request, HttpContext context, UserManager<ApplicationUser> users,
        SignInManager<ApplicationUser> signInManager, PasswordChangeService passwords)
    {
        context.Response.Headers.CacheControl = "no-store";
        var user = await users.GetUserAsync(context.User);
        if (user is null) return Results.Unauthorized();
        var result = await passwords.ChangeOwnAsync(user.Id, request.CurrentPassword,
            request.NewPassword, request.ConfirmPassword, user.SecurityStamp);
        if (result is IStatusCodeHttpResult { StatusCode: StatusCodes.Status200OK })
            await signInManager.RefreshSignInAsync(user);
        return result;
    }

    private static async Task<IResult> ResetPasswordAsync(
        ResetPasswordRequest request,
        UserManager<ApplicationUser> userManager,
        PasswordChangeService passwords)
    {
        var email = NormalizeEmail(request.Email);

        if (!IsValidEmail(email) ||
            string.IsNullOrWhiteSpace(request.NewPassword) ||
            request.NewPassword.Length > 256 ||
            !TryDecodeToken(request.Code, out var token))
        {
            return InvalidPasswordReset();
        }

        var user = await userManager.FindByEmailAsync(email);

        if (user is null ||
            !user.EmailConfirmed ||
            !string.Equals(user.Status, UserStatuses.Active, StringComparison.OrdinalIgnoreCase) ||
            !await userManager.HasPasswordAsync(user))
        {
            return InvalidPasswordReset();
        }

        if (!await userManager.VerifyUserTokenAsync(user, userManager.Options.Tokens.PasswordResetTokenProvider,
            UserManager<ApplicationUser>.ResetPasswordTokenPurpose, token)) return InvalidPasswordReset();
        return await passwords.SubmitAsync(user.Id, request.NewPassword, request.ConfirmPassword, user.SecurityStamp);
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager)
    {
        var email = NormalizeEmail(request.Email);

        if ((request.Password?.Length ?? 0) > 256)
        {
            return InvalidCredentials();
        }

        var user = IsValidEmail(email) ? await userManager.FindByEmailAsync(email) : null;

        if (user is null)
        {
            return InvalidCredentials();
        }

        if (!user.EmailConfirmed)
        {
            if (await userManager.IsLockedOutAsync(user))
            {
                return AccountLocked();
            }

            var passwordIsValid = await userManager.CheckPasswordAsync(user, request.Password ?? string.Empty);

            if (!passwordIsValid)
            {
                if (userManager.SupportsUserLockout && await userManager.GetLockoutEnabledAsync(user))
                {
                    var failureResult = await userManager.AccessFailedAsync(user);

                    if (failureResult.Succeeded && await userManager.IsLockedOutAsync(user))
                    {
                        return AccountLocked();
                    }
                }

                return InvalidCredentials();
            }

            if (string.Equals(user.Status, UserStatuses.Pending, StringComparison.OrdinalIgnoreCase))
            {
                return AccountApprovalRequired();
            }

            if (!string.Equals(user.Status, UserStatuses.Active, StringComparison.OrdinalIgnoreCase))
            {
                return Results.Problem(
                    title: "Account inactive.",
                    detail: "Contact an administrator to restore this account.",
                    statusCode: StatusCodes.Status403Forbidden);
            }

            if (userManager.SupportsUserLockout && await userManager.GetAccessFailedCountAsync(user) > 0)
            {
                await userManager.ResetAccessFailedCountAsync(user);
            }

            return EmailConfirmationRequired();
        }

        var result = await signInManager.PasswordSignInAsync(
            user,
            request.Password ?? string.Empty,
            request.RememberMe,
            lockoutOnFailure: true);

        if (result.IsLockedOut)
        {
            return AccountLocked();
        }

        if (!result.Succeeded && !result.RequiresTwoFactor)
        {
            return InvalidCredentials();
        }

        if (!string.Equals(user.Status, UserStatuses.Active, StringComparison.OrdinalIgnoreCase))
        {
            await signInManager.SignOutAsync();
            return string.Equals(user.Status, UserStatuses.Pending, StringComparison.OrdinalIgnoreCase)
                ? AccountApprovalRequired()
                : Results.Problem(
                    title: "Account inactive.",
                    detail: "Contact an administrator to restore this account.",
                    statusCode: StatusCodes.Status403Forbidden);
        }

        if (result.RequiresTwoFactor)
        {
            return Results.Ok(new { succeeded = false, requiresTwoFactor = true });
        }

        await RecordSuccessfulLoginAsync(user, userManager);

        return Results.Ok(new
        {
            succeeded = true,
            requiresTwoFactor = false,
            session = await BuildSessionAsync(user, null, userManager, "password"),
        });
    }

    private static async Task<IResult> StartExternalLoginAsync(
        string provider,
        string? returnUrl,
        bool? rememberMe,
        IAuthenticationSchemeProvider schemeProvider)
    {
        var scheme = NormalizeProviderScheme(provider);

        if (scheme is null || await schemeProvider.GetSchemeAsync(scheme) is null)
        {
            return Results.Problem(
                title: "Sign-in provider unavailable.",
                detail: "This external sign-in provider is not configured.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var callback = QueryHelpers.AddQueryString(
            "/api/auth/external/callback",
            new Dictionary<string, string?>
            {
                ["returnUrl"] = NormalizeReturnUrl(returnUrl),
                ["rememberMe"] = rememberMe == true ? "true" : "false",
            });

        return Results.Challenge(new AuthenticationProperties { RedirectUri = callback }, [scheme]);
    }

    private static async Task<IResult> CompleteExternalLoginAsync(
        string? returnUrl,
        bool? rememberMe,
        HttpContext context,
        CanvasToDoDbContext applicationDb,
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager,
        IAccountEmailSender emailSender,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var safeReturnUrl = NormalizeReturnUrl(returnUrl);
        var isPersistent = rememberMe == true;
        var info = await signInManager.GetExternalLoginInfoAsync();

        if (info is null || string.IsNullOrWhiteSpace(info.ProviderKey))
        {
            await context.SignOutAsync(IdentityConstants.ExternalScheme);
            return ExternalFailure(safeReturnUrl, "The external sign-in response could not be verified.");
        }

        var existingUser = await userManager.FindByLoginAsync(info.LoginProvider, info.ProviderKey);

        if (existingUser is not null)
        {
            if (!string.Equals(existingUser.Status, UserStatuses.Active, StringComparison.OrdinalIgnoreCase))
            {
                await context.SignOutAsync(IdentityConstants.ExternalScheme);
                return ExternalFailure(
                    safeReturnUrl,
                    string.Equals(existingUser.Status, UserStatuses.Pending, StringComparison.OrdinalIgnoreCase)
                        ? "Your account is awaiting administrator approval."
                        : "This account is inactive.");
            }

            var providerEmail = NormalizeEmail(info.Principal.FindFirstValue(ClaimTypes.Email));

            if (!existingUser.EmailConfirmed &&
                IsProviderEmailVerified(info) &&
                IsValidEmail(providerEmail) &&
                string.Equals(providerEmail, NormalizeEmail(existingUser.Email), StringComparison.Ordinal))
            {
                existingUser.EmailConfirmed = true;
                existingUser.UpdatedAt = DateTimeOffset.UtcNow;
                var confirmationResult = await userManager.UpdateAsync(existingUser);

                if (!confirmationResult.Succeeded)
                {
                    await context.SignOutAsync(IdentityConstants.ExternalScheme);
                    return ExternalFailure(safeReturnUrl, "The verified provider email could not be saved. Try again.");
                }
            }

            var signInResult = await signInManager.ExternalLoginSignInAsync(
                info.LoginProvider,
                info.ProviderKey,
                isPersistent,
                bypassTwoFactor: false);

            if (signInResult.RequiresTwoFactor)
            {
                await context.SignOutAsync(IdentityConstants.ExternalScheme);
                return Results.Redirect(QueryHelpers.AddQueryString(
                    safeReturnUrl,
                    new Dictionary<string, string?>
                    {
                        ["requiresTwoFactor"] = "true",
                        ["rememberMe"] = isPersistent ? "true" : "false",
                    }));
            }

            if (!signInResult.Succeeded)
            {
                if (signInResult.IsNotAllowed && !existingUser.EmailConfirmed)
                {
                    var sendResult = await SendConfirmationEmailAsync(
                        existingUser,
                        userManager,
                        emailSender,
                        loggerFactory,
                        cancellationToken);
                    await context.SignOutAsync(IdentityConstants.ExternalScheme);

                    return ExternalFailure(
                        safeReturnUrl,
                        sendResult.Succeeded
                            ? "Check your email and confirm the address before signing in."
                            : "Email confirmation delivery is unavailable. Try again later or contact the site operator.");
                }

                await context.SignOutAsync(IdentityConstants.ExternalScheme);
                return ExternalFailure(
                    safeReturnUrl,
                    signInResult.IsLockedOut ? "This account is temporarily locked." : "External sign-in failed.");
            }

            await RecordSuccessfulLoginAsync(existingUser, userManager);
            await CopyVerifiedLegacyDataAsync(
                info,
                existingUser,
                applicationDb,
                loggerFactory,
                cancellationToken);
            await context.SignOutAsync(IdentityConstants.ExternalScheme);
            return Results.Redirect(safeReturnUrl);
        }

        var email = NormalizeEmail(info.Principal.FindFirstValue(ClaimTypes.Email));

        if (!IsValidEmail(email))
        {
            await context.SignOutAsync(IdentityConstants.ExternalScheme);
            return ExternalFailure(
                safeReturnUrl,
                "The provider did not return an email address. Add an email to that provider account and try again.");
        }

        var providerEmailVerified = IsProviderEmailVerified(info);

        // Email equality is not proof that two provider accounts have the same owner.
        if (await userManager.FindByEmailAsync(email) is not null)
        {
            await context.SignOutAsync(IdentityConstants.ExternalScheme);
            return ExternalFailure(
                safeReturnUrl,
                "An account already uses this email. Sign in with the method originally used for that account.");
        }

        var providerDisplayName = info.Principal.FindFirstValue(ClaimTypes.Name)?.Trim();

        if (string.IsNullOrWhiteSpace(providerDisplayName))
        {
            providerDisplayName = email;
        }

        providerDisplayName = TruncateUtf16(providerDisplayName, 160);
        var now = DateTimeOffset.UtcNow;
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = email,
            Email = email,
            EmailConfirmed = providerEmailVerified,
            DisplayName = providerDisplayName,
            Status = UserStatuses.Pending,
            CreatedAt = now,
            UpdatedAt = now,
            LastLoginAt = null,
        };
        var createResult = await userManager.CreateAsync(user);

        if (!createResult.Succeeded)
        {
            await context.SignOutAsync(IdentityConstants.ExternalScheme);
            return ExternalFailure(safeReturnUrl, FirstIdentityError(createResult));
        }

        var roleResult = await userManager.AddToRoleAsync(user, ApplicationRoles.User);
        var loginResult = roleResult.Succeeded
            ? await userManager.AddLoginAsync(user, info)
            : roleResult;

        if (!loginResult.Succeeded)
        {
            await userManager.DeleteAsync(user);
            await context.SignOutAsync(IdentityConstants.ExternalScheme);
            return ExternalFailure(safeReturnUrl, FirstIdentityError(loginResult));
        }

        await context.SignOutAsync(IdentityConstants.ExternalScheme);
        loggerFactory.CreateLogger("RegistrationAudit").LogInformation(
            "External user {UserId} registered with {Provider} and is awaiting administrator approval.",
            user.Id,
            info.LoginProvider);

        return ExternalFailure(safeReturnUrl, "Your account was created and is awaiting administrator approval.");
    }

    private static async Task<IResult> GetProfileAsync(
        HttpContext context,
        UserManager<ApplicationUser> userManager)
    {
        var user = await userManager.GetUserAsync(context.User);
        return user is null ? Results.Unauthorized() : Results.Ok(await BuildProfileAsync(user, userManager));
    }

    private static async Task<IResult> UpdateProfileAsync(
        UpdateProfileRequest request,
        HttpContext context,
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager)
    {
        var user = await userManager.GetUserAsync(context.User);
        if (user is null) return Results.Unauthorized();
        if (request.CurrentPassword is not null || request.NewPassword is not null)
            return Results.Problem(statusCode: 409, detail: "Use the change-password endpoint to update your password.");

        var displayName = request.DisplayName?.Trim();
        if (string.IsNullOrWhiteSpace(displayName) || displayName.Length > 160)
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["displayName"] = ["Display name is required and must be 160 characters or less."],
            });

        user.DisplayName = displayName;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        var result = await userManager.UpdateAsync(user);
        if (!result.Succeeded) return IdentityValidationProblem(result);
        await signInManager.RefreshSignInAsync(user);
        return Results.Ok(await BuildProfileAsync(user, userManager));
    }

    private static async Task<IResult> GetTwoFactorStatusAsync(
        HttpContext context,
        UserManager<ApplicationUser> userManager)
    {
        var user = await userManager.GetUserAsync(context.User);

        if (user is null)
        {
            return Results.Unauthorized();
        }

        return Results.Ok(new
        {
            enabled = await userManager.GetTwoFactorEnabledAsync(user),
            hasAuthenticator = !string.IsNullOrWhiteSpace(await userManager.GetAuthenticatorKeyAsync(user)),
            recoveryCodesLeft = await userManager.CountRecoveryCodesAsync(user),
        });
    }

    private static async Task<IResult> SetUpAuthenticatorAsync(
        HttpContext context,
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager)
    {
        var user = await userManager.GetUserAsync(context.User);

        if (user is null)
        {
            return Results.Unauthorized();
        }

        if (await userManager.GetTwoFactorEnabledAsync(user))
        {
            return AuthenticatorAlreadyEnabled();
        }

        var key = await userManager.GetAuthenticatorKeyAsync(user);

        if (string.IsNullOrWhiteSpace(key))
        {
            var resetResult = await userManager.ResetAuthenticatorKeyAsync(user);

            if (!resetResult.Succeeded)
            {
                return IdentityValidationProblem(resetResult);
            }

            key = await userManager.GetAuthenticatorKeyAsync(user);
            await signInManager.RefreshSignInAsync(user);
        }

        if (string.IsNullOrWhiteSpace(key))
        {
            return Results.Problem(title: "Authenticator setup failed.", statusCode: StatusCodes.Status500InternalServerError);
        }

        var email = user.Email ?? user.UserName ?? user.Id.ToString();
        var encodedIssuer = Uri.EscapeDataString(AuthenticatorIssuer);
        var encodedEmail = Uri.EscapeDataString(email);

        return Results.Ok(new
        {
            sharedKey = FormatAuthenticatorKey(key),
            authenticatorUri = $"otpauth://totp/{encodedIssuer}:{encodedEmail}?secret={key}&issuer={encodedIssuer}&digits=6",
        });
    }

    private static async Task<IResult> ConfirmAuthenticatorAsync(
        AuthenticatorCodeRequest request,
        HttpContext context,
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager)
    {
        var user = await userManager.GetUserAsync(context.User);

        if (user is null)
        {
            return Results.Unauthorized();
        }

        if (await userManager.GetTwoFactorEnabledAsync(user))
        {
            return AuthenticatorAlreadyEnabled();
        }

        if (string.IsNullOrWhiteSpace(await userManager.GetAuthenticatorKeyAsync(user)))
        {
            return Results.Problem(
                title: "Authenticator setup has not started.",
                detail: "Request a setup key before confirming a code.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var isValid = await userManager.VerifyTwoFactorTokenAsync(
            user,
            TokenOptions.DefaultAuthenticatorProvider,
            NormalizeAuthenticatorCode(request.Code));

        if (!isValid)
        {
            return InvalidAuthenticatorCode();
        }

        var enableResult = await userManager.SetTwoFactorEnabledAsync(user, true);

        if (!enableResult.Succeeded)
        {
            return IdentityValidationProblem(enableResult);
        }

        var recoveryCodes = (await userManager.GenerateNewTwoFactorRecoveryCodesAsync(user, 10))?.ToArray() ?? [];
        await signInManager.RefreshSignInAsync(user);

        return Results.Ok(new { enabled = true, recoveryCodes });
    }

    private static async Task<IResult> DisableAuthenticatorAsync(
        AuthenticatorCodeRequest request,
        HttpContext context,
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager)
    {
        var user = await userManager.GetUserAsync(context.User);

        if (user is null)
        {
            return Results.Unauthorized();
        }

        if (!await userManager.GetTwoFactorEnabledAsync(user))
        {
            return Results.NoContent();
        }

        var isValid = await userManager.VerifyTwoFactorTokenAsync(
            user,
            TokenOptions.DefaultAuthenticatorProvider,
            NormalizeAuthenticatorCode(request.Code));

        if (!isValid)
        {
            return InvalidAuthenticatorCode();
        }

        var disableResult = await userManager.SetTwoFactorEnabledAsync(user, false);

        if (!disableResult.Succeeded)
        {
            return IdentityValidationProblem(disableResult);
        }

        var resetResult = await userManager.ResetAuthenticatorKeyAsync(user);

        if (!resetResult.Succeeded)
        {
            return IdentityValidationProblem(resetResult);
        }

        await signInManager.RefreshSignInAsync(user);
        return Results.NoContent();
    }

    private static async Task<IResult> CompleteTwoFactorLoginAsync(
        TwoFactorLoginRequest request,
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager)
    {
        var user = await signInManager.GetTwoFactorAuthenticationUserAsync();

        if (user is null)
        {
            return Results.Unauthorized();
        }

        if (!string.Equals(user.Status, UserStatuses.Active, StringComparison.OrdinalIgnoreCase))
        {
            await signInManager.SignOutAsync();
            return Results.Forbid();
        }

        var result = await signInManager.TwoFactorAuthenticatorSignInAsync(
            NormalizeAuthenticatorCode(request.Code),
            request.RememberMe,
            request.RememberMachine);

        if (result.IsLockedOut)
        {
            return Results.Problem(title: "Account temporarily locked.", statusCode: StatusCodes.Status423Locked);
        }

        if (!result.Succeeded)
        {
            return InvalidAuthenticatorCode();
        }

        await RecordSuccessfulLoginAsync(user, userManager);
        return Results.Ok(new
        {
            succeeded = true,
            requiresTwoFactor = false,
            session = await BuildSessionAsync(user, null, userManager),
        });
    }

    private static async Task<IResult> CompleteRecoveryCodeLoginAsync(
        RecoveryCodeLoginRequest request,
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager)
    {
        var user = await signInManager.GetTwoFactorAuthenticationUserAsync();

        if (user is null)
        {
            return Results.Unauthorized();
        }

        if (!string.Equals(user.Status, UserStatuses.Active, StringComparison.OrdinalIgnoreCase))
        {
            await signInManager.SignOutAsync();
            return Results.Forbid();
        }

        var result = await signInManager.TwoFactorRecoveryCodeSignInAsync(
            (request.RecoveryCode ?? string.Empty).Replace(" ", string.Empty, StringComparison.Ordinal));

        if (!result.Succeeded)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["recoveryCode"] = ["The recovery code is invalid or has already been used."],
            });
        }

        await RecordSuccessfulLoginAsync(user, userManager);
        return Results.Ok(new
        {
            succeeded = true,
            requiresTwoFactor = false,
            session = await BuildSessionAsync(user, null, userManager),
        });
    }

    private static async Task<IResult> LogoutAsync(SignInManager<ApplicationUser> signInManager)
    {
        await signInManager.SignOutAsync();
        return Results.NoContent();
    }

    private static async Task<object> BuildProfileAsync(
        ApplicationUser user,
        UserManager<ApplicationUser> userManager)
    {
        var roles = await userManager.GetRolesAsync(user);
        var logins = await userManager.GetLoginsAsync(user);

        return new
        {
            id = user.Id,
            email = user.Email,
            displayName = user.DisplayName,
            status = user.Status,
            roles,
            hasPassword = await userManager.HasPasswordAsync(user),
            twoFactorEnabled = await userManager.GetTwoFactorEnabledAsync(user),
            externalLogins = logins.Select(login => new
            {
                provider = login.LoginProvider.ToLowerInvariant(),
                providerDisplayName = login.ProviderDisplayName ?? login.LoginProvider,
            }),
        };
    }

    private static async Task<AuthSessionResponse> BuildSessionAsync(
        ApplicationUser user,
        ClaimsPrincipal? principal,
        UserManager<ApplicationUser> userManager,
        string? knownProvider = null)
    {
        var isAdmin = await userManager.IsInRoleAsync(user, ApplicationRoles.Admin);
        var hasPassword = await userManager.HasPasswordAsync(user);
        var provider = knownProvider ?? principal?.FindFirstValue(ClaimTypes.AuthenticationMethod);

        if (string.IsNullOrWhiteSpace(provider))
        {
            provider = hasPassword
                ? "password"
                : (await userManager.GetLoginsAsync(user)).FirstOrDefault()?.LoginProvider.ToLowerInvariant() ?? "external";
        }

        var access = isAdmin
            ? new[]
            {
                "academy",
                "academy-dashboard",
                "academy-courses",
                "academy-grades",
                "academy-inbox",
                "academy-people",
                "academy-settings-page",
                "admin-users",
            }
            : new[]
            {
                "academy",
                "academy-dashboard",
                "academy-courses",
                "academy-grades",
                "academy-inbox",
                "academy-people",
                "academy-settings-page",
            };
        var email = user.Email?.Trim().ToLowerInvariant();
        var ownerKey = UserOwnerKeys.FromId(user.Id);

        return new AuthSessionResponse(
            true,
            provider.ToLowerInvariant(),
            user.DisplayName,
            email,
            ownerKey,
            user.Status,
            access,
            await userManager.GetTwoFactorEnabledAsync(user),
            isAdmin,
            hasPassword);
    }

    private static AuthSessionResponse AnonymousSession() => new(
        false, null, null, null, null, null, [], false, false, false);

    private static async Task RecordSuccessfulLoginAsync(
        ApplicationUser user,
        UserManager<ApplicationUser> userManager)
    {
        user.LastLoginAt = DateTimeOffset.UtcNow;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await userManager.UpdateAsync(user);
    }

    private static IResult InvalidCredentials() => Results.Problem(
        title: "Sign-in failed.",
        detail: "The email address or password is incorrect.",
        statusCode: StatusCodes.Status401Unauthorized);

    private static IResult AccountLocked() => Results.Problem(
        title: "Account temporarily locked.",
        detail: "Too many unsuccessful sign-in attempts. Try again later.",
        statusCode: StatusCodes.Status423Locked);

    private static IResult EmailConfirmationRequired() => Results.Problem(
        title: "Email confirmation required.",
        detail: "Confirm your email address before signing in. You can request another confirmation message.",
        statusCode: StatusCodes.Status403Forbidden,
        extensions: new Dictionary<string, object?>
        {
            ["emailConfirmationRequired"] = true,
        });

    private static IResult AccountApprovalRequired() => Results.Problem(
        title: "Administrator approval required.",
        detail: "Your account is awaiting administrator approval.",
        statusCode: StatusCodes.Status403Forbidden,
        extensions: new Dictionary<string, object?>
        {
            ["adminApprovalRequired"] = true,
        });

    private static IResult InvalidEmailConfirmation() => Results.Problem(
        title: "Email confirmation failed.",
        detail: "This confirmation link is invalid or has expired. Request a new confirmation message.",
        statusCode: StatusCodes.Status400BadRequest);

    private static IResult InvalidPasswordReset() => Results.Problem(
        title: "Password reset failed.",
        detail: "This password-reset link is invalid or has expired. Request a new one.",
        statusCode: StatusCodes.Status400BadRequest);

    private static IResult EmailDeliveryUnavailable(AccountEmailAvailability availability) => Results.Problem(
        title: "Email delivery unavailable.",
        detail: "Account email delivery is not configured or is currently unavailable. Try again later or contact the site operator.",
        statusCode: StatusCodes.Status503ServiceUnavailable,
        extensions: new Dictionary<string, object?>
        {
            ["emailDeliveryConfigured"] = availability.IsAvailable,
        });

    private static IResult GenericConfirmationAccepted(AccountEmailSendResult? result) =>
        result?.Status == AccountEmailSendStatus.DevelopmentDisclosure
            ? Results.Accepted(value: new
            {
                message = "If this address belongs to an eligible account, a confirmation message has been prepared.",
                developmentActionUrl = result.DevelopmentActionUrl,
            })
            : Results.Accepted(value: new
            {
                message = "If this address belongs to an eligible account, a confirmation message has been sent.",
            });

    private static IResult RegistrationPendingAccepted() => Results.Accepted(value: new
    {
        message = "Your account was created and is awaiting administrator approval.",
    });

    private static IResult GenericPasswordResetAccepted(AccountEmailSendResult? result) =>
        result?.Status == AccountEmailSendStatus.DevelopmentDisclosure
            ? Results.Accepted(value: new
            {
                message = "If this address belongs to an eligible password account, reset instructions have been prepared.",
                developmentActionUrl = result.DevelopmentActionUrl,
            })
            : Results.Accepted(value: new
            {
                message = "If this address belongs to an eligible password account, reset instructions have been sent.",
            });

    private static async Task<AccountEmailSendResult> SendConfirmationEmailAsync(
        ApplicationUser user,
        UserManager<ApplicationUser> userManager,
        IAccountEmailSender emailSender,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var token = await userManager.GenerateEmailConfirmationTokenAsync(user);
        var result = await emailSender.SendEmailConfirmationAsync(user, token, cancellationToken);

        if (!result.Succeeded)
        {
            LogEmailDeliveryFailure(loggerFactory, "email confirmation", result.Status);
        }

        return result;
    }

    private static void LogEmailDeliveryFailure(
        ILoggerFactory loggerFactory,
        string messageType,
        AccountEmailSendStatus status)
    {
        // Never include the email address, Identity token, or action URL in logs.
        loggerFactory.CreateLogger("AccountEmailDelivery").LogWarning(
            "Could not deliver an account {MessageType} message. Delivery status: {DeliveryStatus}.",
            messageType,
            status);
    }

    private static IResult InvalidAuthenticatorCode() =>
        Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["code"] = ["The authenticator code is invalid."],
        });

    private static IResult AuthenticatorAlreadyEnabled() => Results.Problem(
        title: "Authenticator already enabled.",
        detail: "Disable the current authenticator with a valid code before starting a new setup.",
        statusCode: StatusCodes.Status409Conflict);

    private static IResult IdentityValidationProblem(IdentityResult result) =>
        Results.ValidationProblem(result.Errors
            .GroupBy(error => ToCamelCase(error.Code))
            .ToDictionary(
                group => group.Key,
                group => group.Select(error => error.Description).ToArray()));

    private static async Task<IdentityResult> ValidatePasswordAsync(
        UserManager<ApplicationUser> userManager,
        ApplicationUser user,
        string password)
    {
        var errors = new List<IdentityError>();

        foreach (var validator in userManager.PasswordValidators)
        {
            var result = await validator.ValidateAsync(userManager, user, password);

            if (!result.Succeeded)
            {
                errors.AddRange(result.Errors);
            }
        }

        return errors.Count == 0 ? IdentityResult.Success : IdentityResult.Failed(errors.ToArray());
    }

    private static IResult ExternalFailure(string returnUrl, string message) =>
        Results.Redirect(QueryHelpers.AddQueryString(returnUrl, "authError", message));

    private static string FirstIdentityError(IdentityResult result) =>
        result.Errors.FirstOrDefault()?.Description ?? "Account creation failed.";

    private static string? NormalizeProviderScheme(string provider) =>
        provider.Trim().ToLowerInvariant() switch
        {
            "google" => "Google",
            "facebook" => "Facebook",
            _ => null,
        };

    private static bool IsProviderEmailVerified(ExternalLoginInfo info)
    {
        var claim = info.Principal.FindFirst("email_verified") ??
                    info.Principal.FindFirst("verified_email") ??
                    info.Principal.FindFirst("urn:google:verified_email") ??
                    info.Principal.FindFirst("urn:facebook:email_verified");

        // Facebook's normal profile/email response does not consistently carry a trustworthy
        // email-verification claim, so absence is deliberately treated as unverified.
        return bool.TryParse(claim?.Value, out var verified) && verified;
    }

    private static Task CopyVerifiedLegacyDataAsync(
        ExternalLoginInfo info,
        ApplicationUser user,
        CanvasToDoDbContext applicationDb,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var verifiedEmail = NormalizeEmail(info.Principal.FindFirstValue(ClaimTypes.Email));

        return IsProviderEmailVerified(info) && IsValidEmail(verifiedEmail)
            ? VerifiedLegacyDataMigrator.CopyAsync(
                applicationDb,
                user.Id,
                verifiedEmail,
                loggerFactory.CreateLogger("VerifiedLegacyDataMigration"),
                cancellationToken)
            : Task.CompletedTask;
    }

    private static bool HasClientCredentials(IConfiguration configuration, string section) =>
        !string.IsNullOrWhiteSpace(configuration[$"{section}:ClientId"]) &&
        !string.IsNullOrWhiteSpace(configuration[$"{section}:ClientSecret"]);

    private static string NormalizeReturnUrl(string? returnUrl) =>
        !string.IsNullOrWhiteSpace(returnUrl) &&
        returnUrl.Length <= 2048 &&
        returnUrl.StartsWith("/", StringComparison.Ordinal) &&
        !returnUrl.StartsWith("//", StringComparison.Ordinal) &&
        !returnUrl.Contains('\\') &&
        !returnUrl.Any(char.IsControl)
            ? returnUrl
            : "/";

    private static string NormalizeEmail(string? email) => email?.Trim().ToLowerInvariant() ?? string.Empty;

    private static string TruncateUtf16(string value, int maximumLength)
    {
        if (value.Length <= maximumLength)
        {
            return value;
        }

        var length = maximumLength;

        if (char.IsHighSurrogate(value[length - 1]) && char.IsLowSurrogate(value[length]))
        {
            length--;
        }

        return value[..length];
    }

    private static bool IsValidEmail(string? email) =>
        !string.IsNullOrWhiteSpace(email) &&
        email.Length <= MaximumEmailLength &&
        EmailValidator.IsValid(email);

    private static bool TryDecodeToken(string? encodedToken, out string token)
    {
        token = string.Empty;

        if (string.IsNullOrWhiteSpace(encodedToken) || encodedToken.Length > 8_192)
        {
            return false;
        }

        try
        {
            token = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(encodedToken));
            return !string.IsNullOrWhiteSpace(token);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static string NormalizeAuthenticatorCode(string? code) =>
        (code ?? string.Empty)
            .Replace(" ", string.Empty, StringComparison.Ordinal)
            .Replace("-", string.Empty, StringComparison.Ordinal);

    private static string FormatAuthenticatorKey(string key)
    {
        var result = new StringBuilder();

        for (var index = 0; index < key.Length; index += 4)
        {
            if (result.Length > 0)
            {
                result.Append(' ');
            }

            result.Append(key.AsSpan(index, Math.Min(4, key.Length - index)));
        }

        return result.ToString().ToLowerInvariant();
    }

    private static string ToCamelCase(string value) =>
        string.IsNullOrEmpty(value) ? value : char.ToLowerInvariant(value[0]) + value[1..];

    public static TimeSpan GetSessionDuration(IConfiguration configuration)
    {
        var hours = configuration.GetValue<double?>("Authentication:SessionHours") ?? DefaultSessionHours;

        return TimeSpan.FromHours(Math.Clamp(hours, MinimumSessionHours, MaximumSessionHours));
    }

    public sealed record SignUpRequest(string Email, string Password, string? DisplayName);

    public sealed record EmailRequest(string? Email);

    public sealed record EmailTokenRequest(string? UserId, string? Code);

    public sealed record PasswordResetApprovalRequest(string? Email, string? NewPassword, string? ConfirmPassword);
    public sealed record ChangeOwnPasswordRequest(string? CurrentPassword, string? NewPassword, string? ConfirmPassword);

    public sealed record ResetPasswordRequest(string? Email, string? Code, string? NewPassword, string? ConfirmPassword = null);

    public sealed record LoginRequest(string Email, string? Password, bool RememberMe = false);

    public sealed record UpdateProfileRequest(
        string? DisplayName,
        string? CurrentPassword,
        string? NewPassword);

    public sealed record AuthenticatorCodeRequest(string? Code);

    public sealed record TwoFactorLoginRequest(string? Code, bool RememberMe = false, bool RememberMachine = false);

    public sealed record RecoveryCodeLoginRequest(string? RecoveryCode);

    public sealed record AuthSessionResponse(
        bool IsAuthenticated,
        string? Provider,
        string? DisplayName,
        string? Email,
        string? AcademyPreferenceOwnerKey,
        string? AccountStatus,
        string[] Access,
        bool TwoFactorEnabled,
        bool IsAdmin,
        bool HasPassword);
}
