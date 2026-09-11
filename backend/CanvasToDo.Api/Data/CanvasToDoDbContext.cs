using CanvasToDo.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CanvasToDo.Api.Data;

/// <summary>
/// Stores encrypted Canvas connections and Academy preferences by account owner.
/// </summary>
public sealed class CanvasToDoDbContext(DbContextOptions<CanvasToDoDbContext> options)
    : DbContext(options)
{
    public DbSet<UserSetting> UserSettings => Set<UserSetting>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<UserSetting>(entity =>
        {
            entity.ToTable("user_settings");
            entity.HasIndex(setting => new { setting.UserKey, setting.SettingKey }).IsUnique();
            entity.Property(setting => setting.UserKey).HasMaxLength(320);
            entity.Property(setting => setting.SettingKey).HasMaxLength(120);
            entity.Property(setting => setting.SettingJson).HasColumnType("jsonb");
        });
    }
}
