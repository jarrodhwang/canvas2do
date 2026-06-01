import { ExternalLink, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { workspaceApi, type CanvasInboxItem } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { cn } from '../lib/utils';
import { EventPill } from './EventPill';
import { Button } from './ui/button';
import { Card } from './ui/card';

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';

function formatCanvasInboxDate(value: string | undefined, locale: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString(locale, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  });
}

function formatCanvasInboxType(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s,_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function sortCanvasInboxItems(firstItem: CanvasInboxItem, secondItem: CanvasInboxItem) {
  const firstTime = new Date(firstItem.updatedAt ?? firstItem.createdAt ?? 0).getTime();
  const secondTime = new Date(secondItem.updatedAt ?? secondItem.createdAt ?? 0).getTime();

  return secondTime - firstTime;
}

export function CanvasInboxView() {
  const { dictionary, language } = useLanguage();
  const locale = language === 'ko' ? 'ko-KR' : 'en-CA';
  const [items, setItems] = useState<CanvasInboxItem[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const sortedItems = useMemo(() => [...items].sort(sortCanvasInboxItems), [items]);
  const isLoading = loadStatus === 'loading';

  const loadItems = () => {
    setLoadStatus('loading');
    setErrorMessage('');

    workspaceApi
      .getCanvasInboxItems(75)
      .then(({ items: nextItems }) => {
        setItems(nextItems);
        setLoadStatus('loaded');
      })
      .catch((error) => {
        setItems([]);
        setErrorMessage(error instanceof Error ? error.message : '');
        setLoadStatus('failed');
      });
  };

  useEffect(() => {
    loadItems();
  }, []);

  return (
    <Card className="min-h-[520px] rounded-xl bg-card p-4 shadow-none">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black uppercase text-muted-foreground">
            <Inbox aria-hidden="true" size={15} strokeWidth={2.4} />
            <span>{dictionary.canvasInboxEyebrow}</span>
          </div>
          <h2 className="mt-1 text-2xl font-black leading-tight text-foreground">
            {dictionary.canvasInboxTitle}
          </h2>
          <p className="mt-1 max-w-2xl text-sm font-semibold text-muted-foreground">
            {dictionary.canvasInboxSubtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <EventPill color="blue" label={`${sortedItems.length}`} />
          <Button
            aria-label={dictionary.canvasInboxRefresh}
            className="size-9"
            disabled={isLoading}
            onClick={loadItems}
            title={dictionary.canvasInboxRefresh}
            type="button"
            variant="outline"
          >
            <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="mb-3 flex min-w-0 items-center gap-2 rounded-lg border bg-muted/55 px-3 py-2 text-xs font-black text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="shrink-0 animate-spin text-primary" size={15} strokeWidth={2.4} />
          <span className="truncate">{dictionary.canvasInboxLoading}</span>
        </div>
      ) : null}

      {loadStatus === 'failed' ? (
        <div className="rounded-lg border border-dashed bg-muted/35 p-6 text-sm font-bold text-muted-foreground">
          {errorMessage || dictionary.canvasInboxUnavailable}
        </div>
      ) : null}

      {loadStatus !== 'failed' && !isLoading && sortedItems.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/35 p-6 text-sm font-bold text-muted-foreground">
          {dictionary.canvasInboxEmpty}
        </div>
      ) : null}

      {sortedItems.length > 0 ? (
        <div className="grid gap-2">
          {sortedItems.map((item) => {
            const timestamp = formatCanvasInboxDate(item.updatedAt ?? item.createdAt, locale);
            const courseLabel = item.courseCode || item.courseName || dictionary.canvasLms;

            return (
              <article
                className="grid min-w-0 gap-2 rounded-lg border bg-muted/25 p-3 transition hover:bg-muted/45 sm:grid-cols-[minmax(0,1fr)_auto]"
                key={item.id}
              >
                <div className="min-w-0">
                  <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                    <EventPill color="green" compact label={courseLabel} />
                    <span className="rounded-md border bg-card px-1.5 py-0.5 text-[10px] font-black uppercase text-muted-foreground">
                      {formatCanvasInboxType(item.type)}
                    </span>
                    {item.readState ? (
                      <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-black uppercase text-primary">
                        {item.readState}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="line-clamp-2 text-sm font-black leading-snug text-foreground">
                    {item.title}
                  </h3>
                  {item.message ? (
                    <p className="mt-1 line-clamp-2 text-sm font-semibold text-muted-foreground">
                      {item.message}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end">
                  {timestamp ? (
                    <time className="text-xs font-black text-muted-foreground">{timestamp}</time>
                  ) : null}
                  {item.htmlUrl ? (
                    <Button asChild className="h-8 gap-1.5 px-2 text-xs font-black" size="sm" variant="outline">
                      <a href={item.htmlUrl} rel="noreferrer" target="_blank">
                        <ExternalLink aria-hidden="true" className="size-3.5" />
                        {dictionary.canvasInboxOpen}
                      </a>
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}
