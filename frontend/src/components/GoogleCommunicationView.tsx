import {
  Clock,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Send,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { workspaceApi, type GoogleChatSpace } from '../api/workspaceApi';
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

function getChatPreview(space: GoogleChatSpace) {
  return space.messages.at(-1)?.text ?? space.spaceType.replaceAll('_', ' ').toLowerCase();
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
      .getGoogleChatSpaces({ search: submittedSearch, pageSize: 12 })
      .then((response) => {
        if (!isMounted) {
          return;
        }

        setChatSpaces(response.spaces);
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
        <CardContent className="grid min-h-0 flex-1 gap-0 p-0 xl:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
          <div className="min-h-0 border-r max-xl:border-b max-xl:border-r-0">
            <div className="flex items-center justify-between px-4 py-3">
              <h3 className="text-sm font-black">{dictionary.googleCommunicationSpaces}</h3>
            </div>
            <Separator />
            <div className="grid max-h-[260px] gap-1 overflow-y-auto p-2 xl:max-h-none">
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
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <GoogleProductIcon decorative product="chat" size={16} />
                        <strong className="min-w-0 truncate text-sm">{space.displayName}</strong>
                        <span className="ml-auto shrink-0 text-xs font-black text-muted-foreground">
                          {formatRelativeTime(space.lastActiveTime, language)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs font-semibold text-muted-foreground">
                        {getChatPreview(space)}
                      </p>
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
                    <div className="min-w-0">
                      <h3 className="truncate text-xl font-black">{selectedChat.displayName}</h3>
                      <p className="mt-1 truncate text-sm font-semibold text-muted-foreground">
                        {getChatPreview(selectedChat)}
                      </p>
                    </div>
                    <Badge className="shrink-0" variant="outline">
                      <Clock className="size-3" />
                      {formatRelativeTime(selectedChat.lastActiveTime, language)}
                    </Badge>
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
                  {selectedChat.messages.length === 0 ? (
                    <p className="rounded-lg border bg-muted/35 p-4 text-sm font-bold text-muted-foreground">
                      {dictionary.googleCommunicationNoChatMessages}
                    </p>
                  ) : null}
                  {selectedChat.messages.map((message) => (
                    <div
                      className="max-w-[78%] rounded-xl border bg-muted/35 p-3"
                      key={message.name}
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs font-black text-muted-foreground">
                        <span>{message.sender}</span>
                        <span>{formatDateTime(message.createdAt, language)}</span>
                      </div>
                      <p className="whitespace-pre-line text-sm font-semibold leading-6">{message.text}</p>
                    </div>
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
