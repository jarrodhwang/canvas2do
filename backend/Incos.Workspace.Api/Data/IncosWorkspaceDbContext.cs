using Incos.Workspace.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Incos.Workspace.Api.Data;

public sealed class IncosWorkspaceDbContext(DbContextOptions<IncosWorkspaceDbContext> options)
    : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<UserSetting> UserSettings => Set<UserSetting>();
    public DbSet<AdminUser> AdminUsers => Set<AdminUser>();
    public DbSet<AdminGroup> AdminGroups => Set<AdminGroup>();
    public DbSet<AdminGroupMember> AdminGroupMembers => Set<AdminGroupMember>();
    public DbSet<AcademyCredentialAccount> AcademyCredentialAccounts => Set<AcademyCredentialAccount>();
    public DbSet<WorkspaceMode> WorkspaceModes => Set<WorkspaceMode>();
    public DbSet<ModeSetting> ModeSettings => Set<ModeSetting>();
    public DbSet<CalendarItem> CalendarItems => Set<CalendarItem>();
    public DbSet<ChecklistItem> ChecklistItems => Set<ChecklistItem>();
    public DbSet<ExternalLink> Links => Set<ExternalLink>();
    public DbSet<ImageAsset> ImageAssets => Set<ImageAsset>();
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<Tag> Tags => Set<Tag>();
    public DbSet<Person> People => Set<Person>();
    public DbSet<Course> Courses => Set<Course>();
    public DbSet<Assignment> Assignments => Set<Assignment>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<Issue> Issues => Set<Issue>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Colleague> Colleagues => Set<Colleague>();
    public DbSet<SupportCase> SupportCases => Set<SupportCase>();
    public DbSet<GoogleLink> GoogleLinks => Set<GoogleLink>();
    public DbSet<TopTrackCase> TopTrackCases => Set<TopTrackCase>();
    public DbSet<PdmLink> PdmLinks => Set<PdmLink>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<ScheduledGmailMessage> ScheduledGmailMessages => Set<ScheduledGmailMessage>();
    public DbSet<GoogleOAuthToken> GoogleOAuthTokens => Set<GoogleOAuthToken>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasIndex(user => user.Email).IsUnique();
            entity.Property(user => user.Email).HasMaxLength(320);
            entity.Property(user => user.DisplayName).HasMaxLength(160);
        });

        modelBuilder.Entity<UserSetting>(entity =>
        {
            entity.ToTable("user_settings");
            entity.HasIndex(setting => new { setting.UserKey, setting.SettingKey }).IsUnique();
            entity.Property(setting => setting.UserKey).HasMaxLength(320);
            entity.Property(setting => setting.SettingKey).HasMaxLength(120);
            entity.Property(setting => setting.SettingJson).HasColumnType("jsonb");
        });

        modelBuilder.Entity<AdminUser>(entity =>
        {
            entity.ToTable("admin_users");
            entity.HasIndex(user => user.Email).IsUnique();
            entity.HasIndex(user => user.GoogleUserId);
            entity.Property(user => user.GoogleUserId).HasMaxLength(120);
            entity.Property(user => user.Email).HasMaxLength(320);
            entity.Property(user => user.DisplayName).HasMaxLength(160);
            entity.Property(user => user.PhotoUrl).HasColumnType("text");
            entity.Property(user => user.HostedDomain).HasMaxLength(160);
            entity.Property(user => user.Role).HasMaxLength(120);
            entity.Property(user => user.Status).HasMaxLength(40);
            entity.Property(user => user.SessionRevokedAt);
        });

        modelBuilder.Entity<AdminGroup>(entity =>
        {
            entity.ToTable("admin_groups");
            entity.HasIndex(group => group.Name).IsUnique();
            entity.Property(group => group.Name).HasMaxLength(160);
            entity.Property(group => group.Description).HasMaxLength(600);
            entity.Property(group => group.PhotoUrl).HasColumnType("text");
            entity.Property(group => group.Status).HasMaxLength(40);
            entity.Property(group => group.PermissionJson).HasColumnType("jsonb");
            entity.Property(group => group.SettingJson).HasColumnType("jsonb");
            entity.Property(group => group.AccessJson).HasColumnType("jsonb");
        });

        modelBuilder.Entity<AdminGroupMember>(entity =>
        {
            entity.ToTable("admin_group_members");
            entity.HasIndex(member => new { member.AdminGroupId, member.AdminUserId }).IsUnique();
            entity.HasOne(member => member.AdminGroup)
                .WithMany(group => group.Members)
                .HasForeignKey(member => member.AdminGroupId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(member => member.AdminUser)
                .WithMany()
                .HasForeignKey(member => member.AdminUserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AcademyCredentialAccount>(entity =>
        {
            entity.ToTable("academy_credential_accounts");
            entity.HasIndex(account => account.LoginId).IsUnique();
            entity.HasIndex(account => account.AdminUserId).IsUnique();
            entity.Property(account => account.LoginId).HasMaxLength(80);
            entity.Property(account => account.PasswordHash).HasColumnType("text");
            entity.HasOne(account => account.AdminUser)
                .WithMany()
                .HasForeignKey(account => account.AdminUserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<WorkspaceMode>(entity =>
        {
            entity.ToTable("workspace_modes");
            entity.HasIndex(mode => mode.ModeKey).IsUnique();
            entity.Property(mode => mode.ModeKey).HasMaxLength(64);
            entity.Property(mode => mode.DisplayName).HasMaxLength(120);
            entity.Property(mode => mode.Icon).HasMaxLength(80);
            entity.Property(mode => mode.AccentPrimary).HasMaxLength(32);
            entity.Property(mode => mode.AccentSecondary).HasMaxLength(32);
        });

        modelBuilder.Entity<ModeSetting>(entity =>
        {
            entity.ToTable("mode_settings");
            entity.HasIndex(setting => new { setting.WorkspaceModeId, setting.SettingKey }).IsUnique();
            entity.Property(setting => setting.SettingKey).HasMaxLength(120);
            entity.Property(setting => setting.SettingJson).HasColumnType("jsonb");
        });

        modelBuilder.Entity<CalendarItem>(entity =>
        {
            entity.ToTable("calendar_items");
            entity.HasIndex(item => new { item.WorkspaceModeId, item.StartAt });
            entity.HasIndex(item => new { item.RelatedEntityType, item.RelatedEntityId });
            entity.Property(item => item.Type).HasMaxLength(80);
            entity.Property(item => item.Title).HasMaxLength(240);
            entity.Property(item => item.Status).HasMaxLength(80);
            entity.Property(item => item.Priority).HasMaxLength(80);
            entity.Property(item => item.RelatedEntityType).HasMaxLength(120);
        });

        modelBuilder.Entity<ChecklistItem>(entity =>
        {
            entity.ToTable("checklist_items");
            entity.HasIndex(item => new { item.OwnerType, item.OwnerId });
            entity.Property(item => item.OwnerType).HasMaxLength(120);
            entity.Property(item => item.Title).HasMaxLength(240);
        });

        modelBuilder.Entity<ExternalLink>(entity =>
        {
            entity.ToTable("links");
            entity.HasIndex(link => new { link.OwnerType, link.OwnerId });
            entity.Property(link => link.OwnerType).HasMaxLength(120);
            entity.Property(link => link.Provider).HasMaxLength(80);
            entity.Property(link => link.ExternalId).HasMaxLength(240);
            entity.Property(link => link.Title).HasMaxLength(240);
            entity.Property(link => link.Url).HasMaxLength(1200);
            entity.Property(link => link.MetadataJson).HasColumnType("jsonb");
        });

        modelBuilder.Entity<ImageAsset>(entity =>
        {
            entity.ToTable("image_assets");
            entity.HasIndex(image => new { image.OwnerType, image.OwnerId });
            entity.HasIndex(image => image.PublicUrl).IsUnique();
            entity.Property(image => image.OwnerType).HasMaxLength(120);
            entity.Property(image => image.FileName).HasMaxLength(240);
            entity.Property(image => image.FileExtension).HasMaxLength(16);
            entity.Property(image => image.MimeType).HasMaxLength(120);
            entity.Property(image => image.StoragePath).HasMaxLength(1200);
            entity.Property(image => image.PublicUrl).HasMaxLength(1200);
            entity.Property(image => image.MetadataJson).HasColumnType("jsonb");
        });

        modelBuilder.Entity<Note>(entity =>
        {
            entity.ToTable("notes");
            entity.HasIndex(note => new { note.OwnerType, note.OwnerId });
            entity.Property(note => note.OwnerType).HasMaxLength(120);
        });

        modelBuilder.Entity<Tag>(entity =>
        {
            entity.ToTable("tags");
            entity.HasIndex(tag => tag.Name).IsUnique();
            entity.Property(tag => tag.Name).HasMaxLength(120);
            entity.Property(tag => tag.Color).HasMaxLength(32);
        });

        modelBuilder.Entity<Person>(entity =>
        {
            entity.ToTable("people");
            entity.Property(person => person.DisplayName).HasMaxLength(160);
            entity.Property(person => person.Email).HasMaxLength(320);
            entity.Property(person => person.PersonType).HasMaxLength(80);
        });

        modelBuilder.Entity<Course>(entity =>
        {
            entity.ToTable("courses");
            entity.Property(course => course.Code).HasMaxLength(80);
            entity.Property(course => course.Name).HasMaxLength(180);
            entity.Property(course => course.Term).HasMaxLength(80);
        });

        modelBuilder.Entity<Assignment>(entity =>
        {
            entity.ToTable("assignments");
            entity.Property(assignment => assignment.Title).HasMaxLength(240);
        });

        modelBuilder.Entity<Project>(entity =>
        {
            entity.ToTable("projects");
            entity.Property(project => project.Name).HasMaxLength(180);
            entity.Property(project => project.Status).HasMaxLength(80);
            entity.Property(project => project.Category).HasMaxLength(120);
        });

        modelBuilder.Entity<Issue>(entity =>
        {
            entity.ToTable("issues");
            entity.Property(issue => issue.IssueType).HasMaxLength(80);
            entity.Property(issue => issue.Title).HasMaxLength(240);
            entity.Property(issue => issue.Status).HasMaxLength(80);
        });

        modelBuilder.Entity<Customer>(entity =>
        {
            entity.ToTable("customers");
            entity.Property(customer => customer.Name).HasMaxLength(180);
            entity.Property(customer => customer.Email).HasMaxLength(320);
            entity.Property(customer => customer.Company).HasMaxLength(180);
        });

        modelBuilder.Entity<Colleague>(entity =>
        {
            entity.ToTable("colleagues");
            entity.Property(colleague => colleague.DisplayName).HasMaxLength(160);
            entity.Property(colleague => colleague.Email).HasMaxLength(320);
            entity.Property(colleague => colleague.Role).HasMaxLength(120);
        });

        modelBuilder.Entity<SupportCase>(entity =>
        {
            entity.ToTable("support_cases");
            entity.HasIndex(supportCase => supportCase.CaseNumber).IsUnique();
            entity.Property(supportCase => supportCase.CaseNumber).HasMaxLength(120);
            entity.Property(supportCase => supportCase.Title).HasMaxLength(240);
            entity.Property(supportCase => supportCase.Status).HasMaxLength(80);
            entity.Property(supportCase => supportCase.HqResponseStatus).HasMaxLength(80);
        });

        modelBuilder.Entity<GoogleLink>(entity =>
        {
            entity.ToTable("google_links");
            entity.HasIndex(link => new { link.OwnerType, link.OwnerId });
            entity.Property(link => link.OwnerType).HasMaxLength(120);
            entity.Property(link => link.GoogleResourceType).HasMaxLength(80);
            entity.Property(link => link.GoogleResourceId).HasMaxLength(240);
            entity.Property(link => link.Url).HasMaxLength(1200);
        });

        modelBuilder.Entity<TopTrackCase>(entity =>
        {
            entity.ToTable("toptrack_cases");
            entity.HasIndex(topTrackCase => topTrackCase.TicketId).IsUnique();
            entity.Property(topTrackCase => topTrackCase.TicketId).HasMaxLength(120);
            entity.Property(topTrackCase => topTrackCase.Url).HasMaxLength(1200);
            entity.Property(topTrackCase => topTrackCase.Status).HasMaxLength(80);
        });

        modelBuilder.Entity<PdmLink>(entity =>
        {
            entity.ToTable("pdm_links");
            entity.Property(link => link.ReferenceType).HasMaxLength(120);
            entity.Property(link => link.ReferenceId).HasMaxLength(240);
            entity.Property(link => link.Url).HasMaxLength(1200);
            entity.Property(link => link.MetadataJson).HasColumnType("jsonb");
        });

        modelBuilder.Entity<Notification>(entity =>
        {
            entity.ToTable("notifications");
            entity.HasIndex(notification => new { notification.OwnerType, notification.OwnerId });
            entity.Property(notification => notification.OwnerType).HasMaxLength(120);
            entity.Property(notification => notification.Channel).HasMaxLength(80);
            entity.Property(notification => notification.Title).HasMaxLength(240);
            entity.Property(notification => notification.Status).HasMaxLength(80);
        });

        modelBuilder.Entity<ScheduledGmailMessage>(entity =>
        {
            entity.ToTable("scheduled_gmail_messages");
            entity.HasIndex(message => new { message.UserKey, message.Status, message.ScheduledFor });
            entity.Property(message => message.UserKey).HasMaxLength(320);
            entity.Property(message => message.To).HasMaxLength(1200);
            entity.Property(message => message.Cc).HasMaxLength(1200);
            entity.Property(message => message.Bcc).HasMaxLength(1200);
            entity.Property(message => message.Subject).HasMaxLength(998);
            entity.Property(message => message.Status).HasMaxLength(40);
            entity.Property(message => message.AccessToken).HasColumnType("text");
            entity.Property(message => message.RefreshToken).HasColumnType("text");
            entity.Property(message => message.AttachmentsJson).HasColumnType("jsonb");
            entity.Property(message => message.Error).HasColumnType("text");
            entity.Property(message => message.GmailMessageId).HasMaxLength(120);
            entity.Property(message => message.GmailThreadId).HasMaxLength(120);
        });

        modelBuilder.Entity<GoogleOAuthToken>(entity =>
        {
            entity.ToTable("google_oauth_tokens");
            entity.HasIndex(token => token.UserKey).IsUnique();
            entity.Property(token => token.UserKey).HasMaxLength(320);
            entity.Property(token => token.Email).HasMaxLength(320);
            entity.Property(token => token.AccessToken).HasColumnType("text");
            entity.Property(token => token.RefreshToken).HasColumnType("text");
            entity.Property(token => token.Scope).HasColumnType("text");
        });

        modelBuilder.Entity<AuditLog>(entity =>
        {
            entity.ToTable("audit_logs");
            entity.Property(log => log.ActorUserId).HasMaxLength(120);
            entity.Property(log => log.Action).HasMaxLength(120);
            entity.Property(log => log.EntityType).HasMaxLength(120);
            entity.Property(log => log.MetadataJson).HasColumnType("jsonb");
        });
    }
}
