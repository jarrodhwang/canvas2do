namespace CanvasToDo.Api.Infrastructure;

/// <summary>
/// Rejects browser-compatible cross-site form mutations. The SPA adds a custom header to every
/// unsafe API request, which forces cross-origin JavaScript through the configured CORS policy.
/// OAuth callbacks remain GET requests and have their own protected correlation/state values.
/// </summary>
public static class ApiRequestVerification
{
    public const string HeaderName = "X-Canvas-To-Do-Request";
    public const string HeaderValue = "1";

    public static async Task EnforceAsync(HttpContext context, RequestDelegate next)
    {
        if (!context.Request.Path.StartsWithSegments("/api") ||
            HttpMethods.IsGet(context.Request.Method) ||
            HttpMethods.IsHead(context.Request.Method) ||
            HttpMethods.IsOptions(context.Request.Method))
        {
            await next(context);
            return;
        }

        var verificationValues = context.Request.Headers[HeaderName];

        if (verificationValues.Count != 1 ||
            !string.Equals(verificationValues[0], HeaderValue, StringComparison.Ordinal))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.ContentType = "application/problem+json";
            context.Response.Headers.CacheControl = "no-store";
            await context.Response.WriteAsJsonAsync(new
            {
                title = "Request verification failed.",
                detail = $"Send the {HeaderName} header when changing application data.",
                status = StatusCodes.Status403Forbidden,
            });
            return;
        }

        await next(context);
    }
}
