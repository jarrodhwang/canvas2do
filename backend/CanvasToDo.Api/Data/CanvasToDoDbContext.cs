using CanvasToDo.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CanvasToDo.Api.Data;

/// <summary>
/// Compatibility context for the small set of settings retained from the former workspace app.
/// The connection-string name and table remain stable so existing Canvas tokens and calendar
/// preferences can be migrated without exposing the retired Workspace data model.
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
