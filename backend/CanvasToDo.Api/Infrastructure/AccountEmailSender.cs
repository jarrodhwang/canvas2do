using CanvasToDo.Api.Domain.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;
using System.Net;
using System.Net.Mail;
using System.Text;

namespace CanvasToDo.Api.Infrastructure;

public interface IAccountEmailSender
{
    AccountEmailAvailability Availability { get; }

    Task<AccountEmailSendResult> SendEmailConfirmationAsync(
        ApplicationUser user,
        string token,
        CancellationToken cancellationToken = default);

    Task<AccountEmailSendResult> SendPasswordResetAsync(
        ApplicationUser user,
        string token,
        CancellationToken cancellationToken = default);
}

public sealed record AccountEmailAvailability(bool IsAvailable, string? UnavailableReason = null);

public sealed record AccountEmailSendResult(
    AccountEmailSendStatus Status,
    string? DevelopmentActionUrl = null)
{
    public bool Succeeded => Status is AccountEmailSendStatus.Sent or AccountEmailSendStatus.DevelopmentDisclosure;
}

public enum AccountEmailSendStatus
{
    Sent,
    DevelopmentDisclosure,
    Unavailable,
    Failed,
}

public sealed class AccountEmailOptions
{
    public string PublicFrontendBaseUrl { get; set; } = string.Empty;

    public string FromAddress { get; set; } = string.Empty;

    public string FromName { get; set; } = "Canvas To Do";

    public SmtpOptions Smtp { get; set; } = new();

    public DevelopmentEmailOptions Development { get; set; } = new();
}

public sealed class SmtpOptions
{
    public string Host { get; set; } = string.Empty;

    public int Port { get; set; } = 587;

    public string Username { get; set; } = string.Empty;

    public string Password { get; set; } = string.Empty;

    public bool EnableSsl { get; set; } = true;

    public int TimeoutSeconds { get; set; } = 15;
}

public sealed class DevelopmentEmailOptions
{
    public bool ExposeTokens { get; set; }
}

public sealed class SmtpAccountEmailSender : IAccountEmailSender
{
    private readonly AccountEmailOptions _options;
    private readonly IHostEnvironment _environment;
    private readonly ILogger<SmtpAccountEmailSender> _logger;
    private readonly Uri? _publicFrontendBaseUri;
    private readonly MailAddress? _fromAddress;
    private readonly bool _developmentDisclosureEnabled;

    public SmtpAccountEmailSender(
        IOptions<AccountEmailOptions> options,
        IHostEnvironment environment,
        ILogger<SmtpAccountEmailSender> logger)
    {
        _options = options.Value;
        _options.Smtp ??= new SmtpOptions();
        _options.Development ??= new DevelopmentEmailOptions();
        _environment = environment;
        _logger = logger;
        _publicFrontendBaseUri = ParsePublicFrontendBaseUri(_options.PublicFrontendBaseUrl, environment);
        _fromAddress = ParseFromAddress(_options.FromAddress, _options.FromName);
        _developmentDisclosureEnabled = environment.IsDevelopment() && _options.Development.ExposeTokens;
        Availability = GetAvailability();

        if (!Availability.IsAvailable)
        {
            _logger.LogWarning("Account email delivery is unavailable: {Reason}", Availability.UnavailableReason);
        }
    }

    public AccountEmailAvailability Availability { get; }

    public Task<AccountEmailSendResult> SendEmailConfirmationAsync(
        ApplicationUser user,
        string token,
        CancellationToken cancellationToken = default)
    {
        var parameters = new Dictionary<string, string?>
        {
            ["userId"] = user.Id.ToString(),
            ["code"] = EncodeToken(token),
        };
        var actionUrl = BuildFrontendActionUrl("confirm-email", parameters);

        return SendAsync(
            user,
            "Confirm your Canvas To Do email",
            "Confirm email",
            "Confirm your email address to finish creating your Canvas To Do account.",
            actionUrl,
            cancellationToken);
    }

    public Task<AccountEmailSendResult> SendPasswordResetAsync(
        ApplicationUser user,
        string token,
        CancellationToken cancellationToken = default)
    {
        var parameters = new Dictionary<string, string?>
        {
            ["email"] = user.Email,
            ["code"] = EncodeToken(token),
        };
        var actionUrl = BuildFrontendActionUrl("reset-password", parameters);

        return SendAsync(
            user,
            "Reset your Canvas To Do password",
            "Reset password",
            "Use this link to choose a new Canvas To Do password. If you did not request this, you can ignore this email.",
            actionUrl,
            cancellationToken);
    }

    private async Task<AccountEmailSendResult> SendAsync(
        ApplicationUser user,
        string subject,
        string actionLabel,
        string introduction,
        string? actionUrl,
        CancellationToken cancellationToken)
    {
        if (!Availability.IsAvailable || string.IsNullOrWhiteSpace(actionUrl))
        {
            return new AccountEmailSendResult(AccountEmailSendStatus.Unavailable);
        }

        if (_developmentDisclosureEnabled)
        {
            // The action URL contains a bearer token. It is returned only when an operator
            // explicitly enables disclosure in the Development environment, and is never logged.
            return new AccountEmailSendResult(AccountEmailSendStatus.DevelopmentDisclosure, actionUrl);
        }

        if (string.IsNullOrWhiteSpace(user.Email) || _fromAddress is null)
        {
            return new AccountEmailSendResult(AccountEmailSendStatus.Failed);
        }

        try
        {
            using var message = new MailMessage
            {
                From = _fromAddress,
                Subject = subject,
                Body = BuildHtmlBody(actionLabel, introduction, actionUrl),
                IsBodyHtml = true,
            };
            message.To.Add(new MailAddress(user.Email));

            using var client = new SmtpClient(_options.Smtp.Host, _options.Smtp.Port)
            {
                DeliveryMethod = SmtpDeliveryMethod.Network,
                EnableSsl = _options.Smtp.EnableSsl,
                UseDefaultCredentials = false,
                Timeout = Math.Clamp(_options.Smtp.TimeoutSeconds, 1, 60) * 1000,
            };

            if (!string.IsNullOrWhiteSpace(_options.Smtp.Username))
            {
                client.Credentials = new NetworkCredential(_options.Smtp.Username, _options.Smtp.Password);
            }

            await client.SendMailAsync(message, cancellationToken);
            return new AccountEmailSendResult(AccountEmailSendStatus.Sent);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            // Do not log the recipient, body, link, or token. The exception type and SMTP
            // status are enough for an operator to diagnose delivery without leaking secrets.
            _logger.LogError(
                "Account email delivery failed ({ExceptionType}, SMTP status {SmtpStatus}).",
                exception.GetType().Name,
                exception is SmtpException smtpException ? smtpException.StatusCode : null);
            return new AccountEmailSendResult(AccountEmailSendStatus.Failed);
        }
    }

    private AccountEmailAvailability GetAvailability()
    {
        if (_publicFrontendBaseUri is null)
        {
            return new(false, "Email.PublicFrontendBaseUrl must be an absolute HTTPS URL (HTTP loopback is allowed in Development).");
        }

        if (_developmentDisclosureEnabled)
        {
            return new(true);
        }

        if (string.IsNullOrWhiteSpace(_options.Smtp.Host) ||
            _options.Smtp.Port is < 1 or > 65535 ||
            _fromAddress is null)
        {
            return new(false, "SMTP host, port, and a valid from address must be configured.");
        }

        if (string.IsNullOrWhiteSpace(_options.Smtp.Username) != string.IsNullOrWhiteSpace(_options.Smtp.Password))
        {
            return new(false, "SMTP username and password must either both be configured or both be empty.");
        }

        if (!_environment.IsDevelopment() && !_options.Smtp.EnableSsl)
        {
            return new(false, "SMTP TLS must be enabled outside Development.");
        }

        return new(true);
    }

    private string? BuildFrontendActionUrl(string localPath, IDictionary<string, string?> parameters)
    {
        if (_publicFrontendBaseUri is null)
        {
            return null;
        }

        var baseUrl = _publicFrontendBaseUri.AbsoluteUri.TrimEnd('/');
        var fragment = string.Join(
            '&',
            parameters.Select(parameter =>
                $"{Uri.EscapeDataString(parameter.Key)}={Uri.EscapeDataString(parameter.Value ?? string.Empty)}"));

        // Identity tokens are bearer credentials. A URL fragment is available to the SPA
        // but is never sent in the HTTP request line, reverse-proxy logs, or Referer header.
        return $"{baseUrl}/{localPath.TrimStart('/')}#{fragment}";
    }

    private static string BuildHtmlBody(string actionLabel, string introduction, string actionUrl)
    {
        var encodedLabel = WebUtility.HtmlEncode(actionLabel);
        var encodedIntroduction = WebUtility.HtmlEncode(introduction);
        var encodedUrl = WebUtility.HtmlEncode(actionUrl);

        return $$"""
            <!doctype html>
            <html lang="en">
              <body style="font-family:system-ui,sans-serif;line-height:1.5;color:#172033">
                <p>{{encodedIntroduction}}</p>
                <p><a href="{{encodedUrl}}">{{encodedLabel}}</a></p>
                <p style="font-size:0.875rem;color:#5f6b7a">If the button does not work, copy this address into your browser:<br>{{encodedUrl}}</p>
              </body>
            </html>
            """;
    }

    private static Uri? ParsePublicFrontendBaseUri(string? value, IHostEnvironment environment)
    {
        if (!Uri.TryCreate(value?.Trim().TrimEnd('/'), UriKind.Absolute, out var uri) ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment))
        {
            return null;
        }

        if (string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            return uri;
        }

        return environment.IsDevelopment() &&
               string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
               (uri.IsLoopback || string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase))
            ? uri
            : null;
    }

    private static MailAddress? ParseFromAddress(string? address, string? displayName)
    {
        try
        {
            return string.IsNullOrWhiteSpace(address)
                ? null
                : new MailAddress(address.Trim(), displayName?.Trim() ?? string.Empty, Encoding.UTF8);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static string EncodeToken(string token) =>
        WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));
}
