namespace Incos.Workspace.Api.Contracts;

public sealed record WorkspaceModeDto(
    Guid Id,
    string ModeKey,
    string DisplayName,
    string? Icon,
    string? Purpose,
    string? AccentPrimary,
    string? AccentSecondary,
    bool Enabled,
    bool Hidden);

public sealed record CalendarItemDto(
    Guid Id,
    string ModeKey,
    string Type,
    string Title,
    string? Description,
    string Status,
    string Priority,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    DateTimeOffset? DueAt,
    string? RelatedEntityType,
    Guid? RelatedEntityId);

public sealed record CreateCalendarItemRequest(
    string Type,
    string Title,
    string? Description,
    string? Status,
    string? Priority,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    DateTimeOffset? DueAt,
    string? RelatedEntityType,
    Guid? RelatedEntityId);

public sealed record StaticImageConfigDto(
    string PublicBasePath,
    string NginxVolumePath,
    string[] AllowedExtensions);

public sealed record ImageAssetDto(
    Guid Id,
    string OwnerType,
    Guid? OwnerId,
    string FileName,
    string FileExtension,
    string MimeType,
    string StoragePath,
    string PublicUrl,
    long SizeBytes);

public sealed record CreateImageAssetRequest(
    string OwnerType,
    Guid? OwnerId,
    string FileName,
    string FileExtension,
    string MimeType,
    string StoragePath,
    string PublicUrl,
    long SizeBytes);

public sealed record GoogleIntegrationStatusDto(
    string Provider,
    string Label,
    bool Configured,
    bool Connected,
    string Status,
    string ConnectUrl,
    string[] Scopes);

public sealed record GoogleDriveFileDto(
    string Id,
    string Name,
    string MimeType,
    string[] Parents,
    string[] ParentNames,
    string? WebViewLink,
    string? IconLink,
    DateTimeOffset? CreatedTime,
    DateTimeOffset? ModifiedTime,
    long? SizeBytes,
    bool IsFolder);

public sealed record GoogleDrivePermissionDto(
    string Id,
    string Type,
    string Role,
    string? DisplayName,
    string? EmailAddress,
    string? PhotoLink,
    bool Deleted,
    bool? AllowFileDiscovery);

public sealed record GoogleDrivePermissionsDto(
    string FileId,
    GoogleDrivePermissionDto[] Permissions);

public sealed record GoogleSharedDriveDto(
    string Id,
    string Name);

public sealed record GoogleDriveBrowserDto(
    string View,
    string? FolderId,
    string? DriveId,
    string? Search,
    bool RequiresSharedDriveSelection,
    GoogleDriveFileDto[] Files,
    GoogleSharedDriveDto[] SharedDrives,
    string? SharedDrivesError);

public sealed record GoogleGmailMessageDto(
    string Id,
    string ThreadId,
    string From,
    string? To,
    string Subject,
    string Snippet,
    string BodyPreview,
    string? BodyHtml,
    DateTimeOffset? ReceivedAt,
    bool Unread,
    string[] Labels,
    GoogleGmailAttachmentDto[] Attachments);

public sealed record GoogleGmailAttachmentDto(
    string FileName,
    string MimeType,
    long? SizeBytes);

public sealed record GoogleGmailMessagesDto(
    string? Search,
    GoogleGmailMessageDto[] Messages,
    string? NextPageToken = null,
    int? ResultSizeEstimate = null);

public sealed record GoogleGmailSendRequestDto(
    string To,
    string? Cc,
    string? Bcc,
    string Subject,
    string Body);

public sealed record GoogleGmailSendResponseDto(
    string Id,
    string ThreadId);

public sealed record GoogleChatMessageDto(
    string Name,
    string Sender,
    string Text,
    DateTimeOffset? CreatedAt);

public sealed record GoogleChatSpaceDto(
    string Name,
    string DisplayName,
    string SpaceType,
    DateTimeOffset? LastActiveTime,
    GoogleChatMessageDto[] Messages);

public sealed record GoogleChatSpacesDto(
    string? Search,
    GoogleChatSpaceDto[] Spaces,
    bool SetupRequired = false,
    string? Error = null);

public sealed record MicrosoftIntegrationStatusDto(
    string Provider,
    string Label,
    bool Configured,
    bool Connected,
    string Status,
    string ConnectUrl,
    string[] Scopes,
    string? UserName = null,
    string? Email = null);

public sealed record OutlookMessageDto(
    string Id,
    string? Subject,
    string From,
    string? To,
    string BodyPreview,
    string? BodyHtml,
    DateTimeOffset? ReceivedAt,
    bool Unread,
    bool HasAttachments,
    string? WebLink,
    string? Importance);

public sealed record OutlookMessagesDto(
    string? Search,
    OutlookMessageDto[] Messages,
    string? NextLink = null);

public sealed record SendOutlookMessageRequestDto(
    string To,
    string? Cc,
    string? Bcc,
    string Subject,
    string Body);

public sealed record CanvasCourseDto(
    string Id,
    string Name,
    string? CourseCode,
    string? TermName,
    string? WorkflowState,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    string? HtmlUrl);

public sealed record CanvasCoursesDto(
    CanvasCourseDto[] Courses,
    string? TermName = null);
