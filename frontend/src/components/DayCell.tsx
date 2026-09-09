import type { CalendarDay } from '../data/mockWorkspaceData';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { getHolidayForDateByNation, type AcademyNation } from '../i18n';
import { badgeColorClasses, dotColorClasses } from '@/lib/colorStyles';
import { cn } from '@/lib/utils';
import { CalendarProgressIndicator } from './CalendarProgressIndicator';
import {
  defaultCalendarProgressThresholds,
  type CalendarProgressDisplay,
  type CalendarProgressThresholds,
} from './calendarProgress';

interface DayCellProps {
  day: CalendarDay;
  holidayNation?: AcademyNation;
  holidayNations?: AcademyNation[];
  isCompact?: boolean;
  isExpanded?: boolean;
  isSelected?: boolean;
  onSelect: () => void;
  progressDisplay?: CalendarProgressDisplay;
  progressThresholds?: CalendarProgressThresholds;
  todayIso?: string;
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

function getDesktopVisibleEventCount(height: number, isExpanded: boolean) {
  if (height <= 0) {
    return isExpanded ? 5 : 4;
  }

  const availableHeight = height - 36;
  const calculatedCount = Math.floor(availableHeight / 20);
  const maximumCount = isExpanded ? 8 : 6;

  return Math.max(1, Math.min(maximumCount, calculatedCount));
}

export const DayCell = forwardRef<HTMLButtonElement, DayCellProps>(function DayCell({
  day,
  holidayNation,
  holidayNations,
  isCompact = false,
  isExpanded = false,
  isSelected = false,
  onSelect,
  progressDisplay = 'linear',
  progressThresholds = defaultCalendarProgressThresholds,
  todayIso,
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
  const effectiveHolidayNations = holidayNations && holidayNations.length > 0
    ? holidayNations
    : [holidayNation ?? (language === 'ko' ? 'kr' : 'ca')];
  const holidays = dateIso
    ? effectiveHolidayNations
        .map((nation) => getHolidayForDateByNation(nation, dateIso))
        .filter((holiday): holiday is NonNullable<typeof holiday> => Boolean(holiday))
    : [];
  const holiday = holidays[0];
  const holidayTitle = holidays.map((currentHoliday) => currentHoliday.label).join(' / ');
  const isToday = day.isToday || (todayIso ? dateIso === todayIso : dateIso === getTodayIsoDate());
  const isRedDate = Boolean(holiday || day.isSunday || (dateIso && isSundayIsoDate(dateIso)));
  const todayLabel = language === 'ko' ? '오늘' : 'Today';
  const workloadLabel = language === 'ko' ? '업무량' : 'Workload';
  const mobileEvents = day.events.slice(0, 4);
  const hiddenMobileEventCount = Math.max(day.events.length - mobileEvents.length, 0);
  const desktopVisibleEventCount = isCompact
    ? Math.max(1, Math.min(4, Math.floor((cellHeight - 24) / 16)))
    : getDesktopVisibleEventCount(cellHeight, isExpanded);
  const desktopEvents = day.events.slice(0, desktopVisibleEventCount);
  const hiddenDesktopEventCount = Math.max(day.events.length - desktopEvents.length, 0);

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
      <div className="hidden h-full min-h-0 flex-col items-center justify-center gap-1 px-0.5 max-[520px]:flex">
        <span
          className={cn(
            'grid size-8 place-items-center rounded-full text-xs font-bold leading-none',
            isRedDate && 'text-red-500',
            day.outsideMonth && 'text-muted-foreground',
            isToday && 'ring-1 ring-inset ring-primary',
            isSelected && 'bg-primary text-primary-foreground',
          )}
          title={holiday ? `${isToday ? `${todayLabel} · ` : ''}${holidayTitle}` : isToday ? todayLabel : undefined}
        >
          {day.dateNumber}
        </span>
        <span className="flex h-2 items-center justify-center gap-0.5">
          {mobileEvents.map((event) => (
            <span
              aria-label={event.title}
              className={cn('size-1 rounded-full', event.isCanceledForHoliday ? 'bg-red-500' : dotColorClasses[event.color])}
              key={event.id}
              title={event.title}
            />
          ))}
          {hiddenMobileEventCount > 0 ? <span className="text-[8px] font-bold leading-none">+{hiddenMobileEventCount}</span> : null}
          {mobileEvents.length > 0 && day.progress >= 100 ? <span className="text-[9px] leading-none text-muted-foreground">✓</span> : null}
        </span>
      </div>

      <div className="absolute inset-x-1 top-1 bottom-1 flex min-h-0 flex-col max-[520px]:hidden">
        <div className={cn('mb-0.5 flex min-w-0 shrink-0 items-center gap-1', isCompact && 'mb-0')}>
          <span
            className={cn(
              'inline-flex h-5 min-w-5 items-center justify-center justify-self-start rounded-full px-1 text-[11px] font-black',
              isRedDate && 'text-red-500',
              isToday && 'bg-primary text-primary-foreground shadow-sm',
            )}
            title={holiday ? `${isToday ? `${todayLabel} · ` : ''}${holidayTitle}` : isToday ? todayLabel : undefined}
          >
            {day.dateNumber}
          </span>
            {isToday ? (
              <span className="truncate rounded-md bg-primary/10 px-1 py-0.5 text-[9px] font-black uppercase text-primary">
                {todayLabel}
              </span>
            ) : null}
            {isCompact ? null : (
              <CalendarProgressIndicator
                className={progressDisplay === 'linear' ? 'min-w-0 flex-1' : 'ml-auto'}
                display={progressDisplay}
                label={workloadLabel}
                showValueLabel={false}
                size="compact"
                thresholds={progressThresholds}
                value={day.progress}
                valueLabel={day.progressLabel}
              />
            )}
        </div>
        <div className={cn('min-h-0 flex-1 space-y-0.5 overflow-hidden pr-0.5', isCompact && 'space-y-px pr-0')}>
          {desktopEvents.map((event) => {
            const isStudyEvent = event.type.toLowerCase() === 'study';
            const isDotEvent = event.displayStyle === 'dot' || isStudyEvent;
            const holidayBadgeLabel = language === 'ko' ? '공휴일' : 'Holiday';

            return isDotEvent ? (
              <span
                className={cn(
                  'relative flex min-h-[18px] min-w-0 items-center gap-1.5 px-0.5 py-0.5 text-[10px] font-extrabold leading-none text-foreground',
                  isCompact && 'min-h-[15px] gap-1 py-0 text-[9px]',
                  event.isCanceledForHoliday && 'text-red-600 line-through decoration-2 decoration-red-500',
                )}
                key={event.id}
                title={event.isCanceledForHoliday && event.holidayName ? `${event.title} · ${event.holidayName}` : event.title}
              >
                <span
                  aria-hidden="true"
                  className={cn('size-2 shrink-0 rounded-full', event.isCanceledForHoliday ? 'bg-red-500' : dotColorClasses[event.color])}
                />
                <span className="truncate">{event.title}</span>
                {event.isCanceledForHoliday ? (
                  <span className="absolute -right-1 -top-1 z-10 rounded-full border border-red-500/35 bg-card px-1 py-0 text-[7px] font-black uppercase leading-none text-red-600 shadow-sm">
                    {holidayBadgeLabel}
                  </span>
                ) : null}
              </span>
            ) : (
              <span
                className={cn(
                  'relative flex min-h-[18px] min-w-0 items-center gap-1 rounded-md border px-1 py-0.5 text-[10px] font-extrabold leading-none',
                  isCompact && 'min-h-[15px] rounded px-1 py-0 text-[9px]',
                  event.isCanceledForHoliday
                    ? 'border-red-500/35 bg-red-500/5 text-red-600 line-through decoration-2 decoration-red-500'
                    : badgeColorClasses[event.color],
                )}
                key={event.id}
                title={event.isCanceledForHoliday && event.holidayName ? `${event.title} · ${event.holidayName}` : event.title}
              >
                {event.courseLabel && !isCompact ? (
                  <span className="max-w-[58px] shrink-0 truncate rounded bg-background/40 px-1 text-[9px] font-black">
                    {event.courseLabel}
                  </span>
                ) : null}
                <span className="truncate">{event.title}</span>
                {event.isCanceledForHoliday ? (
                  <span className="absolute -right-1 -top-1 z-10 rounded-full border border-red-500/35 bg-card px-1 py-0 text-[7px] font-black uppercase leading-none text-red-600 shadow-sm">
                    {holidayBadgeLabel}
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
        {hiddenDesktopEventCount > 0 ? (
          <span className="absolute bottom-0.5 right-0.5 rounded-md border bg-card/95 px-1.5 py-0.5 text-[9px] font-black text-muted-foreground shadow-sm">
            +{hiddenDesktopEventCount} ...
          </span>
        ) : null}
      </div>
    </button>
  );
});
