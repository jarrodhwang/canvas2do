import {
  ArrowLeft,
  ExternalLink,
  Inbox,
  MailPlus,
  MailOpen,
  MoreVertical,
  Paperclip,
  RefreshCw,
  Reply,
  Search,
  Send,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { workspaceApi, type OutlookMessage } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { cn } from '../lib/utils';
import { MicrosoftProductIcon } from './MicrosoftProductIcon';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { Textarea } from './ui/textarea';

const outlookPageSize = 50;

interface ComposeForm {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

const emptyComposeForm: ComposeForm = {
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  body: '',
};

function createEmailFrameDocument(html: string) {
  return `<!doctype html>
<html>
  <head>
    <base target="_blank" />
    <meta charset="utf-8" />
    <meta name="referrer" content="no-referrer" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src 'self' data: http: https:; style-src 'unsafe-inline' http: https:; font-src data: http: https:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    />
    <style>
      html,
      body {
        margin: 0;
        min-width: 0;
        overflow: hidden;
        padding: 0;
        background: transparent;
        color: #202124;
        font-family: Arial, Helvetica, sans-serif;
      }

      body {
        overflow-wrap: anywhere;
        word-break: normal;
      }

      img,
      table,
      video {
        max-width: 100% !important;
      }

      img {
        height: auto;
      }

      pre,
      code {
        white-space: pre-wrap;
        word-break: break-word;
      }

      a {
        color: #106ebe;
      }
    </style>
  </head>
  <body>
    ${html}
  </body>
</html>`;
}

function OutlookHtmlBodyFrame({ html, title }: { html: string; title: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(420);
  const srcDoc = useMemo(() => createEmailFrameDocument(html), [html]);

  const resizeToContent = () => {
    const documentElement = iframeRef.current?.contentDocument?.documentElement;
    const body = iframeRef.current?.contentDocument?.body;

    if (!documentElement || !body) {
      return;
    }

    const nextHeight = Math.max(
      320,
      documentElement.scrollHeight,
      body.scrollHeight,
      documentElement.offsetHeight,
      body.offsetHeight,
    );

    setHeight(nextHeight + 24);

    Array.from(body.querySelectorAll('img')).forEach((image) => {
      image.addEventListener('load', resizeToContent, { once: true });
      image.addEventListener('error', resizeToContent, { once: true });
    });
  };

  return (
    <iframe
      className="mt-7 w-full max-w-[1400px] rounded-sm border-0 bg-transparent"
      onLoad={resizeToContent}
      ref={iframeRef}
      referrerPolicy="no-referrer"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      style={{ height }}
      title={title}
    />
  );
}

function formatMessageTime(value: string | undefined, language: 'en' | 'ko') {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  return new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en-US', {
    day: isToday ? undefined : 'numeric',
    hour: isToday ? 'numeric' : undefined,
    minute: isToday ? '2-digit' : undefined,
    month: isToday ? undefined : 'short',
  }).format(date);
}

function formatFullMessageDate(value: string | undefined, language: 'en' | 'ko') {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getSenderName(from: string) {
  const emailIndex = from.indexOf('<');
  const rawName = emailIndex > 0 ? from.slice(0, emailIndex).trim() : from;

  return rawName.replace(/^"|"$/g, '') || from;
}

function getEmailAddress(value: string | undefined) {
  if (!value) {
    return '';
  }

  const match = /<([^>]+)>/.exec(value);

  return (match?.[1] ?? value).trim();
}

function getSenderInitial(from: string) {
  return getSenderName(from).trim().charAt(0).toUpperCase() || 'O';
}

function ensureReplySubject(subject: string | undefined) {
  const nextSubject = subject?.trim() || '';

  return nextSubject.toLowerCase().startsWith('re:') ? nextSubject : `Re: ${nextSubject}`;
}

function quoteReplyBody(message: OutlookMessage, language: 'en' | 'ko') {
  const sentAt = formatFullMessageDate(message.receivedAt, language);
  const header =
    language === 'ko'
      ? `\n\n${sentAt}에 ${message.from}님이 작성:\n`
      : `\n\nOn ${sentAt}, ${message.from} wrote:\n`;

  return `${header}${message.bodyPreview}`;
}

export function OutlookEmailView() {
  const { dictionary, language } = useLanguage();
  const [messages, setMessages] = useState<OutlookMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedMessageDetail, setSelectedMessageDetail] = useState<OutlookMessage | null>(null);
  const [searchText, setSearchText] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composeForm, setComposeForm] = useState<ComposeForm>(emptyComposeForm);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [composeNotice, setComposeNotice] = useState('');
  const selectedListMessage = messages.find((message) => message.id === selectedId) ?? messages[0];
  const selectedMessage = selectedMessageDetail?.id === selectedListMessage?.id
    ? selectedMessageDetail
    : selectedListMessage;
  const unreadCount = messages.filter((message) => message.unread).length;
  const selectedMessageBody = selectedMessage?.bodyPreview || dictionary.gmailNoBody;

  useEffect(() => {
    let isMounted = true;

    setIsLoading(true);
    workspaceApi
      .getOutlookMessages({ search: submittedSearch, pageSize: outlookPageSize })
      .then((response) => {
        if (!isMounted) {
          return;
        }

        setMessages(response.messages);
        setSelectedMessageDetail(null);
        setSelectedId((current) =>
          response.messages.some((message) => message.id === current)
            ? current
            : response.messages[0]?.id,
        );
      })
      .catch((loadError: unknown) => {
        if (!isMounted) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Microsoft Graph request failed.');
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [reloadKey, submittedSearch]);

  useEffect(() => {
    let isMounted = true;

    if (!selectedListMessage) {
      setSelectedMessageDetail(null);
      return undefined;
    }

    setIsDetailLoading(true);
    workspaceApi
      .getOutlookMessage(selectedListMessage.id)
      .then((message) => {
        if (!isMounted) {
          return;
        }

        setSelectedMessageDetail(message);
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }

        setSelectedMessageDetail(null);
      })
      .finally(() => {
        if (isMounted) {
          setIsDetailLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedListMessage?.id]);

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmittedSearch(searchText.trim());
    setReloadKey((current) => current + 1);
  };

  const handleRefresh = () => {
    setError(null);
    setReloadKey((current) => current + 1);
  };

  const openCompose = (overrides: Partial<ComposeForm> = {}) => {
    setComposeNotice('');
    setComposeForm({ ...emptyComposeForm, ...overrides });
    setIsComposeOpen(true);
  };

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSending(true);
    setComposeNotice('');

    try {
      await workspaceApi.sendOutlookMessage(composeForm);
      setComposeNotice(dictionary.gmailComposeSent);
      setComposeForm(emptyComposeForm);
      setIsComposeOpen(false);
      setReloadKey((current) => current + 1);
    } catch (sendError) {
      setComposeNotice(sendError instanceof Error ? sendError.message : 'Unable to send Outlook message.');
    } finally {
      setIsSending(false);
    }
  };

  const handleToggleRead = async (message: OutlookMessage) => {
    const updater = message.unread
      ? workspaceApi.markOutlookMessageRead
      : workspaceApi.markOutlookMessageUnread;

    await updater(message.id);
    setMessages((currentMessages) =>
      currentMessages.map((currentMessage) =>
        currentMessage.id === message.id
          ? { ...currentMessage, unread: !message.unread }
          : currentMessage,
      ),
    );
    setSelectedMessageDetail((currentMessage) =>
      currentMessage?.id === message.id
        ? { ...currentMessage, unread: !message.unread }
        : currentMessage,
    );
  };

  return (
    <Card className="relative flex min-h-[620px] flex-col gap-0 overflow-hidden rounded-xl bg-card py-0 shadow-none xl:h-full xl:min-h-0">
      <div className="border-b px-3 py-2">
        <form className="flex min-w-0 items-center gap-2" onSubmit={handleSearch}>
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
            <MicrosoftProductIcon decorative product="outlook" size={22} />
          </span>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-9 font-semibold"
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={dictionary.outlookSearchEmail}
              value={searchText}
            />
          </div>
          <Button
            aria-label={dictionary.outlookSearchEmail}
            className="size-8 shrink-0"
            size="icon"
            type="submit"
            variant="outline"
          >
            <Search className="size-4" />
          </Button>
          <Button
            aria-label={dictionary.driveRefresh}
            className="size-8 shrink-0"
            onClick={handleRefresh}
            size="icon"
            type="button"
            variant="outline"
          >
            <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
          </Button>
          <Badge className="h-8 shrink-0 rounded-lg px-2.5 text-xs" variant="outline">
            {unreadCount} {dictionary.googleCommunicationUnread}
          </Badge>
          <Button
            className="h-8 shrink-0 px-3"
            onClick={() => openCompose()}
            size="sm"
            type="button"
          >
            <MailPlus className="size-4" />
            <span>{dictionary.googleCommunicationComposeEmail}</span>
          </Button>
        </form>
      </div>

      {error ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-xl rounded-xl border bg-muted/35 p-5 text-center">
            <MicrosoftProductIcon decorative product="outlook" size={34} />
            <h3 className="mt-3 text-lg font-black">{dictionary.outlookTitle}</h3>
            <p className="mt-2 text-sm font-semibold text-muted-foreground">{error}</p>
            <Button
              className="mt-4"
              onClick={() => {
                window.location.href = `${workspaceApi.apiBaseUrl}/microsoft/integrations/outlook/connect`;
              }}
              type="button"
            >
              {dictionary.outlookReconnect}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-0 p-0 xl:grid-cols-[minmax(320px,460px)_minmax(0,1fr)]">
          <aside className="min-h-0 border-r max-xl:border-b max-xl:border-r-0">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Inbox className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-black">{dictionary.googleCommunicationInbox}</h3>
              </div>
              <span className="text-xs font-black text-muted-foreground">{messages.length}</span>
            </div>
            <Separator />
            <div className="grid max-h-[360px] gap-1 overflow-y-auto p-2 xl:max-h-none">
              {isLoading ? (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/35 p-4 text-sm font-bold text-muted-foreground">
                  <RefreshCw className="size-4 animate-spin" />
                  {dictionary.driveLoading}
                </div>
              ) : null}
              {!isLoading && messages.length === 0 ? (
                <p className="rounded-lg border bg-muted/35 p-4 text-sm font-bold text-muted-foreground">
                  {dictionary.outlookNoEmail}
                </p>
              ) : null}
              {messages.map((message) => {
                const active = message.id === selectedListMessage?.id;

                return (
                  <button
                    className={cn(
                      'grid min-w-0 grid-cols-[34px_minmax(0,1fr)_auto] items-start gap-3 rounded-lg p-3 text-left transition hover:bg-muted',
                      active && 'bg-muted text-foreground',
                    )}
                    key={message.id}
                    onClick={() => setSelectedId(message.id)}
                    type="button"
                  >
                    <span
                      className={cn(
                        'grid size-8 place-items-center rounded-full text-xs font-black text-white',
                        message.unread ? 'bg-[#0078D4]' : 'bg-muted-foreground',
                      )}
                    >
                      {getSenderInitial(message.from)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <strong className={cn('min-w-0 truncate text-sm', message.unread && 'font-black')}>
                          {getSenderName(message.from)}
                        </strong>
                        {message.hasAttachments ? <Paperclip className="size-3 shrink-0 text-muted-foreground" /> : null}
                      </span>
                      <span className={cn('mt-1 block truncate text-sm', message.unread ? 'font-black' : 'font-semibold')}>
                        {message.subject || dictionary.gmailNoBody}
                      </span>
                      <span className="mt-1 line-clamp-2 text-xs font-semibold text-muted-foreground">
                        {message.bodyPreview}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-black text-muted-foreground">
                      {formatMessageTime(message.receivedAt, language)}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto bg-background/35">
            {selectedMessage ? (
              <article className="mx-auto max-w-[1400px] p-4 lg:p-7">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <Button
                    aria-label={dictionary.gmailBackToInbox}
                    className="xl:hidden"
                    size="icon-sm"
                    type="button"
                    variant="outline"
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      aria-label={selectedMessage.unread ? dictionary.outlookMarkRead : dictionary.outlookMarkUnread}
                      onClick={() => {
                        void handleToggleRead(selectedMessage);
                      }}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <MailOpen className="size-4" />
                    </Button>
                    {selectedMessage.webLink ? (
                      <Button
                        aria-label={dictionary.gmailOpenInNewWindow}
                        onClick={() => window.open(selectedMessage.webLink, '_blank', 'noopener,noreferrer')}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <ExternalLink className="size-4" />
                      </Button>
                    ) : null}
                    <Button aria-label={dictionary.gmailMoreActions} size="icon-sm" type="button" variant="ghost">
                      <MoreVertical className="size-4" />
                    </Button>
                  </div>
                </div>

                <h2 className="max-w-5xl text-2xl font-semibold tracking-normal">
                  {selectedMessage.subject || dictionary.gmailNoBody}
                </h2>

                <div className="mt-5 flex min-w-0 items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#0078D4] text-sm font-black text-white">
                    {getSenderInitial(selectedMessage.from)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm">{getSenderName(selectedMessage.from)}</strong>
                        <p className="text-xs font-semibold text-muted-foreground">
                          {selectedMessage.to ? dictionary.gmailTo : dictionary.gmailToMe}{' '}
                          {selectedMessage.to ?? dictionary.gmailToMe}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-muted-foreground">
                        {formatFullMessageDate(selectedMessage.receivedAt, language)}
                      </span>
                    </div>

                    <div className="mt-4 rounded-xl border bg-card p-4 text-sm">
                      <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
                        <span className="font-bold text-muted-foreground">{dictionary.gmailFrom}</span>
                        <span className="break-words">{selectedMessage.from}</span>
                        <span className="font-bold text-muted-foreground">{dictionary.gmailTo}</span>
                        <span className="break-words">{selectedMessage.to ?? dictionary.gmailToMe}</span>
                        <span className="font-bold text-muted-foreground">{dictionary.gmailDate}</span>
                        <span>{formatFullMessageDate(selectedMessage.receivedAt, language)}</span>
                        <span className="font-bold text-muted-foreground">{dictionary.gmailSecurity}</span>
                        <span>{dictionary.gmailStandardEncryption}</span>
                      </div>
                    </div>

                    {isDetailLoading ? (
                      <div className="mt-7 flex items-center gap-2 text-sm font-bold text-muted-foreground">
                        <RefreshCw className="size-4 animate-spin" />
                        {dictionary.driveLoading}
                      </div>
                    ) : selectedMessage.bodyHtml ? (
                      <OutlookHtmlBodyFrame html={selectedMessage.bodyHtml} title={selectedMessage.subject ?? ''} />
                    ) : (
                      <p className="mt-7 whitespace-pre-wrap text-sm leading-7">{selectedMessageBody}</p>
                    )}

                    <div className="mt-8 flex flex-wrap gap-2">
                      <Button
                        onClick={() =>
                          openCompose({
                            to: getEmailAddress(selectedMessage.from),
                            subject: ensureReplySubject(selectedMessage.subject),
                            body: quoteReplyBody(selectedMessage, language),
                          })
                        }
                        type="button"
                        variant="outline"
                      >
                        <Reply className="size-4" />
                        {dictionary.gmailReply}
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            ) : (
              <div className="flex h-full min-h-[360px] items-center justify-center p-6">
                <p className="text-sm font-bold text-muted-foreground">{dictionary.outlookNoEmail}</p>
              </div>
            )}
          </section>
        </div>
      )}

      {isComposeOpen ? (
        <form
          aria-label={dictionary.outlookComposeEmail}
          className="absolute bottom-4 right-4 z-20 grid w-[min(520px,calc(100%-32px))] gap-0 overflow-hidden rounded-xl border bg-card shadow-2xl"
          onSubmit={handleSend}
        >
          <div className="flex items-center justify-between border-b bg-[#0078D4] px-4 py-2 text-sm font-black text-white">
            <span className="min-w-0 truncate">{dictionary.outlookComposeEmail}</span>
            <Button
              className="size-7 text-white hover:bg-white/15"
              onClick={() => setIsComposeOpen(false)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="grid gap-0">
            <label className="grid grid-cols-[64px_minmax(0,1fr)] items-center border-b px-3 py-2 text-xs font-bold">
              <span className="text-muted-foreground">{dictionary.gmailComposeTo}</span>
              <Input
                className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
                onChange={(event) => setComposeForm((current) => ({ ...current, to: event.target.value }))}
                required
                value={composeForm.to}
              />
            </label>
            <label className="grid grid-cols-[64px_minmax(0,1fr)] items-center border-b px-3 py-2 text-xs font-bold">
              <span className="text-muted-foreground">{dictionary.gmailComposeCc}</span>
              <Input
                className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
                onChange={(event) => setComposeForm((current) => ({ ...current, cc: event.target.value }))}
                value={composeForm.cc}
              />
            </label>
            <label className="grid grid-cols-[64px_minmax(0,1fr)] items-center border-b px-3 py-2 text-xs font-bold">
              <span className="text-muted-foreground">{dictionary.gmailComposeBcc}</span>
              <Input
                className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
                onChange={(event) => setComposeForm((current) => ({ ...current, bcc: event.target.value }))}
                value={composeForm.bcc}
              />
            </label>
            <Input
              className="h-10 rounded-none border-0 border-b px-3 shadow-none focus-visible:ring-0"
              onChange={(event) => setComposeForm((current) => ({ ...current, subject: event.target.value }))}
              placeholder={dictionary.gmailComposeSubject}
              value={composeForm.subject}
            />
            <Textarea
              className="min-h-44 resize-none rounded-none border-0 px-3 py-3 shadow-none focus-visible:ring-0"
              onChange={(event) => setComposeForm((current) => ({ ...current, body: event.target.value }))}
              placeholder={dictionary.gmailComposeBody}
              required
              value={composeForm.body}
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
            <span className="min-w-0 truncate text-xs font-bold text-muted-foreground">{composeNotice}</span>
            <Button disabled={isSending} size="sm" type="submit">
              <Send className="size-4" />
              <span>{isSending ? dictionary.gmailComposeSending : dictionary.gmailComposeSend}</span>
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
