import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, ExternalLink, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';

import { workspaceApi, type CanvasInboxItem } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { cn } from '../lib/utils';
import type { ColorToken } from '../modes/types';
import { EventPill } from './EventPill';
import { Button } from './ui/button';
import { Card } from './ui/card';

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';
const canvasLecturePreferencesStorageKey = 'incos-academy-canvas-lecture-preferences';
const colorTokens = new Set<ColorToken>(['blue', 'green', 'orange', 'red', 'purple', 'teal', 'gold', 'gray']);

interface CanvasInboxViewProps {
  onOpenIntegration?: (courseRowId?: string | null, resourceUrl?: string | null) => void;
}

interface InboxCourseGroup {
  key: string;
  label: string;
  color: ColorToken;
  items: CanvasInboxItem[];
}

interface InboxSelectionHistory {
  ids: string[];
  index: number;
}

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

function hasHtmlMarkup(value?: string) {
  return Boolean(value && /<\/?[a-z][\s\S]*>/i.test(value));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeCanvasInboxEntities(value: string) {
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');

    textarea.innerHTML = value;

    return textarea.value;
  }

  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getCanvasInboxRenderableMessage(value?: string) {
  if (!value) {
    return '';
  }

  if (hasHtmlMarkup(value)) {
    return value;
  }

  const decodedValue = decodeCanvasInboxEntities(value);

  return hasHtmlMarkup(decodedValue) ? decodedValue : value;
}

function stripCanvasInboxHtml(value?: string) {
  if (!value) {
    return '';
  }

  if (typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(value, 'text/html');

    return document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeCanvasInboxHtml(value?: string) {
  if (!value) {
    return '';
  }

  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return escapeHtml(stripCanvasInboxHtml(value));
  }

  const document = new DOMParser().parseFromString(value, 'text/html');

  document
    .querySelectorAll('script, style, iframe, object, embed, link, meta, form')
    .forEach((element) => element.remove());
  document.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const attributeName = attribute.name.toLowerCase();
      const attributeValue = attribute.value.trim().toLowerCase();

      if (attributeName.startsWith('on') || attributeValue.startsWith('javascript:')) {
        element.removeAttribute(attribute.name);
      }
    });

    if (element.tagName.toLowerCase() === 'a') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noreferrer');
    }
  });

  return document.body.innerHTML;
}

function getInboxCourseLabel(item: CanvasInboxItem, fallback: string) {
  return item.courseCode?.trim() || item.courseName?.trim() || fallback;
}

function getInboxCourseKey(item: CanvasInboxItem, fallback: string) {
  return item.courseId?.trim() || getInboxCourseLabel(item, fallback);
}

function readCanvasCourseColorPreferences() {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const storedValue = window.localStorage.getItem(canvasLecturePreferencesStorageKey);
    const preferences = storedValue ? JSON.parse(storedValue) as Record<string, { chipColor?: unknown }> : {};

    return preferences && typeof preferences === 'object' && !Array.isArray(preferences)
      ? preferences
      : {};
  } catch {
    return {};
  }
}

function getInboxCourseColor(item: CanvasInboxItem, preferences: Record<string, { chipColor?: unknown }>): ColorToken {
  const storedColor = item.courseId ? preferences[item.courseId]?.chipColor : undefined;

  return typeof storedColor === 'string' && colorTokens.has(storedColor as ColorToken)
    ? storedColor as ColorToken
    : 'green';
}

function getCanvasCourseRowId(item: CanvasInboxItem) {
  if (item.courseId?.trim()) {
    return `canvas:${item.courseId.trim()}`;
  }

  const match = item.htmlUrl?.match(/\/courses\/([^/?#]+)/i);

  return match?.[1] ? `canvas:${match[1]}` : null;
}

function groupCanvasInboxItems(items: CanvasInboxItem[], fallbackLabel: string, locale: string) {
  const groups = new Map<string, InboxCourseGroup>();
  const preferences = readCanvasCourseColorPreferences();

  items.forEach((item) => {
    const key = getInboxCourseKey(item, fallbackLabel);
    const label = getInboxCourseLabel(item, fallbackLabel);
    const currentGroup = groups.get(key) ?? {
      color: getInboxCourseColor(item, preferences),
      key,
      label,
      items: [],
    };

    currentGroup.items.push(item);
    groups.set(key, currentGroup);
  });

  return Array.from(groups.values()).sort((firstGroup, secondGroup) => (
    firstGroup.label.localeCompare(secondGroup.label, locale, { numeric: true, sensitivity: 'base' })
  ));
}

export function CanvasInboxView({ onOpenIntegration }: CanvasInboxViewProps = {}) {
  const { dictionary, language } = useLanguage();
  const locale = language === 'ko' ? 'ko-KR' : 'en-CA';
  const [items, setItems] = useState<CanvasInboxItem[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [collapsedCourseKeys, setCollapsedCourseKeys] = useState<Set<string>>(() => new Set());
  const [selectionHistory, setSelectionHistory] = useState<InboxSelectionHistory>({ ids: [], index: -1 });
  const sortedItems = useMemo(() => [...items].sort(sortCanvasInboxItems), [items]);
  const groupedItems = useMemo(
    () => groupCanvasInboxItems(sortedItems, dictionary.canvasInboxCourseFallback, locale),
    [dictionary.canvasInboxCourseFallback, locale, sortedItems],
  );
  const selectedItem = useMemo(
    () => sortedItems.find((item) => item.id === selectedItemId) ?? null,
    [selectedItemId, sortedItems],
  );
  const selectedMessage = useMemo(
    () => getCanvasInboxRenderableMessage(selectedItem?.message),
    [selectedItem?.message],
  );
  const isLoading = loadStatus === 'loading';
  const canGoBack = selectionHistory.index > 0;
  const canGoForward = selectionHistory.index >= 0 && selectionHistory.index < selectionHistory.ids.length - 1;
  const toggleCourseGroup = (courseKey: string) => {
    setCollapsedCourseKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys);

      if (nextKeys.has(courseKey)) {
        nextKeys.delete(courseKey);
      } else {
        nextKeys.add(courseKey);
      }

      return nextKeys;
    });
  };

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

  const selectInboxItem = (itemId: string, replaceHistory = false) => {
    setSelectedItemId(itemId);
    setSelectionHistory((currentHistory) => {
      const activeId = currentHistory.ids[currentHistory.index];

      if (activeId === itemId && !replaceHistory) {
        return currentHistory;
      }

      if (replaceHistory || currentHistory.index < 0) {
        return { ids: [itemId], index: 0 };
      }

      const nextIds = currentHistory.ids.slice(0, currentHistory.index + 1);

      nextIds.push(itemId);

      return { ids: nextIds, index: nextIds.length - 1 };
    });
  };

  const navigateSelectionHistory = (nextIndex: number) => {
    const nextItemId = selectionHistory.ids[nextIndex];

    if (!nextItemId || !sortedItems.some((item) => item.id === nextItemId)) {
      return;
    }

    setSelectedItemId(nextItemId);
    setSelectionHistory((currentHistory) => ({ ...currentHistory, index: nextIndex }));
  };

  const openInboxItem = (item: CanvasInboxItem) => {
    if (!item.htmlUrl) {
      return;
    }

    const courseRowId = getCanvasCourseRowId(item);

    if (courseRowId && onOpenIntegration) {
      onOpenIntegration(courseRowId, item.htmlUrl);
      return;
    }

    window.open(item.htmlUrl, '_blank', 'noopener,noreferrer');
  };

  const handleInboxMessageClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!selectedItem || !onOpenIntegration) {
      return;
    }

    const target = event.target;
    const targetElement = target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
    const anchor = targetElement?.closest('a');
    const href = anchor?.getAttribute('href') ?? anchor?.href;
    const courseRowId = getCanvasCourseRowId(selectedItem);

    if (!href || !courseRowId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onOpenIntegration(courseRowId, href);
  };

  const handleInboxAuxClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button === 3 && canGoBack) {
      event.preventDefault();
      navigateSelectionHistory(selectionHistory.index - 1);
    }

    if (event.button === 4 && canGoForward) {
      event.preventDefault();
      navigateSelectionHistory(selectionHistory.index + 1);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  useEffect(() => {
    if (sortedItems.length === 0) {
      setSelectedItemId(null);
      setSelectionHistory({ ids: [], index: -1 });
      return;
    }

    if (selectedItemId && sortedItems.some((item) => item.id === selectedItemId)) {
      return;
    }

    selectInboxItem(sortedItems[0].id, true);
  }, [selectedItemId, sortedItems]);

  return (
    <Card
      className="min-h-[620px] rounded-xl bg-card p-0 shadow-none xl:h-[calc(100vh_-_var(--top-bar-height)_-_1.5rem)] xl:min-h-0"
      onAuxClick={handleInboxAuxClick}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b p-4">
          <div className="flex items-start justify-between gap-3">
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
            <div className="mt-3 flex min-w-0 items-center gap-2 rounded-lg border bg-muted/55 px-3 py-2 text-xs font-black text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="shrink-0 animate-spin text-primary" size={15} strokeWidth={2.4} />
              <span className="truncate">{dictionary.canvasInboxLoading}</span>
            </div>
          ) : null}
        </div>

        {loadStatus === 'failed' ? (
          <div className="m-4 rounded-lg border border-dashed bg-muted/35 p-6 text-sm font-bold text-muted-foreground">
            {errorMessage || dictionary.canvasInboxUnavailable}
          </div>
        ) : null}

        {loadStatus !== 'failed' && !isLoading && sortedItems.length === 0 ? (
          <div className="m-4 rounded-lg border border-dashed bg-muted/35 p-6 text-sm font-bold text-muted-foreground">
            {dictionary.canvasInboxEmpty}
          </div>
        ) : null}

        {sortedItems.length > 0 ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[330px_minmax(0,1fr)]">
            <aside className="min-h-0 border-b bg-muted/15 lg:border-b-0 lg:border-r">
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 border-b px-3 py-2">
                  <p className="text-xs font-black uppercase text-muted-foreground">
                    {dictionary.canvasInboxGroupByCourse}
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {groupedItems.map((group) => (
                    <section className="mb-3 last:mb-0" key={group.key}>
                      <button
                        className="sticky top-0 z-10 mb-1 flex w-full items-center justify-between gap-2 rounded-md bg-card/95 px-2 py-1.5 text-left backdrop-blur transition hover:bg-muted/55"
                        onClick={() => toggleCourseGroup(group.key)}
                        type="button"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {collapsedCourseKeys.has(group.key) ? (
                            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <EventPill color={group.color} compact label={group.label} />
                        </span>
                        <span className="text-[10px] font-black text-muted-foreground">{group.items.length}</span>
                      </button>
                      {!collapsedCourseKeys.has(group.key) ? (
                      <div className="space-y-1">
                        {group.items.map((item) => {
                          const timestamp = formatCanvasInboxDate(item.updatedAt ?? item.createdAt, locale);
                          const preview = stripCanvasInboxHtml(getCanvasInboxRenderableMessage(item.message));
                          const isSelected = item.id === selectedItemId;

                          return (
                            <button
                              className={cn(
                                'w-full rounded-lg border px-3 py-2 text-left transition hover:bg-muted/55',
                                isSelected
                                  ? 'border-primary/35 border-l-4 border-l-primary bg-primary/10'
                                  : 'border-transparent bg-transparent',
                              )}
                              key={item.id}
                              onClick={() => selectInboxItem(item.id)}
                              type="button"
                            >
                              <div className="mb-1 flex min-w-0 items-center gap-2">
                                <span className="rounded-md border bg-card px-1.5 py-0.5 text-[10px] font-black uppercase text-muted-foreground">
                                  {formatCanvasInboxType(item.type)}
                                </span>
                                {timestamp ? (
                                  <time className="truncate text-[11px] font-black text-muted-foreground">{timestamp}</time>
                                ) : null}
                              </div>
                              <h3 className="line-clamp-2 text-sm font-black leading-snug text-foreground">
                                {item.title}
                              </h3>
                              {preview ? (
                                <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-muted-foreground">
                                  {preview}
                                </p>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                      ) : null}
                    </section>
                  ))}
                </div>
              </div>
            </aside>

            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
              {selectedItem ? (
                <>
                  <div className="shrink-0 border-b p-4">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                          <EventPill
                            color={getInboxCourseColor(selectedItem, readCanvasCourseColorPreferences())}
                            compact
                            label={getInboxCourseLabel(selectedItem, dictionary.canvasInboxCourseFallback)}
                          />
                          <span className="rounded-md border bg-card px-1.5 py-0.5 text-[10px] font-black uppercase text-muted-foreground">
                            {formatCanvasInboxType(selectedItem.type)}
                          </span>
                          {selectedItem.readState ? (
                            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-black uppercase text-primary">
                              {selectedItem.readState}
                            </span>
                          ) : null}
                        </div>
                        <h1 className="text-xl font-black leading-tight text-foreground">
                          {selectedItem.title}
                        </h1>
                        {formatCanvasInboxDate(selectedItem.updatedAt ?? selectedItem.createdAt, locale) ? (
                          <time className="mt-2 block text-xs font-black text-muted-foreground">
                            {formatCanvasInboxDate(selectedItem.updatedAt ?? selectedItem.createdAt, locale)}
                          </time>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          aria-label={dictionary.courseDetailPrevious}
                          className="h-9 rounded-md px-3"
                          disabled={!canGoBack}
                          onClick={() => navigateSelectionHistory(selectionHistory.index - 1)}
                          size="sm"
                          title={dictionary.courseDetailPrevious}
                          type="button"
                          variant="outline"
                        >
                          <ArrowLeft className="size-4" />
                          <span className="hidden sm:inline">{dictionary.courseDetailPrevious}</span>
                        </Button>
                        <Button
                          aria-label={dictionary.courseDetailNext}
                          className="h-9 rounded-md px-3"
                          disabled={!canGoForward}
                          onClick={() => navigateSelectionHistory(selectionHistory.index + 1)}
                          size="sm"
                          title={dictionary.courseDetailNext}
                          type="button"
                          variant="outline"
                        >
                          <span className="hidden sm:inline">{dictionary.courseDetailNext}</span>
                          <ArrowRight className="size-4" />
                        </Button>
                        {selectedItem.htmlUrl ? (
                          <Button
                            className="rounded-md"
                            onClick={() => openInboxItem(selectedItem)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <ExternalLink className="size-4" />
                            {dictionary.canvasInboxOpen}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {selectedMessage ? (
                      hasHtmlMarkup(selectedMessage) ? (
                        <div
                          className={cn(
                            'course-rich-content rounded-lg border bg-card p-5 text-sm leading-6 text-foreground',
                            '[&_a]:font-semibold [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline',
                            '[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
                            '[&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold',
                            '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_p]:my-2',
                            '[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border',
                            '[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5',
                            '[&_table]:my-3 [&_table]:w-full [&_table]:overflow-hidden [&_table]:rounded-lg [&_table]:border [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:bg-muted/50 [&_th]:p-2 [&_th]:text-left',
                          )}
                          dangerouslySetInnerHTML={{ __html: sanitizeCanvasInboxHtml(selectedMessage) }}
                          onClick={handleInboxMessageClick}
                        />
                      ) : (
                        <div className="rounded-lg border bg-card p-5 text-sm font-semibold leading-6 text-foreground whitespace-pre-wrap">
                          {selectedMessage}
                        </div>
                      )
                    ) : (
                      <div className="rounded-lg border border-dashed bg-muted/35 p-6 text-sm font-bold text-muted-foreground">
                        {dictionary.canvasInboxNoMessage}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="grid min-h-0 flex-1 place-items-center p-6 text-center text-sm font-bold text-muted-foreground">
                  {dictionary.canvasInboxSelectNotification}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
