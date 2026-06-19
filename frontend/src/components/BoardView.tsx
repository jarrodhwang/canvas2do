import { CalendarPlus, Check, ExternalLink, EyeOff, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

import type { BoardItem } from '../data/mockWorkspaceData';
import { useLanguage } from '../context/LanguageContext';
import type { BoardColumnConfig, ColorToken } from '../modes/types';
import { dotColorClasses } from '../lib/colorStyles';
import { cn } from '../lib/utils';
import { EventPill } from './EventPill';
import { Button } from './ui/button';
import { Card } from './ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from './ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface BoardViewProps {
  columns: BoardColumnConfig[];
  items: BoardItem[];
  focusedItemId?: string | null;
  onAddItem?: (column: BoardColumnConfig) => void;
  onFinishItemTitleEdit?: () => void;
  onOpenItem?: (item: BoardItem) => void;
  onRemoveItem?: (item: BoardItem) => void;
  onMoveItemDueDate?: (item: BoardItem, target: 'today' | 'tomorrow') => void;
  onOpenItemDetails?: (item: BoardItem) => void;
  onStartItemTitleEdit?: (item: BoardItem) => void;
  onToggleItemStar?: (item: BoardItem) => void;
  onUpdateItemTitle?: (item: BoardItem, title: string) => void;
  onToggleItemDone?: (item: BoardItem) => void;
  showCurrentTime?: boolean;
}

interface StoredCoursePreference {
  chipColor?: ColorToken;
  code?: string;
  friendlyCourseCode?: string;
  originalCourseCode?: string;
}

const manualLecturesStorageKey = 'incos-academy-manual-lectures';
const canvasLecturePreferencesStorageKey = 'incos-academy-canvas-lecture-preferences';
const academyPreferencesUpdatedEvent = 'incos-academy-preferences-updated';

function normalizeCourseCode(value: string) {
  return value.replace(/\s+/g, '').toLowerCase();
}

function getCourseCodeRoot(value: string) {
  const match = value.match(/[a-z]{2,}\s*\d{2,4}[a-z]?/i);

  return match ? normalizeCourseCode(match[0]) : undefined;
}

function getCourseCodeCandidates(value?: string) {
  if (!value) {
    return [];
  }

  return [normalizeCourseCode(value), getCourseCodeRoot(value)].filter(Boolean) as string[];
}

function codesMatch(firstCode?: string, secondCode?: string) {
  const firstCandidates = getCourseCodeCandidates(firstCode);
  const secondCandidates = getCourseCodeCandidates(secondCode);

  return firstCandidates.some((candidate) => secondCandidates.includes(candidate));
}

function readStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const storedValue = window.localStorage.getItem(key);

    return storedValue ? JSON.parse(storedValue) as T : fallback;
  } catch {
    return fallback;
  }
}

function getStoredCourseChipColor(courseCode: string): ColorToken | undefined {
  const storedManualLectures = readStoredJson<unknown>(manualLecturesStorageKey, []);
  const manualLectures = Array.isArray(storedManualLectures)
    ? storedManualLectures as StoredCoursePreference[]
    : [];
  const manualLecture = manualLectures.find((lecture) => (
    codesMatch(courseCode, lecture.friendlyCourseCode) || codesMatch(courseCode, lecture.code)
  ));

  if (manualLecture?.chipColor) {
    return manualLecture.chipColor;
  }

  const storedCanvasPreferences = readStoredJson<unknown>(canvasLecturePreferencesStorageKey, {});
  const canvasPreferences = storedCanvasPreferences &&
    typeof storedCanvasPreferences === 'object' &&
    !Array.isArray(storedCanvasPreferences)
    ? storedCanvasPreferences as Record<string, StoredCoursePreference>
    : {};
  const canvasLecture = Object.values(canvasPreferences).find((preference) => (
    codesMatch(courseCode, preference.friendlyCourseCode) || codesMatch(courseCode, preference.originalCourseCode)
  ));

  return canvasLecture?.chipColor;
}

function isComplete(item: BoardItem) {
  if (typeof item.isCompleted === 'boolean') {
    return item.isCompleted;
  }

  const normalizedType = item.type.toLowerCase();
  const progressMatch = item.checklistProgress.match(/^(\d+)\s+of\s+(\d+)$/i);

  return normalizedType === 'done' || Boolean(progressMatch && progressMatch[1] === progressMatch[2]);
}

function getNowMinutes() {
  const now = new Date();

  return (now.getHours() * 60) + now.getMinutes();
}

function getItemMinutes(item: BoardItem) {
  if (item.dueAt) {
    const dueDate = new Date(item.dueAt);

    if (!Number.isNaN(dueDate.getTime())) {
      return (dueDate.getHours() * 60) + dueDate.getMinutes();
    }
  }

  const match = item.time?.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return Number.POSITIVE_INFINITY;
  }

  return (Number.parseInt(match[1], 10) * 60) + Number.parseInt(match[2], 10);
}

function getMoveDueDateTarget(item: BoardItem, complete: boolean) {
  if (item.isLocked || complete || !item.dueAt) {
    return null;
  }

  if (item.isCanvasSource && !item.isArchivedCanvasItem) {
    return null;
  }

  const dueDate = new Date(item.dueAt);

  if (Number.isNaN(dueDate.getTime())) {
    return null;
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDueDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()).getTime();

  if (startOfDueDate < startOfToday) {
    return 'today';
  }

  if (startOfDueDate === startOfToday) {
    return 'tomorrow';
  }

  return null;
}

function isTodoActionTarget(target: EventTarget | null) {
  return target instanceof Element &&
    Boolean(target.closest('button,a,input,textarea,select,[role="menuitem"],[data-calendar-todo-action]'));
}

function CurrentTimeLine() {
  return (
    <div className="my-2 flex items-center gap-2">
      <span className="text-[10px] font-black uppercase text-red-500">Now</span>
      <span className="h-0.5 min-w-0 flex-1 rounded-full bg-red-500" />
    </div>
  );
}

export function BoardView({
  columns,
  items,
  focusedItemId,
  onAddItem,
  onFinishItemTitleEdit,
  onOpenItem,
  onRemoveItem,
  onMoveItemDueDate,
  onOpenItemDetails,
  onStartItemTitleEdit,
  onToggleItemStar,
  onUpdateItemTitle,
  onToggleItemDone,
  showCurrentTime = false,
}: BoardViewProps) {
  const { dictionary, translateBoardColumn } = useLanguage();
  const [, setPreferenceVersion] = useState(0);
  const tapTimeoutRef = useRef<{ itemId: string; timeoutId: number } | null>(null);
  const nowMinutes = getNowMinutes();

  const clearTap = () => {
    if (tapTimeoutRef.current) {
      window.clearTimeout(tapTimeoutRef.current.timeoutId);
      tapTimeoutRef.current = null;
    }
  };
  const startTitleEdit = (item: BoardItem) => {
    if (item.isLocked || !item.isTitleEditable) {
      return;
    }

    onStartItemTitleEdit?.(item);
  };
  const handleRowTap = (event: ReactMouseEvent, item: BoardItem, isEditingTitle: boolean) => {
    if (isTodoActionTarget(event.target) || item.isLocked || isEditingTitle) {
      return;
    }

    if (tapTimeoutRef.current?.itemId === item.id) {
      clearTap();
      event.preventDefault();
      startTitleEdit(item);
      return;
    }

    clearTap();
    tapTimeoutRef.current = {
      itemId: item.id,
      timeoutId: window.setTimeout(() => {
        tapTimeoutRef.current = null;
        onToggleItemDone?.(item);
      }, 350),
    };
  };

  useEffect(() => {
    const handleAcademyPreferencesUpdated = () => {
      setPreferenceVersion((currentVersion) => currentVersion + 1);
    };

    window.addEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);

    return () => {
      window.removeEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);
    };
  }, []);

  useEffect(() => () => {
    clearTap();
  }, []);
  const renderItemTouchMenu = (item: BoardItem, complete: boolean) => {
    if (!item.canOpenDetails || !onOpenItemDetails) {
      return null;
    }

    const moveTarget = getMoveDueDateTarget(item, complete);

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={dictionary.gmailMoreActions}
            className="size-8 shrink-0 rounded-md border-border bg-background/80 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            size="icon-sm"
            title={dictionary.gmailMoreActions}
            type="button"
            variant="outline"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {onOpenItem ? (
            <DropdownMenuItem onSelect={() => onOpenItem(item)}>
              <ExternalLink className="size-4" />
              <span>{dictionary.courseOverviewOpenCanvas}</span>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => onOpenItemDetails(item)}>
            <Pencil className="size-4" />
            <span>{dictionary.courseworkOpenDetails}</span>
          </DropdownMenuItem>
          {onToggleItemStar ? (
            <DropdownMenuItem onSelect={() => onToggleItemStar(item)}>
              <Star className={cn('size-4', item.isStarred && 'fill-amber-400 text-amber-500')} />
              <span>{item.isStarred ? dictionary.courseworkUnstar : dictionary.courseworkStar}</span>
            </DropdownMenuItem>
          ) : null}
          {onMoveItemDueDate && moveTarget ? (
            <DropdownMenuItem onSelect={() => onMoveItemDueDate(item, moveTarget)}>
              <CalendarPlus className="size-4" />
              <span>
                {moveTarget === 'today'
                  ? dictionary.courseworkDoToday
                  : dictionary.courseworkDoTomorrow}
              </span>
            </DropdownMenuItem>
          ) : null}
          {onToggleItemDone ? (
            <DropdownMenuItem disabled={item.isLocked} onSelect={() => onToggleItemDone(item)}>
              <Check className="size-4" />
              <span>
                {item.isLocked
                  ? dictionary.courseworkSubmittedInCanvas
                  : complete
                    ? dictionary.courseworkMarkNotDone
                    : dictionary.courseworkMarkDone}
              </span>
            </DropdownMenuItem>
          ) : null}
          {onRemoveItem ? (
            <DropdownMenuItem onSelect={() => onRemoveItem(item)}>
              {item.isCanvasSource ? <EyeOff className="size-4" /> : <Trash2 className="size-4" />}
              <span>{item.isCanvasSource ? dictionary.courseworkHideCanvas : dictionary.courseworkDelete}</span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <Card className="overflow-hidden rounded-xl bg-card shadow-none lg:h-full lg:min-h-0">
      <div
        className="grid min-h-[440px] overflow-x-auto lg:h-full lg:min-h-0"
        style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))` }}
      >
        {columns.map((column) => {
          const columnItems = items
            .filter((item) => item.columnId === column.id)
            .sort((firstItem, secondItem) => getItemMinutes(firstItem) - getItemMinutes(secondItem));
          const columnLabel = translateBoardColumn(column.id, column.label);
          const columnChipColor =
            getStoredCourseChipColor(column.label) ?? getStoredCourseChipColor(columnLabel) ?? column.color;
          let hasRenderedCurrentTime = false;
          const renderCurrentTimeIfNeeded = (item: BoardItem) => {
            if (!showCurrentTime || hasRenderedCurrentTime || getItemMinutes(item) < nowMinutes) {
              return null;
            }

            hasRenderedCurrentTime = true;

            return <CurrentTimeLine />;
          };

          return (
            <section className="flex min-w-0 flex-col border-r bg-muted/25 p-3 last:border-r-0 lg:min-h-0" key={column.id}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-black">
                  <EventPill className="h-6 px-2 text-xs" color={columnChipColor} compact label={columnLabel} />
                  <EventPill color="gray" label={`${columnItems.length}`} compact />
                </h3>
                <Button
                  aria-label={dictionary.boardAddTodoItem}
                  className="size-7 shrink-0 rounded-md border-border bg-card text-muted-foreground hover:text-foreground"
                  disabled={!onAddItem || column.canAdd === false}
                  onClick={() => onAddItem?.(column)}
                  size="icon-sm"
                  title={dictionary.boardAddTodoItem}
                  type="button"
                  variant="outline"
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
              <div className="flex flex-col gap-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
                {columnItems.map((item) => {
                  const complete = isComplete(item);
                  const isEditingTitle = Boolean(item.isTitleEditable && (focusedItemId === item.id || item.title.trim() === ''));
                  const rowElement = (
                    <div key={item.id}>
                      {renderCurrentTimeIfNeeded(item)}
                      <div
                        className={cn(
                          'group flex w-full min-w-0 items-start gap-2 rounded-lg border bg-card p-2.5 text-left shadow-none transition hover:bg-muted/45',
                          !item.isLocked && 'cursor-pointer',
                        )}
                        onClick={(event) => {
                          handleRowTap(event, item, isEditingTitle);
                        }}
                      >
                        <div className="w-11 shrink-0 pt-1 text-right text-[11px] font-black tabular-nums text-muted-foreground">
                          {item.time || '—'}
                        </div>
                        {item.isClassSession ? (
                          <span
                            aria-hidden="true"
                            className={cn('mt-2 size-3 shrink-0 rounded-full', dotColorClasses[item.color])}
                          />
                        ) : (
                          <button
                            aria-label={item.isLocked ? item.title : dictionary.boardAddTodoItem}
                            className={cn(
                              'mt-0.5 grid size-6 shrink-0 place-items-center rounded-[10px] transition-colors',
                              complete
                                ? dotColorClasses[item.color]
                                : 'bg-muted-foreground/20 group-hover:bg-muted-foreground/30',
                              item.isLocked ? 'opacity-70' : 'cursor-pointer',
                            )}
                            disabled={item.isLocked}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!item.isLocked) {
                                onToggleItemDone?.(item);
                              }
                            }}
                            title={item.title}
                            type="button"
                          >
                            {complete ? <Check className="size-4 stroke-[3] text-white" /> : null}
                          </button>
                        )}
                        <div
                          className="min-w-0 flex-1 text-left"
                          onKeyDown={(event) => {
                            if (isTodoActionTarget(event.target)) {
                              return;
                            }

                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              if (!item.isLocked && !isEditingTitle) {
                                onToggleItemDone?.(item);
                              }
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            {isEditingTitle ? (
                              <input
                                aria-label={dictionary.boardAddTodoItem}
                                autoFocus
                                className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm font-semibold leading-snug text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/45"
                                onBlur={onFinishItemTitleEdit}
                                onChange={(event) => onUpdateItemTitle?.(item, event.target.value)}
                                onClick={(event) => event.stopPropagation()}
                                onFocus={(event) => event.currentTarget.select()}
                                onKeyDown={(event) => {
                                  event.stopPropagation();
                                  if (event.key === 'Enter' || event.key === 'Escape') {
                                    event.currentTarget.blur();
                                  }
                                }}
                                placeholder={dictionary.boardAddTodoItem}
                                value={item.title}
                              />
                            ) : (
                              <span
                                className="min-w-0 flex-1 whitespace-normal text-sm font-semibold leading-snug text-foreground"
                              >
                                {item.title || dictionary.boardAddTodoItem}
                              </span>
                            )}
                            <span className="flex shrink-0 flex-wrap gap-1">
                              <EventPill color={item.color} label={item.type} compact />
                              {renderItemTouchMenu(item, complete)}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  );

                  return item.canOpenDetails && onOpenItemDetails ? (
                    <ContextMenu key={item.id}>
                      <ContextMenuTrigger asChild>{rowElement}</ContextMenuTrigger>
                      <ContextMenuContent className="w-56">
                        <ContextMenuLabel>{item.title || dictionary.boardAddTodoItem}</ContextMenuLabel>
                        {onOpenItem ? (
                          <ContextMenuItem onSelect={() => onOpenItem(item)}>
                            <ExternalLink className="size-4" />
                            <span>{dictionary.courseOverviewOpenCanvas}</span>
                          </ContextMenuItem>
                        ) : null}
                        <ContextMenuItem onSelect={() => onOpenItemDetails(item)}>
                          <Pencil className="size-4" />
                          <span>{dictionary.courseworkOpenDetails}</span>
                        </ContextMenuItem>
                        {onToggleItemStar ? (
                          <ContextMenuItem onSelect={() => onToggleItemStar(item)}>
                            <Star className={cn('size-4', item.isStarred && 'fill-amber-400 text-amber-500')} />
                            <span>{item.isStarred ? dictionary.courseworkUnstar : dictionary.courseworkStar}</span>
                          </ContextMenuItem>
                        ) : null}
                        {onMoveItemDueDate && getMoveDueDateTarget(item, complete) ? (
                          <ContextMenuItem onSelect={() => onMoveItemDueDate(item, getMoveDueDateTarget(item, complete)!)}>
                            <CalendarPlus className="size-4" />
                            <span>
                              {getMoveDueDateTarget(item, complete) === 'today'
                                ? dictionary.courseworkDoToday
                                : dictionary.courseworkDoTomorrow}
                            </span>
                          </ContextMenuItem>
                        ) : null}
                        {onToggleItemDone ? (
                          <ContextMenuItem disabled={item.isLocked} onSelect={() => onToggleItemDone(item)}>
                            <Check className="size-4" />
                            <span>
                              {item.isLocked
                                ? dictionary.courseworkSubmittedInCanvas
                                : complete
                                  ? dictionary.courseworkMarkNotDone
                                  : dictionary.courseworkMarkDone}
                            </span>
                          </ContextMenuItem>
                        ) : null}
                        {onRemoveItem ? (
                          <ContextMenuItem onSelect={() => onRemoveItem(item)}>
                            {item.isCanvasSource ? <EyeOff className="size-4" /> : <Trash2 className="size-4" />}
                            <span>{item.isCanvasSource ? dictionary.courseworkHideCanvas : dictionary.courseworkDelete}</span>
                          </ContextMenuItem>
                        ) : null}
                      </ContextMenuContent>
                    </ContextMenu>
                  ) : rowElement;
                })}
                {showCurrentTime && !hasRenderedCurrentTime ? <CurrentTimeLine /> : null}
              </div>
            </section>
          );
        })}
        {columns.length === 0 ? (
          <div className="p-4 text-sm font-black text-muted-foreground">
            No coursework for this day.
          </div>
        ) : null}
      </div>
    </Card>
  );
}
