namespace Incos.Workspace.Api.Infrastructure;

public static class MicrosoftGraphScopes
{
    public const string UserRead = "User.Read";
    public const string MailRead = "Mail.Read";
    public const string MailReadWrite = "Mail.ReadWrite";
    public const string MailSend = "Mail.Send";

    public static readonly string[] Authorization =
    [
        "openid",
        "profile",
        "email",
        "offline_access",
        UserRead,
        MailRead,
        MailReadWrite,
        MailSend,
    ];

    public static readonly string[] Outlook =
    [
        UserRead,
        MailRead,
        MailReadWrite,
        MailSend,
    ];
}
