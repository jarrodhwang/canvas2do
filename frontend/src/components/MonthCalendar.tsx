import type { CalendarDay } from '../data/mockWorkspaceData';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { getWeekdayLabels } from '../i18n';
import { cn } from '../lib/utils';
import type { CalendarProgressDisplay, CalendarProgressThresholds } from './CalendarProgressIndicator';
import { DayCell } from './DayCell';
import { Card } from './ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from './ui/context-menu';

interface MonthCalendarProps {
  days: CalendarDay[];
  isExpanded?: boolean;
  onAddCourseworkForDay?: (day: CalendarDay) => void;
  onSelectItem: (day: CalendarDay) => void;
  progressDisplay: CalendarProgressDisplay;
  progressThresholds: CalendarProgressThresholds;
}

export function MonthCalendar({
  days,
  isExpanded = false,
  onAddCourseworkForDay,
  onSelectItem,
  progressDisplay,
  progressThresholds,
}: MonthCalendarProps) {
  const { dictionary, language } = useLanguage();
  const weekdays = getWeekdayLabels(language);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const renderDayCell = (day: CalendarDay) => (
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
  );

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
          onAddCourseworkForDay ? (
            <ContextMenu key={day.id}>
              <ContextMenuTrigger asChild>
                <div className="h-full min-h-0">{renderDayCell(day)}</div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-56">
                <ContextMenuLabel>{day.dateNumber}</ContextMenuLabel>
                <ContextMenuItem
                  onSelect={() => {
                    setSelectedDayId(day.id);
                    onSelectItem(day);
                    onAddCourseworkForDay(day);
                  }}
                >
                  <Plus className="size-4" />
                  <span>{dictionary.courseworkAdd}</span>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ) : renderDayCell(day)
        ))}
      </div>
    </Card>
  );
}
