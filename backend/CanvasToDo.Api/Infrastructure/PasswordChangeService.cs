using System.Text.Json;
using CanvasToDo.Api.Data;
using CanvasToDo.Api.Domain.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace CanvasToDo.Api.Infrastructure;

// Uses Identity's existing per-user token table. Plaintext passwords never enter storage or logs.
public sealed class PasswordChangeService(
    AuthDbContext db,
    UserManager<ApplicationUser> users,
    ILogger<PasswordChangeService> logger)
{
    public const string Provider = "CanvasToDo.PasswordChange";
    public const string TokenName = "Request";
    public sealed record StoredRequest(Guid Id, string Status, DateTimeOffset RequestedAt,
        string? PasswordHash, string? SecurityStamp, DateTimeOffset? ReviewedAt = null, Guid? ReviewedBy = null);
    public sealed record RequestStatus(Guid Id, string Status, DateTimeOffset RequestedAt,
        DateTimeOffset ExpiresAt, DateTimeOffset? ReviewedAt);

    public static StoredRequest? Parse(string? value) =>
        value is null ? null : JsonSerializer.Deserialize<StoredRequest>(value);

    public static RequestStatus? Describe(StoredRequest? request, string? stamp)
    {
        if (request is null) return null;
        var status = request.Status;
        if (status == "pending" && (request.RequestedAt.AddDays(7) <= DateTimeOffset.UtcNow ||
            request.SecurityStamp != stamp)) status = "expired";
        return new(request.Id, status, request.RequestedAt, request.RequestedAt.AddDays(7), request.ReviewedAt);
    }

    public async Task<RequestStatus?> GetAsync(ApplicationUser user) => Describe(
        Parse(await users.GetAuthenticationTokenAsync(user, Provider, TokenName)), user.SecurityStamp);

    private async Task<ApplicationUser?> LockAsync(Guid id)
    {
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({"password-change:" + id}, 0));");
        var user = await users.FindByIdAsync(id.ToString());
        if (user is not null) await db.Entry(user).ReloadAsync();
        return user;
    }

    public async Task<IResult> SubmitAsync(Guid id, string? password, string? confirmation, string? expectedSecurityStamp)
    {
        if (password != confirmation) return Invalid("Passwords do not match.");
        await using var transaction = await db.Database.BeginTransactionAsync();
        var user = await LockAsync(id);
        if (user is null || user.Status != UserStatuses.Active) return Results.Forbid();
        if (user.SecurityStamp != expectedSecurityStamp)
            return Results.Problem(statusCode: 409, detail: "Account security changed. Sign in again or request a fresh recovery link.");
        if (await ValidateAsync(user, password) is { } error) return error;
        var request = new StoredRequest(Guid.NewGuid(), "pending", DateTimeOffset.UtcNow,
            users.PasswordHasher.HashPassword(user, password!), user.SecurityStamp);
        var result = await users.SetAuthenticationTokenAsync(user, Provider, TokenName, JsonSerializer.Serialize(request));
        if (!result.Succeeded) return Errors(result);
        await transaction.CommitAsync();
        logger.LogInformation("User {UserId} submitted password request {RequestId}.", id, request.Id);
        return Results.Accepted(value: new { message = "Password change requested. Keep using your current password until an administrator approves it.", request = Describe(request, user.SecurityStamp) });
    }

    public async Task<IResult> ReviewAsync(Guid id, Guid requestId, bool approve, Guid actor)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        var user = await LockAsync(id);
        if (user is null) return Results.NotFound();
        var request = Parse(await users.GetAuthenticationTokenAsync(user, Provider, TokenName));
        if (request is null || request.Id != requestId || Describe(request, user.SecurityStamp)?.Status != "pending")
            return Results.Problem(statusCode: 409, detail: "This request was replaced, reviewed, or expired. Refresh the user details.");
        if (approve && user.Status != UserStatuses.Active)
            return Results.Problem(statusCode: 409, detail: "Activate the account before approving its password change.");
        if (approve)
        {
            if (string.IsNullOrEmpty(request.PasswordHash)) return Results.Conflict();
            user.PasswordHash = request.PasswordHash;
            user.SecurityStamp = Guid.NewGuid().ToString();
            user.AccessFailedCount = 0;
            user.LockoutEnd = null;
            user.UpdatedAt = DateTimeOffset.UtcNow;
            var result = await users.UpdateAsync(user);
            if (!result.Succeeded) return Errors(result);
        }
        var reviewed = request with { Status = approve ? "approved" : "rejected", PasswordHash = null,
            SecurityStamp = null, ReviewedAt = DateTimeOffset.UtcNow, ReviewedBy = actor };
        var saved = await users.SetAuthenticationTokenAsync(user, Provider, TokenName, JsonSerializer.Serialize(reviewed));
        if (!saved.Succeeded) return Errors(saved);
        await transaction.CommitAsync();
        logger.LogInformation("Administrator {ActorId} {Decision} password request {RequestId} for user {UserId}.",
            actor, reviewed.Status, requestId, id);
        return Results.Ok(new { message = approve ? "Password approved. Existing sessions were revoked." : "Password request rejected.", request = Describe(reviewed, user.SecurityStamp) });
    }

    public async Task<IResult> SetByAdminAsync(Guid id, string? password, string? confirmation, Guid actor)
    {
        if (password != confirmation) return Invalid("Passwords do not match.");
        await using var transaction = await db.Database.BeginTransactionAsync();
        var user = await LockAsync(id);
        if (user is null) return Results.NotFound();
        if (await ValidateAsync(user, password) is { } error) return error;
        user.PasswordHash = users.PasswordHasher.HashPassword(user, password!);
        user.SecurityStamp = Guid.NewGuid().ToString();
        user.AccessFailedCount = 0;
        user.LockoutEnd = null;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        var result = await users.UpdateAsync(user);
        if (!result.Succeeded) return Errors(result);
        var removed = await users.RemoveAuthenticationTokenAsync(user, Provider, TokenName);
        if (!removed.Succeeded) return Errors(removed);
        await transaction.CommitAsync();
        logger.LogInformation("Administrator {ActorId} replaced the password for user {UserId}.", actor, id);
        return Results.Ok(new { message = "Password updated. Existing sessions and pending password requests were revoked." });
    }

    private async Task<IResult?> ValidateAsync(ApplicationUser user, string? password)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length > 256) return Invalid("Enter a password of at most 256 characters.");
        foreach (var validator in users.PasswordValidators)
        {
            var result = await validator.ValidateAsync(users, user, password);
            if (!result.Succeeded) return Errors(result);
        }
        return null;
    }
    private static IResult Invalid(string message) => Results.ValidationProblem(new Dictionary<string, string[]> { ["password"] = [message] });
    private static IResult Errors(IdentityResult result) => Invalid(string.Join(" ", result.Errors.Select(e => e.Description)));
}
