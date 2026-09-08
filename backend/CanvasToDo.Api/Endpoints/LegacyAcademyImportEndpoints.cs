using CanvasToDo.Api.Contracts;
using CanvasToDo.Api.Domain.Identity;
using CanvasToDo.Api.Infrastructure;
using Microsoft.AspNetCore.Identity;

namespace CanvasToDo.Api.Endpoints;

public static class LegacyAcademyImportEndpoints
{
    public static IEndpointRouteBuilder MapLegacyAcademyImportEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/auth/legacy-academy/import", ImportAsync)
            .RequireAuthorization()
            .RequireRateLimiting("legacy-academy-import")
            .WithName("ImportLegacyAcademyData");

        return app;
    }

    private static async Task<IResult> ImportAsync(
        LegacyAcademyImportRequest request,
        HttpContext context,
        UserManager<ApplicationUser> userManager,
        LegacyAcademyImportService importService,
        CancellationToken cancellationToken)
    {
        context.Response.Headers.CacheControl = "no-store";
        var user = await userManager.GetUserAsync(context.User);

        if (user is null ||
            !user.EmailConfirmed ||
            !string.Equals(user.Status, UserStatuses.Active, StringComparison.OrdinalIgnoreCase))
        {
            return Results.Forbid();
        }

        var result = await importService.ImportAsync(
            user.Id,
            request.LoginId,
            request.Password,
            cancellationToken);

        return result.Outcome switch
        {
            LegacyAcademyImportOutcome.Succeeded => Results.Ok(new LegacyAcademyImportDto(
                result.AlreadyLinked,
                result.ImportedSettingKeys,
                BuildSuccessMessage(result))),
            LegacyAcademyImportOutcome.InvalidCredentials => Results.Problem(
                title: "Legacy credentials not accepted.",
                detail: "Check the Academy ID and password from the retired sign-in system.",
                statusCode: StatusCodes.Status400BadRequest),
            LegacyAcademyImportOutcome.LegacyAccountInactive => Results.Problem(
                title: "Legacy account inactive.",
                detail: "This legacy Academy account is not active and cannot be imported.",
                statusCode: StatusCodes.Status403Forbidden),
            LegacyAcademyImportOutcome.CurrentIdentityAlreadyLinked => Results.Conflict(new
            {
                title = "A legacy account is already linked.",
                detail = "This Canvas To Do account cannot be linked to a different legacy Academy account.",
            }),
            LegacyAcademyImportOutcome.LegacyAccountAlreadyLinked => Results.Conflict(new
            {
                title = "Legacy account already claimed.",
                detail = "That legacy Academy account is already linked to another Canvas To Do account.",
            }),
            LegacyAcademyImportOutcome.Unavailable => Results.Problem(
                title: "Legacy import unavailable.",
                detail: "The legacy Academy data store is not available. Contact the site operator.",
                statusCode: StatusCodes.Status503ServiceUnavailable),
            LegacyAcademyImportOutcome.Busy => Results.Problem(
                title: "Legacy import is busy.",
                detail: "Too many legacy password checks are already running. Wait a moment and try again.",
                statusCode: StatusCodes.Status503ServiceUnavailable),
            _ => Results.Conflict(new
            {
                title = "Import could not be completed.",
                detail = "Another import changed the account binding. Check your account and try again.",
            }),
        };
    }

    private static string BuildSuccessMessage(LegacyAcademyImportResult result)
    {
        if (result.ImportedSettingKeys.Length > 0)
        {
            return "Available legacy Canvas and Academy data was imported. Existing Canvas To Do settings were preserved.";
        }

        return result.AlreadyLinked
            ? "This legacy account was already linked. Your existing Canvas To Do settings were preserved."
            : "Your legacy account was linked. It had no eligible data to copy, and your existing Canvas To Do settings were preserved.";
    }
}
