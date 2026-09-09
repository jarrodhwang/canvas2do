using CanvasToDo.Api.Domain.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace CanvasToDo.Api.Data;

public sealed class AuthDbContext(DbContextOptions<AuthDbContext> options)
    : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options)
{
    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<ApplicationUser>(entity =>
        {
            entity.ToTable("auth_users");
            entity.Property(user => user.DisplayName).HasMaxLength(160);
            entity.Property(user => user.Status).HasMaxLength(32);
            entity.HasIndex(user => user.NormalizedEmail)
                .IsUnique()
                .HasDatabaseName("EmailIndex");
            entity.HasIndex(user => user.Status);
        });

        builder.Entity<IdentityRole<Guid>>().ToTable("auth_roles");
        builder.Entity<IdentityUserRole<Guid>>().ToTable("auth_user_roles");
        builder.Entity<IdentityUserClaim<Guid>>().ToTable("auth_user_claims");
        builder.Entity<IdentityUserLogin<Guid>>(entity =>
        {
            entity.ToTable("auth_user_logins");
            entity.Property(login => login.LoginProvider).HasMaxLength(128);
            entity.Property(login => login.ProviderKey).HasMaxLength(256);
            entity.Property(login => login.ProviderDisplayName).HasMaxLength(160);
        });
        builder.Entity<IdentityRoleClaim<Guid>>().ToTable("auth_role_claims");
        builder.Entity<IdentityUserToken<Guid>>(entity =>
        {
            entity.ToTable("auth_user_tokens");
            entity.Property(token => token.LoginProvider).HasMaxLength(128);
            entity.Property(token => token.Name).HasMaxLength(128);
        });
    }
}
