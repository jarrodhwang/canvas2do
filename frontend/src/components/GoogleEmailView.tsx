import {
  Archive,
  ArrowLeft,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileText,
  Folder,
  Forward,
  Inbox,
  Mail,
  MailPlus,
  MailOpen,
  Menu,
  MoreVertical,
  Paperclip,
  Printer,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Smile,
  Star,
  Tag,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { workspaceApi, type GoogleGmailMessage } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { cn } from '../lib/utils';
import { GoogleProductIcon } from './GoogleProductIcon';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Textarea } from './ui/textarea';

type GmailCategory = 'primary' | 'promotions' | 'social';

const gmailPageSize = 50;

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
        color: #1a73e8;
      }
    </style>
  </head>
  <body>
    ${html}
  </body>
</html>`;
}

function GmailHtmlBodyFrame({ html, title }: { html: string; title: string }) {
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

function classifyMessage(message: GoogleGmailMessage): GmailCategory {
  const labels = message.labels.join(' ').toLowerCase();
  const text = `${message.from} ${message.subject} ${message.snippet}`.toLowerCase();

  if (labels.includes('category_social') || text.includes('linkedin')) {
    return 'social';
  }

  if (labels.includes('category_promotions') || text.includes('newsletter') || text.includes('webinar')) {
    return 'promotions';
  }

  return 'primary';
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
  return getSenderName(from).trim().charAt(0).toUpperCase() || 'G';
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

function ensureReplySubject(subject: string) {
  return subject.trim().toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
}

function ensureForwardSubject(subject: string) {
  return subject.trim().toLowerCase().startsWith('fwd:') ? subject : `Fwd: ${subject}`;
}

function quoteForwardBody(message: GoogleGmailMessage, language: 'en' | 'ko') {
  const sentAt = formatFullMessageDate(message.receivedAt, language);
  const header =
    language === 'ko'
      ? `---------- 전달된 메시지 ----------\n보낸사람: ${message.from}\n날짜: ${sentAt}\n제목: ${message.subject}\n받는사람: ${message.to ?? ''}`
      : `---------- Forwarded message ----------\nFrom: ${message.from}\nDate: ${sentAt}\nSubject: ${message.subject}\nTo: ${message.to ?? ''}`;

  return `\n\n${header}\n\n${message.bodyPreview || message.snippet}`;
}

function formatFileSize(sizeBytes: number | undefined, language: 'en' | 'ko') {
  if (!sizeBytes) {
    return '';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${new Intl.NumberFormat(language === 'ko' ? 'ko-KR' : 'en-US', {
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
  }).format(value)} ${units[unitIndex]}`;
}

function getAttachmentHints(message: GoogleGmailMessage) {
  const attachments = message.attachments ?? [];

  if (attachments.length > 0) {
    return attachments.map((attachment) => attachment.fileName).slice(0, 3);
  }

  return message.labels
    .filter((label) => !['INBOX', 'UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL'].includes(label.toUpperCase()))
    .slice(0, 3);
}

function setMessageUnread(message: GoogleGmailMessage, unread: boolean): GoogleGmailMessage {
  const labels = message.labels.filter((label) => label.toUpperCase() !== 'UNREAD');

  return {
    ...message,
    labels: unread ? [...labels, 'UNREAD'] : labels,
    unread,
  };
}

function applyUnreadOverrides(
  messages: GoogleGmailMessage[],
  overrides: Record<string, boolean>,
) {
  return messages.map((message) =>
    Object.prototype.hasOwnProperty.call(overrides, message.id)
      ? setMessageUnread(message, overrides[message.id])
      : message,
  );
}

const gmailCategoryStyles: Record<
  GmailCategory,
  {
    badgeActive: string;
    badgeInactive: string;
    icon: string;
  }
> = {
  primary: {
    badgeActive: 'bg-yellow-400 text-yellow-950 hover:bg-yellow-400',
    badgeInactive: 'border-yellow-500/25 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
    icon: 'text-yellow-600',
  },
  promotions: {
    badgeActive: 'bg-green-700 text-white hover:bg-green-700',
    badgeInactive: 'border-green-600/25 bg-green-600/10 text-green-700 dark:text-green-300',
    icon: 'text-green-600',
  },
  social: {
    badgeActive: 'bg-blue-700 text-white hover:bg-blue-700',
    badgeInactive: 'border-blue-600/25 bg-blue-600/10 text-blue-700 dark:text-blue-300',
    icon: 'text-blue-600',
  },
};

export function GoogleEmailView() {
  const { dictionary, language } = useLanguage();
  const [messages, setMessages] = useState<GoogleGmailMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [isReadingMessage, setIsReadingMessage] = useState(false);
  const [loadedMessageDetailIds, setLoadedMessageDetailIds] = useState<Set<string>>(() => new Set());
  const [messageDetailLoadingId, setMessageDetailLoadingId] = useState<string>();
  const [messageDetailError, setMessageDetailError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [pageToken, setPageToken] = useState<string>();
  const [previousPageTokens, setPreviousPageTokens] = useState<string[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string>();
  const [resultSizeEstimate, setResultSizeEstimate] = useState<number>();
  const [category, setCategory] = useState<GmailCategory>('primary');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeForm, setComposeForm] = useState<ComposeForm>(emptyComposeForm);
  const [showCarbonCopy, setShowCarbonCopy] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeNotice, setComposeNotice] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const messageDetailAbortRef = useRef<AbortController | null>(null);
  const unreadOverridesRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    workspaceApi
      .getGoogleGmailMessages({
        pageSize: gmailPageSize,
        pageToken,
        search: submittedSearch,
        signal: controller.signal,
      })
      .then((response) => {
        if (!isMounted) {
          return;
        }

        setMessages(applyUnreadOverrides(response.messages, unreadOverridesRef.current));
        setNextPageToken(response.nextPageToken);
        setResultSizeEstimate(response.resultSizeEstimate);
        setSelectedId((current) => {
          const hasCurrentMessage = response.messages.some((message) => message.id === current);

          if (!hasCurrentMessage) {
            setIsReadingMessage(false);
          }

          return hasCurrentMessage ? current : response.messages[0]?.id;
        });
      })
      .catch((loadError: unknown) => {
        if (!isMounted) {
          return;
        }

        if (loadError instanceof DOMException && loadError.name === 'AbortError') {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Google API request failed.');
      })
      .finally(() => {
        if (isMounted && !controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [pageToken, reloadKey, submittedSearch]);

  const unreadCount = useMemo(
    () => messages.filter((message) => message.unread).length,
    [messages],
  );

  const categoryUnreadCounts = useMemo(() => {
    return messages.reduce<Record<GmailCategory, number>>(
      (counts, message) => {
        if (message.unread) {
          counts[classifyMessage(message)] += 1;
        }

        return counts;
      },
      { primary: 0, promotions: 0, social: 0 },
    );
  }, [messages]);

  const visibleMessages = useMemo(
    () => messages.filter((message) => classifyMessage(message) === category),
    [category, messages],
  );
  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedId),
    [messages, selectedId],
  );
  const selectedAttachments = selectedMessage?.attachments ?? [];
  const selectedMessageBody = selectedMessage?.bodyPreview || selectedMessage?.snippet || dictionary.gmailNoBody;
  const isSelectedMessageDetailLoading = Boolean(
    selectedMessage && messageDetailLoadingId === selectedMessage.id,
  );
  const pageStart = messages.length > 0 ? previousPageTokens.length * gmailPageSize + 1 : 0;
  const pageEnd = previousPageTokens.length * gmailPageSize + messages.length;
  const rangeLabel = resultSizeEstimate
    ? `${pageStart.toLocaleString()}-${pageEnd.toLocaleString()} / ${resultSizeEstimate.toLocaleString()}`
    : `${pageStart.toLocaleString()}-${pageEnd.toLocaleString()}`;

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    messageDetailAbortRef.current?.abort();
    setIsLoading(true);
    setError(null);
    setMessageDetailError(null);
    setIsReadingMessage(false);
    setLoadedMessageDetailIds(new Set());
    setPreviousPageTokens([]);
    setPageToken(undefined);
    setSubmittedSearch(searchText.trim());
    setReloadKey((current) => current + 1);
  };

  const handleRefresh = () => {
    if (isLoading) {
      return;
    }

    messageDetailAbortRef.current?.abort();
    setIsLoading(true);
    setError(null);
    setMessageDetailError(null);
    setLoadedMessageDetailIds(new Set());
    setReloadKey((current) => current + 1);
  };

  const handlePreviousPage = () => {
    if (isLoading) {
      return;
    }

    messageDetailAbortRef.current?.abort();
    const previousToken = previousPageTokens.at(-1);

    setMessageDetailError(null);
    setLoadedMessageDetailIds(new Set());
    setIsReadingMessage(false);
    setPreviousPageTokens((current) => current.slice(0, -1));
    setPageToken(previousToken || undefined);
    setIsLoading(true);
    setError(null);
  };

  const handleNextPage = () => {
    if (!nextPageToken || isLoading) {
      return;
    }

    messageDetailAbortRef.current?.abort();
    setMessageDetailError(null);
    setLoadedMessageDetailIds(new Set());
    setIsReadingMessage(false);
    setPreviousPageTokens((current) => [...current, pageToken ?? '']);
    setPageToken(nextPageToken);
    setIsLoading(true);
    setError(null);
  };

  const handleComposeChange = (field: keyof ComposeForm, value: string) => {
    setComposeForm((current) => ({ ...current, [field]: value }));
    setComposeError(null);
    setComposeNotice(null);
  };

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!composeForm.to.trim() || !composeForm.body.trim()) {
      setComposeError(
        language === 'ko'
          ? '받는사람과 메시지를 입력하세요.'
          : 'Add a recipient and message body.',
      );

      return;
    }

    setIsSending(true);
    setComposeError(null);
    setComposeNotice(null);

    try {
      await workspaceApi.sendGoogleGmailMessage({
        body: composeForm.body,
        bcc: composeForm.bcc,
        cc: composeForm.cc,
        subject: composeForm.subject,
        to: composeForm.to,
      });
      setComposeForm(emptyComposeForm);
      setComposeOpen(false);
      setComposeNotice(dictionary.gmailComposeSent);
      setIsLoading(true);
      setError(null);
      setReloadKey((current) => current + 1);
    } catch (sendError) {
      setComposeError(sendError instanceof Error ? sendError.message : 'Unable to send message.');
    } finally {
      setIsSending(false);
    }
  };

  const setMessageUnreadLocally = (messageId: string, unread: boolean) => {
    unreadOverridesRef.current = {
      ...unreadOverridesRef.current,
      [messageId]: unread,
    };
    setMessages((current) =>
      current.map((message) => (message.id === messageId ? setMessageUnread(message, unread) : message)),
    );
  };

  const setMessageUnreadInGmail = (messageId: string, unread: boolean) => {
    setMessageUnreadLocally(messageId, unread);

    const request = unread
      ? workspaceApi.markGoogleGmailMessageUnread(messageId)
      : workspaceApi.markGoogleGmailMessageRead(messageId);

    request
      .catch((markReadError: unknown) => {
        setMessageDetailError(
          markReadError instanceof Error
            ? markReadError.message
            : unread
              ? 'Unable to mark Gmail message as unread.'
              : 'Unable to mark Gmail message as read.',
        );
      });
  };

  const toggleSelectedMessageUnread = () => {
    if (!selectedMessage) {
      return;
    }

    setMessageUnreadInGmail(selectedMessage.id, !selectedMessage.unread);
  };

  const openMessage = (message: GoogleGmailMessage) => {
    setSelectedId(message.id);
    setIsReadingMessage(true);

    if (message.unread) {
      setMessageUnreadInGmail(message.id, false);
    }

    if (loadedMessageDetailIds.has(message.id)) {
      return;
    }

    messageDetailAbortRef.current?.abort();
    const controller = new AbortController();
    messageDetailAbortRef.current = controller;
    setMessageDetailLoadingId(message.id);
    setMessageDetailError(null);

    workspaceApi
      .getGoogleGmailMessage(message.id, { signal: controller.signal })
      .then((fullMessage) => {
        if (controller.signal.aborted) {
          return;
        }

        setMessages((current) =>
          current.map((currentMessage) =>
            currentMessage.id === fullMessage.id ? {
              ...currentMessage,
              ...fullMessage,
              labels: setMessageUnread(fullMessage, currentMessage.unread).labels,
              unread: currentMessage.unread,
            } : currentMessage,
          ),
        );
        setLoadedMessageDetailIds((current) => new Set(current).add(fullMessage.id));
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setMessageDetailError(
          loadError instanceof Error ? loadError.message : 'Unable to load Gmail message.',
        );
      })
      .finally(() => {
        if (messageDetailAbortRef.current === controller) {
          setMessageDetailLoadingId(undefined);
        }
      });
  };

  const openReplyCompose = (message: GoogleGmailMessage, mode: 'reply' | 'replyAll' | 'forward') => {
    const senderAddress = getEmailAddress(message.from);

    setComposeError(null);
    setComposeNotice(null);
    setShowCarbonCopy(false);
    setComposeForm({
      bcc: '',
      body: mode === 'forward' ? quoteForwardBody(message, language) : '',
      cc: mode === 'replyAll' ? message.to ?? '' : '',
      subject: mode === 'forward' ? ensureForwardSubject(message.subject) : ensureReplySubject(message.subject),
      to: mode === 'forward' ? '' : senderAddress,
    });
    setComposeOpen(true);
  };

  const navItems = [
    { icon: Inbox, label: dictionary.googleCommunicationInbox, count: messages.length, active: true },
    { icon: Star, label: dictionary.gmailStarred },
    { icon: Clock3, label: dictionary.gmailSnoozed },
    { icon: Send, label: dictionary.gmailSent },
    { icon: FileText, label: dictionary.gmailDrafts },
    { icon: Tag, label: dictionary.gmailCategories },
    { icon: ChevronDown, label: dictionary.gmailMore },
  ];

  return (
    <Card className="relative flex h-[calc(100dvh-98px)] min-h-[620px] flex-col gap-0 overflow-hidden rounded-xl bg-card py-0 shadow-none xl:h-full xl:min-h-0">
      <div
        className={cn(
          'grid min-h-0 flex-1 bg-[#f6f8fc] dark:bg-background max-lg:grid-cols-[74px_minmax(0,1fr)]',
          sidebarCollapsed
            ? 'grid-cols-[74px_minmax(0,1fr)]'
            : 'grid-cols-[260px_minmax(0,1fr)]',
        )}
      >
        <aside className="flex min-h-0 flex-col border-r border-border/60 bg-[#edf2fa] dark:bg-muted/35">
          <div className="flex h-14 items-center gap-3 px-4 max-lg:justify-center max-lg:px-2">
            <Button
              aria-label={sidebarCollapsed ? dictionary.gmailExpandMenu : dictionary.gmailCollapseMenu}
              onClick={() => setSidebarCollapsed((current) => !current)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Menu className="size-5" />
            </Button>
            <div className={cn('flex min-w-0 items-center gap-2 max-lg:hidden', sidebarCollapsed && 'hidden')}>
              <GoogleProductIcon decorative product="gmail" size={30} />
              <span className="truncate text-2xl font-semibold text-foreground/85">Gmail</span>
            </div>
          </div>

          <div className="px-4 pb-4 max-lg:px-2">
            <Button
              className={cn(
                'h-14 w-full justify-start gap-3 rounded-2xl bg-[#c2e7ff] px-5 text-base font-semibold text-slate-900 hover:bg-[#b6def8] dark:bg-primary/90 dark:text-primary-foreground dark:hover:bg-primary',
                sidebarCollapsed && 'justify-center px-0',
              )}
              onClick={() => setComposeOpen(true)}
              type="button"
            >
              <MailPlus className="size-5" />
              <span className={cn('max-lg:hidden', sidebarCollapsed && 'hidden')}>
                {dictionary.googleCommunicationComposeEmail}
              </span>
            </Button>
          </div>

          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4 max-lg:px-2">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <Button
                  className={cn(
                    'h-9 w-full justify-start rounded-full px-4 text-sm font-semibold max-lg:justify-center max-lg:px-0',
                    sidebarCollapsed && 'justify-center px-0',
                    item.active && 'bg-[#d3e3fd] text-foreground hover:bg-[#d3e3fd] dark:bg-primary/20',
                  )}
                  key={item.label}
                  type="button"
                  variant="ghost"
                >
                  <Icon className="size-4" />
                  <span className={cn('min-w-0 flex-1 truncate text-left max-lg:hidden', sidebarCollapsed && 'hidden')}>
                    {item.label}
                  </span>
                  {item.count ? (
                    <span className={cn('ml-auto text-xs font-black max-lg:hidden', sidebarCollapsed && 'hidden')}>
                      {item.count.toLocaleString()}
                    </span>
                  ) : null}
                </Button>
              );
            })}

            <div className={cn('px-4 pt-5 max-lg:hidden', sidebarCollapsed && 'hidden')}>
              <div className="flex items-center justify-between text-sm font-black">
                <span>{dictionary.gmailLabels}</span>
                <Button size="icon-sm" type="button" variant="ghost">
                  <MailPlus className="size-4" />
                </Button>
              </div>
              <div className="mt-2 space-y-1">
                {['cg@incos.me', 'linework', 'Notes'].map((label, index) => (
                  <Button
                    className="h-8 w-full justify-start rounded-full px-3 text-sm font-semibold text-muted-foreground"
                    key={label}
                    type="button"
                    variant="ghost"
                  >
                    <Tag className="size-4 fill-muted-foreground/70 text-muted-foreground/70" />
                    <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                    {index === 0 ? <span className="text-xs">5,936</span> : null}
                  </Button>
                ))}
              </div>
            </div>
          </nav>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col bg-card">
          <div className="flex h-14 shrink-0 items-center gap-3 border-b bg-[#f6f8fc] px-4 dark:bg-background">
            <form className="relative min-w-0 flex-1" onSubmit={handleSearch}>
              <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-11 rounded-full border-transparent bg-[#eaf1fb] pl-12 pr-12 text-base font-semibold shadow-none focus-visible:bg-background dark:bg-muted/50"
                onChange={(event) => setSearchText(event.target.value)}
                placeholder={dictionary.googleCommunicationSearchEmail}
                value={searchText}
              />
              <Button
                aria-label={dictionary.googleCommunicationSearchEmail}
                className="absolute right-1 top-1/2 size-9 -translate-y-1/2"
                size="icon"
                type="submit"
                variant="ghost"
              >
                <SlidersHorizontal className="size-5" />
              </Button>
            </form>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Badge className="h-9 rounded-full px-3 text-sm" variant="secondary">
                {unreadCount} {dictionary.googleCommunicationUnread}
              </Badge>
              <Button onClick={handleRefresh} size="icon" type="button" variant="ghost">
                <RefreshCw className={cn('size-5', isLoading && 'animate-spin')} />
              </Button>
              <Button aria-label="Gemini" className="max-md:hidden" size="icon" type="button" variant="ghost">
                <GoogleProductIcon decorative product="gemini" size={21} />
              </Button>
              <Button className="max-md:hidden" size="icon" type="button" variant="ghost">
                <Settings className="size-5" />
              </Button>
            </div>
          </div>

          {error ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="max-w-xl rounded-xl border bg-muted/35 p-5 text-center">
                <GoogleProductIcon decorative product="gmail" size={30} />
                <h3 className="mt-3 text-lg font-black">{dictionary.googleEmailTitle}</h3>
                <p className="mt-2 text-sm font-semibold text-muted-foreground">{error}</p>
                <Button
                  className="mt-4"
                  onClick={() => {
                    window.location.href = `${workspaceApi.apiBaseUrl}/google/integrations/gmail/connect`;
                  }}
                  type="button"
                >
                  {dictionary.reconnectGoogle}
                </Button>
              </div>
            </div>
          ) : isReadingMessage && selectedMessage ? (
            <>
              <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
                <div className="flex min-w-0 items-center gap-1">
                  <Button
                    aria-label={dictionary.gmailBackToInbox}
                    onClick={() => setIsReadingMessage(false)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                  <Separator className="mx-2 h-6" orientation="vertical" />
                  <Button size="icon-sm" type="button" variant="ghost">
                    <Archive className="size-4" />
                  </Button>
                  <Button size="icon-sm" type="button" variant="ghost">
                    <CircleAlert className="size-4" />
                  </Button>
                  <Button size="icon-sm" type="button" variant="ghost">
                    <Trash2 className="size-4" />
                  </Button>
                  <Separator className="mx-2 h-6 max-sm:hidden" orientation="vertical" />
                  <Button
                    aria-label={selectedMessage.unread ? 'Mark as read' : 'Mark as unread'}
                    className="max-sm:hidden"
                    onClick={toggleSelectedMessageUnread}
                    size="icon-sm"
                    title={selectedMessage.unread ? 'Mark as read' : 'Mark as unread'}
                    type="button"
                    variant="ghost"
                  >
                    {selectedMessage.unread ? <MailOpen className="size-4" /> : <Mail className="size-4" />}
                  </Button>
                  <Button className="max-sm:hidden" size="icon-sm" type="button" variant="ghost">
                    <Clock3 className="size-4" />
                  </Button>
                  <Button className="max-sm:hidden" size="icon-sm" type="button" variant="ghost">
                    <Folder className="size-4" />
                  </Button>
                  <Button className="max-sm:hidden" size="icon-sm" type="button" variant="ghost">
                    <Tag className="size-4" />
                  </Button>
                  <Button size="icon-sm" type="button" variant="ghost">
                    <MoreVertical className="size-4" />
                  </Button>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <span className="max-md:hidden">{rangeLabel}</span>
                  <Button
                    aria-label={dictionary.gmailPreviousPage}
                    disabled={previousPageTokens.length === 0 || isLoading}
                    onClick={handlePreviousPage}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    aria-label={dictionary.gmailNextPage}
                    disabled={!nextPageToken || isLoading}
                    onClick={handleNextPage}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-card px-5 py-5 dark:bg-background max-sm:px-3">
                <article className="mx-auto flex max-w-[1500px] flex-col gap-5">
                  <div className="flex min-w-0 items-start justify-between gap-4 pl-12 max-md:pl-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h1 className="min-w-0 text-2xl font-normal leading-tight text-foreground max-md:text-xl">
                          {selectedMessage.subject}
                        </h1>
                        {selectedMessage.labels.includes('IMPORTANT') ? (
                          <Tag className="size-4 shrink-0 fill-yellow-400 text-yellow-400" />
                        ) : null}
                        {selectedMessage.labels.includes('INBOX') ? (
                          <Badge className="rounded-sm px-2 py-0.5 text-xs" variant="secondary">
                            {dictionary.googleCommunicationInbox}
                          </Badge>
                        ) : null}
                        {selectedMessage.unread ? (
                          <Badge className="rounded-sm px-2 py-0.5 text-xs" variant="outline">
                            {dictionary.googleCommunicationUnread}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button aria-label={dictionary.gmailPrint} size="icon-sm" type="button" variant="ghost">
                        <Printer className="size-4" />
                      </Button>
                      <Button
                        aria-label={dictionary.gmailOpenInNewWindow}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <ExternalLink className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#f1f5fb] px-5 py-3 text-sm font-semibold text-muted-foreground dark:bg-muted/35 max-md:ml-0 md:ml-12">
                    <div className="flex items-center gap-2">
                      <SlidersHorizontal className="size-4" />
                      <span>{dictionary.gmailEmailSummary}</span>
                    </div>
                  </div>

                  <section className="grid grid-cols-[40px_minmax(0,1fr)] gap-4">
                    <div className="flex size-10 items-center justify-center rounded-full bg-primary/80 text-base font-black text-primary-foreground">
                      {getSenderInitial(selectedMessage.from)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                            <span className="font-black">{getSenderName(selectedMessage.from)}</span>
                            <span className="min-w-0 truncate text-xs font-semibold text-muted-foreground">
                              {getEmailAddress(selectedMessage.from)}
                            </span>
                          </div>
                          <details className="group relative mt-0.5 inline-block text-xs font-semibold text-muted-foreground">
                            <summary className="flex cursor-pointer list-none items-center gap-1">
                              <span>{selectedMessage.to ? dictionary.gmailTo : dictionary.gmailToMe}</span>
                              <span className="max-w-[420px] truncate">
                                {selectedMessage.to ?? dictionary.gmailToMe}
                              </span>
                              <ChevronDown className="size-3 transition group-open:rotate-180" />
                            </summary>
                            <div className="absolute left-0 top-6 z-20 grid min-w-[360px] gap-2 rounded-md border bg-popover p-4 text-xs text-popover-foreground shadow-xl max-sm:min-w-[260px]">
                              <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
                                <span className="font-bold text-muted-foreground">{dictionary.gmailFrom}</span>
                                <span className="break-words">{selectedMessage.from}</span>
                              </div>
                              <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
                                <span className="font-bold text-muted-foreground">{dictionary.gmailTo}</span>
                                <span className="break-words">{selectedMessage.to ?? dictionary.gmailToMe}</span>
                              </div>
                              <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
                                <span className="font-bold text-muted-foreground">{dictionary.gmailDate}</span>
                                <span>{formatFullMessageDate(selectedMessage.receivedAt, language)}</span>
                              </div>
                              <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
                                <span className="font-bold text-muted-foreground">{dictionary.gmailSecurity}</span>
                                <span>{dictionary.gmailStandardEncryption}</span>
                              </div>
                              {selectedMessage.labels.includes('IMPORTANT') ? (
                                <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
                                  <span />
                                  <span className="flex items-center gap-1">
                                    <Tag className="size-3 fill-yellow-400 text-yellow-400" />
                                    {dictionary.gmailImportantNotice}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          </details>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground">
                          <span className="max-lg:hidden">
                            {formatFullMessageDate(selectedMessage.receivedAt, language)}
                          </span>
                          <Star
                            className={cn(
                              'size-4',
                              selectedMessage.labels.includes('STARRED')
                                ? 'fill-yellow-400 text-yellow-500'
                                : 'text-muted-foreground',
                            )}
                          />
                          <Button
                            aria-label={dictionary.gmailReply}
                            onClick={() => openReplyCompose(selectedMessage, 'reply')}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <Reply className="size-4" />
                          </Button>
                          <Button
                            aria-label={dictionary.gmailMoreActions}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <MoreVertical className="size-4" />
                          </Button>
                        </div>
                      </div>

                      {messageDetailError ? (
                        <div className="mt-7 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive">
                          {messageDetailError}
                        </div>
                      ) : null}

                      {isSelectedMessageDetailLoading ? (
                        <div className="mt-7 flex max-w-[1180px] items-center gap-2 rounded-lg border bg-muted/35 px-4 py-3 text-sm font-bold text-muted-foreground">
                          <RefreshCw className="size-4 animate-spin" />
                          {dictionary.driveLoading}
                        </div>
                      ) : selectedMessage.bodyHtml ? (
                        <GmailHtmlBodyFrame html={selectedMessage.bodyHtml} title={selectedMessage.subject} />
                      ) : (
                        <div className="mt-7 max-w-[1180px] whitespace-pre-wrap break-words text-[0.95rem] leading-7 text-foreground">
                          {selectedMessageBody}
                        </div>
                      )}

                      {selectedAttachments.length > 0 ? (
                        <div className="mt-7 border-t pt-4">
                          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm font-black">
                            <span>
                              {dictionary.gmailAttachments} {selectedAttachments.length}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            <Button className="h-7 gap-1 px-2 text-xs" type="button" variant="ghost">
                              <GoogleProductIcon decorative product="drive" size={16} />
                              {dictionary.gmailAddAllToDrive}
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-3">
                            {selectedAttachments.map((attachment) => (
                              <button
                                className="flex h-14 min-w-52 max-w-72 items-center gap-3 rounded-md border bg-muted/25 px-3 text-left text-sm font-semibold transition hover:bg-muted/45"
                                key={attachment.fileName}
                                type="button"
                              >
                                <FileText className="size-5 shrink-0 text-primary" />
                                <span className="min-w-0">
                                  <span className="block truncate">{attachment.fileName}</span>
                                  {attachment.sizeBytes ? (
                                    <span className="block text-xs text-muted-foreground">
                                      {formatFileSize(attachment.sizeBytes, language)}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-10 flex flex-wrap items-center gap-2">
                        <Button
                          className="rounded-full"
                          onClick={() => openReplyCompose(selectedMessage, 'reply')}
                          type="button"
                          variant="outline"
                        >
                          <Reply className="size-4" />
                          {dictionary.gmailReply}
                        </Button>
                        <Button
                          className="rounded-full"
                          onClick={() => openReplyCompose(selectedMessage, 'replyAll')}
                          type="button"
                          variant="outline"
                        >
                          <ReplyAll className="size-4" />
                          {dictionary.gmailReplyAll}
                        </Button>
                        <Button
                          className="rounded-full"
                          onClick={() => openReplyCompose(selectedMessage, 'forward')}
                          type="button"
                          variant="outline"
                        >
                          <Forward className="size-4" />
                          {dictionary.gmailForward}
                        </Button>
                        <Button className="rounded-full" size="icon" type="button" variant="outline">
                          <Smile className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </section>
                </article>
              </div>
            </>
          ) : (
            <>
              <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
                <div className="flex items-center gap-1">
                  <Checkbox aria-label={dictionary.gmailSelect} />
                  <Button size="icon-sm" type="button" variant="ghost">
                    <ChevronDown className="size-4" />
                  </Button>
                  <Button onClick={handleRefresh} size="icon-sm" type="button" variant="ghost">
                    <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
                  </Button>
                  <Button size="icon-sm" type="button" variant="ghost">
                    <MoreVertical className="size-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <span>{rangeLabel}</span>
                  <Button
                    aria-label={dictionary.gmailPreviousPage}
                    disabled={previousPageTokens.length === 0 || isLoading}
                    onClick={handlePreviousPage}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    aria-label={dictionary.gmailNextPage}
                    disabled={!nextPageToken || isLoading}
                    onClick={handleNextPage}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                  <Button size="icon-sm" type="button" variant="ghost">
                    <Archive className="size-4" />
                  </Button>
                  <Button size="icon-sm" type="button" variant="ghost">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>

              <Tabs
                className="shrink-0 border-b"
                onValueChange={(value) => setCategory(value as GmailCategory)}
                value={category}
              >
                <TabsList className="h-14 w-full justify-start gap-0 rounded-none bg-transparent p-0" variant="line">
                  <TabsTrigger className="h-full max-w-[220px] justify-start gap-3 px-5" value="primary">
                    <CheckSquare className={cn('size-4', gmailCategoryStyles.primary.icon)} />
                    <span>{dictionary.gmailPrimary}</span>
                    {categoryUnreadCounts.primary ? (
                      <Badge
                        className={cn(
                          category === 'primary'
                            ? gmailCategoryStyles.primary.badgeActive
                            : gmailCategoryStyles.primary.badgeInactive,
                        )}
                        variant={category === 'primary' ? 'default' : 'outline'}
                      >
                        {categoryUnreadCounts.primary}
                      </Badge>
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger className="h-full max-w-[260px] justify-start gap-3 px-5" value="promotions">
                    <Tag className={cn('size-4', gmailCategoryStyles.promotions.icon)} />
                    <span>{dictionary.gmailPromotions}</span>
                    {categoryUnreadCounts.promotions ? (
                      <Badge
                        className={cn(
                          category === 'promotions'
                            ? gmailCategoryStyles.promotions.badgeActive
                            : gmailCategoryStyles.promotions.badgeInactive,
                        )}
                        variant={category === 'promotions' ? 'default' : 'outline'}
                      >
                        {categoryUnreadCounts.promotions}
                      </Badge>
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger className="h-full max-w-[260px] justify-start gap-3 px-5" value="social">
                    <Inbox className={cn('size-4', gmailCategoryStyles.social.icon)} />
                    <span>{dictionary.gmailSocial}</span>
                    {categoryUnreadCounts.social ? (
                      <Badge
                        className={cn(
                          category === 'social'
                            ? gmailCategoryStyles.social.badgeActive
                            : gmailCategoryStyles.social.badgeInactive,
                        )}
                        variant={category === 'social' ? 'default' : 'outline'}
                      >
                        {categoryUnreadCounts.social}
                      </Badge>
                    ) : null}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="min-h-0 flex-1 overflow-y-auto bg-[#f2f6fc] dark:bg-background">
                {composeNotice ? (
                  <div className="m-3 rounded-lg border bg-primary/10 px-4 py-2 text-sm font-bold text-primary">
                    {composeNotice}
                  </div>
                ) : null}
                {isLoading ? (
                  <div className="m-3 flex items-center gap-2 rounded-lg border bg-card p-4 text-sm font-bold text-muted-foreground">
                    <RefreshCw className="size-4 animate-spin" />
                    {dictionary.driveLoading}
                  </div>
                ) : null}
                {!isLoading && visibleMessages.length === 0 ? (
                  <p className="m-3 rounded-lg border bg-card p-4 text-sm font-bold text-muted-foreground">
                    {dictionary.googleCommunicationNoEmail}
                  </p>
                ) : null}
                <div className="divide-y">
                  {visibleMessages.map((message) => {
                    const active = message.id === selectedId;
                    const attachmentHints = getAttachmentHints(message);

                    return (
                      <button
                        className={cn(
                          'grid w-full min-w-0 grid-cols-[32px_28px_minmax(140px,240px)_minmax(0,1fr)_96px] items-start gap-3 bg-card px-4 py-2.5 text-left text-sm transition hover:relative hover:z-10 hover:shadow-md max-xl:grid-cols-[32px_28px_minmax(120px,180px)_minmax(0,1fr)_76px] max-md:grid-cols-[28px_minmax(0,1fr)_64px]',
                          message.unread && 'font-black',
                          active && 'bg-primary/10',
                        )}
                        key={message.id}
                        onClick={() => openMessage(message)}
                        type="button"
                      >
                        <Checkbox aria-label={dictionary.gmailSelect} className="mt-0.5 max-md:hidden" />
                        <Star
                          className={cn(
                            'mt-0.5 size-4 text-muted-foreground max-md:hidden',
                            message.labels.includes('STARRED') && 'fill-yellow-400 text-yellow-500',
                          )}
                        />
                        <div className="min-w-0 max-md:hidden">
                          <div className="flex min-w-0 items-center gap-2">
                            <Tag className="size-4 shrink-0 fill-yellow-400 text-yellow-400" />
                            <span className="min-w-0 truncate">{getSenderName(message.from)}</span>
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0 truncate">{message.subject}</span>
                            <span className="truncate font-semibold text-muted-foreground">
                              - {message.snippet || message.bodyPreview}
                            </span>
                          </div>
                          {attachmentHints.length > 0 ? (
                            <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                              {attachmentHints.map((hint) => (
                                <span
                                  className="inline-flex max-w-40 items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs font-semibold text-muted-foreground"
                                  key={hint}
                                >
                                  <Paperclip className="size-3" />
                                  <span className="truncate">{hint}</span>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <span className="justify-self-end text-xs font-black text-muted-foreground">
                          {formatMessageTime(message.receivedAt, language)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {composeOpen ? (
        <div
          aria-label={dictionary.gmailComposeTitle}
          className="absolute bottom-4 right-4 z-20 flex h-[min(680px,calc(100%-2rem))] min-h-[360px] w-[min(720px,calc(100%-2rem))] min-w-[480px] max-w-[calc(100%-2rem)] resize flex-col overflow-auto rounded-xl border bg-popover text-popover-foreground shadow-2xl max-sm:min-w-0"
          role="dialog"
        >
          <div className="flex h-10 w-full shrink-0 items-center justify-between bg-foreground px-4 text-sm font-black text-background dark:bg-muted dark:text-foreground">
            <span className="min-w-0 truncate">{dictionary.gmailComposeTitle}</span>
            <Button
              className="size-7 shrink-0 text-background hover:bg-background/10 hover:text-background dark:text-foreground dark:hover:bg-foreground/10 dark:hover:text-foreground"
              onClick={() => setComposeOpen(false)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <ChevronDown className="size-4" />
            </Button>
          </div>
          <form className="flex min-h-0 flex-1 flex-col bg-popover" onSubmit={handleSend}>
            <div className="flex w-full shrink-0 items-center gap-3 border-b bg-popover px-4 py-2">
              <span className="w-[4.5rem] shrink-0 whitespace-nowrap text-xs font-bold text-muted-foreground">
                {dictionary.gmailComposeTo}
              </span>
              <Input
                className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                onChange={(event) => handleComposeChange('to', event.target.value)}
                value={composeForm.to}
              />
              <Button
                className="h-7 shrink-0 px-2 text-xs"
                onClick={() => setShowCarbonCopy((current) => !current)}
                type="button"
                variant="ghost"
              >
                {dictionary.gmailComposeCc}/{dictionary.gmailComposeBcc}
              </Button>
            </div>
            {showCarbonCopy ? (
              <>
                <div className="flex w-full shrink-0 items-center gap-3 border-b bg-popover px-4 py-2">
                  <span className="w-[4.5rem] shrink-0 whitespace-nowrap text-xs font-bold text-muted-foreground">
                    {dictionary.gmailComposeCc}
                  </span>
                  <Input
                    className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                    onChange={(event) => handleComposeChange('cc', event.target.value)}
                    value={composeForm.cc}
                  />
                </div>
                <div className="flex w-full shrink-0 items-center gap-3 border-b bg-popover px-4 py-2">
                  <span className="w-[4.5rem] shrink-0 whitespace-nowrap text-xs font-bold text-muted-foreground">
                    {dictionary.gmailComposeBcc}
                  </span>
                  <Input
                    className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                    onChange={(event) => handleComposeChange('bcc', event.target.value)}
                    value={composeForm.bcc}
                  />
                </div>
              </>
            ) : null}
            <Input
              className="h-10 shrink-0 rounded-none border-0 border-b bg-popover px-4 shadow-none focus-visible:ring-0 dark:bg-popover"
              onChange={(event) => handleComposeChange('subject', event.target.value)}
              placeholder={dictionary.gmailComposeSubject}
              value={composeForm.subject}
            />
            <Textarea
              className="min-h-[180px] flex-1 resize-none rounded-none border-0 bg-popover p-4 shadow-none focus-visible:ring-0 dark:bg-popover"
              onChange={(event) => handleComposeChange('body', event.target.value)}
              placeholder={dictionary.gmailComposeBody}
              value={composeForm.body}
            />
            {composeError ? (
              <p className="px-4 pb-2 text-sm font-bold text-destructive">{composeError}</p>
            ) : null}
            <Separator />
            <div className="flex shrink-0 items-center justify-between p-3">
              <Button disabled={isSending} type="submit">
                <Send className="size-4" />
                <span>{isSending ? dictionary.gmailComposeSending : dictionary.gmailComposeSend}</span>
              </Button>
              <Button
                disabled={isSending}
                onClick={() => setComposeOpen(false)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </Card>
  );
}
