using Incos.Workspace.Api.Contracts;
using Incos.Workspace.Api.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.WebUtilities;
using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;

namespace Incos.Workspace.Api.Endpoints;

public static class MicrosoftIntegrationEndpoints
{
    private const string GraphBaseUrl = "https://graph.microsoft.com/v1.0";
    private const int OutlookPageSizeDefault = 50;

    public static IEndpointRouteBuilder MapMicrosoftIntegrationEndpoints(this IEndpointRouteBuilder app)
    {
        var microsoft = app.MapGroup("/api/microsoft")
            .RequireAuthorization();

        microsoft.MapGet("/integrations", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                CancellationToken cancellationToken) =>
            {
                var isConfigured = IsMicrosoftConfigured(configuration);
                var accessToken = await GetMicrosoftAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);
                var grantedScopes = await GetGrantedMicrosoftScopesAsync(context);
                var hasRequiredScopes = MicrosoftGraphScopes.Outlook.All(grantedScopes.Contains);
                var isConnected = isConfigured &&
                    !string.IsNullOrWhiteSpace(accessToken) &&
                    hasRequiredScopes;

                return Results.Ok(new[]
                {
                    new MicrosoftIntegrationStatusDto(
                        "outlook",
                        "Outlook",
                        isConfigured,
                        isConnected,
                        isConnected ? "connected" : "needs_connection",
                        "/api/microsoft/integrations/outlook/connect",
                        MicrosoftGraphScopes.Outlook,
                        context.User.FindFirstValue("urn:microsoft:name"),
                        context.User.FindFirstValue("urn:microsoft:email")),
                });
            })
            .WithName("GetMicrosoftIntegrationStatuses");

        microsoft.MapGet("/integrations/outlook/connect", () =>
                Results.Redirect(
                    $"/api/auth/microsoft/login?returnUrl={Uri.EscapeDataString("/?mode=academy&item=outlook")}&forceConsent=true"))
            .WithName("ConnectMicrosoftOutlook");

        microsoft.MapGet("/outlook/messages", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string? search,
                int? pageSize,
                CancellationToken cancellationToken) =>
            {
                var accessToken = await GetMicrosoftAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return CreateOutlookConnectionProblem();
                }

                try
                {
                    var messages = await GetOutlookMessagesAsync(
                        httpClientFactory,
                        accessToken,
                        search,
                        Math.Clamp(pageSize ?? OutlookPageSizeDefault, 1, 100),
                        cancellationToken);

                    return Results.Ok(messages);
                }
                catch (MicrosoftGraphRequestException exception)
                {
                    return Results.Problem(
                        title: exception.Title,
                        detail: exception.Detail,
                        statusCode: exception.StatusCode);
                }
            })
            .WithName("GetOutlookMessages");

        microsoft.MapGet("/outlook/messages/{messageId}", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string messageId,
                CancellationToken cancellationToken) =>
            {
                var accessToken = await GetMicrosoftAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return CreateOutlookConnectionProblem();
                }

                try
                {
                    var message = await GetOutlookMessageAsync(
                        httpClientFactory,
                        accessToken,
                        messageId,
                        cancellationToken);

                    return Results.Ok(message);
                }
                catch (MicrosoftGraphRequestException exception)
                {
                    return Results.Problem(
                        title: exception.Title,
                        detail: exception.Detail,
                        statusCode: exception.StatusCode);
                }
            })
            .WithName("GetOutlookMessage");

        microsoft.MapPost("/outlook/messages/{messageId}/read", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string messageId,
                CancellationToken cancellationToken) =>
            {
                return await SetOutlookMessageReadStateAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    messageId,
                    isRead: true,
                    cancellationToken);
            })
            .WithName("MarkOutlookMessageRead");

        microsoft.MapPost("/outlook/messages/{messageId}/unread", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                string messageId,
                CancellationToken cancellationToken) =>
            {
                return await SetOutlookMessageReadStateAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    messageId,
                    isRead: false,
                    cancellationToken);
            })
            .WithName("MarkOutlookMessageUnread");

        microsoft.MapPost("/outlook/messages/send", async (
                HttpContext context,
                IHttpClientFactory httpClientFactory,
                IConfiguration configuration,
                SendOutlookMessageRequestDto request,
                CancellationToken cancellationToken) =>
            {
                if (string.IsNullOrWhiteSpace(request.To))
                {
                    return Results.BadRequest(new { message = "Recipient is required." });
                }

                if (string.IsNullOrWhiteSpace(request.Body))
                {
                    return Results.BadRequest(new { message = "Message body is required." });
                }

                var accessToken = await GetMicrosoftAccessTokenAsync(
                    context,
                    httpClientFactory,
                    configuration,
                    cancellationToken);

                if (string.IsNullOrWhiteSpace(accessToken))
                {
                    return CreateOutlookConnectionProblem();
                }

                try
                {
                    await SendOutlookMessageAsync(
                        httpClientFactory,
                        accessToken,
                        request,
                        cancellationToken);

                    return Results.NoContent();
                }
                catch (MicrosoftGraphRequestException exception)
                {
                    return Results.Problem(
                        title: exception.Title,
                        detail: exception.Detail,
                        statusCode: exception.StatusCode);
                }
            })
            .WithName("SendOutlookMessage");

        return app;
    }

    private static IResult CreateOutlookConnectionProblem() =>
        Results.Problem(
            title: "Outlook is not connected.",
            detail: "Connect Outlook so the API has a Microsoft Graph access token with mail scopes.",
            statusCode: StatusCodes.Status409Conflict);

    private static bool IsMicrosoftConfigured(IConfiguration configuration) =>
        !string.IsNullOrWhiteSpace(configuration["Authentication:Microsoft:ClientId"]) &&
        !string.IsNullOrWhiteSpace(configuration["Authentication:Microsoft:ClientSecret"]);

    private static async Task<string?> GetMicrosoftAccessTokenAsync(
        HttpContext context,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var accessToken = await context.GetTokenAsync("microsoft_access_token");
        var expiresAt = await context.GetTokenAsync("microsoft_expires_at");

        if (!ShouldRefreshAccessToken(accessToken, expiresAt))
        {
            return accessToken;
        }

        var refreshToken = await context.GetTokenAsync("microsoft_refresh_token");
        var clientId = configuration["Authentication:Microsoft:ClientId"];
        var clientSecret = configuration["Authentication:Microsoft:ClientSecret"];

        if (string.IsNullOrWhiteSpace(refreshToken) ||
            string.IsNullOrWhiteSpace(clientId) ||
            string.IsNullOrWhiteSpace(clientSecret))
        {
            return null;
        }

        MicrosoftTokenRefreshResult refreshedToken;

        try
        {
            refreshedToken = await RefreshMicrosoftAccessTokenAsync(
                httpClientFactory,
                configuration,
                clientId,
                clientSecret,
                refreshToken,
                cancellationToken);
        }
        catch (MicrosoftGraphRequestException)
        {
            return null;
        }

        await StoreRefreshedMicrosoftTokenAsync(context, refreshedToken, refreshToken);

        return refreshedToken.AccessToken;
    }

    private static bool ShouldRefreshAccessToken(string? accessToken, string? expiresAt)
    {
        if (string.IsNullOrWhiteSpace(accessToken))
        {
            return true;
        }

        if (!DateTimeOffset.TryParse(
                expiresAt,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal,
                out var parsedExpiresAt))
        {
            return true;
        }

        return parsedExpiresAt <= DateTimeOffset.UtcNow.AddMinutes(5);
    }

    private static async Task<MicrosoftTokenRefreshResult> RefreshMicrosoftAccessTokenAsync(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        string clientId,
        string clientSecret,
        string refreshToken,
        CancellationToken cancellationToken)
    {
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["client_secret"] = clientSecret,
            ["refresh_token"] = refreshToken,
            ["grant_type"] = "refresh_token",
            ["scope"] = string.Join(' ', MicrosoftGraphScopes.Authorization),
        });
        var response = await httpClientFactory
            .CreateClient()
            .PostAsync(GetMicrosoftTokenEndpoint(configuration), content, cancellationToken);
        var payload = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new MicrosoftGraphRequestException(
                "Microsoft token refresh failed.",
                payload,
                (int)response.StatusCode);
        }

        using var document = JsonDocument.Parse(payload);
        var accessToken = GetJsonString(document.RootElement, "access_token");

        if (string.IsNullOrWhiteSpace(accessToken))
        {
            throw new MicrosoftGraphRequestException(
                "Microsoft token refresh failed.",
                "Microsoft did not return a new access token.",
                StatusCodes.Status401Unauthorized);
        }

        return new MicrosoftTokenRefreshResult(
            accessToken,
            GetJsonString(document.RootElement, "refresh_token"),
            GetJsonLong(document.RootElement, "expires_in") ?? 3600,
            GetJsonString(document.RootElement, "scope") ?? "");
    }

    private static async Task StoreRefreshedMicrosoftTokenAsync(
        HttpContext context,
        MicrosoftTokenRefreshResult refreshedToken,
        string previousRefreshToken)
    {
        var authenticateResult = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);

        if (!authenticateResult.Succeeded || authenticateResult.Principal is null)
        {
            return;
        }

        var properties = authenticateResult.Properties ?? new AuthenticationProperties();
        var tokens = properties.GetTokens().ToList();
        var expiresAt = DateTimeOffset.UtcNow
            .AddSeconds(Math.Max(60, refreshedToken.ExpiresIn - 60))
            .ToString("o", CultureInfo.InvariantCulture);

        StoreToken(tokens, "microsoft_access_token", refreshedToken.AccessToken);
        StoreToken(tokens, "microsoft_expires_at", expiresAt);
        StoreToken(tokens, "microsoft_refresh_token", refreshedToken.RefreshToken ?? previousRefreshToken);

        if (!string.IsNullOrWhiteSpace(refreshedToken.Scope))
        {
            StoreToken(tokens, "microsoft_scope", refreshedToken.Scope);
        }

        properties.StoreTokens(tokens);
        await context.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            authenticateResult.Principal,
            properties);
    }

    private static async Task<ISet<string>> GetGrantedMicrosoftScopesAsync(HttpContext context)
    {
        var scopes = await context.GetTokenAsync("microsoft_scope");

        if (string.IsNullOrWhiteSpace(scopes))
        {
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }

        return scopes
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static async Task<OutlookMessagesDto> GetOutlookMessagesAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string? search,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var query = new Dictionary<string, string?>
        {
            ["$top"] = pageSize.ToString(CultureInfo.InvariantCulture),
            ["$select"] =
                "id,subject,from,toRecipients,receivedDateTime,isRead,importance,hasAttachments,bodyPreview,webLink",
        };

        if (string.IsNullOrWhiteSpace(search))
        {
            query["$orderby"] = "receivedDateTime desc";
        }
        else
        {
            query["$search"] = $"\"{search.Trim().Replace("\"", "\\\"", StringComparison.Ordinal)}\"";
        }

        var requestUri = QueryHelpers.AddQueryString($"{GraphBaseUrl}/me/messages", query);
        var payload = await SendGraphGetAsync(httpClientFactory, accessToken, requestUri, cancellationToken);

        using var document = JsonDocument.Parse(payload);
        var messages = document.RootElement.TryGetProperty("value", out var valueElement) &&
                       valueElement.ValueKind == JsonValueKind.Array
            ? valueElement.EnumerateArray().Select(ParseOutlookMessage).ToArray()
            : [];

        return new OutlookMessagesDto(
            search,
            messages,
            GetJsonString(document.RootElement, "@odata.nextLink"));
    }

    private static async Task<OutlookMessageDto> GetOutlookMessageAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string messageId,
        CancellationToken cancellationToken)
    {
        var query = new Dictionary<string, string?>
        {
            ["$select"] =
                "id,subject,from,toRecipients,receivedDateTime,isRead,importance,hasAttachments,bodyPreview,body,webLink",
        };
        var requestUri = QueryHelpers.AddQueryString(
            $"{GraphBaseUrl}/me/messages/{Uri.EscapeDataString(messageId)}",
            query);
        var payload = await SendGraphGetAsync(httpClientFactory, accessToken, requestUri, cancellationToken);

        using var document = JsonDocument.Parse(payload);

        return ParseOutlookMessage(document.RootElement);
    }

    private static async Task<IResult> SetOutlookMessageReadStateAsync(
        HttpContext context,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        string messageId,
        bool isRead,
        CancellationToken cancellationToken)
    {
        var accessToken = await GetMicrosoftAccessTokenAsync(
            context,
            httpClientFactory,
            configuration,
            cancellationToken);

        if (string.IsNullOrWhiteSpace(accessToken))
        {
            return CreateOutlookConnectionProblem();
        }

        try
        {
            await SendGraphPatchAsync(
                httpClientFactory,
                accessToken,
                $"{GraphBaseUrl}/me/messages/{Uri.EscapeDataString(messageId)}",
                new { isRead },
                cancellationToken);

            return Results.NoContent();
        }
        catch (MicrosoftGraphRequestException exception)
        {
            return Results.Problem(
                title: exception.Title,
                detail: exception.Detail,
                statusCode: exception.StatusCode);
        }
    }

    private static async Task SendOutlookMessageAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        SendOutlookMessageRequestDto request,
        CancellationToken cancellationToken)
    {
        var payload = new
        {
            message = new
            {
                subject = request.Subject,
                body = new
                {
                    contentType = "Text",
                    content = request.Body,
                },
                toRecipients = ParseRecipients(request.To),
                ccRecipients = ParseRecipients(request.Cc),
                bccRecipients = ParseRecipients(request.Bcc),
            },
            saveToSentItems = true,
        };

        await SendGraphPostAsync(
            httpClientFactory,
            accessToken,
            $"{GraphBaseUrl}/me/sendMail",
            payload,
            cancellationToken);
    }

    private static object[] ParseRecipients(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return [];
        }

        return value
            .Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(address => new { emailAddress = new { address } })
            .Cast<object>()
            .ToArray();
    }

    private static OutlookMessageDto ParseOutlookMessage(JsonElement message)
    {
        return new OutlookMessageDto(
            GetJsonString(message, "id") ?? "",
            GetJsonString(message, "subject"),
            FormatEmailAddress(message, "from"),
            FormatRecipients(message, "toRecipients"),
            GetJsonString(message, "bodyPreview") ?? "",
            GetBodyHtml(message),
            GetJsonDateTimeOffset(message, "receivedDateTime"),
            !(GetJsonBool(message, "isRead") ?? false),
            GetJsonBool(message, "hasAttachments") ?? false,
            GetJsonString(message, "webLink"),
            GetJsonString(message, "importance"));
    }

    private static string FormatEmailAddress(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var wrapper) ||
            wrapper.ValueKind != JsonValueKind.Object ||
            !wrapper.TryGetProperty("emailAddress", out var emailAddress))
        {
            return "";
        }

        var name = GetJsonString(emailAddress, "name");
        var address = GetJsonString(emailAddress, "address");

        if (string.IsNullOrWhiteSpace(name))
        {
            return address ?? "";
        }

        return string.IsNullOrWhiteSpace(address) ? name : $"{name} <{address}>";
    }

    private static string FormatRecipients(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var recipients) ||
            recipients.ValueKind != JsonValueKind.Array)
        {
            return "";
        }

        return string.Join(
            ", ",
            recipients
                .EnumerateArray()
                .Select(recipient => FormatEmailAddressFromRecipient(recipient))
                .Where(recipient => !string.IsNullOrWhiteSpace(recipient)));
    }

    private static string FormatEmailAddressFromRecipient(JsonElement recipient)
    {
        if (!recipient.TryGetProperty("emailAddress", out var emailAddress))
        {
            return "";
        }

        var name = GetJsonString(emailAddress, "name");
        var address = GetJsonString(emailAddress, "address");

        if (string.IsNullOrWhiteSpace(name))
        {
            return address ?? "";
        }

        return string.IsNullOrWhiteSpace(address) ? name : $"{name} <{address}>";
    }

    private static string? GetBodyHtml(JsonElement message)
    {
        if (!message.TryGetProperty("body", out var body) || body.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return GetJsonString(body, "content");
    }

    private static async Task<string> SendGraphGetAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUri,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.TryAddWithoutValidation("Prefer", "outlook.body-content-type=\"html\"");

        var response = await httpClientFactory
            .CreateClient()
            .SendAsync(request, cancellationToken);
        var payload = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new MicrosoftGraphRequestException(
                "Microsoft Graph request failed.",
                string.IsNullOrWhiteSpace(payload) ? response.ReasonPhrase ?? "Microsoft Graph returned an error." : payload,
                (int)response.StatusCode);
        }

        return payload;
    }

    private static async Task SendGraphPatchAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUri,
        object payload,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Patch, requestUri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Content = JsonContent.Create(payload);

        await SendGraphMutationAsync(httpClientFactory, request, cancellationToken);
    }

    private static async Task SendGraphPostAsync(
        IHttpClientFactory httpClientFactory,
        string accessToken,
        string requestUri,
        object payload,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, requestUri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Content = JsonContent.Create(payload);

        await SendGraphMutationAsync(httpClientFactory, request, cancellationToken);
    }

    private static async Task SendGraphMutationAsync(
        IHttpClientFactory httpClientFactory,
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var response = await httpClientFactory
            .CreateClient()
            .SendAsync(request, cancellationToken);
        var payload = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new MicrosoftGraphRequestException(
                "Microsoft Graph request failed.",
                string.IsNullOrWhiteSpace(payload) ? response.ReasonPhrase ?? "Microsoft Graph returned an error." : payload,
                (int)response.StatusCode);
        }
    }

    private static string GetMicrosoftTenantId(IConfiguration configuration)
    {
        var tenantId = configuration["Authentication:Microsoft:TenantId"];

        return string.IsNullOrWhiteSpace(tenantId) ? "common" : tenantId.Trim();
    }

    private static string GetMicrosoftTokenEndpoint(IConfiguration configuration) =>
        $"https://login.microsoftonline.com/{Uri.EscapeDataString(GetMicrosoftTenantId(configuration))}/oauth2/v2.0/token";

    private static void StoreToken(List<AuthenticationToken> tokens, string name, string value)
    {
        var token = tokens.FirstOrDefault(currentToken => currentToken.Name == name);

        if (token is null)
        {
            tokens.Add(new AuthenticationToken
            {
                Name = name,
                Value = value,
            });
            return;
        }

        token.Value = value;
    }

    private static string? GetJsonString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) &&
               property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
    }

    private static bool? GetJsonBool(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) &&
               property.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? property.GetBoolean()
            : null;
    }

    private static long? GetJsonLong(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var property) &&
               property.ValueKind == JsonValueKind.Number &&
               property.TryGetInt64(out var value)
            ? value
            : null;
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

    private sealed record MicrosoftTokenRefreshResult(
        string AccessToken,
        string? RefreshToken,
        long ExpiresIn,
        string Scope);

    private sealed class MicrosoftGraphRequestException(string title, string detail, int statusCode) : Exception(title)
    {
        public string Title { get; } = title;
        public string Detail { get; } = detail;
        public int StatusCode { get; } = statusCode;
    }
}
