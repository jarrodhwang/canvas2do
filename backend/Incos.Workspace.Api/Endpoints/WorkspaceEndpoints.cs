using Incos.Workspace.Api.Contracts;
using Incos.Workspace.Api.Data;
using Incos.Workspace.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Incos.Workspace.Api.Endpoints;

public static class WorkspaceEndpoints
{
    public static IEndpointRouteBuilder MapWorkspaceEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/health", () => Results.Ok(new { service = "Incos Workspace API", status = "ok" }))
            .WithName("Health");

        api.MapGet("/images/config", () =>
                Results.Ok(new StaticImageConfigDto(
                    "/static/images",
                    "/var/www/incos-static/images",
                    [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"])))
            .WithName("GetStaticImageConfig");

        var workspaceApi = api.MapGroup("")
            .RequireAuthorization();

        workspaceApi.MapGet("/image-assets", async (IncosWorkspaceDbContext db) =>
            await db.ImageAssets
                .AsNoTracking()
                .OrderByDescending(image => image.CreatedAt)
                .Select(image => new ImageAssetDto(
                    image.Id,
                    image.OwnerType,
                    image.OwnerId,
                    image.FileName,
                    image.FileExtension,
                    image.MimeType,
                    image.StoragePath,
                    image.PublicUrl,
                    image.SizeBytes))
                .ToListAsync())
            .WithName("GetImageAssets");

        workspaceApi.MapPost("/image-assets", async (
                CreateImageAssetRequest request,
                IncosWorkspaceDbContext db) =>
            {
                var image = new ImageAsset
                {
                    OwnerType = request.OwnerType,
                    OwnerId = request.OwnerId,
                    FileName = request.FileName,
                    FileExtension = request.FileExtension.StartsWith('.')
                        ? request.FileExtension.ToLowerInvariant()
                        : $".{request.FileExtension.ToLowerInvariant()}",
                    MimeType = request.MimeType,
                    StoragePath = request.StoragePath,
                    PublicUrl = request.PublicUrl,
                    SizeBytes = request.SizeBytes,
                };

                db.ImageAssets.Add(image);
                await db.SaveChangesAsync();

                var dto = new ImageAssetDto(
                    image.Id,
                    image.OwnerType,
                    image.OwnerId,
                    image.FileName,
                    image.FileExtension,
                    image.MimeType,
                    image.StoragePath,
                    image.PublicUrl,
                    image.SizeBytes);

                return Results.Created($"/api/image-assets/{image.Id}", dto);
            })
            .WithName("CreateImageAsset");

        workspaceApi.MapGet("/workspace-modes", async (IncosWorkspaceDbContext db) =>
            await db.WorkspaceModes
                .AsNoTracking()
                .OrderBy(mode => mode.DisplayName)
                .Select(mode => new WorkspaceModeDto(
                    mode.Id,
                    mode.ModeKey,
                    mode.DisplayName,
                    mode.Icon,
                    mode.Purpose,
                    mode.AccentPrimary,
                    mode.AccentSecondary,
                    mode.Enabled,
                    mode.Hidden))
                .ToListAsync())
            .WithName("GetWorkspaceModes");

        workspaceApi.MapGet("/workspace-modes/{modeKey}/calendar-items", async (
                string modeKey,
                IncosWorkspaceDbContext db) =>
            {
                var mode = await db.WorkspaceModes
                    .AsNoTracking()
                    .FirstOrDefaultAsync(workspaceMode => workspaceMode.ModeKey == modeKey);

                if (mode is null)
                {
                    return Results.NotFound();
                }

                var items = await db.CalendarItems
                    .AsNoTracking()
                    .Where(item => item.WorkspaceModeId == mode.Id)
                    .OrderBy(item => item.StartAt ?? item.DueAt ?? item.CreatedAt)
                    .Select(item => new CalendarItemDto(
                        item.Id,
                        mode.ModeKey,
                        item.Type,
                        item.Title,
                        item.Description,
                        item.Status,
                        item.Priority,
                        item.StartAt,
                        item.EndAt,
                        item.DueAt,
                        item.RelatedEntityType,
                        item.RelatedEntityId))
                    .ToListAsync();

                return Results.Ok(items);
            })
            .WithName("GetCalendarItemsForMode");

        workspaceApi.MapPost("/workspace-modes/{modeKey}/calendar-items", async (
                string modeKey,
                CreateCalendarItemRequest request,
                IncosWorkspaceDbContext db) =>
            {
                var mode = await db.WorkspaceModes.FirstOrDefaultAsync(workspaceMode =>
                    workspaceMode.ModeKey == modeKey);

                if (mode is null)
                {
                    return Results.NotFound();
                }

                var item = new CalendarItem
                {
                    WorkspaceModeId = mode.Id,
                    Type = request.Type,
                    Title = request.Title,
                    Description = request.Description,
                    Status = request.Status ?? "open",
                    Priority = request.Priority ?? "normal",
                    StartAt = request.StartAt,
                    EndAt = request.EndAt,
                    DueAt = request.DueAt,
                    RelatedEntityType = request.RelatedEntityType,
                    RelatedEntityId = request.RelatedEntityId,
                };

                db.CalendarItems.Add(item);
                await db.SaveChangesAsync();

                var dto = new CalendarItemDto(
                    item.Id,
                    mode.ModeKey,
                    item.Type,
                    item.Title,
                    item.Description,
                    item.Status,
                    item.Priority,
                    item.StartAt,
                    item.EndAt,
                    item.DueAt,
                    item.RelatedEntityType,
                    item.RelatedEntityId);

                return Results.Created($"/api/workspace-modes/{modeKey}/calendar-items/{item.Id}", dto);
            })
            .WithName("CreateCalendarItemForMode");

        return app;
    }
}
