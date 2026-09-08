import { CalendarPlus, Check, ExternalLink, EyeOff, MoreHorizontal, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

import type { BoardItem } from '../data/mockWorkspaceData';
import { useLanguage } from '../context/LanguageContext';
import type { BoardColumnConfig } from '../modes/types';
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
  calendarTodoStyle?: 'comfortable' | 'compact';
  columns: BoardColumnConfig[];
  fillHeight?: boolean;
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

const academyPreferencesUpdatedEvent = 'canvas-to-do-preferences-updated';

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
  calendarTodoStyle = 'compact',
  columns,
  fillHeight = false,
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
  const { dictionary, language } = useLanguage();
  const holidayBadgeLabel = language === 'ko' ? '공휴일' : 'Holiday';
  const [, setPreferenceVersion] = useState(0);
  const tapTimeoutRef = useRef<{ itemId: string; timeoutId: number } | null>(null);
  const nowMinutes = getNowMinutes();
  const isDenseBoard = calendarTodoStyle === 'compact';

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
  const renderItemTouchMenu = (item: BoardItem, complete: boolean, compact = false) => {
    if (!item.canOpenDetails || !onOpenItemDetails) {
      return null;
    }

    const moveTarget = getMoveDueDateTarget(item, complete);

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={dictionary.moreActions}
            className={cn(
              'shrink-0 rounded-md border-border bg-background/80 text-muted-foreground hover:bg-muted hover:text-foreground',
              compact ? 'size-6' : 'size-8',
            )}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            size="icon-sm"
            title={dictionary.moreActions}
            type="button"
            variant="outline"
          >
            <MoreHorizontal className={compact ? 'size-3' : 'size-4'} />
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
    <Card
      className={cn(
        'overflow-hidden rounded-xl bg-card shadow-none lg:h-full lg:min-h-0',
        fillHeight && 'h-full min-h-0',
      )}
    >
      <div
        className={cn(
          'grid min-h-[440px] overflow-x-auto lg:h-full lg:min-h-0',
          fillHeight && 'h-full min-h-0',
        )}
        style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))` }}
      >
        {columns.map((column) => {
          const columnItems = items
            .filter((item) => item.columnId === column.id)
            .sort((firstItem, secondItem) => getItemMinutes(firstItem) - getItemMinutes(secondItem));
          const columnLabel = column.label;
          const columnChipColor = column.color;
          let hasRenderedCurrentTime = false;
          const renderCurrentTimeIfNeeded = (item: BoardItem) => {
            if (!showCurrentTime || hasRenderedCurrentTime || getItemMinutes(item) < nowMinutes) {
              return null;
            }

            hasRenderedCurrentTime = true;

            return <CurrentTimeLine />;
          };

          return (
            <section
              className={cn(
                'flex min-w-0 flex-col border-r bg-muted/25 last:border-r-0 lg:min-h-0',
                isDenseBoard ? 'p-2' : 'p-3',
                fillHeight && 'min-h-0',
              )}
              key={column.id}
            >
              <div className={cn('flex items-center justify-between gap-2', isDenseBoard ? 'mb-2' : 'mb-3')}>
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
              <div
                className={cn(
                  'flex flex-col gap-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1',
                  fillHeight && 'min-h-0 flex-1 overflow-y-auto pr-1',
                )}
              >
                {columnItems.map((item) => {
                  const complete = isComplete(item);
                  const isCanceledForHoliday = Boolean(item.isCanceledForHoliday);
                  const isEditingTitle = Boolean(item.isTitleEditable && (focusedItemId === item.id || item.title.trim() === ''));
                  const itemTouchMenu = renderItemTouchMenu(item, complete, isDenseBoard);
                  const rowElement = (
                    <div key={item.id}>
                      {renderCurrentTimeIfNeeded(item)}
                      <div
                        className={cn(
                          'group flex w-full min-w-0 rounded-lg border bg-card text-left shadow-none transition hover:bg-muted/45',
                          isDenseBoard
                            ? 'relative min-h-12 items-end gap-1.5 px-2 pb-2 pt-6'
                            : 'min-h-12 items-center gap-2 p-2',
                          complete && !isCanceledForHoliday && 'border-foreground/25 bg-muted/45 opacity-80',
                          !item.isLocked && 'cursor-pointer',
                        )}
                        onClick={(event) => {
                          handleRowTap(event, item, isEditingTitle);
                        }}
                      >
                        {isCanceledForHoliday ? (
                          <span
                            className="absolute -right-1 top-1 z-20 max-w-20 truncate rounded-full border border-red-500/35 bg-card px-1.5 py-0.5 text-[9px] font-black uppercase leading-none text-red-600 shadow-sm"
                            title={item.holidayName}
                          >
                            {holidayBadgeLabel}
                          </span>
                        ) : null}
                        {item.isClassSession ? (
                          <span
                            aria-hidden="true"
                            className={cn(
                              'shrink-0 rounded-full',
                              isCanceledForHoliday
                                ? 'size-3 bg-muted-foreground/35'
                                : complete
                                  ? 'size-3 bg-muted-foreground/35'
                                : cn(isDenseBoard ? 'size-3' : 'size-3', dotColorClasses[item.color]),
                            )}
                          />
                        ) : (
                          <button
                            aria-label={item.isLocked ? item.title : dictionary.boardAddTodoItem}
                            className={cn(
                              'grid shrink-0 place-items-center transition-colors',
                              isDenseBoard ? 'size-5 rounded-[8px]' : 'size-6 rounded-[10px]',
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
                            {complete ? <Check className={cn(isDenseBoard ? 'size-3.5' : 'size-4', 'stroke-[3] text-white')} /> : null}
                          </button>
                        )}
                        <span
                          className={cn(
                            'shrink-0 rounded-md bg-muted/65 font-black tabular-nums text-muted-foreground',
                            isDenseBoard
                              ? 'absolute left-2 top-1.5 px-1 py-0 text-[10px]'
                              : 'px-1.5 py-0.5 text-[11px]',
                          )}
                        >
                          {item.time || '—'}
                        </span>
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
                          {isEditingTitle ? (
                            <input
                              aria-label={dictionary.boardAddTodoItem}
                              autoFocus
                              className="block w-full min-w-0 rounded-md border bg-background px-2 py-1 text-sm font-semibold leading-snug text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/45"
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
	                              className={cn(
                                'block min-w-0 truncate font-semibold leading-snug text-foreground',
                                isDenseBoard ? 'text-sm' : 'text-sm',
                                complete && !isCanceledForHoliday && 'text-muted-foreground line-through decoration-2',
                                isCanceledForHoliday && 'text-foreground line-through decoration-2 decoration-red-500',
                              )}
                            >
                              {item.title || dictionary.boardAddTodoItem}
                            </span>
                          )}
                        </div>
                        {isDenseBoard ? (
                          <EventPill
                            className={cn(
                              'absolute -right-0.5 top-1 z-10 max-w-[72px] shrink-0 bg-card/95 px-1.5 text-[10px] shadow-sm backdrop-blur',
                              isCanceledForHoliday && 'hidden',
                            )}
                            color={item.color}
                            label={item.type}
                            compact
                          />
                        ) : (
                          <EventPill
                            className={cn('max-w-20 shrink-0', isCanceledForHoliday && 'hidden')}
                            color={item.color}
                            label={item.type}
                            compact
                          />
                        )}
                        {itemTouchMenu}
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
