using Incos.Workspace.Api.Contracts;
using Microsoft.AspNetCore.WebUtilities;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Incos.Workspace.Api.Endpoints;

public static class CanvasIntegrationEndpoints
{
    public static IEndpointRouteBuilder MapCanvasIntegrationEndpoints(this IEndpointRouteBuilder app)
    {
        var canvas = app.MapGroup("/api/canvas")
            .RequireAuthorization();

        canvas.MapGet("/integration", (IConfiguration configuration) =>
            {
                var instanceUrl = NormalizeCanvasInstanceUrl(configuration["Authentication:Canvas:InstanceUrl"]);
                var accessToken = configuration["Authentication:Canvas:AccessToken"];
                var isConfigured =
                    !string.IsNullOrWhiteSpace(instanceUrl) &&
                    !string.IsNullOrWhiteSpace(accessToken);

                return Results.Ok(new
                {
                    provider = "canvas_lms",
                    label = "Canvas LMS",
                    configured = isConfigured,
                    connected = isConfigured,
                    status = isConfigured ? "connected" : "needs_connection",
                    connectUrl = "",
                    instanceUrl,
                    userName = (string?)null,
                    scopes = Array.Empty<string>(),
                });
            })
            .WithName("GetCanvasIntegrationStatus");

        canvas.MapGet("/courses", GetCanvasCoursesAsync)
            .WithName("GetCanvasCourses");

        return app;
    }

    private static async Task<IResult> GetCanvasCoursesAsync(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        int? pageSize,
        CancellationToken cancellationToken)
    {
        var instanceUrl = NormalizeCanvasInstanceUrl(configuration["Authentication:Canvas:InstanceUrl"]);
        var accessToken = configuration["Authentication:Canvas:AccessToken"];

        if (string.IsNullOrWhiteSpace(instanceUrl) || string.IsNullOrWhiteSpace(accessToken))
        {
            return Results.Problem(
                title: "Canvas LMS is not connected.",
                detail: "Add CANVAS_INSTANCE_URL and CANVAS_ACCESS_TOKEN to the API environment.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var safePageSize = Math.Clamp(pageSize ?? 5, 1, 5);

        try
        {
            var courses = await GetActiveStudentCoursesAsync(
                httpClientFactory,
                instanceUrl,
                accessToken,
                safePageSize,
                cancellationToken);

            return Results.Ok(new CanvasCoursesDto(courses, GetCommonTermName(courses)));
        }
        catch (CanvasApiRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task<CanvasCourseDto[]> GetActiveStudentCoursesAsync(
        IHttpClientFactory httpClientFactory,
        string instanceUrl,
        string accessToken,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var query = new List<KeyValuePair<string, string?>>
        {
            new("enrollment_type", "student"),
            new("enrollment_state", "active"),
            new("include[]", "term"),
            new("state[]", "available"),
            new("per_page", pageSize.ToString(CultureInfo.InvariantCulture)),
        };
        var requestUri = QueryHelpers.AddQueryString($"{instanceUrl}/api/v1/courses", query);
        var payload = await SendCanvasGetAsync(
            httpClientFactory,
            accessToken,
            requestUri,
            cancellationToken);

        using var document = JsonDocument.Parse(payload);

        if (document.RootElement.ValueKind != JsonValueKind.Array)
        {
            throw new CanvasApiRequestException(
                "Canvas courses failed to load.",
                "Canvas returned an unexpected courses response.",
                StatusCodes.Status502BadGateway);
        }

        return document.RootElement
            .EnumerateArray()
            .Select(course => ParseCanvasCourse(course, instanceUrl))
            .Where(course => !string.IsNullOrWhiteSpace(course.Name))
            .Take(pageSize)
            .ToArray();
    }

    private static CanvasCourseDto ParseCanvasCourse(JsonElement course, string instanceUrl)
    {
        var id = GetJsonStringOrNumber(course, "id") ?? "";
        var name =
            GetJsonString(course, "name") ??
            GetJsonString(course, "original_name") ??
            GetJsonString(course, "course_code") ??
            "Untitled course";
        var htmlUrl = GetJsonString(course, "html_url");

        if (string.IsNullOrWhiteSpace(htmlUrl) && !string.IsNullOrWhiteSpace(id))
        {
            htmlUrl = $"{instanceUrl}/courses/{id}";
        }

        return new CanvasCourseDto(
            id,
            name,
            GetJsonString(course, "course_code"),
            GetCanvasTermName(course),
            GetJsonString(course, "workflow_state"),
            GetJsonDateTimeOffset(course, "start_at"),
            GetJsonDateTimeOffset(course, "end_at"),
            htmlUrl);
    }

    private static async Task<string> SendCanvasGetAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUri,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        var response = await httpClientFactory
            .CreateClient()
            .SendAsync(request, cancellationToken);
        var payload = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new CanvasApiRequestException(
                "Canvas request failed.",
                string.IsNullOrWhiteSpace(payload) ? response.ReasonPhrase ?? "Canvas returned an error." : payload,
                (int)response.StatusCode);
        }

        return payload;
    }

    private static string? GetCommonTermName(CanvasCourseDto[] courses)
    {
        var termNames = courses
            .Select(course => course.TermName)
            .Where(termName => !string.IsNullOrWhiteSpace(termName))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(2)
            .ToArray();

        return termNames.Length == 1 ? termNames[0] : null;
    }

    private static string? NormalizeCanvasInstanceUrl(string? instanceUrl)
    {
        if (string.IsNullOrWhiteSpace(instanceUrl))
        {
            return null;
        }

        return instanceUrl.Trim().TrimEnd('/');
    }

    private static string? GetCanvasTermName(JsonElement course)
    {
        if (!course.TryGetProperty("term", out var term) || term.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return GetJsonString(term, "name");
    }

    private static string? GetJsonString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) &&
               property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
    }

    private static string? GetJsonStringOrNumber(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var property))
        {
            return null;
        }

        return property.ValueKind switch
        {
            JsonValueKind.String => property.GetString(),
            JsonValueKind.Number => property.TryGetInt64(out var value)
                ? value.ToString(CultureInfo.InvariantCulture)
                : property.GetRawText(),
            _ => null,
        };
    }

    private static DateTimeOffset? GetJsonDateTimeOffset(JsonElement element, string propertyName)
    {
        var value = GetJsonString(element, propertyName);

        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal,
            out var parsedValue)
            ? parsedValue
            : null;
    }

    private sealed class CanvasApiRequestException(string title, string detail, int statusCode) : Exception(title)
    {
        public string Title { get; } = title;
        public string Detail { get; } = detail;
        public int StatusCode { get; } = statusCode;
    }
}
