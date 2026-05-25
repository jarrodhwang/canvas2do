namespace Incos.Workspace.Api.Domain.Entities;

public abstract class Entity
{
    public Guid Id { get; set; } = Guid.NewGuid();
}

public abstract class AuditableEntity : Entity
{
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class User : AuditableEntity
{
    public string Email { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? TimeZone { get; set; }
    public List<CalendarItem> OwnedCalendarItems { get; set; } = [];
}

public sealed class WorkspaceMode : AuditableEntity
{
    public string ModeKey { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? Icon { get; set; }
    public string? Purpose { get; set; }
    public string? AccentPrimary { get; set; }
    public string? AccentSecondary { get; set; }
    public bool Enabled { get; set; } = true;
    public bool Hidden { get; set; }
    public List<ModeSetting> Settings { get; set; } = [];
    public List<CalendarItem> CalendarItems { get; set; } = [];
}

public sealed class ModeSetting : AuditableEntity
{
    public Guid WorkspaceModeId { get; set; }
    public WorkspaceMode? WorkspaceMode { get; set; }
    public string SettingKey { get; set; } = string.Empty;
    public string SettingJson { get; set; } = "{}";
}

public sealed class CalendarItem : AuditableEntity
{
    public Guid WorkspaceModeId { get; set; }
    public WorkspaceMode? WorkspaceMode { get; set; }
    public string Type { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Status { get; set; } = "open";
    public string Priority { get; set; } = "normal";
    public DateTimeOffset? StartAt { get; set; }
    public DateTimeOffset? EndAt { get; set; }
    public DateTimeOffset? DueAt { get; set; }
    public Guid? OwnerUserId { get; set; }
    public User? OwnerUser { get; set; }
    public string? RelatedEntityType { get; set; }
    public Guid? RelatedEntityId { get; set; }
    public List<ChecklistItem> ChecklistItems { get; set; } = [];
    public List<ExternalLink> Links { get; set; } = [];
    public List<Note> Notes { get; set; } = [];
}

public sealed class ChecklistItem : AuditableEntity
{
    public Guid? CalendarItemId { get; set; }
    public CalendarItem? CalendarItem { get; set; }
    public string OwnerType { get; set; } = "calendar_item";
    public Guid? OwnerId { get; set; }
    public string Title { get; set; } = string.Empty;
    public bool IsDone { get; set; }
    public int SortOrder { get; set; }
}

public sealed class ExternalLink : AuditableEntity
{
    public Guid? CalendarItemId { get; set; }
    public CalendarItem? CalendarItem { get; set; }
    public string OwnerType { get; set; } = string.Empty;
    public Guid OwnerId { get; set; }
    public string Provider { get; set; } = "manual_url";
    public string? ExternalId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string MetadataJson { get; set; } = "{}";
}

public sealed class ImageAsset : AuditableEntity
{
    public string OwnerType { get; set; } = string.Empty;
    public Guid? OwnerId { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string FileExtension { get; set; } = string.Empty;
    public string MimeType { get; set; } = string.Empty;
    public string StoragePath { get; set; } = string.Empty;
    public string PublicUrl { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public string MetadataJson { get; set; } = "{}";
}

public sealed class Note : AuditableEntity
{
    public Guid? CalendarItemId { get; set; }
    public CalendarItem? CalendarItem { get; set; }
    public string OwnerType { get; set; } = string.Empty;
    public Guid OwnerId { get; set; }
    public string Body { get; set; } = string.Empty;
}

public sealed class Tag : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string? Color { get; set; }
}

public sealed class Person : AuditableEntity
{
    public string DisplayName { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string PersonType { get; set; } = "person";
}

public sealed class Course : AuditableEntity
{
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Term { get; set; }
}

public sealed class Assignment : AuditableEntity
{
    public Guid CourseId { get; set; }
    public Course? Course { get; set; }
    public Guid? CalendarItemId { get; set; }
    public CalendarItem? CalendarItem { get; set; }
    public string Title { get; set; } = string.Empty;
    public DateTimeOffset? StartAt { get; set; }
    public DateTimeOffset? DueAt { get; set; }
}

public sealed class Project : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string Status { get; set; } = "active";
    public string? Category { get; set; }
}

public sealed class Issue : AuditableEntity
{
    public Guid? ProjectId { get; set; }
    public Project? Project { get; set; }
    public Guid? CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public Guid? CalendarItemId { get; set; }
    public CalendarItem? CalendarItem { get; set; }
    public string IssueType { get; set; } = "issue";
    public string Title { get; set; } = string.Empty;
    public string Status { get; set; } = "todo";
}

public sealed class Customer : AuditableEntity
{
    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Company { get; set; }
}

public sealed class Colleague : AuditableEntity
{
    public string DisplayName { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Role { get; set; }
}

public sealed class SupportCase : AuditableEntity
{
    public Guid? CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public string CaseNumber { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Status { get; set; } = "open";
    public string? HqResponseStatus { get; set; }
    public DateTimeOffset? FollowUpAt { get; set; }
}

public sealed class GoogleLink : AuditableEntity
{
    public string OwnerType { get; set; } = string.Empty;
    public Guid OwnerId { get; set; }
    public string GoogleResourceType { get; set; } = string.Empty;
    public string GoogleResourceId { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
}

public sealed class TopTrackCase : AuditableEntity
{
    public string TicketId { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string Status { get; set; } = "open";
    public Guid? SupportCaseId { get; set; }
    public SupportCase? SupportCase { get; set; }
}

public sealed class PdmLink : AuditableEntity
{
    public string ReferenceType { get; set; } = string.Empty;
    public string ReferenceId { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string MetadataJson { get; set; } = "{}";
}

public sealed class Notification : AuditableEntity
{
    public string OwnerType { get; set; } = string.Empty;
    public Guid OwnerId { get; set; }
    public string Channel { get; set; } = "app";
    public string Title { get; set; } = string.Empty;
    public string Status { get; set; } = "pending";
    public DateTimeOffset? ScheduledAt { get; set; }
}

public sealed class ScheduledGmailMessage : AuditableEntity
{
    public string UserKey { get; set; } = string.Empty;
    public string To { get; set; } = string.Empty;
    public string? Cc { get; set; }
    public string? Bcc { get; set; }
    public string Subject { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public string AttachmentsJson { get; set; } = "[]";
    public DateTimeOffset ScheduledFor { get; set; }
    public string Status { get; set; } = "pending";
    public string AccessToken { get; set; } = string.Empty;
    public string? RefreshToken { get; set; }
    public DateTimeOffset? AccessTokenExpiresAt { get; set; }
    public int AttemptCount { get; set; }
    public DateTimeOffset? LastAttemptAt { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public string? Error { get; set; }
    public string? GmailMessageId { get; set; }
    public string? GmailThreadId { get; set; }
}

public sealed class GoogleOAuthToken : AuditableEntity
{
    public string UserKey { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string AccessToken { get; set; } = string.Empty;
    public string? RefreshToken { get; set; }
    public DateTimeOffset? AccessTokenExpiresAt { get; set; }
    public string? Scope { get; set; }
}

public sealed class AuditLog : Entity
{
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string ActorUserId { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string EntityType { get; set; } = string.Empty;
    public Guid EntityId { get; set; }
    public string MetadataJson { get; set; } = "{}";
}
