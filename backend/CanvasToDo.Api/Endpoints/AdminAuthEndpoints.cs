using CanvasToDo.Api.Data;
using CanvasToDo.Api.Domain.Identity;
using CanvasToDo.Api.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using System.Data;
using System.Security.Claims;
using System.ComponentModel.DataAnnotations;

namespace CanvasToDo.Api.Endpoints;

public static class AdminAuthEndpoints
{
    public static IEndpointRouteBuilder MapAdminAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/admin/users")
            .RequireAuthorization("Admin");

        admin.MapGet("", ListUsersAsync)
            .WithName("ListIdentityUsers");
        admin.MapGet("/{id:guid}", GetUserDetailsAsync);
        admin.MapPost("/{id:guid}/password", (Guid id, PasswordRequest request, HttpContext context, PasswordChangeService passwords) =>
            passwords.SetByAdminAsync(id, request.NewPassword, request.ConfirmPassword, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!)))
            .RequireRateLimiting("admin-write");
        admin.MapPost("/{id:guid}/password-request/review", (Guid id, PasswordReview request, HttpContext context, PasswordChangeService passwords) =>
            passwords.ReviewAsync(id, request.RequestId, request.Approve, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!)))
            .RequireRateLimiting("admin-write");

        // Authorization runs as the administrator. Only these specific data handlers
        // receive the target's owner key; no target login cookie is issued.
        var data = admin.MapGroup("/{id:guid}/data").AddEndpointFilter(ForTargetUserAsync);
        data.MapGet("/preferences", AcademyPreferenceEndpoints.GetAsync);
        data.MapPut("/preferences", AcademyPreferenceEndpoints.SaveAsync).RequireRateLimiting("admin-write");
        data.MapGet("/canvas-token", CanvasIntegrationEndpoints.GetCanvasTokenStatusAsync);
        data.MapPut("/canvas-token", CanvasIntegrationEndpoints.UpdateCanvasTokenAsync).RequireRateLimiting("admin-write");
        data.MapDelete("/canvas-token", CanvasIntegrationEndpoints.DeleteCanvasTokenAsync).RequireRateLimiting("admin-write");
        data.MapGet("/courses", CanvasIntegrationEndpoints.GetCanvasCoursesAsync).RequireRateLimiting("canvas-read");
        data.MapGet("/calendar", CanvasIntegrationEndpoints.GetCanvasCalendarItemsAsync).RequireRateLimiting("canvas-calendar");
        admin.MapPatch("/{id:guid}", UpdateUserAsync)
            .RequireRateLimiting("admin-write")
            .WithName("UpdateIdentityUser");
        admin.MapPost("/{id:guid}/revoke-sessions", RevokeUserSessionsAsync)
            .RequireRateLimiting("admin-write")
            .WithName("RevokeIdentityUserSessions");

        return app;
    }

    private static async ValueTask<object?> ForTargetUserAsync(EndpointFilterInvocationContext invocation, EndpointFilterDelegate next)
    {
        var context = invocation.HttpContext;
        var users = context.RequestServices.GetRequiredService<UserManager<ApplicationUser>>();
        var actor = await users.GetUserAsync(context.User);
        var target = await users.FindByIdAsync(context.Request.RouteValues["id"]!.ToString()!);
        if (actor is null || !await users.IsInRoleAsync(actor, ApplicationRoles.Admin)) return Results.Forbid();
        if (target is null) return Results.NotFound();
        var principal = context.User;
        var ownerHeader = context.Request.Headers["X-Canvas-To-Do-Owner-Key"];
        context.User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, target.Id.ToString())], "AdminDataAccess"));
        context.Request.Headers["X-Canvas-To-Do-Owner-Key"] = UserOwnerKeys.FromId(target.Id);
        try
        {
            var result = await next(invocation);
            context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("AdministratorAudit").LogInformation(
                "Administrator {ActorUserId} accessed user {TargetUserId} data: {Method} {Path}; result {Status}.",
                actor.Id, target.Id, context.Request.Method, context.Request.Path, (result as IStatusCodeHttpResult)?.StatusCode);
            return result;
        }
        finally
        {
            context.User = principal;
            context.Request.Headers["X-Canvas-To-Do-Owner-Key"] = ownerHeader;
        }
    }

    private static async Task<IResult> GetUserDetailsAsync(Guid id, UserManager<ApplicationUser> users, PasswordChangeService passwords)
    {
        var user = await users.FindByIdAsync(id.ToString());
        if (user is null) return Results.NotFound();
        return Results.Ok(new
        {
            user.Id, user.Email, user.DisplayName, user.PhoneNumber, user.Status, user.EmailConfirmed,
            role = await users.IsInRoleAsync(user, ApplicationRoles.Admin) ? ApplicationRoles.Admin : ApplicationRoles.User,
            user.CreatedAt, user.LastActiveAt, user.LastLoginAt, user.TwoFactorEnabled, lockedUntil = user.LockoutEnd,
            hasPassword = await users.HasPasswordAsync(user), passwordRequest = await passwords.GetAsync(user),
        });
    }

    public sealed record PasswordRequest(string? NewPassword, string? ConfirmPassword);
    public sealed record PasswordReview(Guid RequestId, bool Approve);

    private static async Task<IResult> ListUsersAsync(
        string? search,
        int? page,
        int? pageSize,
        AuthDbContext db,
        CancellationToken cancellationToken)
    {
        var currentPage = Math.Clamp(page ?? 1, 1, 1_000_000);
        var currentPageSize = Math.Clamp(pageSize ?? 50, 1, 100);
        var query = db.Users.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(user =>
                (user.Email != null && user.Email.ToLower().Contains(term)) ||
                user.DisplayName.ToLower().Contains(term));
        }

        var total = await query.CountAsync(cancellationToken);
        var users = await query
            .OrderBy(user => user.Status == UserStatuses.Pending ? 0 : 1)
            .ThenBy(user => user.Email)
            .Skip((currentPage - 1) * currentPageSize)
            .Take(currentPageSize)
            .Select(user => new
            {
                user.Id,
                user.Email,
                user.DisplayName,
                user.Status,
                user.EmailConfirmed,
                user.TwoFactorEnabled,
                user.LockoutEnd,
                user.LastActiveAt,
                user.LastLoginAt,
                user.CreatedAt,
                user.SecurityStamp,
            })
            .ToArrayAsync(cancellationToken);
        var userIds = users.Select(user => user.Id).ToArray();
        var passwordRows = await db.UserTokens.AsNoTracking().Where(token => userIds.Contains(token.UserId) &&
            token.LoginProvider == PasswordChangeService.Provider && token.Name == PasswordChangeService.TokenName)
            .ToDictionaryAsync(token => token.UserId, token => token.Value, cancellationToken);
        var roleRows = await (
            from userRole in db.UserRoles
            join role in db.Roles on userRole.RoleId equals role.Id
            where userIds.Contains(userRole.UserId)
            select new { userRole.UserId, role.Name })
            .AsNoTracking()
            .ToArrayAsync(cancellationToken);
        var rolesByUser = roleRows
            .GroupBy(row => row.UserId)
            .ToDictionary(
                group => group.Key,
                group => group.Select(row => row.Name).Where(name => name is not null).Cast<string>().ToArray());
        var items = users.Select(user =>
        {
            var roles = rolesByUser.GetValueOrDefault(user.Id) ?? [];
            var role = roles.Contains(ApplicationRoles.Admin, StringComparer.OrdinalIgnoreCase)
                ? ApplicationRoles.Admin
                : ApplicationRoles.User;

            return new
            {
                id = user.Id,
                email = user.Email,
                displayName = user.DisplayName,
                role,
                status = user.Status,
                emailConfirmed = user.EmailConfirmed,
                lastActiveAt = user.LastActiveAt,
                lastLoginAt = user.LastLoginAt,
                twoFactorEnabled = user.TwoFactorEnabled,
                lockedUntil = user.LockoutEnd,
                createdAt = user.CreatedAt,
                passwordRequest = PasswordChangeService.Describe(PasswordChangeService.Parse(passwordRows.GetValueOrDefault(user.Id)), user.SecurityStamp),
            };
        }).ToArray();

        return Results.Ok(new
        {
            items,
            users = items,
            total,
            page = currentPage,
            pageSize = currentPageSize,
        });
    }

    private static async Task<IResult> UpdateUserAsync(
        Guid id,
        AdminUpdateUserRequest request,
        HttpContext context,
        IConfiguration configuration,
        AuthDbContext db,
        UserManager<ApplicationUser> userManager,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var actor = await userManager.GetUserAsync(context.User);
        var target = await userManager.FindByIdAsync(id.ToString());

        if (actor is null || target is null)
        {
            return target is null ? Results.NotFound() : Results.Unauthorized();
        }

        var requestedStatus = request.Status is null ? target.Status : UserStatuses.Normalize(request.Status);
        var targetRoles = await userManager.GetRolesAsync(target);
        var currentRole = targetRoles.Contains(ApplicationRoles.Admin, StringComparer.OrdinalIgnoreCase)
            ? ApplicationRoles.Admin
            : ApplicationRoles.User;
        var requestedRole = request.Role is null ? currentRole : ApplicationRoles.Normalize(request.Role);
        var previousDisplayName = target.DisplayName;
        var previousStatus = target.Status;
        var previousEmail = target.Email;
        var previousPhone = target.PhoneNumber;

        if (request.Email is not null)
        {
            var email = request.Email.Trim().ToLowerInvariant();
            if (email.Length > 256 || !new EmailAddressAttribute().IsValid(email))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["email"] = ["Enter a valid email address."] });
            var existing = await userManager.FindByEmailAsync(email);
            if (existing is not null && existing.Id != id)
                return Results.Problem(statusCode: 409, detail: "Another account already uses this email address.");
        }
        if (request.PhoneNumber?.Length > 50)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["phoneNumber"] = ["Phone number must be at most 50 characters."] });

        if (request.Status is not null && !UserStatuses.IsValid(request.Status))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["status"] = ["Status must be active, inactive, or pending."],
            });
        }

        if (request.Role is not null && !ApplicationRoles.IsValid(request.Role))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["role"] = ["Role must be User or Admin."],
            });
        }

        if (target.Id == actor.Id &&
            (!string.Equals(requestedStatus, UserStatuses.Active, StringComparison.OrdinalIgnoreCase) ||
             !string.Equals(requestedRole, ApplicationRoles.Admin, StringComparison.OrdinalIgnoreCase)))
        {
            return Results.Problem(
                title: "Self-lockout prevented.",
                detail: "Administrators cannot deactivate or demote their own account.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var bootstrapEmail = configuration["Authentication:Admin:BootstrapEmail"]?.Trim();

        if (!string.IsNullOrWhiteSpace(bootstrapEmail) &&
            string.Equals(target.Email, bootstrapEmail, StringComparison.OrdinalIgnoreCase) &&
            (!string.Equals(requestedStatus, UserStatuses.Active, StringComparison.OrdinalIgnoreCase) ||
             !string.Equals(requestedRole, ApplicationRoles.Admin, StringComparison.OrdinalIgnoreCase)))
        {
            return Results.Problem(
                title: "Bootstrap administrator protected.",
                detail: "Change Authentication:Admin:BootstrapEmail before demoting or deactivating this account.",
                statusCode: StatusCodes.Status409Conflict);
        }

        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var removesActiveAdmin =
            string.Equals(currentRole, ApplicationRoles.Admin, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(target.Status, UserStatuses.Active, StringComparison.OrdinalIgnoreCase) &&
            (!string.Equals(requestedRole, ApplicationRoles.Admin, StringComparison.OrdinalIgnoreCase) ||
             !string.Equals(requestedStatus, UserStatuses.Active, StringComparison.OrdinalIgnoreCase));

        if (removesActiveAdmin && await CountActiveAdministratorsAsync(db, cancellationToken) <= 1)
        {
            return Results.Problem(
                title: "Last administrator protected.",
                detail: "Promote another active administrator before changing this account.",
                statusCode: StatusCodes.Status409Conflict);
        }

        if (request.DisplayName is not null)
        {
            var displayName = request.DisplayName.Trim();

            if (string.IsNullOrWhiteSpace(displayName) || displayName.Length > 160)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["displayName"] = ["Display name is required and must be 160 characters or less."],
                });
            }

            target.DisplayName = displayName;
        }

        if (request.Email is not null && !string.Equals(target.Email, request.Email.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            if (string.Equals(previousEmail, bootstrapEmail, StringComparison.OrdinalIgnoreCase))
                return Results.Problem(statusCode: 409, detail: "Update AUTH_ADMIN_BOOTSTRAP_EMAIL before changing this administrator's email.");
            target.Email = request.Email.Trim().ToLowerInvariant();
            target.UserName = target.Email;
            // Approval to use an address is not proof of mailbox ownership.
            target.EmailConfirmed = false;
        }
        if (request.PhoneNumber is not null)
        {
            target.PhoneNumber = request.PhoneNumber.Trim();
            if (target.PhoneNumber != previousPhone) target.PhoneNumberConfirmed = false;
        }

        var approvingUnconfirmedUser =
            !target.EmailConfirmed &&
            request.Status is not null &&
            string.Equals(requestedStatus, UserStatuses.Active, StringComparison.OrdinalIgnoreCase);
        var securityChanged =
            !string.Equals(previousEmail, target.Email, StringComparison.OrdinalIgnoreCase) ||
            approvingUnconfirmedUser ||
            !string.Equals(target.Status, requestedStatus, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(currentRole, requestedRole, StringComparison.OrdinalIgnoreCase);
        if (approvingUnconfirmedUser)
        {
            // Administrator approval is the deployment's identity-verification gate
            // when SMTP delivery is unavailable.
            target.EmailConfirmed = true;
        }
        target.Status = requestedStatus;
        target.UpdatedAt = DateTimeOffset.UtcNow;
        var updateResult = await userManager.UpdateAsync(target);

        if (!updateResult.Succeeded)
        {
            return IdentityValidationProblem(updateResult);
        }

        if (!string.Equals(currentRole, requestedRole, StringComparison.OrdinalIgnoreCase))
        {
            var removableRoles = targetRoles
                .Where(role => ApplicationRoles.IsValid(role))
                .ToArray();

            if (removableRoles.Length > 0)
            {
                var removeResult = await userManager.RemoveFromRolesAsync(target, removableRoles);

                if (!removeResult.Succeeded)
                {
                    return IdentityValidationProblem(removeResult);
                }
            }

            var addResult = await userManager.AddToRoleAsync(target, requestedRole);

            if (!addResult.Succeeded)
            {
                return IdentityValidationProblem(addResult);
            }
        }

        if (securityChanged)
        {
            var stampResult = await userManager.UpdateSecurityStampAsync(target);

            if (!stampResult.Succeeded)
            {
                return IdentityValidationProblem(stampResult);
            }
        }

        await transaction.CommitAsync(cancellationToken);

        loggerFactory.CreateLogger("AdministratorAudit").LogInformation(
            "Administrator {ActorUserId} updated user {TargetUserId}. DisplayNameChanged={DisplayNameChanged}; StatusChanged={StatusChanged}; RoleChanged={RoleChanged}; EmailChanged={EmailChanged}; PhoneChanged={PhoneChanged}.",
            actor.Id,
            target.Id,
            !string.Equals(previousDisplayName, target.DisplayName, StringComparison.Ordinal),
            !string.Equals(previousStatus, target.Status, StringComparison.OrdinalIgnoreCase),
            !string.Equals(currentRole, requestedRole, StringComparison.OrdinalIgnoreCase),
            previousEmail != target.Email, previousPhone != target.PhoneNumber);

        return Results.Ok(new
        {
            id = target.Id,
            email = target.Email,
            displayName = target.DisplayName,
            status = target.Status,
            role = requestedRole,
            emailConfirmed = target.EmailConfirmed,
            lastActiveAt = target.LastActiveAt,
            lastLoginAt = target.LastLoginAt,
            twoFactorEnabled = target.TwoFactorEnabled,
            lockedUntil = target.LockoutEnd,
            createdAt = target.CreatedAt,
        });
    }

    private static async Task<IResult> RevokeUserSessionsAsync(
        Guid id,
        HttpContext context,
        UserManager<ApplicationUser> userManager,
        ILoggerFactory loggerFactory)
    {
        var user = await userManager.FindByIdAsync(id.ToString());

        if (user is null)
        {
            return Results.NotFound();
        }

        var result = await userManager.UpdateSecurityStampAsync(user);

        if (!result.Succeeded)
        {
            return IdentityValidationProblem(result);
        }

        loggerFactory.CreateLogger("AdministratorAudit").LogInformation(
            "Administrator {ActorUserId} revoked sessions for user {TargetUserId}.",
            context.User.FindFirstValue(ClaimTypes.NameIdentifier),
            user.Id);

        return Results.NoContent();
    }

    private static async Task<int> CountActiveAdministratorsAsync(
        AuthDbContext db,
        CancellationToken cancellationToken)
    {
        var normalizedAdminRole = ApplicationRoles.Admin.ToUpperInvariant();

        return await (
            from user in db.Users
            join userRole in db.UserRoles on user.Id equals userRole.UserId
            join role in db.Roles on userRole.RoleId equals role.Id
            where user.Status == UserStatuses.Active && role.NormalizedName == normalizedAdminRole
            select user.Id)
            .Distinct()
            .CountAsync(cancellationToken);
    }

    private static IResult IdentityValidationProblem(IdentityResult result) =>
        Results.ValidationProblem(result.Errors
            .GroupBy(error => error.Code)
            .ToDictionary(
                group => group.Key,
                group => group.Select(error => error.Description).ToArray()));

    public sealed record AdminUpdateUserRequest(string? DisplayName, string? Status, string? Role, string? Email = null, string? PhoneNumber = null);
}
