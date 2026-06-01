import type { CalendarDay } from '../data/mockWorkspaceData';
import { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { getWeekdayLabels } from '../i18n';
import { cn } from '../lib/utils';
import type { CalendarProgressDisplay, CalendarProgressThresholds } from './CalendarProgressIndicator';
import { DayCell } from './DayCell';
import { Card } from './ui/card';

interface MonthCalendarProps {
  days: CalendarDay[];
  isExpanded?: boolean;
  onSelectItem: (day: CalendarDay) => void;
  progressDisplay: CalendarProgressDisplay;
  progressThresholds: CalendarProgressThresholds;
}

export function MonthCalendar({
  days,
  isExpanded = false,
  onSelectItem,
  progressDisplay,
  progressThresholds,
}: MonthCalendarProps) {
  const { language } = useLanguage();
  const weekdays = getWeekdayLabels(language);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);

  return (
    <Card className="h-full gap-0 overflow-visible rounded-xl bg-card p-0 shadow-none">
      <div className="sticky top-0 z-30 grid min-w-[660px] grid-cols-7 overflow-hidden rounded-t-xl border-b bg-muted/95 backdrop-blur">
        {weekdays.map((weekday, index) => (
          <div
            className={`border-r px-2 py-2 text-xs font-black uppercase last:border-r-0 ${
              index === 6 ? 'text-red-500' : 'text-muted-foreground'
            }`}
            key={weekday}
          >
            {weekday}
          </div>
        ))}
      </div>
      <div
        className={cn(
          'month-calendar-grid grid min-w-[660px] flex-1 grid-cols-7 grid-rows-6 transition-[grid-template-rows] duration-300 ease-out',
          isExpanded
            ? 'month-calendar-grid-expanded'
            : 'month-calendar-grid-fill',
        )}
      >
        {days.map((day) => (
          <DayCell
            day={day}
            isExpanded={isExpanded}
            isSelected={day.id === selectedDayId}
            key={day.id}
            onSelect={() => {
              setSelectedDayId(day.id);
              onSelectItem(day);
            }}
            progressDisplay={progressDisplay}
            progressThresholds={progressThresholds}
          />
        ))}
      </div>
    </Card>
  );
}
