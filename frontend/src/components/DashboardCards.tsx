import { CalendarPlus, ChevronDown, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { workspaceApi, type CanvasCourse } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { useWorkspaceMode } from '../context/WorkspaceModeContext';
import type { DashboardCardConfig } from '../modes/types';
import { cn } from '../lib/utils';
import { EventPill } from './EventPill';
import { GoogleProductIcon, type GoogleProduct } from './GoogleProductIcon';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

type DashboardRow = DashboardCardConfig['rows'][number];

function createCanvasLectureRows(courses: CanvasCourse[], maxRows: number): DashboardRow[] {
  return courses.slice(0, maxRows).map((course) => ({
    id: course.id,
    label: course.courseCode?.trim() || course.id,
    value: course.name,
  }));
}

function BrandIcon({ source }: { source: DashboardRow['source'] }) {
  if (source && ['gmail', 'chat', 'meet', 'docs', 'sheets', 'slides'].includes(source)) {
    return <GoogleProductIcon product={source as GoogleProduct} size={16} />;
  }

  const fallback =
    source === 'teams'
      ? { color: '#6264A7', label: 'T' }
      : source === 'zoom'
        ? { color: '#0B5CFF', label: 'Z' }
        : { color: '#4285F4', label: 'D' };

  return (
    <span
      aria-hidden="true"
      className="inline-grid size-4 place-items-center rounded-[4px] text-[9px] font-black leading-none text-white"
      style={{ backgroundColor: fallback.color }}
    >
      {fallback.label}
    </span>
  );
}

function DashboardRows({ card }: { card: DashboardCardConfig }) {
  const rows = card.rows.slice(0, card.maxRows ?? card.rows.length);

  if (card.layout === 'agenda') {
    return rows.map((row) => (
      <div
        className="flex min-w-0 items-center gap-3 border-t py-2 text-sm first:border-t-0"
        key={`${card.id}-${row.label}-${row.value}`}
      >
        <EventPill className="h-6 px-2 text-xs" color={card.color} compact label={row.label} />
        <strong className="min-w-0 truncate">{row.value}</strong>
      </div>
    ));
  }

  if (card.layout === 'messages') {
    return rows.map((row) => (
      <div
        className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)_34px] items-center gap-2 border-t py-2 text-sm first:border-t-0"
        key={`${card.id}-${row.label}-${row.value}`}
      >
        <span className="grid size-7 place-items-center rounded-lg bg-muted">
          <BrandIcon source={row.source} />
        </span>
        <div className="min-w-0">
          <strong className="block truncate leading-tight">{row.value}</strong>
          <span className="block truncate text-xs font-bold text-muted-foreground">
            {row.description}
          </span>
        </div>
        <span className="justify-self-end text-xs font-black text-muted-foreground">{row.label}</span>
      </div>
    ));
  }

  if (card.layout === 'meetings') {
    return rows.map((row) => {
      const content = (
        <>
          <EventPill className="h-6 px-2 text-xs" color={card.color} compact label={row.label} />
          <div className="min-w-0 flex-1">
            <strong className="block truncate leading-tight">{row.value}</strong>
            <span className="block truncate text-xs font-bold text-muted-foreground">
              {row.description}
            </span>
          </div>
          <BrandIcon source={row.source} />
        </>
      );

      return row.href ? (
        <a
          className="flex min-w-0 items-center gap-3 border-t py-2 text-sm transition hover:bg-muted/45 first:border-t-0"
          href={row.href}
          key={`${card.id}-${row.label}-${row.value}`}
          rel="noreferrer"
          target="_blank"
          title={row.description ? `${row.value} - ${row.description}` : row.value}
        >
          {content}
        </a>
      ) : (
        <div
          className="flex min-w-0 items-center gap-3 border-t py-2 text-sm first:border-t-0"
          key={`${card.id}-${row.label}-${row.value}`}
          title={row.value}
        >
          {content}
        </div>
      );
    });
  }

  return rows.map((row) => (
    <div
      className="flex items-center justify-between gap-3 border-t py-2 text-sm first:border-t-0"
      key={`${card.id}-${row.label}`}
    >
      <span className="text-muted-foreground">{row.label}</span>
      <strong className="text-right">{row.value}</strong>
    </div>
  ));
}

interface DashboardCardsProps {
  onOpenAddItem?: () => void;
  onPlanMeeting?: () => void;
  onStartMeetingNow?: () => void;
  onWriteInPersonMeetingReport?: () => void;
}

export function DashboardCards({
  onOpenAddItem,
  onPlanMeeting,
  onStartMeetingNow,
  onWriteInPersonMeetingReport,
}: DashboardCardsProps) {
  const { activeMode } = useWorkspaceMode();
  const { dictionary, translateDashboardCard, translateModeName } = useLanguage();
  const [isRefreshingMessages, setIsRefreshingMessages] = useState(false);
  const [canvasCourses, setCanvasCourses] = useState<CanvasCourse[] | null>(null);
  const [canvasTermName, setCanvasTermName] = useState<string | undefined>();
  const refreshTimeoutRef = useRef<number | null>(null);
  const dashboardCards = activeMode.dashboardCards.map((card) => {
    const translatedCard = translateDashboardCard(activeMode.id, card);

    if (activeMode.id === 'academy' && translatedCard.id === 'semester-lectures' && canvasCourses) {
      return {
        ...translatedCard,
        pill: canvasTermName ?? translatedCard.pill,
        rows: createCanvasLectureRows(canvasCourses, translatedCard.maxRows ?? 5),
      };
    }

    return translatedCard;
  });

  useEffect(
    () => () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let isCancelled = false;

    if (activeMode.id !== 'academy') {
      setCanvasCourses(null);
      setCanvasTermName(undefined);
      return undefined;
    }

    workspaceApi
      .getCanvasCourses(5)
      .then(({ courses, termName }) => {
        if (isCancelled) {
          return;
        }

        setCanvasCourses(courses);
        setCanvasTermName(termName);
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setCanvasCourses(null);
        setCanvasTermName(undefined);
      });

    return () => {
      isCancelled = true;
    };
  }, [activeMode.id]);

  const handleRefreshMessages = () => {
    setIsRefreshingMessages(true);

    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      setIsRefreshingMessages(false);
      refreshTimeoutRef.current = null;
    }, 700);
  };

  const renderCardAction = (card: DashboardCardConfig) => {
    if (card.id === 'agenda') {
      return (
        <Button
          aria-label={dictionary.dashboardAddAgenda}
          className="size-7 border-border bg-background/70 text-muted-foreground hover:text-foreground"
          onClick={onOpenAddItem}
          size="icon-sm"
          title={dictionary.dashboardAddAgenda}
          type="button"
          variant="outline"
        >
          <Plus className="size-3.5" />
        </Button>
      );
    }

    if (card.id === 'messages') {
      return (
        <Button
          aria-label={dictionary.dashboardRefreshMessages}
          className="size-7 border-border bg-background/70 text-muted-foreground hover:text-foreground"
          onClick={handleRefreshMessages}
          size="icon-sm"
          title={dictionary.dashboardRefreshMessages}
          type="button"
          variant="outline"
        >
          <RefreshCw className={cn('size-3.5', isRefreshingMessages && 'animate-spin')} />
        </Button>
      );
    }

    if (card.id === 'meetings') {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={dictionary.dashboardAddMeeting}
              className="h-7 gap-1 rounded-md border-border bg-background/70 px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              size="sm"
              title={dictionary.dashboardAddMeeting}
              type="button"
              variant="outline"
            >
              <GoogleProductIcon decorative product="meet" size={15} />
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem
              onSelect={() => {
                onStartMeetingNow?.();
              }}
            >
              <GoogleProductIcon decorative product="meet" size={16} />
              <span>{dictionary.dashboardStartMeetingNow}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onPlanMeeting?.();
              }}
            >
              <CalendarPlus className="size-4" />
              <span>{dictionary.dashboardPlanMeeting}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onWriteInPersonMeetingReport?.();
              }}
            >
              <GoogleProductIcon decorative product="docs" size={16} />
              <span>{dictionary.dashboardWriteMeetingReport}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    return null;
  };

  return (
    <section
      className="grid gap-3 xl:grid-cols-3"
      aria-label={`${translateModeName(activeMode.id, activeMode.displayName)} dashboard summary`}
    >
      {dashboardCards.map((card) => (
        <Card className="rounded-xl bg-card shadow-none" key={card.id}>
          <CardHeader className="gap-2 pb-3">
            <div className="flex min-w-0 items-start justify-between gap-3">
              {card.kicker ? (
                <div className="text-[11px] font-black uppercase text-muted-foreground">
                  {card.kicker}
                </div>
              ) : null}
              <div
                className={cn(
                  'flex min-w-0 items-center gap-2',
                  card.kicker ? 'justify-end' : 'w-full justify-between',
                )}
              >
                <CardTitle
                  className={cn(
                    'min-w-0 truncate text-base font-black leading-tight',
                    card.kicker ? 'text-right' : 'text-left',
                  )}
                >
                  {card.title}
                </CardTitle>
                {!card.kicker && card.pill ? (
                  <EventPill color={card.color} label={card.pill} />
                ) : null}
                {renderCardAction(card)}
              </div>
            </div>
            {card.kicker && card.pill ? (
              <div>
                <EventPill color={card.color} label={card.pill} />
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <DashboardRows card={card} />
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
