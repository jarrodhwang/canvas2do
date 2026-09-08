using System.Security.Claims;

namespace CanvasToDo.Api.Infrastructure;

public static class UserOwnerKeys
{
    public static string FromId(Guid userId) => $"user:{userId:D}";

    public static string? FromPrincipal(ClaimsPrincipal principal)
    {
        var subject = principal.FindFirstValue(ClaimTypes.NameIdentifier);

        return Guid.TryParse(subject, out var userId)
            ? FromId(userId)
            : null;
    }
}
