using CanvasToDo.Api.Data;
using CanvasToDo.Api.Domain.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using System.Data;
using System.Security.Claims;

namespace CanvasToDo.Api.Endpoints;

public static class AdminAuthEndpoints
{
    public static IEndpointRouteBuilder MapAdminAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/admin/users")
            .RequireAuthorization("Admin");

        admin.MapGet("", ListUsersAsync)
            .WithName("ListIdentityUsers");
        admin.MapPatch("/{id:guid}", UpdateUserAsync)
            .RequireRateLimiting("admin-write")
            .WithName("UpdateIdentityUser");
        admin.MapPost("/{id:guid}/revoke-sessions", RevokeUserSessionsAsync)
            .RequireRateLimiting("admin-write")
            .WithName("RevokeIdentityUserSessions");

        return app;
    }

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
            .OrderBy(user => user.Email)
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
                user.LastLoginAt,
                user.CreatedAt,
            })
            .ToArrayAsync(cancellationToken);
        var userIds = users.Select(user => user.Id).ToArray();
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
                lastLoginAt = user.LastLoginAt,
                twoFactorEnabled = user.TwoFactorEnabled,
                lockedUntil = user.LockoutEnd,
                createdAt = user.CreatedAt,
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

        if (request.Status is not null && !UserStatuses.IsValid(request.Status))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["status"] = ["Status must be active or inactive."],
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

        var securityChanged =
            !string.Equals(target.Status, requestedStatus, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(currentRole, requestedRole, StringComparison.OrdinalIgnoreCase);
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
            "Administrator {ActorUserId} updated user {TargetUserId}. DisplayNameChanged={DisplayNameChanged}; StatusChanged={StatusChanged}; RoleChanged={RoleChanged}.",
            actor.Id,
            target.Id,
            !string.Equals(previousDisplayName, target.DisplayName, StringComparison.Ordinal),
            !string.Equals(previousStatus, target.Status, StringComparison.OrdinalIgnoreCase),
            !string.Equals(currentRole, requestedRole, StringComparison.OrdinalIgnoreCase));

        return Results.Ok(new
        {
            id = target.Id,
            email = target.Email,
            displayName = target.DisplayName,
            status = target.Status,
            role = requestedRole,
            emailConfirmed = target.EmailConfirmed,
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

    public sealed record AdminUpdateUserRequest(string? DisplayName, string? Status, string? Role);
}
