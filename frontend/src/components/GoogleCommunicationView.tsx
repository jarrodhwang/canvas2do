import {
  Clock,
  ExternalLink,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  MessageSquarePlus,
  Paperclip,
  Presentation,
  RefreshCw,
  Search,
  Send,
  UserRound,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import {
  workspaceApi,
  type GoogleChatAttachment,
  type GoogleChatMessage,
  type GoogleChatSpace,
} from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { cn } from '../lib/utils';
import { GoogleEmailView } from './GoogleEmailView';
import { GoogleProductIcon } from './GoogleProductIcon';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { Separator } from './ui/separator';

type CommunicationType = 'email' | 'chat';

interface GoogleCommunicationViewProps {
  type: CommunicationType;
}

function formatRelativeTime(value: string | undefined, language: 'en' | 'ko') {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();

  if (Number.isNaN(diffMs) || diffMs < 60_000) {
    return language === 'ko' ? '방금' : 'now';
  }

  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 60) {
    return language === 'ko' ? `${minutes}분` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return language === 'ko' ? `${hours}시간` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);

  return language === 'ko' ? `${days}일` : `${days}d`;
}

function formatDateTime(value: string | undefined, language: 'en' | 'ko') {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en-US', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(date);
}

function getSenderSeed(message: GoogleChatMessage | undefined) {
  return message?.senderEmail ?? message?.senderName ?? message?.sender ?? message?.name;
}

function isBotMessage(message: GoogleChatMessage | undefined) {
  return message?.senderType === 'BOT' || message?.senderName === 'users/app';
}

function inferProductFromMessage(message: GoogleChatMessage | undefined) {
  const text = `${message?.sender ?? ''} ${message?.text ?? ''}`.toLowerCase();

  if (text.includes('google drive') || text.includes('shared') || text.includes('공유')) {
    return 'drive' as const;
  }

  return undefined;
}

function getSpaceTypeLabel(spaceType: string, language: 'en' | 'ko') {
  if (spaceType === 'DIRECT_MESSAGE') {
    return language === 'ko' ? '채팅 메시지' : 'Direct message';
  }

  if (spaceType === 'GROUP_CHAT') {
    return language === 'ko' ? '그룹 채팅' : 'Group chat';
  }

  return language === 'ko' ? '스페이스' : 'Space';
}

function getAttachmentCountLabel(count: number, language: 'en' | 'ko') {
  if (language === 'ko') {
    return count === 1 ? '첨부파일 1개' : `첨부파일 ${count}개`;
  }

  return count === 1 ? '1 attachment' : `${count} attachments`;
}

function getChatPreview(space: GoogleChatSpace, language: 'en' | 'ko') {
  const message = space.messages.at(-1);
  const attachments = message?.attachments ?? [];

  if (!message) {
    return getSpaceTypeLabel(space.spaceType, language);
  }

  if (attachments.length > 0) {
    const firstFileName = attachments[0]?.fileName;
    const attachmentLabel = firstFileName ?? getAttachmentCountLabel(attachments.length, language);
    const prefix = message.sender && message.sender !== 'Google Chat' ? `${message.sender}: ` : '';

    return `${prefix}${attachmentLabel}`;
  }

  if (message.text) {
    return message.text;
  }

  return getSpaceTypeLabel(space.spaceType, language);
}

function getAttachmentLink(attachment: GoogleChatAttachment) {
  if (attachment.downloadUri) {
    return attachment.downloadUri;
  }

  if (attachment.driveFileId) {
    return `https://drive.google.com/open?id=${encodeURIComponent(attachment.driveFileId)}`;
  }

  return undefined;
}

function getAttachmentKind(attachment: GoogleChatAttachment) {
  const value = `${attachment.contentType} ${attachment.fileName}`.toLowerCase();

  if (value.includes('spreadsheet') || /\.(csv|xls|xlsx)$/i.test(attachment.fileName)) {
    return 'sheet';
  }

  if (value.includes('presentation') || /\.(ppt|pptx)$/i.test(attachment.fileName)) {
    return 'slides';
  }

  if (value.includes('zip') || /\.(zip|7z|rar)$/i.test(attachment.fileName)) {
    return 'archive';
  }

  if (value.includes('image') || /\.(png|jpe?g|gif|webp)$/i.test(attachment.fileName)) {
    return 'image';
  }

  if (value.includes('pdf')) {
    return 'pdf';
  }

  return 'file';
}

function ChatAvatar({
  avatarUrl,
  className,
  product,
}: {
  avatarUrl?: string;
  className?: string;
  label?: string;
  product?: 'chat' | 'drive';
  seed?: string;
}) {
  if (avatarUrl) {
    return (
      <span className={cn('block shrink-0 overflow-hidden rounded-full bg-muted', className)}>
        <img alt="" className="size-full object-cover" referrerPolicy="no-referrer" src={avatarUrl} />
      </span>
    );
  }

  if (product) {
    return (
      <span className={cn('grid shrink-0 place-items-center rounded-full bg-muted', className)}>
        <GoogleProductIcon decorative product={product} size={22} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full border bg-muted text-muted-foreground',
        className,
      )}
    >
      <UserRound className="size-[54%]" />
    </span>
  );
}

function ChatAttachmentIcon({ attachment }: { attachment: GoogleChatAttachment }) {
  const kind = getAttachmentKind(attachment);
  const className = 'size-5 shrink-0';

  if (kind === 'sheet') {
    return <FileSpreadsheet className={cn(className, 'text-emerald-600')} />;
  }

  if (kind === 'slides') {
    return <Presentation className={cn(className, 'text-amber-600')} />;
  }

  if (kind === 'archive') {
    return <FileArchive className={cn(className, 'text-purple-600')} />;
  }

  if (kind === 'image') {
    return <FileImage className={cn(className, 'text-red-600')} />;
  }

  return <FileText className={cn(className, kind === 'pdf' ? 'text-red-600' : 'text-blue-600')} />;
}

function ChatAttachmentCard({ attachment }: { attachment: GoogleChatAttachment }) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const link = getAttachmentLink(attachment);
  const hasThumbnail = Boolean(attachment.thumbnailUri && !thumbnailFailed);
  const content = (
    <>
      <div className="grid aspect-[16/9] place-items-center overflow-hidden bg-muted/55">
        {hasThumbnail ? (
          <img
            alt=""
            className="size-full object-cover"
            onError={() => setThumbnailFailed(true)}
            src={attachment.thumbnailUri}
          />
        ) : (
          <div className="grid size-16 place-items-center rounded-xl bg-background/80 shadow-sm">
            <ChatAttachmentIcon attachment={attachment} />
          </div>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2.5 border-t bg-background/80 px-3.5 py-2.5">
        <ChatAttachmentIcon attachment={attachment} />
        <span className="min-w-0 flex-1 truncate text-sm font-black">{attachment.fileName}</span>
        {link ? <ExternalLink className="size-4 shrink-0 text-muted-foreground" /> : null}
      </div>
    </>
  );

  if (!link) {
    return (
      <div className="w-full max-w-md overflow-hidden rounded-xl border bg-background shadow-sm">
        {content}
      </div>
    );
  }

  return (
    <a
      className="block w-full max-w-md overflow-hidden rounded-xl border bg-background shadow-sm transition hover:border-primary/45 hover:bg-muted/40"
      href={link}
      rel="noreferrer"
      target="_blank"
      title={attachment.fileName}
    >
      {content}
    </a>
  );
}

function ChatMessageBubble({ language, message }: { language: 'en' | 'ko'; message: GoogleChatMessage }) {
  const attachments = message.attachments ?? [];
  const product = isBotMessage(message) ? inferProductFromMessage(message) ?? 'chat' : undefined;
  const hasText = Boolean(message.text.trim());

  return (
    <div className="flex min-w-0 items-start gap-3.5">
      <ChatAvatar
        avatarUrl={message.senderAvatarUrl}
        className="size-11"
        label={message.sender}
        product={product}
        seed={getSenderSeed(message)}
      />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <strong className="min-w-0 truncate text-base font-black">{message.sender}</strong>
          {message.senderEmail && message.senderEmail !== message.sender ? (
            <span className="truncate text-sm font-semibold text-muted-foreground">{message.senderEmail}</span>
          ) : null}
          <span className="text-sm font-bold text-muted-foreground">
            {formatDateTime(message.createdAt, language)}
          </span>
        </div>
        <div className="space-y-2.5">
          {hasText ? (
            <div className="max-w-3xl rounded-2xl rounded-tl-sm bg-muted/55 px-4 py-3 text-base font-semibold leading-7">
              <p className="whitespace-pre-line break-words">{message.text}</p>
            </div>
          ) : null}
          {attachments.length > 0 ? (
            <div className="grid gap-2">
              {attachments.map((attachment) => (
                <ChatAttachmentCard attachment={attachment} key={attachment.name || attachment.fileName} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function GoogleCommunicationView({ type }: GoogleCommunicationViewProps) {
  if (type === 'email') {
    return <GoogleEmailView />;
  }

  return <GoogleChatView />;
}

function GoogleChatView() {
  const { dictionary, language } = useLanguage();
  const [chatSpaces, setChatSpaces] = useState<GoogleChatSpace[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [searchText, setSearchText] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedChat = chatSpaces.find((item) => item.name === selectedId) ?? chatSpaces[0];

  useEffect(() => {
    let isMounted = true;

    workspaceApi
      .getGoogleChatSpaces({ search: submittedSearch, pageSize: 30 })
      .then((response) => {
        if (!isMounted) {
          return;
        }

        setChatSpaces(response.spaces);
        setError(null);
        setSelectedId((current) =>
          response.spaces.some((space) => space.name === current)
            ? current
            : response.spaces[0]?.name,
        );
      })
      .catch((loadError: unknown) => {
        if (!isMounted) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Google API request failed.');
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

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setSubmittedSearch(searchText.trim());
    setReloadKey((current) => current + 1);
  };

  const handleRefresh = () => {
    setIsLoading(true);
    setError(null);
    setReloadKey((current) => current + 1);
  };

  return (
    <Card className="flex min-h-[620px] flex-col gap-0 overflow-hidden rounded-xl bg-card py-0 shadow-none xl:h-full xl:min-h-0">
      <CardHeader className="border-b px-3 py-2">
        <form className="flex min-w-0 items-center gap-2" onSubmit={handleSearch}>
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
            <GoogleProductIcon decorative product="chat" size={20} />
          </span>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-9 font-semibold"
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={dictionary.googleCommunicationSearchChat}
              value={searchText}
            />
          </div>
          <Button
            aria-label={dictionary.googleCommunicationSearchChat}
            className="size-8 shrink-0"
            size="icon"
            type="submit"
            variant="outline"
          >
            <Search className="size-4" />
          </Button>
          <Button
            className="size-8 shrink-0"
            onClick={handleRefresh}
            size="icon"
            type="button"
            variant="outline"
          >
            <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
          </Button>
          <Badge className="h-8 shrink-0 rounded-lg px-2.5 text-xs" variant="outline">
            {chatSpaces.length} {dictionary.googleCommunicationSpacesUnit}
          </Badge>
          <Button className="h-8 shrink-0 px-3" disabled size="sm" type="button">
            <MessageSquarePlus className="size-4" />
            <span>{dictionary.googleCommunicationNewChat}</span>
          </Button>
        </form>
      </CardHeader>

      {error ? (
        <CardContent className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-xl rounded-xl border bg-muted/35 p-5 text-center">
            <GoogleProductIcon decorative product="chat" size={30} />
            <h3 className="mt-3 text-lg font-black">{dictionary.googleChatTitle}</h3>
            <p className="mt-2 text-sm font-semibold text-muted-foreground">{error}</p>
            <Button
              className="mt-4"
              onClick={() => {
                window.location.href = `${workspaceApi.apiBaseUrl}/google/integrations/google_chat/connect`;
              }}
              type="button"
            >
              {dictionary.reconnectGoogle}
            </Button>
          </div>
        </CardContent>
      ) : (
        <CardContent className="grid min-h-0 flex-1 gap-0 p-0 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <div className="min-h-0 border-r max-xl:border-b max-xl:border-r-0">
            <div className="flex items-center justify-between px-4 py-3">
              <h3 className="text-base font-black">{dictionary.googleCommunicationSpaces}</h3>
            </div>
            <Separator />
            <div className="grid max-h-[360px] gap-1 overflow-y-auto p-2 xl:max-h-none">
              {isLoading ? (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/35 p-4 text-sm font-bold text-muted-foreground">
                  <RefreshCw className="size-4 animate-spin" />
                  {dictionary.driveLoading}
                </div>
              ) : null}
              {!isLoading && chatSpaces.length === 0 ? (
                <p className="rounded-lg border bg-muted/35 p-4 text-sm font-bold text-muted-foreground">
                  {dictionary.googleCommunicationNoChat}
                </p>
              ) : null}
              {chatSpaces.map((space) => {
                const active = space.name === selectedId;
                const latestMessage = space.messages.at(-1);
                const attachments = latestMessage?.attachments ?? [];
                const product = isBotMessage(latestMessage)
                  ? inferProductFromMessage(latestMessage) ?? 'chat'
                  : undefined;

                return (
                  <Button
                    className={cn(
                      'h-auto min-w-0 justify-start rounded-lg p-3 text-left hover:bg-muted',
                      active && 'bg-muted text-foreground',
                    )}
                    key={space.name}
                    onClick={() => setSelectedId(space.name)}
                    type="button"
                    variant="ghost"
                  >
                    <div className="grid min-w-0 flex-1 grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3.5">
                      <ChatAvatar
                        avatarUrl={latestMessage?.senderAvatarUrl}
                        className="size-12"
                        label={space.displayName}
                        product={product}
                        seed={getSenderSeed(latestMessage) ?? space.name}
                      />
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <strong className="min-w-0 truncate text-base">{space.displayName}</strong>
                          {attachments.length > 0 ? (
                            <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                          ) : null}
                        </div>
                        <p className="mt-1 line-clamp-1 text-sm font-semibold text-muted-foreground">
                          {getChatPreview(space, language)}
                        </p>
                      </div>
                      <span className="shrink-0 self-start pt-0.5 text-sm font-black text-muted-foreground">
                        {formatRelativeTime(space.lastActiveTime, language)}
                      </span>
                    </div>
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            {selectedChat ? (
              <>
                <div className="border-b p-5">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ChatAvatar
                        avatarUrl={selectedChat.messages.at(-1)?.senderAvatarUrl}
                        className="size-14"
                        label={selectedChat.displayName}
                        product={isBotMessage(selectedChat.messages.at(-1))
                          ? inferProductFromMessage(selectedChat.messages.at(-1)) ?? 'chat'
                          : undefined}
                        seed={getSenderSeed(selectedChat.messages.at(-1)) ?? selectedChat.name}
                      />
                      <div className="min-w-0">
                        <h3 className="truncate text-2xl font-black">{selectedChat.displayName}</h3>
                        <p className="mt-1 truncate text-base font-semibold text-muted-foreground">
                          {getSpaceTypeLabel(selectedChat.spaceType, language)}
                          {selectedChat.messages.length > 0
                            ? ` · ${selectedChat.messages.length} ${language === 'ko' ? '메시지' : 'messages'}`
                            : ''}
                        </p>
                      </div>
                    </div>
                    <Badge className="shrink-0" variant="outline">
                      <Clock className="size-3" />
                      {formatRelativeTime(selectedChat.lastActiveTime, language)}
                    </Badge>
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                  {selectedChat.messages.length === 0 ? (
                    <p className="rounded-lg border bg-muted/35 p-4 text-sm font-bold text-muted-foreground">
                      {dictionary.googleCommunicationNoChatMessages}
                    </p>
                  ) : null}
                  {selectedChat.messages.map((message) => (
                    <ChatMessageBubble key={message.name} language={language} message={message} />
                  ))}
                </div>
                <div className="flex gap-2 border-t p-4">
                  <Input
                    className="h-10 font-semibold"
                    disabled
                    placeholder={dictionary.googleCommunicationSendMessage}
                  />
                  <Button className="shrink-0" disabled size="icon" type="button">
                    <Send className="size-4" />
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
