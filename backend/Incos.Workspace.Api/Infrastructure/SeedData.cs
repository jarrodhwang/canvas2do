using Incos.Workspace.Api.Data;
using Incos.Workspace.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Incos.Workspace.Api.Infrastructure;

public static class SeedData
{
    public static async Task SeedAsync(IncosWorkspaceDbContext db, CancellationToken cancellationToken = default)
    {
        if (await db.WorkspaceModes.AnyAsync(cancellationToken))
        {
            return;
        }

        var academy = new WorkspaceMode
        {
            ModeKey = "academy",
            DisplayName = "Academy",
            Icon = "graduation-cap",
            Purpose = "Manage school, study, courses, lectures, assignments, quizzes, exams, routines, and notes.",
            AccentPrimary = "#3757d8",
            AccentSecondary = "#7b61ff",
            Enabled = true,
        };

        var project = new WorkspaceMode
        {
            ModeKey = "project",
            DisplayName = "Workspace",
            Icon = "rocket",
            Purpose = "Manage workspace work, development todos, bugs, features, customer requests, and timelines.",
            AccentPrimary = "#0f8f95",
            AccentSecondary = "#3757d8",
            Enabled = true,
        };

        var adminConsole = new WorkspaceMode
        {
            ModeKey = "admin-console",
            DisplayName = "Admin Console",
            Icon = "settings",
            Purpose = "Manage users, workspace modes, integrations, permissions, audit logs, and system settings.",
            AccentPrimary = "#8a5a00",
            AccentSecondary = "#4b5563",
            Enabled = true,
        };

        var support = new WorkspaceMode
        {
            ModeKey = "support",
            DisplayName = "Support CRM",
            Icon = "life-buoy",
            Purpose = "Future customer support and reseller communication workflow mode.",
            AccentPrimary = "#2d6a4f",
            AccentSecondary = "#0f8f95",
            Enabled = false,
            Hidden = true,
        };

        db.WorkspaceModes.AddRange(academy, project, adminConsole, support);

        db.CalendarItems.AddRange(
            new CalendarItem
            {
                WorkspaceMode = academy,
                Type = "assignment",
                Title = "CS101 Assignment 1",
                Description = "Start-to-due assignment timeline with checklist, notes, and links.",
                Status = "doing",
                Priority = "high",
                StartAt = new DateTimeOffset(2026, 5, 6, 9, 0, 0, TimeSpan.Zero),
                DueAt = new DateTimeOffset(2026, 5, 10, 23, 59, 0, TimeSpan.Zero),
                RelatedEntityType = "assignment",
            },
            new CalendarItem
            {
                WorkspaceMode = project,
                Type = "bug",
                Title = "Login Bug on Mobile",
                Description = "Bug issue linked to customer, category, colleague, and meeting link.",
                Status = "doing",
                Priority = "high",
                StartAt = new DateTimeOffset(2026, 5, 12, 9, 0, 0, TimeSpan.Zero),
                DueAt = new DateTimeOffset(2026, 5, 15, 17, 0, 0, TimeSpan.Zero),
                RelatedEntityType = "issue",
            });

        await db.SaveChangesAsync(cancellationToken);
    }
}
