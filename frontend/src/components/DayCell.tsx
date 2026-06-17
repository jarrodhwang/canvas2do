import type { CalendarDay } from '../data/mockWorkspaceData';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { getHolidayForDate } from '../i18n';
import { badgeColorClasses, dotColorClasses, timelineTextClasses } from '@/lib/colorStyles';
import { cn } from '@/lib/utils';
import {
  CalendarProgressIndicator,
  defaultCalendarProgressThresholds,
  type CalendarProgressDisplay,
  type CalendarProgressThresholds,
} from './CalendarProgressIndicator';

interface DayCellProps {
  day: CalendarDay;
  isExpanded?: boolean;
  isSelected?: boolean;
  onSelect: () => void;
  progressDisplay?: CalendarProgressDisplay;
  progressThresholds?: CalendarProgressThresholds;
}

function getDateIsoFromDayId(dayId: string) {
  const isoDateMatch = dayId.match(/\d{4}-\d{2}-\d{2}$/);

  if (isoDateMatch) {
    return isoDateMatch[0];
  }

  const [, monthDay] = dayId.split('-');

  if (!monthDay || monthDay.length !== 4) {
    return undefined;
  }

  return `2026-${monthDay.slice(0, 2)}-${monthDay.slice(2)}`;
}

function isSundayIsoDate(dateIso: string) {
  const [year, month, day] = dateIso.split('-').map((value) => Number.parseInt(value, 10));

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
}

function getTodayIsoDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, '0');
  const day = `${today.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getDesktopVisibleEventCount(height: number, isExpanded: boolean, hasTimeline: boolean) {
  if (height <= 0) {
    return isExpanded ? 5 : 4;
  }

  const availableHeight = height - 36 - (hasTimeline ? 18 : 0);
  const calculatedCount = Math.floor(availableHeight / 20);
  const maximumCount = isExpanded ? 8 : 6;

  return Math.max(1, Math.min(maximumCount, calculatedCount));
}

export const DayCell = forwardRef<HTMLButtonElement, DayCellProps>(function DayCell({
  day,
  isExpanded = false,
  isSelected = false,
  onSelect,
  progressDisplay = 'linear',
  progressThresholds = defaultCalendarProgressThresholds,
}, ref) {
  const { language } = useLanguage();
  const [cellHeight, setCellHeight] = useState(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const setButtonRef = useCallback((node: HTMLButtonElement | null) => {
    buttonRef.current = node;

    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  }, [ref]);
  useEffect(() => {
    const button = buttonRef.current;

    if (!button) {
      return undefined;
    }

    const updateHeight = () => {
      setCellHeight(button.getBoundingClientRect().height);
    };

    updateHeight();

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(updateHeight);
    observer.observe(button);

    return () => observer.disconnect();
  }, []);
  const dateIso = day.dateIso ?? getDateIsoFromDayId(day.id);
  const holiday = dateIso ? getHolidayForDate(language, dateIso) : undefined;
  const isToday = day.isToday || dateIso === getTodayIsoDate();
  const isRedDate = !day.outsideMonth && Boolean(holiday || day.isSunday || (dateIso && isSundayIsoDate(dateIso)));
  const todayLabel = language === 'ko' ? '오늘' : 'Today';
  const workloadLabel = language === 'ko' ? '업무량' : 'Workload';
  const mobileEvents = day.events.slice(0, 4);
  const hiddenMobileEventCount = Math.max(day.events.length - mobileEvents.length, 0);
  const desktopVisibleEventCount = getDesktopVisibleEventCount(cellHeight, isExpanded, Boolean(day.timelineBar));
  const desktopEvents = day.events.slice(0, desktopVisibleEventCount);
  const hiddenDesktopEventCount = Math.max(day.events.length - desktopEvents.length, 0);
  const mobileClusterPositions = [
    'left-0 top-0',
    'right-0 top-0',
    'left-0 bottom-0',
    'right-0 bottom-0',
  ];

  return (
    <button
      ref={setButtonRef}
      className={cn(
        'relative h-full min-h-0 w-full min-w-0 overflow-hidden rounded-none border-0 border-r border-b bg-card p-0 text-left text-foreground shadow-none transition hover:z-10 hover:bg-muted',
        'block whitespace-normal align-top outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        'month-calendar-day',
        day.outsideMonth && 'bg-muted/35 text-muted-foreground',
        isToday && 'z-10 bg-primary/5 ring-2 ring-inset ring-primary/45 hover:bg-primary/10',
        isSelected && 'z-20 bg-primary/10 ring-2 ring-inset ring-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)] hover:bg-primary/15',
        'max-[520px]:bg-transparent max-[520px]:hover:bg-transparent',
        day.outsideMonth && 'max-[520px]:opacity-30',
        isToday && 'max-[520px]:bg-transparent max-[520px]:ring-0 max-[520px]:hover:bg-transparent',
        isSelected && 'max-[520px]:bg-transparent max-[520px]:ring-0 max-[520px]:shadow-none max-[520px]:hover:bg-transparent',
      )}
      aria-pressed={isSelected}
      onClick={onSelect}
      type="button"
    >
      <div className="hidden h-full min-h-0 flex-col items-center justify-start px-0.5 py-0.5 max-[520px]:flex">
        <div className="mb-0.5 flex h-5 min-w-0 items-center justify-center">
          {mobileEvents.length > 0 ? (
            <span className="relative block size-6" title={mobileEvents.map((event) => event.title).join(', ')}>
              {mobileEvents.map((event, index) => (
                <span
                  aria-label={event.title}
                  className={cn(
                    'absolute size-[15px] rounded-[6px] shadow-sm',
                    mobileClusterPositions[index],
                    dotColorClasses[event.color],
                    mobileEvents.length === 1 && 'left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-[7px]',
                  )}
                  key={event.id}
                  title={event.title}
                />
              ))}
              {day.progress >= 100 ? (
                <span className="absolute inset-0 grid place-items-center text-[10px] font-black leading-none text-white drop-shadow-sm">
                  ✓
                </span>
              ) : null}
              {hiddenMobileEventCount > 0 ? (
                <span className="absolute -bottom-1 -right-1 grid size-[16px] place-items-center rounded-full bg-muted text-[8px] font-black text-foreground shadow-sm">
                  {hiddenMobileEventCount}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="size-5 rounded-[7px] bg-muted-foreground/20" aria-hidden="true" />
          )}
        </div>
        <span
          className={cn(
            'grid size-[18px] place-items-center rounded-full text-xs font-black leading-none',
            isRedDate && 'text-red-500',
            !isRedDate && !day.outsideMonth && 'text-foreground',
            day.outsideMonth && 'text-muted-foreground',
            isToday && 'bg-primary text-primary-foreground shadow-sm max-[520px]:bg-foreground max-[520px]:text-background',
            isSelected && !isToday && 'bg-muted text-foreground max-[520px]:bg-primary max-[520px]:text-primary-foreground max-[520px]:shadow-sm',
            isSelected && isToday && 'max-[520px]:ring-2 max-[520px]:ring-primary/70 max-[520px]:ring-offset-1 max-[520px]:ring-offset-background',
          )}
          title={holiday ? `${todayLabel} · ${holiday.label}` : isToday ? todayLabel : undefined}
        >
          {day.dateNumber}
        </span>
      </div>

      <div className="absolute inset-x-1 top-1 bottom-1 flex min-h-0 flex-col max-[520px]:hidden">
        <div className="mb-0.5 flex min-w-0 shrink-0 items-center gap-1">
          <span
            className={cn(
              'inline-flex h-5 min-w-5 items-center justify-center justify-self-start rounded-full px-1 text-[11px] font-black',
              isRedDate && 'text-red-500',
              isToday && 'bg-primary text-primary-foreground shadow-sm',
            )}
            title={holiday ? `${todayLabel} · ${holiday.label}` : isToday ? todayLabel : undefined}
          >
            {day.dateNumber}
          </span>
          {isToday ? (
            <span className="truncate rounded-md bg-primary/10 px-1 py-0.5 text-[9px] font-black uppercase text-primary">
              {todayLabel}
            </span>
          ) : null}
          <span className="min-w-0 flex-1" />
          <CalendarProgressIndicator
            className={progressDisplay === 'linear' ? 'max-w-[112px] flex-1' : undefined}
            display={progressDisplay}
            label={workloadLabel}
            size="compact"
            thresholds={progressThresholds}
            value={day.progress}
            valueLabel={day.progressLabel}
          />
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden pr-0.5">
          {desktopEvents.map((event) => {
            const isStudyEvent = event.type.toLowerCase() === 'study';

            return isStudyEvent ? (
              <span
                className="flex min-h-[18px] min-w-0 items-center gap-1.5 px-0.5 py-0.5 text-[10px] font-extrabold leading-none text-foreground"
                key={event.id}
              >
                <span
                  aria-hidden="true"
                  className={cn('size-2 shrink-0 rounded-full', dotColorClasses[event.color])}
                />
                <span className="truncate">{event.title}</span>
              </span>
            ) : (
              <span
                className={cn(
                  'flex min-h-[18px] min-w-0 items-center gap-1 rounded-md border px-1 py-0.5 text-[10px] font-extrabold leading-none',
                  badgeColorClasses[event.color],
                )}
                key={event.id}
              >
                {event.courseLabel ? (
                  <span className="max-w-[58px] shrink-0 truncate rounded bg-background/40 px-1 text-[9px] font-black">
                    {event.courseLabel}
                  </span>
                ) : null}
                <span className="truncate">{event.title}</span>
              </span>
            );
          })}
        </div>
        {hiddenDesktopEventCount > 0 ? (
          <span className="absolute bottom-0.5 right-0.5 rounded-md border bg-card/95 px-1.5 py-0.5 text-[9px] font-black text-muted-foreground shadow-sm">
            +{hiddenDesktopEventCount} ...
          </span>
        ) : null}
        {day.timelineBar ? (
          <div className={cn('relative -mx-1 mt-0.5 flex h-4 shrink-0 items-center', timelineTextClasses[day.timelineBar.color])}>
            <span className="absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-current opacity-25" />
            <span className="relative ml-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-md border border-current bg-card px-1 py-0.5 text-[9px] font-black">
              {day.timelineBar.label}
            </span>
          </div>
        ) : null}
      </div>
    </button>
  );
});
