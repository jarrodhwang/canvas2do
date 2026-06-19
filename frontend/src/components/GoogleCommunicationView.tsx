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

function isGoogleApiAccessDisabledError(error: string | null) {
  const normalizedError = error?.toLowerCase() ?? '';

  return normalizedError.includes('google api access is not enabled') ||
    normalizedError.includes('api access is disabled') ||
    normalizedError.includes('not assigned to your account');
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

function isBotMessage(message: GoogleChatMessage | undefined) {
  return message?.senderType === 'BOT' ||
    message?.senderName === 'users/app' ||
    message?.sender === 'Google Chat';
}

function inferProductFromMessage(message: GoogleChatMessage | undefined) {
  const text = `${message?.sender ?? ''} ${message?.text ?? ''}`.toLowerCase();

  if (text.includes('google drive') || text.includes('shared') || text.includes('공유')) {
    return 'drive' as const;
  }

  if (text.includes('figma')) {
    return 'figma' as const;
  }

  return undefined;
}

function getAvatarInitial(label: string | undefined) {
  const cleanedLabel = (label ?? '').trim();

  if (!cleanedLabel ||
    cleanedLabel === 'Unknown user' ||
    cleanedLabel === 'Google Chat' ||
    cleanedLabel === 'Google Chat user') {
    return '';
  }

  return Array.from(cleanedLabel)[0]?.toUpperCase() ?? '';
}

function getChatAvatarSrc(avatarUrl: string | undefined) {
  if (!avatarUrl) {
    return undefined;
  }

  if (/^(?:data|blob):/i.test(avatarUrl)) {
    return avatarUrl;
  }

  if (/^https?:\/\//i.test(avatarUrl)) {
    return `${workspaceApi.apiBaseUrl}/google/chat/avatar?url=${encodeURIComponent(avatarUrl)}`;
  }

  return avatarUrl;
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

function getChatSpaceTitle(space: GoogleChatSpace) {
  if (
    space.spaceType === 'DIRECT_MESSAGE' &&
    space.primaryMember?.displayName &&
    !space.primaryMember.displayName.startsWith('users/')
  ) {
    return space.primaryMember.displayName;
  }

  return space.displayName;
}

function getChatSpaceAvatarUrl(space: GoogleChatSpace) {
  if (space.spaceType !== 'DIRECT_MESSAGE') {
    return undefined;
  }

  if (space.primaryMember?.avatarUrl) {
    return space.primaryMember.avatarUrl;
  }

  for (let index = space.messages.length - 1; index >= 0; index -= 1) {
    const message = space.messages[index];

    if (!isBotMessage(message) && message.senderAvatarUrl) {
      return message.senderAvatarUrl;
    }
  }

  return undefined;
}

function getChatSpaceAvatarProduct(space: GoogleChatSpace) {
  const latestMessage = space.messages.at(-1);

  return isBotMessage(latestMessage)
    ? inferProductFromMessage(latestMessage) ?? 'chat'
    : undefined;
}

function getAttachmentLink(attachment: GoogleChatAttachment) {
  if (attachment.webViewLink) {
    return attachment.webViewLink;
  }

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

  if (value.includes('google-apps.spreadsheet') ||
    value.includes('spreadsheet') ||
    /\.(csv|xls|xlsx)$/i.test(attachment.fileName)) {
    return 'sheet';
  }

  if (value.includes('google-apps.presentation') ||
    value.includes('presentation') ||
    /\.(ppt|pptx)$/i.test(attachment.fileName)) {
    return 'slides';
  }

  if (value.includes('google-apps.document') ||
    value.includes('wordprocessingml') ||
    value.includes('msword') ||
    /\.(doc|docx)$/i.test(attachment.fileName)) {
    return 'doc';
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

function getAttachmentPreviewSrc(attachment: GoogleChatAttachment) {
  const previewUri = attachment.thumbnailUri;
  const uploadedPreviewSrc = getAttachmentUploadedPreviewSrc(attachment);
  const kind = getAttachmentKind(attachment);

  if (!previewUri) {
    if (kind === 'image' || kind === 'slides' || kind === 'doc' || kind === 'sheet') {
      return uploadedPreviewSrc;
    }

    return undefined;
  }

  if (/^(?:data|blob):/i.test(previewUri)) {
    return previewUri;
  }

  if (/^https?:\/\//i.test(previewUri)) {
    return `${workspaceApi.apiBaseUrl}/google/chat/attachment-preview?url=${encodeURIComponent(previewUri)}`;
  }

  return previewUri;
}

function getAttachmentUploadedPreviewSrc(attachment: GoogleChatAttachment) {
  if (!attachment.attachmentResourceName) {
    return undefined;
  }

  const token = [
    encodeURIComponent(attachment.attachmentResourceName),
    encodeURIComponent(attachment.fileName),
    encodeURIComponent(attachment.contentType),
  ].join('|');
  const params = new URLSearchParams({ url: `chat-media:${token}` });

  return `${workspaceApi.apiBaseUrl}/google/chat/attachment-preview?${params.toString()}`;
}

function getAttachmentEmbedSrc(attachment: GoogleChatAttachment) {
  const uploadedPreviewSrc = getAttachmentUploadedPreviewSrc(attachment);
  const kind = getAttachmentKind(attachment);

  if (uploadedPreviewSrc && (kind === 'pdf' || kind === 'image')) {
    return uploadedPreviewSrc;
  }

  if (!attachment.driveFileId) {
    return undefined;
  }

  const fileId = encodeURIComponent(attachment.driveFileId);
  const value = `${attachment.contentType} ${attachment.fileName}`.toLowerCase();

  if (value.includes('google-apps.presentation')) {
    return `https://docs.google.com/presentation/d/${fileId}/embed?start=false&loop=false&delayms=3000`;
  }

  if (value.includes('google-apps.spreadsheet')) {
    return `https://docs.google.com/spreadsheets/d/${fileId}/preview`;
  }

  if (value.includes('google-apps.document')) {
    return `https://docs.google.com/document/d/${fileId}/preview`;
  }

  return `https://drive.google.com/file/d/${fileId}/preview`;
}

function getAttachmentTypeLabel(attachment: GoogleChatAttachment) {
  const kind = getAttachmentKind(attachment);

  if (kind === 'sheet') {
    return 'Sheet';
  }

  if (kind === 'slides') {
    return 'Slides';
  }

  if (kind === 'doc') {
    return 'Doc';
  }

  if (kind === 'image') {
    return 'Image';
  }

  if (kind === 'pdf') {
    return 'PDF';
  }

  if (kind === 'archive') {
    return 'ZIP';
  }

  return 'File';
}

function getAttachmentTone(attachment: GoogleChatAttachment) {
  const kind = getAttachmentKind(attachment);

  if (kind === 'sheet') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }

  if (kind === 'slides') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  }

  if (kind === 'image' || kind === 'pdf') {
    return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300';
  }

  if (kind === 'archive') {
    return 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300';
  }

  return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300';
}

function formatAttachmentSize(sizeBytes: number | undefined) {
  if (!sizeBytes || sizeBytes <= 0) {
    return undefined;
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(sizeBytes < 10 * 1024 ? 1 : 0)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(sizeBytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function ChatAvatar({
  avatarUrl,
  className,
  label,
  product,
  variant = 'person',
}: {
  avatarUrl?: string;
  className?: string;
  label?: string;
  product?: 'chat' | 'drive' | 'figma';
  variant?: 'person' | 'space';
}) {
  const avatarSrc = getChatAvatarSrc(avatarUrl);

  if (avatarSrc) {
    return (
      <span className={cn('block shrink-0 overflow-hidden rounded-full bg-muted', className)}>
        <img alt="" className="size-full object-cover" referrerPolicy="no-referrer" src={avatarSrc} />
      </span>
    );
  }

  if (product) {
    return (
      <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-[10px] bg-transparent', className)}>
        <GoogleProductIcon decorative product={product} size={product === 'drive' ? 46 : 36} />
      </span>
    );
  }

  if (variant === 'space') {
    return (
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-[10px] bg-[#30284C] text-[#8B7CFF]',
          className,
        )}
        aria-label={label}
      >
        <span className="grid w-[58%] gap-[12%]">
          <span className="grid grid-cols-2 gap-[12%]">
            <span className="aspect-square rounded-[2px] border-[3px] border-current" />
            <span className="aspect-square rounded-[2px] border-[3px] border-current" />
          </span>
          <span className="h-[3px] rounded-full bg-current" />
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full border bg-[#1f2937] text-lg font-bold text-[#93c5fd]',
        className,
      )}
    >
      {getAvatarInitial(label) || <UserRound className="size-[54%] text-muted-foreground" />}
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

  if (kind === 'doc') {
    return <FileText className={cn(className, 'text-blue-600')} />;
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
  const previewSrc = getAttachmentPreviewSrc(attachment);
  const embedSrc = getAttachmentEmbedSrc(attachment);
  const hasThumbnail = Boolean(previewSrc && !thumbnailFailed);
  const sizeLabel = formatAttachmentSize(attachment.sizeBytes);
  const typeLabel = getAttachmentTypeLabel(attachment);
  const showEmbed = Boolean(embedSrc && !hasThumbnail);

  return (
    <div
      className="w-full max-w-[360px] overflow-hidden rounded-xl border bg-background shadow-sm transition hover:border-primary/45"
      title={attachment.fileName}
    >
      <div className="relative grid aspect-[16/9] overflow-hidden bg-muted/55">
        {showEmbed ? (
          <iframe
            className="size-full border-0 bg-background"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            src={embedSrc}
            title={`${attachment.fileName} preview`}
          />
        ) : hasThumbnail ? (
          link ? (
            <a href={link} rel="noreferrer" target="_blank">
              <img
                alt=""
                className="size-full object-cover"
                onError={() => setThumbnailFailed(true)}
                src={previewSrc}
              />
            </a>
          ) : (
            <img
              alt=""
              className="size-full object-cover"
              onError={() => setThumbnailFailed(true)}
              src={previewSrc}
            />
          )
        ) : (
          <div className="grid size-full place-items-center">
            <div className={cn('grid size-20 place-items-center rounded-2xl border shadow-sm', getAttachmentTone(attachment))}>
              {attachment.iconLink ? (
                <img alt="" className="size-9 object-contain" src={attachment.iconLink} />
              ) : (
                <ChatAttachmentIcon attachment={attachment} />
              )}
            </div>
          </div>
        )}
        <span className={cn('absolute left-2 top-2 rounded-md border px-2 py-1 text-[11px] font-black uppercase tracking-normal backdrop-blur', getAttachmentTone(attachment))}>
          {typeLabel}
        </span>
      </div>
      <div className="grid min-w-0 gap-1 border-t bg-background/85 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <ChatAttachmentIcon attachment={attachment} />
          <span className="min-w-0 flex-1 truncate text-sm font-black">{attachment.fileName}</span>
          {link ? (
            <a
              aria-label={`Open ${attachment.fileName}`}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              href={link}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink className="size-4 shrink-0" />
            </a>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center gap-2 pl-7 text-xs font-semibold text-muted-foreground">
          <span>{typeLabel}</span>
          {sizeLabel ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{sizeLabel}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ChatMessageBubble({ language, message }: { language: 'en' | 'ko'; message: GoogleChatMessage }) {
  const attachments = message.attachments ?? [];
  const product = isBotMessage(message) ? inferProductFromMessage(message) ?? 'chat' : undefined;
  const hasText = Boolean(message.text.trim());

  return (
    <div className="flex min-w-0 items-start gap-3">
      <ChatAvatar
        avatarUrl={message.senderAvatarUrl}
        className="size-10"
        label={message.sender}
        product={product}
      />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <strong className="min-w-0 truncate text-sm font-black">{message.sender}</strong>
          {message.senderEmail && message.senderEmail !== message.sender ? (
            <span className="truncate text-xs font-semibold text-muted-foreground">{message.senderEmail}</span>
          ) : null}
          <span className="text-xs font-bold text-muted-foreground">
            {formatDateTime(message.createdAt, language)}
          </span>
        </div>
        <div className="space-y-2">
          {hasText ? (
            <div className="max-w-3xl rounded-2xl rounded-tl-sm bg-muted/55 px-3.5 py-2.5 text-sm font-semibold leading-6">
              <p className="whitespace-pre-line break-words">{message.text}</p>
            </div>
          ) : null}
          {attachments.length > 0 ? (
            <div className="grid max-w-3xl gap-2 sm:grid-cols-[repeat(auto-fit,minmax(260px,360px))]">
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
  const needsPeopleApiSetup = error?.toLowerCase().includes('people api') ?? false;
  const needsWorkspaceSignIn =
    error?.toLowerCase().includes('session expired') ||
    error?.toLowerCase().includes('sign-in required') ||
    error?.toLowerCase().includes('sign in again') ||
    false;
  const isGoogleApiAccessDisabled = isGoogleApiAccessDisabledError(error);

  useEffect(() => {
    let isMounted = true;

    workspaceApi
      .getGoogleChatSpaces({ search: submittedSearch, pageSize: 150 })
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
    <Card className="flex min-h-[580px] flex-col gap-0 overflow-hidden rounded-xl bg-card py-0 shadow-none xl:h-full xl:min-h-0">
      <CardHeader className="border-b px-3 py-1.5">
        <form className="flex min-w-0 items-center gap-2" onSubmit={handleSearch}>
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted">
            <GoogleProductIcon decorative product="chat" size={18} />
          </span>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-7 pl-8 text-sm font-semibold"
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={dictionary.googleCommunicationSearchChat}
              value={searchText}
            />
          </div>
          <Button
            aria-label={dictionary.googleCommunicationSearchChat}
            className="size-7 shrink-0"
            size="icon"
            type="submit"
            variant="outline"
          >
            <Search className="size-3.5" />
          </Button>
          <Button
            className="size-7 shrink-0"
            onClick={handleRefresh}
            size="icon"
            type="button"
            variant="outline"
          >
            <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
          </Button>
          <Badge className="h-7 shrink-0 rounded-lg px-2 text-xs" variant="outline">
            {chatSpaces.length} {dictionary.googleCommunicationSpacesUnit}
          </Badge>
          <Button className="h-7 shrink-0 px-2.5 text-xs" disabled size="sm" type="button">
            <MessageSquarePlus className="size-3.5" />
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
            {!isGoogleApiAccessDisabled ? (
              <Button
                className="mt-4"
                onClick={() => {
                  if (needsPeopleApiSetup) {
                    window.open('https://console.cloud.google.com/apis/library/people.googleapis.com', '_blank', 'noopener,noreferrer');
                    return;
                  }

                if (needsWorkspaceSignIn) {
                  window.location.href = workspaceApi.getGoogleLoginUrl(window.location.pathname, {
                    forceConsent: true,
                    forceLogin: true,
                  });
                  return;
                }

                  window.location.href = `${workspaceApi.apiBaseUrl}/google/integrations/google_chat/connect`;
                }}
                type="button"
              >
                {needsPeopleApiSetup
                  ? 'Open People API setup'
                  : needsWorkspaceSignIn
                    ? 'Sign in again'
                    : dictionary.reconnectGoogle}
              </Button>
            ) : null}
          </div>
        </CardContent>
      ) : (
        <CardContent className="grid min-h-0 flex-1 gap-0 p-0 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-r max-xl:border-b max-xl:border-r-0">
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <h3 className="text-sm font-black">{dictionary.googleCommunicationSpaces}</h3>
            </div>
            <Separator />
            <div className="grid min-h-0 flex-1 content-start gap-0 overflow-y-auto max-xl:max-h-[440px]">
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
                const title = getChatSpaceTitle(space);
                const avatarUrl = getChatSpaceAvatarUrl(space);
                const product = avatarUrl ? undefined : getChatSpaceAvatarProduct(space);

                return (
                  <Button
                    className={cn(
                      'h-auto min-w-0 justify-start rounded-none border-b border-border/80 px-3.5 py-2.5 text-left hover:bg-muted/70',
                      active && 'bg-muted text-foreground hover:bg-muted',
                    )}
                    key={space.name}
                    onClick={() => setSelectedId(space.name)}
                    type="button"
                    variant="ghost"
                  >
                    <div className="grid min-w-0 flex-1 grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2.5">
                      <ChatAvatar
                        avatarUrl={avatarUrl}
                        className="size-12"
                        label={title}
                        product={product}
                        variant={space.spaceType === 'DIRECT_MESSAGE' ? 'person' : 'space'}
                      />
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <strong className="min-w-0 truncate text-[17px] font-semibold leading-tight text-foreground/80">
                            {title}
                          </strong>
                          {attachments.length > 0 ? (
                            <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                          ) : null}
                        </div>
                        <p className="mt-1 line-clamp-1 text-[14px] font-semibold leading-tight text-muted-foreground">
                          {getChatPreview(space, language)}
                        </p>
                      </div>
                      <span className="shrink-0 self-start pt-0.5 text-xs font-bold text-muted-foreground">
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
                <div className="border-b p-4">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ChatAvatar
                        avatarUrl={getChatSpaceAvatarUrl(selectedChat)}
                        className="size-12"
                        label={getChatSpaceTitle(selectedChat)}
                        product={getChatSpaceAvatarUrl(selectedChat) ? undefined : getChatSpaceAvatarProduct(selectedChat)}
                        variant={selectedChat.spaceType === 'DIRECT_MESSAGE' ? 'person' : 'space'}
                      />
                      <div className="min-w-0">
                        <h3 className="truncate text-xl font-semibold text-foreground/85">{getChatSpaceTitle(selectedChat)}</h3>
                        <p className="mt-1 truncate text-sm font-semibold text-muted-foreground">
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
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                  {selectedChat.messages.length === 0 ? (
                    <p className="rounded-lg border bg-muted/35 p-4 text-sm font-bold text-muted-foreground">
                      {dictionary.googleCommunicationNoChatMessages}
                    </p>
                  ) : null}
                  {selectedChat.messages.map((message) => (
                    <ChatMessageBubble key={message.name} language={language} message={message} />
                  ))}
                </div>
                <div className="flex gap-2 border-t p-3.5">
                  <Input
                    className="h-9 text-sm font-semibold"
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
