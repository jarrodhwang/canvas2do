using System.Text.Json;
using System.Text.Json.Serialization;

namespace CanvasToDo.Api.Contracts;

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

public sealed record CanvasIntegrationStatusDto(
    string Provider,
    string Label,
    bool Configured,
    bool Connected,
    string Status,
    string ConnectUrl,
    string? InstanceUrl,
    string? UserName,
    string[] Scopes,
    string TokenSource,
    DateTimeOffset? TokenStartsAt,
    DateTimeOffset? TokenExpiresAt,
    DateTimeOffset? TokenUpdatedAt,
    [property: JsonPropertyName("oauthConfigured")] bool OAuthConfigured = false,
    bool ManualTokenEnabled = false);

public sealed record CanvasTokenStatusDto(
    bool Configured,
    bool Connected,
    string Status,
    string? InstanceUrl,
    string TokenSource,
    DateTimeOffset? StartsAt,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset? UpdatedAt,
    string? UserName,
    [property: JsonPropertyName("oauthConfigured")] bool OAuthConfigured = false,
    bool ManualTokenEnabled = false,
    string? ConnectUrl = null,
    IReadOnlyList<CanvasSchoolDto>? Schools = null);

public sealed record CanvasSchoolDto(string Name, string InstanceUrl);

public sealed record UpdateCanvasTokenRequest(
    string InstanceUrl,
    string AccessToken,
    DateTimeOffset? StartsAt,
    DateTimeOffset? ExpiresAt);

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
    string? CurrentGrade,
    DateTimeOffset? TermStartAt = null,
    DateTimeOffset? TermEndAt = null,
    string? EnrollmentState = null,
    bool AccessRestrictedByDate = false,
    bool AccessClosed = false,
    bool IsPublished = true);

public sealed record CanvasCoursesDto(
    CanvasCourseDto[] Courses,
    string? TermName = null,
    bool IsComplete = true);

public sealed record CanvasCoursePersonDto(
    string Id,
    string Name,
    string? ShortName,
    string? SortableName,
    string[] Roles,
    string? Email,
    string? AvatarUrl = null,
    string? LoginId = null,
    string? Bio = null,
    string[]? EnrollmentStates = null,
    string[]? SectionIds = null);

public sealed record CanvasCoursePeopleDto(
    CanvasCoursePersonDto[] People,
    bool IsComplete);

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

public sealed record CanvasRubricRatingDto(
    string Id,
    string? Description,
    string? LongDescription,
    double? Points);

public sealed record CanvasRubricCriterionDto(
    string Id,
    string? Description,
    string? LongDescription,
    double? Points,
    bool CriterionUseRange,
    bool IgnoreForScoring,
    CanvasRubricRatingDto[] Ratings);

public sealed record CanvasRubricSettingsDto(
    string? Id,
    string? Title,
    double? PointsPossible,
    bool? HideScoreTotal,
    bool? HidePoints,
    bool? FreeFormCriterionComments);

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
    string? WorkflowState,
    bool? UseRubricForGrading,
    CanvasRubricSettingsDto? RubricSettings,
    CanvasRubricCriterionDto[] Rubric);

public sealed record CanvasAssignmentSubmissionRequest(
    string SubmissionType,
    string? Body,
    string? Url,
    string? Comment);

public sealed record CanvasSubmissionResultDto(
    bool Success,
    string Status,
    string? Message,
    string? HtmlUrl,
    DateTimeOffset? SubmittedAt);

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

public sealed record CanvasQuizStartRequest(string? AccessCode);

public sealed record CanvasQuizSubmissionDto(
    string Id,
    string QuizId,
    string? SubmissionId,
    int? Attempt,
    string? WorkflowState,
    string? ValidationToken,
    DateTimeOffset? StartedAt,
    DateTimeOffset? FinishedAt,
    DateTimeOffset? EndAt,
    string? HtmlUrl);

public sealed record CanvasCourseDiscussionDto(
    string Id,
    string Title,
    string? Message,
    DateTimeOffset? PostedAt,
    string? HtmlUrl,
    string? AuthorName,
    bool IsAnnouncement,
    string? AssignmentId);

public sealed record CanvasDiscussionEntryRequest(
    string Message,
    string? ParentEntryId);

public sealed record CanvasDiscussionEntryDto(
    string Id,
    string? Message,
    DateTimeOffset? CreatedAt,
    string? AuthorName,
    string? HtmlUrl);

public sealed record CanvasCourseContentDto(
    CanvasCourseDto Course,
    CanvasCourseTabDto[] Tabs,
    CanvasCourseModuleDto[] Modules,
    CanvasCourseAnnouncementDto[] Announcements,
    CanvasCourseAssignmentDto[] Assignments,
    CanvasCourseQuizDto[] Quizzes,
    CanvasCourseDiscussionDto[] Discussions,
    CanvasCoursePageDto[] Pages,
    CanvasCoursePersonDto[] People,
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
    CanvasInboxItemDto[] Items,
    bool IsComplete);

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
    bool IsSubmitted,
    DateTimeOffset? SubmittedAt);

public sealed record CanvasCalendarItemsDto(
    CanvasCalendarItemDto[] Items,
    bool IsComplete);
