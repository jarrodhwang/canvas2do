using Incos.Workspace.Api.Contracts;
using Incos.Workspace.Api.Data;
using Incos.Workspace.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;

namespace Incos.Workspace.Api.Endpoints;

public static class WorkspaceManagementEndpoints
{
    private static readonly string[] ProjectStatuses = ["planned", "active", "waiting", "completed"];
    private static readonly string[] IssueStatuses = ["todo", "doing", "waiting", "solved"];
    private static readonly string[] IssueTypes = ["issue", "request", "task", "meeting"];
    private static readonly string[] Priorities = ["low", "normal", "high", "urgent"];
    private static readonly string[] CalendarItemTypes = ["work", "meeting", "deadline", "follow-up"];
    private static readonly string[] CalendarStatuses = ["scheduled", "completed", "cancelled"];
    private static readonly SemaphoreSlim SchemaInitializationLock = new(1, 1);
    private static bool schemaInitialized;
    private static readonly WorkspaceCategoryDto[] Categories =
    [
        new("TopSolid", ["CAM", "Mold"]),
        new("Eureka", []),
        new("Boxcon", []),
    ];

    public static IEndpointRouteBuilder MapWorkspaceManagementEndpoints(this IEndpointRouteBuilder app)
    {
        var workspace = app.MapGroup("/api/workspace")
            .RequireAuthorization();

        workspace.MapGet("/overview", GetOverviewAsync)
            .WithName("GetWorkspaceManagementOverview");

        workspace.MapPost("/customers", CreateCustomerAsync)
            .WithName("CreateWorkspaceCustomer");
        workspace.MapPut("/customers/{customerId:guid}", UpdateCustomerAsync)
            .WithName("UpdateWorkspaceCustomer");

        workspace.MapPost("/projects", CreateProjectAsync)
            .WithName("CreateWorkspaceProject");
        workspace.MapPut("/projects/{projectId:guid}", UpdateProjectAsync)
            .WithName("UpdateWorkspaceProject");

        workspace.MapPost("/issues", CreateIssueAsync)
            .WithName("CreateWorkspaceIssue");
        workspace.MapPut("/issues/{issueId:guid}", UpdateIssueAsync)
            .WithName("UpdateWorkspaceIssue");
        workspace.MapPatch("/issues/{issueId:guid}/status", UpdateIssueStatusAsync)
            .WithName("UpdateWorkspaceIssueStatus");

        workspace.MapPost("/calendar-items", CreateCalendarEntryAsync)
            .WithName("CreateWorkspaceCalendarEntry");
        workspace.MapPut("/calendar-items/{entryId:guid}", UpdateCalendarEntryAsync)
            .WithName("UpdateWorkspaceCalendarEntry");
        workspace.MapDelete("/calendar-items/{entryId:guid}", DeleteCalendarEntryAsync)
            .WithName("DeleteWorkspaceCalendarEntry");

        return app;
    }

    public static async Task EnsureWorkspaceManagementTablesAsync(
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken = default)
    {
        if (Volatile.Read(ref schemaInitialized))
        {
            return;
        }

        await SchemaInitializationLock.WaitAsync(cancellationToken);
        try
        {
            if (Volatile.Read(ref schemaInitialized))
            {
                return;
            }

            await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS audit_logs (
                "Id" uuid NOT NULL PRIMARY KEY,
                "CreatedAt" timestamp with time zone NOT NULL,
                "ActorUserId" character varying(320) NOT NULL,
                "Action" character varying(120) NOT NULL,
                "EntityType" character varying(120) NOT NULL,
                "EntityId" uuid NOT NULL,
                "MetadataJson" jsonb NOT NULL
            );
            ALTER TABLE audit_logs ALTER COLUMN "ActorUserId" TYPE character varying(320);

            CREATE TABLE IF NOT EXISTS workspace_customers (
                "Id" uuid NOT NULL PRIMARY KEY,
                "CreatedAt" timestamp with time zone NOT NULL,
                "UpdatedAt" timestamp with time zone NOT NULL,
                "OwnerKey" character varying(320) NOT NULL,
                "CompanyName" character varying(180) NOT NULL,
                "ContactName" character varying(160),
                "ContactEmail" character varying(320),
                "Phone" character varying(80)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_workspace_customers_OwnerKey_CompanyName"
                ON workspace_customers ("OwnerKey", "CompanyName");

            CREATE TABLE IF NOT EXISTS workspace_work_projects (
                "Id" uuid NOT NULL PRIMARY KEY,
                "CreatedAt" timestamp with time zone NOT NULL,
                "UpdatedAt" timestamp with time zone NOT NULL,
                "OwnerKey" character varying(320) NOT NULL,
                "CustomerId" uuid NOT NULL,
                "Name" character varying(180) NOT NULL,
                "Description" text,
                "Category" character varying(80) NOT NULL,
                "Subcategory" character varying(80),
                "Status" character varying(40) NOT NULL,
                "StartAtUtc" timestamp with time zone,
                "DueAtUtc" timestamp with time zone,
                CONSTRAINT "FK_workspace_work_projects_workspace_customers_CustomerId"
                    FOREIGN KEY ("CustomerId") REFERENCES workspace_customers ("Id") ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS "IX_workspace_work_projects_CustomerId"
                ON workspace_work_projects ("CustomerId");
            CREATE INDEX IF NOT EXISTS "IX_workspace_work_projects_OwnerKey_Status_DueAtUtc"
                ON workspace_work_projects ("OwnerKey", "Status", "DueAtUtc");

            CREATE TABLE IF NOT EXISTS workspace_work_issues (
                "Id" uuid NOT NULL PRIMARY KEY,
                "CreatedAt" timestamp with time zone NOT NULL,
                "UpdatedAt" timestamp with time zone NOT NULL,
                "OwnerKey" character varying(320) NOT NULL,
                "CustomerId" uuid NOT NULL,
                "ProjectId" uuid,
                "Title" character varying(240) NOT NULL,
                "Description" text,
                "IssueType" character varying(40) NOT NULL,
                "Status" character varying(40) NOT NULL,
                "Priority" character varying(40) NOT NULL,
                "DueAtUtc" timestamp with time zone,
                CONSTRAINT "FK_workspace_work_issues_workspace_customers_CustomerId"
                    FOREIGN KEY ("CustomerId") REFERENCES workspace_customers ("Id") ON DELETE RESTRICT,
                CONSTRAINT "FK_workspace_work_issues_workspace_work_projects_ProjectId"
                    FOREIGN KEY ("ProjectId") REFERENCES workspace_work_projects ("Id") ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_workspace_work_issues_CustomerId"
                ON workspace_work_issues ("CustomerId");
            CREATE INDEX IF NOT EXISTS "IX_workspace_work_issues_ProjectId"
                ON workspace_work_issues ("ProjectId");
            CREATE INDEX IF NOT EXISTS "IX_workspace_work_issues_OwnerKey_Status_DueAtUtc"
                ON workspace_work_issues ("OwnerKey", "Status", "DueAtUtc");

            CREATE TABLE IF NOT EXISTS workspace_calendar_entries (
                "Id" uuid NOT NULL PRIMARY KEY,
                "CreatedAt" timestamp with time zone NOT NULL,
                "UpdatedAt" timestamp with time zone NOT NULL,
                "OwnerKey" character varying(320) NOT NULL,
                "Title" character varying(240) NOT NULL,
                "Description" text,
                "ItemType" character varying(40) NOT NULL,
                "Status" character varying(40) NOT NULL,
                "StartAtUtc" timestamp with time zone NOT NULL,
                "EndAtUtc" timestamp with time zone NOT NULL,
                "SourceTimeZone" character varying(120) NOT NULL,
                "IsAllDay" boolean NOT NULL,
                "ProjectId" uuid,
                "IssueId" uuid,
                CONSTRAINT "FK_workspace_calendar_entries_workspace_work_projects_ProjectId"
                    FOREIGN KEY ("ProjectId") REFERENCES workspace_work_projects ("Id") ON DELETE SET NULL,
                CONSTRAINT "FK_workspace_calendar_entries_workspace_work_issues_IssueId"
                    FOREIGN KEY ("IssueId") REFERENCES workspace_work_issues ("Id") ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_workspace_calendar_entries_ProjectId"
                ON workspace_calendar_entries ("ProjectId");
            CREATE INDEX IF NOT EXISTS "IX_workspace_calendar_entries_IssueId"
                ON workspace_calendar_entries ("IssueId");
            CREATE INDEX IF NOT EXISTS "IX_workspace_calendar_entries_OwnerKey_StartAtUtc"
                ON workspace_calendar_entries ("OwnerKey", "StartAtUtc");

            CREATE TABLE IF NOT EXISTS workspace_calendar_shares (
                "Id" uuid NOT NULL PRIMARY KEY,
                "CreatedAt" timestamp with time zone NOT NULL,
                "UpdatedAt" timestamp with time zone NOT NULL,
                "CalendarEntryId" uuid NOT NULL,
                "TargetType" character varying(20) NOT NULL,
                "TargetKey" character varying(320) NOT NULL,
                "TargetLabel" character varying(180) NOT NULL,
                CONSTRAINT "FK_workspace_calendar_shares_workspace_calendar_entries_CalendarEntryId"
                    FOREIGN KEY ("CalendarEntryId") REFERENCES workspace_calendar_entries ("Id") ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS "IX_workspace_calendar_shares_TargetType_TargetKey"
                ON workspace_calendar_shares ("TargetType", "TargetKey");
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_workspace_calendar_shares_CalendarEntryId_TargetType_TargetKey"
                ON workspace_calendar_shares ("CalendarEntryId", "TargetType", "TargetKey");
            """,
            cancellationToken);

            Volatile.Write(ref schemaInitialized, true);
        }
        finally
        {
            SchemaInitializationLock.Release();
        }
    }

    private static async Task<IResult> GetOverviewAsync(
        HttpContext context,
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        if (userKey is null)
        {
            return Results.Unauthorized();
        }

        if (RequireAnyAccess(
            context,
            "workspace",
            "workspace-dashboard",
            "workspace-project",
            "workspace-calendar",
            "workspace-board",
            "workspace-timeline",
            "workspace-issues",
            "workspace-bugs",
            "workspace-features",
            "workspace-customers",
            "workspace-categories") is { } accessResult)
        {
            return accessResult;
        }

        await EnsureWorkspaceManagementTablesAsync(db, cancellationToken);

        var currentAdminUser = await db.AdminUsers
            .AsNoTracking()
            .Where(user => user.Email == userKey)
            .Select(user => new { user.Id, user.DisplayName })
            .FirstOrDefaultAsync(cancellationToken);
        var groupIds = currentAdminUser is null
            ? []
            : await db.AdminGroupMembers
                .AsNoTracking()
                .Where(member =>
                    member.AdminUserId == currentAdminUser.Id &&
                    member.AdminGroup != null &&
                    member.AdminGroup.Status == "active")
                .Select(member => member.AdminGroupId)
                .ToArrayAsync(cancellationToken);
        var groupKeys = groupIds.Select(id => id.ToString()).ToArray();

        var customers = await db.WorkspaceCustomers
            .AsNoTracking()
            .Where(customer => customer.OwnerKey == userKey)
            .OrderBy(customer => customer.CompanyName)
            .Select(customer => new WorkspaceCustomerDto(
                customer.Id,
                customer.CompanyName,
                customer.ContactName,
                customer.ContactEmail,
                customer.Phone,
                customer.Projects.Count,
                customer.Issues.Count))
            .ToArrayAsync(cancellationToken);

        var projects = await db.WorkspaceWorkProjects
            .AsNoTracking()
            .Where(project => project.OwnerKey == userKey)
            .OrderBy(project => project.DueAtUtc)
            .ThenBy(project => project.Name)
            .Select(project => new WorkspaceProjectDto(
                project.Id,
                project.CustomerId,
                project.Customer!.CompanyName,
                project.Name,
                project.Description,
                project.Category,
                project.Subcategory,
                project.Status,
                project.StartAtUtc,
                project.DueAtUtc,
                project.Issues.Count(issue => issue.Status != "solved"),
                project.Issues.Count))
            .ToArrayAsync(cancellationToken);

        var issues = await db.WorkspaceWorkIssues
            .AsNoTracking()
            .Where(issue => issue.OwnerKey == userKey)
            .OrderBy(issue => issue.Status == "solved")
            .ThenBy(issue => issue.DueAtUtc)
            .ThenByDescending(issue => issue.UpdatedAt)
            .Select(issue => new WorkspaceIssueDto(
                issue.Id,
                issue.CustomerId,
                issue.Customer!.CompanyName,
                issue.ProjectId,
                issue.Project != null ? issue.Project.Name : null,
                issue.Title,
                issue.Description,
                issue.IssueType,
                issue.Status,
                issue.Priority,
                issue.DueAtUtc,
                issue.CreatedAt,
                issue.UpdatedAt))
            .ToArrayAsync(cancellationToken);

        var calendarEntries = await db.WorkspaceCalendarEntries
            .AsNoTracking()
            .Include(entry => entry.Project)
            .Include(entry => entry.Issue)
            .Include(entry => entry.Shares)
            .Where(entry =>
                entry.OwnerKey == userKey ||
                entry.Shares.Any(share => share.TargetType == "user" && share.TargetKey == userKey) ||
                entry.Shares.Any(share => share.TargetType == "group" && groupKeys.Contains(share.TargetKey)))
            .OrderBy(entry => entry.StartAtUtc)
            .ToArrayAsync(cancellationToken);

        var ownerKeys = calendarEntries
            .Select(entry => entry.OwnerKey)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var ownerNames = await db.AdminUsers
            .AsNoTracking()
            .Where(user => ownerKeys.Contains(user.Email))
            .ToDictionaryAsync(user => user.Email, user => user.DisplayName, cancellationToken);

        var users = await db.AdminUsers
            .AsNoTracking()
            .Where(user => user.Status == "active" && user.Email != userKey)
            .OrderBy(user => user.DisplayName)
            .Select(user => new WorkspaceDirectoryUserDto(user.Email, user.DisplayName))
            .ToArrayAsync(cancellationToken);
        var groups = await db.AdminGroups
            .AsNoTracking()
            .Where(group => group.Status == "active")
            .OrderBy(group => group.Name)
            .Select(group => new WorkspaceDirectoryGroupDto(group.Id.ToString(), group.Name))
            .ToArrayAsync(cancellationToken);

        return Results.Ok(new WorkspaceManagementOverviewDto(
            DateTimeOffset.UtcNow,
            customers,
            projects,
            issues,
            calendarEntries.Select(entry => ToCalendarEntryDto(entry, userKey, ownerNames)).ToArray(),
            users,
            groups,
            Categories));
    }

    private static async Task<IResult> CreateCustomerAsync(
        HttpContext context,
        SaveWorkspaceCustomerRequest request,
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        if (userKey is null)
        {
            return Results.Unauthorized();
        }

        if (RequireAnyAccess(context, "workspace", "workspace-customers", "workspace-project", "workspace-issues") is { } accessResult)
        {
            return accessResult;
        }

        if (ValidateCustomer(request) is { } validationResult)
        {
            return validationResult;
        }

        await EnsureWorkspaceManagementTablesAsync(db, cancellationToken);
        var companyName = request.CompanyName.Trim();
        var alreadyExists = await db.WorkspaceCustomers.AnyAsync(
            customer => customer.OwnerKey == userKey && customer.CompanyName.ToLower() == companyName.ToLower(),
            cancellationToken);

        if (alreadyExists)
        {
            return ValidationProblem("companyName", "A customer company with this name already exists.");
        }

        var customer = new WorkspaceCustomer
        {
            OwnerKey = userKey,
            CompanyName = companyName,
            ContactName = CleanOptional(request.ContactName),
            ContactEmail = CleanOptional(request.ContactEmail)?.ToLowerInvariant(),
            Phone = CleanOptional(request.Phone),
        };

        db.WorkspaceCustomers.Add(customer);
        AddAuditLog(db, userKey, "workspace.customer.created", nameof(WorkspaceCustomer), customer.Id);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/workspace/customers/{customer.Id}", ToCustomerDto(customer));
    }

    private static async Task<IResult> UpdateCustomerAsync(
        Guid customerId,
        HttpContext context,
        SaveWorkspaceCustomerRequest request,
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        if (userKey is null)
        {
            return Results.Unauthorized();
        }

        if (RequireAnyAccess(context, "workspace", "workspace-customers", "workspace-project", "workspace-issues") is { } accessResult)
        {
            return accessResult;
        }

        if (ValidateCustomer(request) is { } validationResult)
        {
            return validationResult;
        }

        await EnsureWorkspaceManagementTablesAsync(db, cancellationToken);
        var customer = await db.WorkspaceCustomers
            .FirstOrDefaultAsync(item => item.Id == customerId && item.OwnerKey == userKey, cancellationToken);

        if (customer is null)
        {
            return Results.NotFound();
        }

        var companyName = request.CompanyName.Trim();
        var alreadyExists = await db.WorkspaceCustomers.AnyAsync(
            item => item.Id != customerId && item.OwnerKey == userKey && item.CompanyName.ToLower() == companyName.ToLower(),
            cancellationToken);

        if (alreadyExists)
        {
            return ValidationProblem("companyName", "A customer company with this name already exists.");
        }

        customer.CompanyName = companyName;
        customer.ContactName = CleanOptional(request.ContactName);
        customer.ContactEmail = CleanOptional(request.ContactEmail)?.ToLowerInvariant();
        customer.Phone = CleanOptional(request.Phone);
        customer.UpdatedAt = DateTimeOffset.UtcNow;
        AddAuditLog(db, userKey, "workspace.customer.updated", nameof(WorkspaceCustomer), customer.Id);
        await db.SaveChangesAsync(cancellationToken);

        var projectCount = await db.WorkspaceWorkProjects.CountAsync(project => project.CustomerId == customer.Id, cancellationToken);
        var issueCount = await db.WorkspaceWorkIssues.CountAsync(issue => issue.CustomerId == customer.Id, cancellationToken);

        return Results.Ok(ToCustomerDto(customer, projectCount, issueCount));
    }

    private static async Task<IResult> CreateProjectAsync(
        HttpContext context,
        SaveWorkspaceProjectRequest request,
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        if (userKey is null)
        {
            return Results.Unauthorized();
        }

        if (RequireAnyAccess(context, "workspace", "workspace-project") is { } accessResult)
        {
            return accessResult;
        }

        if (ValidateProject(request) is { } validationResult)
        {
            return validationResult;
        }

        await EnsureWorkspaceManagementTablesAsync(db, cancellationToken);
        var customer = await FindOwnedCustomerAsync(db, request.CustomerId, userKey, cancellationToken);

        if (customer is null)
        {
            return ValidationProblem("customerId", "Select a customer company that you can access.");
        }

        var category = NormalizeCategory(request.Category)!;
        var project = new WorkspaceWorkProject
        {
            OwnerKey = userKey,
            CustomerId = customer.Id,
            Name = request.Name.Trim(),
            Description = CleanOptional(request.Description),
            Category = category,
            Subcategory = NormalizeSubcategory(category, request.Subcategory),
            Status = request.Status.ToLowerInvariant(),
            StartAtUtc = request.StartAtUtc?.ToUniversalTime(),
            DueAtUtc = request.DueAtUtc?.ToUniversalTime(),
        };

        db.WorkspaceWorkProjects.Add(project);
        AddAuditLog(db, userKey, "workspace.project.created", nameof(WorkspaceWorkProject), project.Id);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/workspace/projects/{project.Id}", ToProjectDto(project, customer.CompanyName));
    }

    private static async Task<IResult> UpdateProjectAsync(
        Guid projectId,
        HttpContext context,
        SaveWorkspaceProjectRequest request,
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        if (userKey is null)
        {
            return Results.Unauthorized();
        }

        if (RequireAnyAccess(context, "workspace", "workspace-project") is { } accessResult)
        {
            return accessResult;
        }

        if (ValidateProject(request) is { } validationResult)
        {
            return validationResult;
        }

        await EnsureWorkspaceManagementTablesAsync(db, cancellationToken);
        var project = await db.WorkspaceWorkProjects
            .FirstOrDefaultAsync(item => item.Id == projectId && item.OwnerKey == userKey, cancellationToken);
        var customer = await FindOwnedCustomerAsync(db, request.CustomerId, userKey, cancellationToken);

        if (project is null)
        {
            return Results.NotFound();
        }

        if (customer is null)
        {
            return ValidationProblem("customerId", "Select a customer company that you can access.");
        }

        var category = NormalizeCategory(request.Category)!;
        project.CustomerId = customer.Id;
        project.Name = request.Name.Trim();
        project.Description = CleanOptional(request.Description);
        project.Category = category;
        project.Subcategory = NormalizeSubcategory(category, request.Subcategory);
        project.Status = request.Status.ToLowerInvariant();
        project.StartAtUtc = request.StartAtUtc?.ToUniversalTime();
        project.DueAtUtc = request.DueAtUtc?.ToUniversalTime();
        project.UpdatedAt = DateTimeOffset.UtcNow;
        var linkedIssues = await db.WorkspaceWorkIssues
            .Where(issue => issue.ProjectId == project.Id && issue.OwnerKey == userKey)
            .ToArrayAsync(cancellationToken);

        foreach (var linkedIssue in linkedIssues)
        {
            linkedIssue.CustomerId = customer.Id;
            linkedIssue.UpdatedAt = project.UpdatedAt;
        }

        AddAuditLog(db, userKey, "workspace.project.updated", nameof(WorkspaceWorkProject), project.Id);
        await db.SaveChangesAsync(cancellationToken);

        var issueCounts = await db.WorkspaceWorkIssues
            .Where(issue => issue.ProjectId == project.Id)
            .GroupBy(_ => 1)
            .Select(group => new
            {
                Open = group.Count(issue => issue.Status != "solved"),
                Total = group.Count(),
            })
            .FirstOrDefaultAsync(cancellationToken);

        return Results.Ok(ToProjectDto(project, customer.CompanyName, issueCounts?.Open ?? 0, issueCounts?.Total ?? 0));
    }

    private static async Task<IResult> CreateIssueAsync(
        HttpContext context,
        SaveWorkspaceIssueRequest request,
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        if (userKey is null)
        {
            return Results.Unauthorized();
        }

        if (RequireAnyAccess(context, "workspace", "workspace-board", "workspace-issues", "workspace-bugs", "workspace-features") is { } accessResult)
        {
            return accessResult;
        }

        if (ValidateIssue(request) is { } validationResult)
        {
            return validationResult;
        }

        await EnsureWorkspaceManagementTablesAsync(db, cancellationToken);
        var relationship = await ValidateIssueRelationshipAsync(db, request.CustomerId, request.ProjectId, userKey, cancellationToken);

        if (relationship.Error is not null)
        {
            return relationship.Error;
        }

        var issue = new WorkspaceWorkIssue
        {
            OwnerKey = userKey,
            CustomerId = relationship.Customer!.Id,
            ProjectId = relationship.Project?.Id,
            Title = request.Title.Trim(),
            Description = CleanOptional(request.Description),
            IssueType = request.IssueType.ToLowerInvariant(),
            Status = request.Status.ToLowerInvariant(),
            Priority = request.Priority.ToLowerInvariant(),
            DueAtUtc = request.DueAtUtc?.ToUniversalTime(),
        };

        db.WorkspaceWorkIssues.Add(issue);
        AddAuditLog(db, userKey, "workspace.issue.created", nameof(WorkspaceWorkIssue), issue.Id);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created(
            $"/api/workspace/issues/{issue.Id}",
            ToIssueDto(issue, relationship.Customer.CompanyName, relationship.Project?.Name));
    }

    private static async Task<IResult> UpdateIssueAsync(
        Guid issueId,
        HttpContext context,
        SaveWorkspaceIssueRequest request,
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        if (userKey is null)
        {
            return Results.Unauthorized();
        }

        if (RequireAnyAccess(context, "workspace", "workspace-board", "workspace-issues", "workspace-bugs", "workspace-features") is { } accessResult)
        {
            return accessResult;
        }

        if (ValidateIssue(request) is { } validationResult)
        {
            return validationResult;
        }

        await EnsureWorkspaceManagementTablesAsync(db, cancellationToken);
        var issue = await db.WorkspaceWorkIssues
            .FirstOrDefaultAsync(item => item.Id == issueId && item.OwnerKey == userKey, cancellationToken);

        if (issue is null)
        {
            return Results.NotFound();
        }

        var relationship = await ValidateIssueRelationshipAsync(db, request.CustomerId, request.ProjectId, userKey, cancellationToken);

        if (relationship.Error is not null)
        {
            return relationship.Error;
        }

        issue.CustomerId = relationship.Customer!.Id;
        issue.ProjectId = relationship.Project?.Id;
        issue.Title = request.Title.Trim();
        issue.Description = CleanOptional(request.Description);
        issue.IssueType = request.IssueType.ToLowerInvariant();
        issue.Status = request.Status.ToLowerInvariant();
        issue.Priority = request.Priority.ToLowerInvariant();
        issue.DueAtUtc = request.DueAtUtc?.ToUniversalTime();
        issue.UpdatedAt = DateTimeOffset.UtcNow;
        AddAuditLog(db, userKey, "workspace.issue.updated", nameof(WorkspaceWorkIssue), issue.Id);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToIssueDto(issue, relationship.Customer.CompanyName, relationship.Project?.Name));
    }

    private static async Task<IResult> UpdateIssueStatusAsync(
        Guid issueId,
        HttpContext context,
        UpdateWorkspaceIssueStatusRequest request,
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);
        var status = request.Status?.Trim().ToLowerInvariant();

        if (userKey is null)
        {
            return Results.Unauthorized();
        }

        if (RequireAnyAccess(context, "workspace", "workspace-board", "workspace-issues", "workspace-bugs", "workspace-features") is { } accessResult)
        {
            return accessResult;
        }

        if (!IssueStatuses.Contains(status))
        {
            return ValidationProblem("status", "Status must be todo, doing, waiting, or solved.");
        }

        await EnsureWorkspaceManagementTablesAsync(db, cancellationToken);
        var issue = await db.WorkspaceWorkIssues
            .Include(item => item.Customer)
            .Include(item => item.Project)
            .FirstOrDefaultAsync(item => item.Id == issueId && item.OwnerKey == userKey, cancellationToken);

        if (issue is null)
        {
            return Results.NotFound();
        }

        issue.Status = status!;
        issue.UpdatedAt = DateTimeOffset.UtcNow;
        AddAuditLog(db, userKey, "workspace.issue.status_changed", nameof(WorkspaceWorkIssue), issue.Id, new { status });
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToIssueDto(issue, issue.Customer!.CompanyName, issue.Project?.Name));
    }

    private static async Task<IResult> CreateCalendarEntryAsync(
        HttpContext context,
        SaveWorkspaceCalendarEntryRequest request,
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        if (userKey is null)
        {
            return Results.Unauthorized();
        }

        if (RequirePermission(context, "workspace-manage-calendar") is { } permissionResult)
        {
            return permissionResult;
        }

        if (ValidateCalendarEntry(request) is { } validationResult)
        {
            return validationResult;
        }

        await EnsureWorkspaceManagementTablesAsync(db, cancellationToken);
        var relationship = await ValidateCalendarRelationshipAsync(db, request.ProjectId, request.IssueId, userKey, cancellationToken);

        if (relationship.Error is not null)
        {
            return relationship.Error;
        }

        var shares = await NormalizeSharesAsync(db, request.Shares, userKey, cancellationToken);

        if (shares.Error is not null)
        {
            return shares.Error;
        }

        var entry = new WorkspaceCalendarEntry
        {
            OwnerKey = userKey,
            Title = request.Title.Trim(),
            Description = CleanOptional(request.Description),
            ItemType = request.ItemType.ToLowerInvariant(),
            Status = string.IsNullOrWhiteSpace(request.Status) ? "scheduled" : request.Status.Trim().ToLowerInvariant(),
            StartAtUtc = request.StartAtUtc.ToUniversalTime(),
            EndAtUtc = request.EndAtUtc.ToUniversalTime(),
            SourceTimeZone = request.SourceTimeZone.Trim(),
            IsAllDay = request.IsAllDay,
            ProjectId = relationship.Project?.Id,
            IssueId = relationship.Issue?.Id,
            Shares = shares.Items!,
        };

        db.WorkspaceCalendarEntries.Add(entry);
        AddAuditLog(db, userKey, "workspace.calendar.created", nameof(WorkspaceCalendarEntry), entry.Id, new { shareCount = entry.Shares.Count });
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created(
            $"/api/workspace/calendar-items/{entry.Id}",
            ToCalendarEntryDto(entry, userKey, new Dictionary<string, string> { [userKey] = GetDisplayName(context, userKey) }, relationship.Project?.Name, relationship.Issue?.Title));
    }

    private static async Task<IResult> UpdateCalendarEntryAsync(
        Guid entryId,
        HttpContext context,
        SaveWorkspaceCalendarEntryRequest request,
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        if (userKey is null)
        {
            return Results.Unauthorized();
        }

        if (RequirePermission(context, "workspace-manage-calendar") is { } permissionResult)
        {
            return permissionResult;
        }

        if (ValidateCalendarEntry(request) is { } validationResult)
        {
            return validationResult;
        }

        await EnsureWorkspaceManagementTablesAsync(db, cancellationToken);
        var entry = await db.WorkspaceCalendarEntries
            .Include(item => item.Shares)
            .FirstOrDefaultAsync(item => item.Id == entryId && item.OwnerKey == userKey, cancellationToken);

        if (entry is null)
        {
            return Results.NotFound();
        }

        var relationship = await ValidateCalendarRelationshipAsync(db, request.ProjectId, request.IssueId, userKey, cancellationToken);

        if (relationship.Error is not null)
        {
            return relationship.Error;
        }

        var shares = await NormalizeSharesAsync(db, request.Shares, userKey, cancellationToken);

        if (shares.Error is not null)
        {
            return shares.Error;
        }

        var previousShares = entry.Shares.ToArray();
        db.WorkspaceCalendarShares.RemoveRange(previousShares);
        entry.Title = request.Title.Trim();
        entry.Description = CleanOptional(request.Description);
        entry.ItemType = request.ItemType.ToLowerInvariant();
        entry.Status = string.IsNullOrWhiteSpace(request.Status) ? "scheduled" : request.Status.Trim().ToLowerInvariant();
        entry.StartAtUtc = request.StartAtUtc.ToUniversalTime();
        entry.EndAtUtc = request.EndAtUtc.ToUniversalTime();
        entry.SourceTimeZone = request.SourceTimeZone.Trim();
        entry.IsAllDay = request.IsAllDay;
        entry.ProjectId = relationship.Project?.Id;
        entry.IssueId = relationship.Issue?.Id;
        entry.Shares = shares.Items!;
        foreach (var share in entry.Shares)
        {
            share.CalendarEntryId = entry.Id;
        }
        db.WorkspaceCalendarShares.AddRange(entry.Shares);
        entry.UpdatedAt = DateTimeOffset.UtcNow;
        AddAuditLog(db, userKey, "workspace.calendar.updated", nameof(WorkspaceCalendarEntry), entry.Id, new { shareCount = entry.Shares.Count });
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToCalendarEntryDto(
            entry,
            userKey,
            new Dictionary<string, string> { [userKey] = GetDisplayName(context, userKey) },
            relationship.Project?.Name,
            relationship.Issue?.Title));
    }

    private static async Task<IResult> DeleteCalendarEntryAsync(
        Guid entryId,
        HttpContext context,
        IncosWorkspaceDbContext db,
        CancellationToken cancellationToken)
    {
        var userKey = GetUserKey(context);

        if (userKey is null)
        {
            return Results.Unauthorized();
        }

        if (RequirePermission(context, "workspace-manage-calendar") is { } permissionResult)
        {
            return permissionResult;
        }

        await EnsureWorkspaceManagementTablesAsync(db, cancellationToken);
        var entry = await db.WorkspaceCalendarEntries
            .FirstOrDefaultAsync(item => item.Id == entryId && item.OwnerKey == userKey, cancellationToken);

        if (entry is null)
        {
            return Results.NotFound();
        }

        db.WorkspaceCalendarEntries.Remove(entry);
        AddAuditLog(db, userKey, "workspace.calendar.deleted", nameof(WorkspaceCalendarEntry), entry.Id);
        await db.SaveChangesAsync(cancellationToken);

        return Results.NoContent();
    }

    private static IResult? ValidateCustomer(SaveWorkspaceCustomerRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.CompanyName) || request.CompanyName.Trim().Length > 180)
        {
            return ValidationProblem("companyName", "Company name is required and must be 180 characters or fewer.");
        }

        if (CleanOptional(request.ContactEmail) is { } email && (!email.Contains('@') || email.Length > 320))
        {
            return ValidationProblem("contactEmail", "Enter a valid contact email address.");
        }

        if (CleanOptional(request.ContactName)?.Length > 160)
        {
            return ValidationProblem("contactName", "Contact name must be 160 characters or fewer.");
        }

        if (CleanOptional(request.Phone)?.Length > 80)
        {
            return ValidationProblem("phone", "Phone must be 80 characters or fewer.");
        }

        return null;
    }

    private static IResult? ValidateProject(SaveWorkspaceProjectRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 180)
        {
            return ValidationProblem("name", "Project name is required and must be 180 characters or fewer.");
        }

        var category = NormalizeCategory(request.Category);

        if (category is null)
        {
            return ValidationProblem("category", "Category must be TopSolid, Eureka, or Boxcon.");
        }

        if (category == "TopSolid" && NormalizeSubcategory(category, request.Subcategory) is null)
        {
            return ValidationProblem("subcategory", "TopSolid projects must select CAM or Mold.");
        }

        if (!ProjectStatuses.Contains(request.Status?.Trim().ToLowerInvariant()))
        {
            return ValidationProblem("status", "Status must be planned, active, waiting, or completed.");
        }

        if (request.StartAtUtc is not null && request.DueAtUtc is not null && request.DueAtUtc < request.StartAtUtc)
        {
            return ValidationProblem("dueAtUtc", "Project due date cannot be before its start date.");
        }

        if (CleanOptional(request.Description)?.Length > 10_000)
        {
            return ValidationProblem("description", "Project description must be 10,000 characters or fewer.");
        }

        return null;
    }

    private static IResult? ValidateIssue(SaveWorkspaceIssueRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Trim().Length > 240)
        {
            return ValidationProblem("title", "Issue title is required and must be 240 characters or fewer.");
        }

        if (!IssueTypes.Contains(request.IssueType?.Trim().ToLowerInvariant()))
        {
            return ValidationProblem("issueType", "Type must be issue, request, task, or meeting.");
        }

        if (!IssueStatuses.Contains(request.Status?.Trim().ToLowerInvariant()))
        {
            return ValidationProblem("status", "Status must be todo, doing, waiting, or solved.");
        }

        if (!Priorities.Contains(request.Priority?.Trim().ToLowerInvariant()))
        {
            return ValidationProblem("priority", "Priority must be low, normal, high, or urgent.");
        }

        if (CleanOptional(request.Description)?.Length > 10_000)
        {
            return ValidationProblem("description", "Issue description must be 10,000 characters or fewer.");
        }

        return null;
    }

    private static IResult? ValidateCalendarEntry(SaveWorkspaceCalendarEntryRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Trim().Length > 240)
        {
            return ValidationProblem("title", "Calendar title is required and must be 240 characters or fewer.");
        }

        if (!CalendarItemTypes.Contains(request.ItemType?.Trim().ToLowerInvariant()))
        {
            return ValidationProblem("itemType", "Type must be work, meeting, deadline, or follow-up.");
        }

        if (!CalendarStatuses.Contains(request.Status?.Trim().ToLowerInvariant()))
        {
            return ValidationProblem("status", "Status must be scheduled, completed, or cancelled.");
        }

        if (request.EndAtUtc <= request.StartAtUtc)
        {
            return ValidationProblem("endAtUtc", "End time must be after start time.");
        }

        if (string.IsNullOrWhiteSpace(request.SourceTimeZone) || request.SourceTimeZone.Length > 120)
        {
            return ValidationProblem("sourceTimeZone", "A valid display time zone is required.");
        }

        try
        {
            _ = TimeZoneInfo.FindSystemTimeZoneById(request.SourceTimeZone.Trim());
        }
        catch (TimeZoneNotFoundException)
        {
            return ValidationProblem("sourceTimeZone", "The selected time zone is not supported by this server.");
        }
        catch (InvalidTimeZoneException)
        {
            return ValidationProblem("sourceTimeZone", "The selected time zone is invalid.");
        }

        if (CleanOptional(request.Description)?.Length > 10_000)
        {
            return ValidationProblem("description", "Calendar description must be 10,000 characters or fewer.");
        }

        if ((request.Shares?.Length ?? 0) > 50)
        {
            return ValidationProblem("shares", "A calendar item can be shared with at most 50 users or groups.");
        }

        return null;
    }

    private static async Task<(WorkspaceCustomer? Customer, WorkspaceWorkProject? Project, IResult? Error)> ValidateIssueRelationshipAsync(
        IncosWorkspaceDbContext db,
        Guid customerId,
        Guid? projectId,
        string userKey,
        CancellationToken cancellationToken)
    {
        var customer = await FindOwnedCustomerAsync(db, customerId, userKey, cancellationToken);

        if (customer is null)
        {
            return (null, null, ValidationProblem("customerId", "Select a customer company that you can access."));
        }

        if (projectId is null)
        {
            return (customer, null, null);
        }

        var project = await db.WorkspaceWorkProjects
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == projectId && item.OwnerKey == userKey, cancellationToken);

        if (project is null)
        {
            return (customer, null, ValidationProblem("projectId", "Select a project that you can access, or leave it blank for a standalone issue."));
        }

        if (project.CustomerId != customer.Id)
        {
            return (customer, project, ValidationProblem("customerId", "The issue customer must match the selected project's customer."));
        }

        return (customer, project, null);
    }

    private static async Task<(WorkspaceWorkProject? Project, WorkspaceWorkIssue? Issue, IResult? Error)> ValidateCalendarRelationshipAsync(
        IncosWorkspaceDbContext db,
        Guid? projectId,
        Guid? issueId,
        string userKey,
        CancellationToken cancellationToken)
    {
        WorkspaceWorkProject? project = null;
        WorkspaceWorkIssue? issue = null;

        if (projectId is not null)
        {
            project = await db.WorkspaceWorkProjects
                .AsNoTracking()
                .FirstOrDefaultAsync(item => item.Id == projectId && item.OwnerKey == userKey, cancellationToken);

            if (project is null)
            {
                return (null, null, ValidationProblem("projectId", "Select a project that you can access."));
            }
        }

        if (issueId is not null)
        {
            issue = await db.WorkspaceWorkIssues
                .AsNoTracking()
                .FirstOrDefaultAsync(item => item.Id == issueId && item.OwnerKey == userKey, cancellationToken);

            if (issue is null)
            {
                return (project, null, ValidationProblem("issueId", "Select an issue that you can access."));
            }

            if (project is not null && issue.ProjectId != project.Id)
            {
                return (project, issue, ValidationProblem("issueId", "The selected issue does not belong to the selected project."));
            }

            project ??= issue.ProjectId is null
                ? null
                : await db.WorkspaceWorkProjects.AsNoTracking().FirstOrDefaultAsync(item => item.Id == issue.ProjectId, cancellationToken);
        }

        return (project, issue, null);
    }

    private static async Task<(List<WorkspaceCalendarShare>? Items, IResult? Error)> NormalizeSharesAsync(
        IncosWorkspaceDbContext db,
        WorkspaceCalendarShareDto[]? requestedShares,
        string userKey,
        CancellationToken cancellationToken)
    {
        var requested = (requestedShares ?? [])
            .OfType<WorkspaceCalendarShareDto>()
            .Where(share =>
                !string.IsNullOrWhiteSpace(share.TargetType) &&
                !string.IsNullOrWhiteSpace(share.TargetKey))
            .Select(share => new
            {
                Type = share.TargetType.Trim().ToLowerInvariant(),
                Key = share.TargetKey.Trim(),
            })
            .DistinctBy(share => $"{share.Type}:{share.Key}", StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var userKeys = requested
            .Where(share => share.Type == "user")
            .Select(share => share.Key.ToLowerInvariant())
            .Where(key => key != userKey)
            .ToArray();
        var groupKeys = requested
            .Where(share => share.Type == "group")
            .Select(share => share.Key)
            .ToArray();

        if (requested.Any(share => share.Type is not "user" and not "group"))
        {
            return (null, ValidationProblem("shares", "Share targets must be users or groups."));
        }

        var parsedGroupIds = new List<Guid>();
        foreach (var groupKey in groupKeys)
        {
            if (!Guid.TryParse(groupKey, out var groupId))
            {
                return (null, ValidationProblem("shares", "One or more selected groups are invalid."));
            }

            parsedGroupIds.Add(groupId);
        }

        var validUsers = await db.AdminUsers
            .AsNoTracking()
            .Where(user => user.Status == "active" && userKeys.Contains(user.Email))
            .Select(user => new { user.Email, user.DisplayName })
            .ToArrayAsync(cancellationToken);
        var validGroupRecords = await db.AdminGroups
            .AsNoTracking()
            .Where(group => group.Status == "active" && parsedGroupIds.Contains(group.Id))
            .Select(group => new { group.Id, group.Name })
            .ToArrayAsync(cancellationToken);
        var validGroups = validGroupRecords
            .Select(group => new { Key = group.Id.ToString(), group.Name })
            .ToArray();

        if (validUsers.Length != userKeys.Distinct(StringComparer.OrdinalIgnoreCase).Count())
        {
            return (null, ValidationProblem("shares", "One or more selected users are unavailable."));
        }

        if (validGroups.Length != groupKeys.Distinct(StringComparer.OrdinalIgnoreCase).Count())
        {
            return (null, ValidationProblem("shares", "One or more selected groups are unavailable."));
        }

        var now = DateTimeOffset.UtcNow;
        var shares = validUsers
            .Select(user => new WorkspaceCalendarShare
            {
                CreatedAt = now,
                UpdatedAt = now,
                TargetType = "user",
                TargetKey = user.Email.ToLowerInvariant(),
                TargetLabel = user.DisplayName,
            })
            .Concat(validGroups.Select(group => new WorkspaceCalendarShare
            {
                CreatedAt = now,
                UpdatedAt = now,
                TargetType = "group",
                TargetKey = group.Key,
                TargetLabel = group.Name,
            }))
            .ToList();

        return (shares, null);
    }

    private static Task<WorkspaceCustomer?> FindOwnedCustomerAsync(
        IncosWorkspaceDbContext db,
        Guid customerId,
        string userKey,
        CancellationToken cancellationToken) =>
        db.WorkspaceCustomers
            .AsNoTracking()
            .FirstOrDefaultAsync(customer => customer.Id == customerId && customer.OwnerKey == userKey, cancellationToken);

    private static WorkspaceCustomerDto ToCustomerDto(WorkspaceCustomer customer, int projectCount = 0, int issueCount = 0) =>
        new(customer.Id, customer.CompanyName, customer.ContactName, customer.ContactEmail, customer.Phone, projectCount, issueCount);

    private static WorkspaceProjectDto ToProjectDto(
        WorkspaceWorkProject project,
        string customerCompany,
        int openIssueCount = 0,
        int totalIssueCount = 0) =>
        new(
            project.Id,
            project.CustomerId,
            customerCompany,
            project.Name,
            project.Description,
            project.Category,
            project.Subcategory,
            project.Status,
            project.StartAtUtc,
            project.DueAtUtc,
            openIssueCount,
            totalIssueCount);

    private static WorkspaceIssueDto ToIssueDto(
        WorkspaceWorkIssue issue,
        string customerCompany,
        string? projectName) =>
        new(
            issue.Id,
            issue.CustomerId,
            customerCompany,
            issue.ProjectId,
            projectName,
            issue.Title,
            issue.Description,
            issue.IssueType,
            issue.Status,
            issue.Priority,
            issue.DueAtUtc,
            issue.CreatedAt,
            issue.UpdatedAt);

    private static WorkspaceCalendarEntryDto ToCalendarEntryDto(
        WorkspaceCalendarEntry entry,
        string userKey,
        IReadOnlyDictionary<string, string> ownerNames,
        string? projectName = null,
        string? issueTitle = null) =>
        new(
            entry.Id,
            entry.Title,
            entry.Description,
            entry.ItemType,
            entry.Status,
            entry.StartAtUtc,
            entry.EndAtUtc,
            entry.SourceTimeZone,
            entry.IsAllDay,
            entry.ProjectId,
            projectName ?? entry.Project?.Name,
            entry.IssueId,
            issueTitle ?? entry.Issue?.Title,
            ownerNames.TryGetValue(entry.OwnerKey, out var ownerName) ? ownerName : entry.OwnerKey,
            string.Equals(entry.OwnerKey, userKey, StringComparison.OrdinalIgnoreCase),
            entry.Shares
                .OrderBy(share => share.TargetType)
                .ThenBy(share => share.TargetLabel)
                .Select(share => new WorkspaceCalendarShareDto(share.TargetType, share.TargetKey, share.TargetLabel))
                .ToArray());

    private static string? NormalizeCategory(string? category) =>
        Categories
            .Select(item => item.Name)
            .FirstOrDefault(item => string.Equals(item, category?.Trim(), StringComparison.OrdinalIgnoreCase));

    private static string? NormalizeSubcategory(string category, string? subcategory)
    {
        if (category != "TopSolid")
        {
            return null;
        }

        return Categories[0].Children.FirstOrDefault(
            item => string.Equals(item, subcategory?.Trim(), StringComparison.OrdinalIgnoreCase));
    }

    private static string? CleanOptional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string? GetUserKey(HttpContext context)
    {
        var email = context.User.FindFirstValue(ClaimTypes.Email);

        return string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant();
    }

    private static string GetDisplayName(HttpContext context, string fallback) =>
        context.User.FindFirstValue(ClaimTypes.Name)?.Trim() is { Length: > 0 } name ? name : fallback;

    private static IResult? RequireAnyAccess(HttpContext context, params string[] allowedAccess)
    {
        var assignedAccess = GetAssignedGrants(context, "Incos.Workspace.Access");

        return assignedAccess.Any(value => allowedAccess.Contains(value, StringComparer.OrdinalIgnoreCase))
            ? null
            : Results.Problem(
                title: "Workspace access not assigned.",
                detail: "Your account cannot manage this Workspace resource.",
                statusCode: StatusCodes.Status403Forbidden);
    }

    private static IResult? RequirePermission(HttpContext context, string requiredPermission)
    {
        var assignedPermissions = GetAssignedGrants(context, "Incos.Workspace.Permissions");

        return assignedPermissions.Contains(requiredPermission, StringComparer.OrdinalIgnoreCase)
            ? null
            : Results.Problem(
                title: "Workspace permission required.",
                detail: "Your account can view this calendar but cannot manage calendar items.",
                statusCode: StatusCodes.Status403Forbidden);
    }

    private static string[] GetAssignedGrants(HttpContext context, string key) =>
        context.Items.TryGetValue(key, out var value) && value is IEnumerable<string> grants
            ? grants.ToArray()
            : [];

    private static IResult ValidationProblem(string key, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [key] = [message] });

    private static void AddAuditLog(
        IncosWorkspaceDbContext db,
        string actorUserId,
        string action,
        string entityType,
        Guid entityId,
        object? metadata = null) =>
        db.AuditLogs.Add(new AuditLog
        {
            ActorUserId = actorUserId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            MetadataJson = metadata is null ? "{}" : JsonSerializer.Serialize(metadata),
        });
}
