import type { CalendarDay } from '../data/mockWorkspaceData';
import { useLanguage } from '../context/LanguageContext';
import { getWeekdayLabels } from '../i18n';
import { DayCell } from './DayCell';
import { Card } from './ui/card';

interface MonthCalendarProps {
  days: CalendarDay[];
  onSelectItem: () => void;
}

export function MonthCalendar({ days, onSelectItem }: MonthCalendarProps) {
  const { language } = useLanguage();
  const weekdays = getWeekdayLabels(language);

  return (
    <Card className="overflow-hidden rounded-xl bg-card p-0 shadow-none">
      <div className="grid min-w-[660px] grid-cols-7 border-b bg-muted/60">
        {weekdays.map((weekday, index) => (
          <div
            className={`border-r px-2.5 py-3 text-sm font-black uppercase last:border-r-0 ${
              index === 6 ? 'text-red-500' : 'text-muted-foreground'
            }`}
            key={weekday}
          >
            {weekday}
          </div>
        ))}
      </div>
      <div className="month-calendar-grid grid min-w-[660px] grid-cols-7 auto-rows-[clamp(124px,12vh,172px)]">
        {days.map((day) => (
          <DayCell day={day} key={day.id} onSelect={onSelectItem} />
        ))}
      </div>
    </Card>
  );
}
