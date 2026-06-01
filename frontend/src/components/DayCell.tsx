import type { CalendarDay } from '../data/mockWorkspaceData';
import { useLanguage } from '../context/LanguageContext';
import { getHolidayForDate } from '../i18n';
import { badgeColorClasses, timelineTextClasses } from '@/lib/colorStyles';
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

export function DayCell({
  day,
  isExpanded = false,
  isSelected = false,
  onSelect,
  progressDisplay = 'linear',
  progressThresholds = defaultCalendarProgressThresholds,
}: DayCellProps) {
  const { language } = useLanguage();
  const dateIso = day.dateIso ?? getDateIsoFromDayId(day.id);
  const holiday = dateIso ? getHolidayForDate(language, dateIso) : undefined;
  const isToday = day.isToday || dateIso === getTodayIsoDate();
  const isRedDate = !day.outsideMonth && Boolean(holiday || day.isSunday || (dateIso && isSundayIsoDate(dateIso)));
  const todayLabel = language === 'ko' ? '오늘' : 'Today';
  const workloadLabel = language === 'ko' ? '업무량' : 'Workload';

  return (
    <button
      className={cn(
        'relative h-full min-h-0 w-full min-w-0 overflow-hidden rounded-none border-0 border-r border-b bg-card p-0 text-left text-foreground shadow-none transition hover:z-10 hover:bg-muted',
        'block whitespace-normal align-top outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        'month-calendar-day',
        day.outsideMonth && 'bg-muted/35 text-muted-foreground',
        isToday && 'z-10 bg-primary/5 ring-2 ring-inset ring-primary/45 hover:bg-primary/10',
        isSelected && 'z-20 bg-primary/10 ring-2 ring-inset ring-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)] hover:bg-primary/15',
      )}
      aria-pressed={isSelected}
      onClick={onSelect}
      type="button"
    >
      <div className="absolute inset-x-1.5 top-1.5">
        <div className="mb-1 flex min-w-0 items-center gap-1.5">
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
        <div className="space-y-0.5">
          {day.events.slice(0, isExpanded ? 5 : 3).map((event) => (
            <span
              className={cn(
                'flex min-h-[18px] min-w-0 items-center gap-1 rounded-md border px-1 py-0.5 text-[10px] font-extrabold',
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
          ))}
        </div>
        {day.timelineBar ? (
          <div className={cn('relative -mx-1.5 mt-0.5 flex h-4 items-center', timelineTextClasses[day.timelineBar.color])}>
            <span className="absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-current opacity-25" />
            <span className="relative ml-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-md border border-current bg-card px-1 py-0.5 text-[9px] font-black">
              {day.timelineBar.label}
            </span>
          </div>
        ) : null}
      </div>
    </button>
  );
}
