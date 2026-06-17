import type { TimelineItem } from '../data/mockWorkspaceData';
import { Check, ExternalLink, EyeOff, MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-react';
import { trackGradientClasses } from '@/lib/colorStyles';
import { cn } from '@/lib/utils';
import { useLanguage } from '../context/LanguageContext';
import { EventPill } from './EventPill';
import { Card } from './ui/card';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface TimelineViewProps {
  label: string;
  items: TimelineItem[];
  monthLabel?: string;
  onOpenItem?: (item: TimelineItem) => void;
  onOpenItemDetails?: (item: TimelineItem) => void;
  onRemoveItem?: (item: TimelineItem) => void;
  onToggleItemDone?: (item: TimelineItem) => void;
  onToggleItemStar?: (item: TimelineItem) => void;
}

const monthIndexes: Record<string, number> = {
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
};

function getMonthInfo(monthLabel?: string) {
  if (!monthLabel) {
    return null;
  }

  const [rawMonth, rawYear] = monthLabel.split(/\s+/);
  const monthIndex = monthIndexes[rawMonth?.toLowerCase() ?? ''];
  const year = Number.parseInt(rawYear ?? '', 10);

  if (!Number.isInteger(monthIndex) || !Number.isInteger(year)) {
    return null;
  }

  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const today = new Date();
  const todayPercent = today.getFullYear() === year && today.getMonth() === monthIndex
    ? ((today.getDate() - 1) / Math.max(daysInMonth - 1, 1)) * 100
    : null;
  const roughDays = Array.from({ length: daysInMonth }, (_, index) => index + 1);

  return {
    daysInMonth,
    roughDays,
    todayPercent,
  };
}

export function TimelineView({
  label,
  items,
  monthLabel,
  onOpenItem,
  onOpenItemDetails,
  onRemoveItem,
  onToggleItemDone,
  onToggleItemStar,
}: TimelineViewProps) {
  const { dictionary } = useLanguage();
  const monthInfo = getMonthInfo(monthLabel);
  const groupedItems = Array.from(
    items.reduce<Map<string, TimelineItem[]>>((groups, item) => {
      groups.set(item.name, [...(groups.get(item.name) ?? []), item]);

      return groups;
    }, new Map()),
  )
    .map(([name, groupItems]) => ({
      color: groupItems[0]?.color ?? 'gray',
      items: groupItems.sort((firstItem, secondItem) => firstItem.offsetPercent - secondItem.offsetPercent),
      name,
      startOffset: Math.min(...groupItems.map((item) => item.offsetPercent)),
    }))
    .sort((firstGroup, secondGroup) => firstGroup.startOffset - secondGroup.startOffset);
  const renderTouchMenu = (item: TimelineItem) => {
    if (!item.canOpenDetails || !onOpenItemDetails) {
      return null;
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={dictionary.gmailMoreActions}
            className="absolute right-1 top-1/2 z-30 size-7 -translate-y-1/2 rounded-md border-border bg-background/85 text-muted-foreground hover:bg-muted hover:text-foreground"
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
          {onToggleItemDone ? (
            <DropdownMenuItem disabled={item.isLocked} onSelect={() => onToggleItemDone(item)}>
              <Check className="size-4" />
              <span>
                {item.isLocked
                  ? dictionary.courseworkSubmittedInCanvas
                  : item.isCompleted
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
    <Card className="flex min-h-[440px] flex-col rounded-xl bg-card p-4 shadow-none lg:h-full lg:min-h-0">
      <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
        <div className="text-[11px] font-black uppercase text-muted-foreground">{label}</div>
        {monthLabel ? (
          <div className="truncate rounded-md border bg-muted px-2 py-1 text-[11px] font-black text-foreground">
            {monthLabel}
          </div>
        ) : null}
      </div>
      <div className="mb-2 grid grid-cols-[150px_minmax(520px,1fr)] gap-3 text-[10px] font-black uppercase text-muted-foreground max-sm:grid-cols-1">
        <span>{dictionary.timelineCourse}</span>
        <span className="relative h-8 rounded-lg border bg-muted/35">
          {monthInfo?.roughDays.map((day) => (
            <span
              className="absolute top-1 -translate-x-1/2 text-[9px] font-black text-muted-foreground"
              key={day}
              style={{ left: `${((day - 1) / Math.max(monthInfo.daysInMonth - 1, 1)) * 100}%` }}
            >
              {day}
            </span>
          ))}
          {monthInfo?.todayPercent !== null && monthInfo?.todayPercent !== undefined ? (
            <span
              className="absolute bottom-1 top-1 w-0.5 rounded-full bg-red-500"
              style={{ left: `${monthInfo.todayPercent}%` }}
            >
              <span className="absolute left-1 top-0 rounded-sm bg-red-500 px-1 text-[9px] font-black uppercase text-white">
                Today
              </span>
            </span>
          ) : null}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {groupedItems.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/35 p-4 text-sm font-bold text-muted-foreground">
            No timeline items for this month.
          </div>
        ) : groupedItems.map((group) => (
          <section
            className="grid grid-cols-[150px_minmax(520px,1fr)] gap-3 border-t py-4 first:border-t-0 max-sm:grid-cols-1"
            key={group.name}
          >
            <div className="min-w-0 pt-1">
              <EventPill className="max-w-full px-2 text-xs" color={group.color} compact label={group.name} />
            </div>
            <div className="grid gap-2">
              {group.items.map((item) => (
                <div className="relative h-9 overflow-hidden rounded-lg border bg-muted/35" key={item.id}>
                  {monthInfo?.todayPercent !== null && monthInfo?.todayPercent !== undefined ? (
                    <span
                      className="absolute bottom-0 top-0 z-10 w-px bg-red-500/80"
                      style={{ left: `${monthInfo.todayPercent}%` }}
                    />
                  ) : null}
                  <span
                    className={cn(
                      'absolute top-1/2 z-20 flex h-5 min-w-9 -translate-y-1/2 items-center truncate rounded-md bg-gradient-to-r px-2.5 pr-8 text-[11px] font-black text-white shadow-sm',
                      trackGradientClasses[item.color],
                    )}
                    style={{ left: `${item.offsetPercent}%`, width: `${item.widthPercent}%` }}
                    title={item.label}
                  >
                    {item.label}
                  </span>
                  {renderTouchMenu(item)}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Card>
  );
}
