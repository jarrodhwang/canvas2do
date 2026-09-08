using CanvasToDo.Api.Data;
using CanvasToDo.Api.Domain.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using System.Data;

namespace CanvasToDo.Api.Infrastructure;

public static class AuthBootstrapper
{
    private const string BootstrapLockName = "canvas-to-do:authentication-bootstrap:v1";

    public static async Task InitializeAsync(
        IServiceProvider services,
        IConfiguration configuration,
        CancellationToken cancellationToken = default)
    {
        var roleManager = services.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        var userManager = services.GetRequiredService<UserManager<ApplicationUser>>();
        var db = services.GetRequiredService<AuthDbContext>();

        foreach (var roleName in new[] { ApplicationRoles.User, ApplicationRoles.Admin })
        {
            if (!await roleManager.RoleExistsAsync(roleName))
            {
                var result = await roleManager.CreateAsync(new IdentityRole<Guid>(roleName));

                if (!result.Succeeded && !await roleManager.RoleExistsAsync(roleName))
                {
                    throw new InvalidOperationException(
                        $"Could not create the {roleName} authentication role: {string.Join(", ", result.Errors.Select(error => error.Description))}");
                }
            }
        }

        var bootstrapEmail = configuration["Authentication:Admin:BootstrapEmail"]?.Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(bootstrapEmail))
        {
            return;
        }

        if (bootstrapEmail.Length > 256 || !new EmailAddressAttribute().IsValid(bootstrapEmail))
        {
            throw new InvalidOperationException(
                "Authentication:Admin:BootstrapEmail must be a valid email address of 256 characters or less.");
        }

        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);

        // Serialize bootstrap discovery and creation across replicas. All Identity writes use the
        // same scoped AuthDbContext, so a crash before commit cannot leave a confirmed non-admin
        // account that permanently blocks subsequent startup attempts.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({BootstrapLockName}, 0));",
            cancellationToken);

        var user = await userManager.FindByEmailAsync(bootstrapEmail);

        if (user is null)
        {
            var bootstrapPassword = configuration["Authentication:Admin:BootstrapPassword"];

            if (string.IsNullOrWhiteSpace(bootstrapPassword))
            {
                throw new InvalidOperationException(
                    "Authentication:Admin:BootstrapPassword is required only while creating a missing bootstrap administrator. Supply it through a secret/environment variable, not source control.");
            }

            var now = DateTimeOffset.UtcNow;
            var configuredDisplayName = configuration["Authentication:Admin:BootstrapDisplayName"]?.Trim();
            var displayName = string.IsNullOrWhiteSpace(configuredDisplayName)
                ? "Administrator"
                : configuredDisplayName;

            if (displayName.Length > 160)
            {
                throw new InvalidOperationException(
                    "Authentication:Admin:BootstrapDisplayName must be 160 characters or less.");
            }

            user = new ApplicationUser
            {
                Id = Guid.NewGuid(),
                UserName = bootstrapEmail,
                Email = bootstrapEmail,
                EmailConfirmed = true,
                DisplayName = displayName,
                Status = UserStatuses.Active,
                CreatedAt = now,
                UpdatedAt = now,
            };
            var createResult = await userManager.CreateAsync(user, bootstrapPassword);

            if (!createResult.Succeeded)
            {
                throw new InvalidOperationException(
                    $"Could not create the bootstrap administrator: {string.Join(", ", createResult.Errors.Select(error => error.Description))}");
            }
        }
        else if (!user.EmailConfirmed || !await userManager.IsInRoleAsync(user, ApplicationRoles.Admin))
        {
            throw new InvalidOperationException(
                "The configured bootstrap email already belongs to an unconfirmed or standard account. It was not promoted because public email ownership has not been verified. Choose an unused bootstrap email or promote and confirm the account through an existing administrator.");
        }

        if (!await userManager.IsInRoleAsync(user, ApplicationRoles.Admin))
        {
            var addResult = await userManager.AddToRoleAsync(user, ApplicationRoles.Admin);

            if (!addResult.Succeeded)
            {
                throw new InvalidOperationException(
                    $"Could not grant the bootstrap administrator role: {string.Join(", ", addResult.Errors.Select(error => error.Description))}");
            }
        }

        if (await userManager.IsInRoleAsync(user, ApplicationRoles.User))
        {
            var removeResult = await userManager.RemoveFromRoleAsync(user, ApplicationRoles.User);

            if (!removeResult.Succeeded)
            {
                throw new InvalidOperationException(
                    $"Could not remove the standard-user role from the bootstrap administrator: {string.Join(", ", removeResult.Errors.Select(error => error.Description))}");
            }
        }

        if (!string.Equals(user.Status, UserStatuses.Active, StringComparison.Ordinal))
        {
            user.Status = UserStatuses.Active;
            user.UpdatedAt = DateTimeOffset.UtcNow;
            var updateResult = await userManager.UpdateAsync(user);

            if (!updateResult.Succeeded)
            {
                throw new InvalidOperationException(
                    $"Could not activate the bootstrap administrator: {string.Join(", ", updateResult.Errors.Select(error => error.Description))}");
            }
        }

        await transaction.CommitAsync(cancellationToken);
    }
}
