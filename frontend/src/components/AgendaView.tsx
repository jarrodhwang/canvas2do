import type { AgendaItem } from '../data/mockWorkspaceData';
import { Check, ExternalLink, EyeOff, MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { EventPill } from './EventPill';
import { Button } from './ui/button';
import { Card } from './ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useLanguage } from '../context/LanguageContext';

interface AgendaViewProps {
  emptyLabel?: string;
  items: AgendaItem[];
  onOpenItem?: (item: AgendaItem) => void;
  onOpenItemDetails?: (item: AgendaItem) => void;
  onRemoveItem?: (item: AgendaItem) => void;
  onSelectItem: () => void;
  onToggleItemDone?: (item: AgendaItem) => void;
  onToggleItemStar?: (item: AgendaItem) => void;
  showCurrentTime?: boolean;
}

function getNowMinutes() {
  const now = new Date();

  return (now.getHours() * 60) + now.getMinutes();
}

function getTimeMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return Number.POSITIVE_INFINITY;
  }

  return (Number.parseInt(match[1], 10) * 60) + Number.parseInt(match[2], 10);
}

function CurrentTimeLine() {
  return (
    <div className="my-2 grid grid-cols-[86px_minmax(0,1fr)] items-center gap-3 max-sm:grid-cols-[70px_minmax(0,1fr)]">
      <div className="text-right text-[10px] font-black text-red-500">
        Now
      </div>
      <div className="h-0.5 rounded-full bg-red-500 shadow-[0_0_0_1px_hsl(var(--card))]" />
    </div>
  );
}

export function AgendaView({
  emptyLabel,
  items,
  onOpenItem,
  onOpenItemDetails,
  onRemoveItem,
  onSelectItem,
  onToggleItemDone,
  onToggleItemStar,
  showCurrentTime = false,
}: AgendaViewProps) {
  const { dictionary } = useLanguage();
  const nowMinutes = getNowMinutes();
  let hasRenderedCurrentTime = false;
  const renderCurrentTimeIfNeeded = (itemTime: string) => {
    if (!showCurrentTime || hasRenderedCurrentTime || getTimeMinutes(itemTime) < nowMinutes) {
      return null;
    }

    hasRenderedCurrentTime = true;

    return <CurrentTimeLine />;
  };
  const renderTouchMenu = (item: AgendaItem) => {
    if (!item.canOpenDetails || !onOpenItemDetails) {
      return null;
    }

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
    <Card className="min-h-[440px] rounded-xl bg-card p-4 shadow-none">
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/35 p-4 text-sm font-black text-muted-foreground">
          {emptyLabel}
        </div>
      ) : null}
      {items.map((item) => (
        <div key={item.id}>
          {renderCurrentTimeIfNeeded(item.time)}
          <div
            className="mb-2 grid h-auto w-full cursor-pointer grid-cols-[86px_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg border bg-muted/35 p-3 text-left shadow-none transition hover:bg-muted max-sm:grid-cols-[70px_minmax(0,1fr)]"
            onClick={onSelectItem}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectItem();
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="text-base font-black text-primary">{item.time}</div>
            <div className="min-w-0">
              <div className="truncate font-black text-foreground">{item.title}</div>
              <div className="truncate text-xs font-semibold text-muted-foreground">
                {item.subtitle}
              </div>
            </div>
            <div className="max-sm:col-start-2 max-sm:justify-self-start">
              <EventPill color={item.color} label={item.type} />
            </div>
            <div className="max-sm:col-start-2 max-sm:justify-self-start">
              {renderTouchMenu(item)}
            </div>
          </div>
        </div>
      ))}
      {showCurrentTime && !hasRenderedCurrentTime ? <CurrentTimeLine /> : null}
    </Card>
  );
}
