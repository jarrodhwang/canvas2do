using System.Text.Json;

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

public sealed record AcademyPreferencesDto(
    JsonElement ManualLectures,
    JsonElement CanvasLecturePreferences,
    JsonElement ManualCoursework,
    JsonElement CanvasCourseworkPreferences,
    JsonElement ManualAssessments,
    JsonElement CanvasAssessmentPreferences,
    JsonElement CalendarSettings,
    bool Exists);

public sealed record SaveAcademyPreferencesRequest(
    JsonElement ManualLectures,
    JsonElement CanvasLecturePreferences,
    JsonElement ManualCoursework,
    JsonElement CanvasCourseworkPreferences,
    JsonElement ManualAssessments,
    JsonElement CanvasAssessmentPreferences,
    JsonElement CalendarSettings);

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
    string Body,
    GoogleGmailSendAttachmentDto[]? Attachments = null);

public sealed record GoogleGmailSendAttachmentDto(
    string FileName,
    string MimeType,
    string ContentBase64,
    long? SizeBytes = null);

public sealed record GoogleGmailScheduleRequestDto(
    string To,
    string? Cc,
    string? Bcc,
    string Subject,
    string Body,
    DateTimeOffset ScheduledFor,
    GoogleGmailSendAttachmentDto[]? Attachments = null);

public sealed record GoogleGmailScheduledMessageDto(
    Guid Id,
    string To,
    string? Cc,
    string? Bcc,
    string Subject,
    string Body,
    DateTimeOffset ScheduledFor,
    DateTimeOffset CreatedAt,
    string Status,
    GoogleGmailScheduledAttachmentDto[] Attachments,
    string? Error = null,
    DateTimeOffset? SentAt = null,
    string? GmailMessageId = null,
    string? GmailThreadId = null);

public sealed record GoogleGmailScheduledAttachmentDto(
    string FileName,
    string MimeType,
    long? SizeBytes = null);

public sealed record GoogleGmailModifyLabelsRequestDto(
    string[]? AddLabelIds,
    string[]? RemoveLabelIds);

public sealed record GoogleGmailSendResponseDto(
    string Id,
    string ThreadId);

public sealed record GoogleChatMessageDto(
    string Name,
    string Sender,
    string Text,
    DateTimeOffset? CreatedAt,
    string? SenderName = null,
    string? SenderEmail = null,
    string? SenderType = null,
    string? SenderAvatarUrl = null,
    GoogleChatAttachmentDto[]? Attachments = null);

public sealed record GoogleChatAttachmentDto(
    string Name,
    string FileName,
    string ContentType,
    string Source,
    string? ThumbnailUri = null,
    string? DownloadUri = null,
    string? DriveFileId = null,
    string? AttachmentResourceName = null,
    string? WebViewLink = null,
    string? IconLink = null,
    long? SizeBytes = null);

public sealed record GoogleChatSpaceDto(
    string Name,
    string DisplayName,
    string SpaceType,
    DateTimeOffset? LastActiveTime,
    GoogleChatMessageDto[] Messages,
    GoogleChatMemberDto? PrimaryMember = null,
    GoogleChatMemberDto[]? Members = null);

public sealed record GoogleChatMemberDto(
    string Name,
    string DisplayName,
    string? Email = null,
    string? AvatarUrl = null,
    string? Type = null);

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
    string? HtmlUrl,
    double? CurrentScore,
    string? CurrentGrade);

public sealed record CanvasCoursesDto(
    CanvasCourseDto[] Courses,
    string? TermName = null);

public sealed record CanvasCourseTabDto(
    string Id,
    string Label,
    string? Type,
    string? Visibility,
    bool Hidden,
    string? HtmlUrl);

public sealed record CanvasCourseModuleItemDto(
    string Id,
    string Title,
    string? Type,
    string? ContentId,
    string? PageUrl,
    string? Url,
    string? HtmlUrl,
    string? ExternalUrl,
    DateTimeOffset? CompletionRequirementCompletedAt);

public sealed record CanvasCourseModuleDto(
    string Id,
    string Name,
    int? Position,
    int? ItemCount,
    CanvasCourseModuleItemDto[] Items);

public sealed record CanvasCourseAnnouncementDto(
    string Id,
    string Title,
    string? Message,
    DateTimeOffset? PostedAt,
    string? HtmlUrl);

public sealed record CanvasCourseAssignmentDto(
    string Id,
    string Name,
    string? Description,
    DateTimeOffset? DueAt,
    double? PointsPossible,
    string? HtmlUrl,
    string[] SubmissionTypes,
    bool IsSubmitted,
    double? Score,
    string? Grade,
    DateTimeOffset? SubmittedAt,
    string? WorkflowState);

public sealed record CanvasCourseQuizDto(
    string Id,
    string Title,
    string? Description,
    DateTimeOffset? DueAt,
    double? PointsPossible,
    string? HtmlUrl,
    string? QuizType,
    int? QuestionCount,
    int? AllowedAttempts,
    string? AssignmentId);

public sealed record CanvasCourseDiscussionDto(
    string Id,
    string Title,
    string? Message,
    DateTimeOffset? PostedAt,
    string? HtmlUrl,
    string? AuthorName,
    bool IsAnnouncement);

public sealed record CanvasCourseUserDto(
    string Id,
    string Name,
    string? ShortName,
    string? SortableName,
    string? AvatarUrl,
    string[] Roles);

public sealed record CanvasCourseContentDto(
    CanvasCourseDto Course,
    CanvasCourseTabDto[] Tabs,
    CanvasCourseModuleDto[] Modules,
    CanvasCourseAnnouncementDto[] Announcements,
    CanvasCourseAssignmentDto[] Assignments,
    CanvasCourseQuizDto[] Quizzes,
    CanvasCourseDiscussionDto[] Discussions,
    CanvasCoursePageDto[] Pages,
    CanvasCourseUserDto[] People,
    CanvasCoursePageDto? FrontPage,
    string? SyllabusBody);

public sealed record CanvasCoursePageDto(
    string Id,
    string Title,
    string? PageUrl,
    string? Body,
    string? HtmlUrl,
    DateTimeOffset? UpdatedAt);

public sealed record CanvasCourseFileDto(
    string Id,
    string DisplayName,
    string? FileName,
    string? ContentType,
    string? Url,
    string? PreviewUrl,
    string? HtmlUrl,
    int? Size,
    DateTimeOffset? UpdatedAt);

public sealed record CanvasCalendarItemDto(
    string Id,
    string Title,
    string Type,
    string? CourseId,
    string? CourseCode,
    string? CourseName,
    DateTimeOffset? StartAt,
    DateTimeOffset? EndAt,
    DateTimeOffset? DueAt,
    string? HtmlUrl,
    string? ContextCode,
    string[] SubmissionTypes,
    string? AssignmentId,
    bool IsSubmitted);

public sealed record CanvasCalendarItemsDto(
    CanvasCalendarItemDto[] Items);

public sealed record CanvasInboxItemDto(
    string Id,
    string Title,
    string? Message,
    string Type,
    string? CourseId,
    string? CourseCode,
    string? CourseName,
    DateTimeOffset? CreatedAt,
    DateTimeOffset? UpdatedAt,
    string? HtmlUrl,
    string? ReadState);

public sealed record CanvasInboxItemsDto(
    CanvasInboxItemDto[] Items);
