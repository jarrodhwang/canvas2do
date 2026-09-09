using Microsoft.AspNetCore.Identity;

namespace CanvasToDo.Api.Domain.Identity;

public sealed class ApplicationUser : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = string.Empty;

    public string Status { get; set; } = UserStatuses.Active;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset? LastLoginAt { get; set; }
}

public static class UserStatuses
{
    public const string Active = "active";
    public const string Inactive = "inactive";
    public const string Pending = "pending";

    public static bool IsValid(string? status) =>
        string.Equals(status, Active, StringComparison.OrdinalIgnoreCase) ||
        string.Equals(status, Inactive, StringComparison.OrdinalIgnoreCase) ||
        string.Equals(status, Pending, StringComparison.OrdinalIgnoreCase);

    public static string Normalize(string status) => status.Trim().ToLowerInvariant();
}

public static class ApplicationRoles
{
    public const string User = "User";
    public const string Admin = "Admin";

    public static bool IsValid(string? role) =>
        string.Equals(role, User, StringComparison.OrdinalIgnoreCase) ||
        string.Equals(role, Admin, StringComparison.OrdinalIgnoreCase);

    public static string Normalize(string role) =>
        string.Equals(role, Admin, StringComparison.OrdinalIgnoreCase) ? Admin : User;
}
