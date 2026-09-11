using System.Data.Common;
using System.Security.Claims;
using CanvasToDo.Api.Data;
using CanvasToDo.Api.Domain.Identity;
using Microsoft.EntityFrameworkCore;

namespace CanvasToDo.Api.Infrastructure;

public static class UserActivityTracking
{
    public static async Task TrackAsync(HttpContext context, RequestDelegate next)
    {
        // Record the real actor before administrator data handlers substitute a target.
        // Authentication and health probes do not represent app activity.
        if (context.User.Identity?.IsAuthenticated == true &&
            context.Request.Path.StartsWithSegments("/api") &&
            !context.Request.Path.StartsWithSegments("/api/auth") &&
            !context.Request.Path.StartsWithSegments("/api/health") &&
            context.GetEndpoint() is not null &&
            Guid.TryParse(context.User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
        {
            var now = DateTimeOffset.UtcNow;
            var cutoff = now.AddMinutes(-1);
            try
            {
                var db = context.RequestServices.GetRequiredService<AuthDbContext>();
                // Atomic conditional update limits writes and prevents concurrent older
                // requests from moving the timestamp backwards. No Identity fields change.
                await db.Users.Where(user => user.Id == userId && user.Status == UserStatuses.Active &&
                        (user.LastActiveAt == null || user.LastActiveAt < cutoff))
                    .ExecuteUpdateAsync(update => update.SetProperty(user => user.LastActiveAt, now), context.RequestAborted);
            }
            catch (Exception exception) when (exception is DbException or DbUpdateException or TimeoutException)
            {
                context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("UserActivityTracking")
                    .LogWarning(exception, "Unable to record activity for user {UserId}.", userId);
            }
        }

        await next(context);
    }
}
