import type { CalendarDay } from '../data/mockWorkspaceData';
import { useLanguage } from '../context/LanguageContext';
import { getHolidayForDate } from '../i18n';
import { badgeColorClasses, timelineTextClasses } from '@/lib/colorStyles';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Progress } from './ui/progress';

interface DayCellProps {
  day: CalendarDay;
  onSelect: () => void;
}

const fallbackEventTimes: Record<string, string> = {
  assignment: '11:59',
  bug: '13:30',
  customer: '15:00',
  discussion: '14:30',
  exam: '10:00',
  feature: '10:00',
  lecture: '09:00',
  meeting: '15:00',
  milestone: '17:00',
  note: '16:00',
  quiz: '14:00',
  release: '17:00',
  routine: '07:30',
  study: '13:00',
  todo: '11:00',
};

function getDateIsoFromDayId(dayId: string) {
  const [, monthDay] = dayId.split('-');

  if (!monthDay || monthDay.length !== 4) {
    return undefined;
  }

  return `2026-${monthDay.slice(0, 2)}-${monthDay.slice(2)}`;
}

export function DayCell({ day, onSelect }: DayCellProps) {
  const { dictionary, language } = useLanguage();
  const dateIso = getDateIsoFromDayId(day.id);
  const holiday = dateIso ? getHolidayForDate(language, dateIso) : undefined;

  return (
    <Button
      className={cn(
        'relative block h-full min-h-[124px] min-w-0 overflow-hidden rounded-none border-0 border-r border-b bg-card p-2.5 text-left text-foreground shadow-none transition hover:z-10 hover:bg-muted',
        'month-calendar-day',
        day.outsideMonth && 'bg-muted/35 text-muted-foreground',
      )}
      onClick={onSelect}
      type="button"
      variant="ghost"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={cn('text-xs font-black', holiday && !day.outsideMonth && 'text-red-500')}
          title={holiday?.label}
        >
          {day.dateNumber}
        </span>
        <span className="truncate text-[11px] font-bold text-muted-foreground">{day.status}</span>
      </div>
      <Progress
        aria-label={`${day.progress}% routine progress`}
        className="mb-2 h-1.5"
        value={day.progress}
      />
      <div className="space-y-1">
        {day.events.slice(0, 3).map((event) => (
          <span
            className={cn(
              'grid min-h-5 grid-cols-[34px_minmax(0,1fr)] items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[11px] font-extrabold',
              badgeColorClasses[event.color],
            )}
            key={event.id}
          >
            <time className="text-[10px] opacity-75">{event.time ?? fallbackEventTimes[event.type] ?? dictionary.allDay}</time>
            <span className="truncate">{event.title}</span>
          </span>
        ))}
      </div>
      {day.timelineBar ? (
        <div className={cn('relative -mx-2.5 mt-1 flex h-5 items-center', timelineTextClasses[day.timelineBar.color])}>
          <span className="absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-current opacity-25" />
          <span className="relative ml-2 max-w-[calc(100%-1rem)] truncate rounded-md border border-current bg-card px-1.5 py-0.5 text-[10px] font-black">
            {day.timelineBar.label}
          </span>
        </div>
      ) : null}
    </Button>
  );
}
