namespace Incos.Workspace.Api.Contracts;

public sealed record WorkspaceManagementOverviewDto(
    DateTimeOffset GeneratedAtUtc,
    WorkspaceCustomerDto[] Customers,
    WorkspaceProjectDto[] Projects,
    WorkspaceIssueDto[] Issues,
    WorkspaceCalendarEntryDto[] CalendarItems,
    WorkspaceDirectoryUserDto[] Users,
    WorkspaceDirectoryGroupDto[] Groups,
    WorkspaceCategoryDto[] Categories);

public sealed record WorkspaceCustomerDto(
    Guid Id,
    string CompanyName,
    string? ContactName,
    string? ContactEmail,
    string? Phone,
    int ProjectCount,
    int IssueCount);

public sealed record WorkspaceProjectDto(
    Guid Id,
    Guid CustomerId,
    string CustomerCompany,
    string Name,
    string? Description,
    string Category,
    string? Subcategory,
    string Status,
    DateTimeOffset? StartAtUtc,
    DateTimeOffset? DueAtUtc,
    int OpenIssueCount,
    int TotalIssueCount);

public sealed record WorkspaceIssueDto(
    Guid Id,
    Guid CustomerId,
    string CustomerCompany,
    Guid? ProjectId,
    string? ProjectName,
    string Title,
    string? Description,
    string IssueType,
    string Status,
    string Priority,
    DateTimeOffset? DueAtUtc,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record WorkspaceCalendarEntryDto(
    Guid Id,
    string Title,
    string? Description,
    string ItemType,
    string Status,
    DateTimeOffset StartAtUtc,
    DateTimeOffset EndAtUtc,
    string SourceTimeZone,
    bool IsAllDay,
    Guid? ProjectId,
    string? ProjectName,
    Guid? IssueId,
    string? IssueTitle,
    string OwnerLabel,
    bool CanEdit,
    WorkspaceCalendarShareDto[] Shares);

public sealed record WorkspaceCalendarShareDto(
    string TargetType,
    string TargetKey,
    string TargetLabel);

public sealed record WorkspaceDirectoryUserDto(
    string Email,
    string DisplayName);

public sealed record WorkspaceDirectoryGroupDto(
    string Id,
    string Name);

public sealed record WorkspaceCategoryDto(
    string Name,
    string[] Children);

public sealed record SaveWorkspaceCustomerRequest(
    string CompanyName,
    string? ContactName,
    string? ContactEmail,
    string? Phone);

public sealed record SaveWorkspaceProjectRequest(
    Guid CustomerId,
    string Name,
    string? Description,
    string Category,
    string? Subcategory,
    string Status,
    DateTimeOffset? StartAtUtc,
    DateTimeOffset? DueAtUtc);

public sealed record SaveWorkspaceIssueRequest(
    Guid CustomerId,
    Guid? ProjectId,
    string Title,
    string? Description,
    string IssueType,
    string Status,
    string Priority,
    DateTimeOffset? DueAtUtc);

public sealed record UpdateWorkspaceIssueStatusRequest(string Status);

public sealed record SaveWorkspaceCalendarEntryRequest(
    string Title,
    string? Description,
    string ItemType,
    string Status,
    DateTimeOffset StartAtUtc,
    DateTimeOffset EndAtUtc,
    string SourceTimeZone,
    bool IsAllDay,
    Guid? ProjectId,
    Guid? IssueId,
    WorkspaceCalendarShareDto[]? Shares);
