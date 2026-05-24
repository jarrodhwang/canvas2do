namespace Incos.Workspace.Api.Infrastructure;

public static class GoogleWorkspaceScopes
{
    public const string CalendarEventsReadonly = "https://www.googleapis.com/auth/calendar.events.readonly";
    public const string CalendarListReadonly = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
    public const string DriveReadonly = "https://www.googleapis.com/auth/drive.readonly";
    public const string GmailReadonly = "https://www.googleapis.com/auth/gmail.readonly";
    public const string GmailModify = "https://www.googleapis.com/auth/gmail.modify";
    public const string GmailSend = "https://www.googleapis.com/auth/gmail.send";
    public const string ChatSpacesReadonly = "https://www.googleapis.com/auth/chat.spaces.readonly";
    public const string ChatMessagesReadonly = "https://www.googleapis.com/auth/chat.messages.readonly";

    public static readonly string[] Calendar =
    [
        CalendarEventsReadonly,
        CalendarListReadonly,
    ];

    public static readonly string[] Drive =
    [
        DriveReadonly,
    ];

    public static readonly string[] Gmail =
    [
        GmailReadonly,
        GmailModify,
        GmailSend,
    ];

    public static readonly string[] Chat =
    [
        ChatSpacesReadonly,
        ChatMessagesReadonly,
    ];

    public static readonly string[] All =
    [
        CalendarEventsReadonly,
        CalendarListReadonly,
        DriveReadonly,
        GmailReadonly,
        GmailModify,
        GmailSend,
        ChatSpacesReadonly,
        ChatMessagesReadonly,
    ];
}
