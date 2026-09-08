import type { CalendarDay } from '../data/mockWorkspaceData';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { getWeekdayLabels, type AcademyNation } from '../i18n';
import { cn } from '../lib/utils';
import type { CalendarProgressDisplay, CalendarProgressThresholds } from './calendarProgress';
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
  holidayNation?: AcademyNation;
  holidayNations?: AcademyNation[];
  isCompact?: boolean;
  isExpanded?: boolean;
  mobileScope?: 'month' | 'week';
  onAddCourseworkForDay?: (day: CalendarDay) => void;
  onSelectItem: (day: CalendarDay) => void;
  progressDisplay: CalendarProgressDisplay;
  progressThresholds: CalendarProgressThresholds;
  todayIso?: string;
}

export function MonthCalendar({
  days,
  holidayNation,
  holidayNations,
  isCompact = false,
  isExpanded = false,
  mobileScope = 'month',
  onAddCourseworkForDay,
  onSelectItem,
  progressDisplay,
  progressThresholds,
  todayIso,
}: MonthCalendarProps) {
  const { dictionary, language } = useLanguage();
  const weekdays = getWeekdayLabels(language);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const selectedDayIndex = Math.max(
    days.findIndex((day) => day.id === selectedDayId),
    days.findIndex((day) => day.isToday),
    days.findIndex((day) => !day.outsideMonth),
    0,
  );
  const selectedWeekStartIndex = Math.floor(selectedDayIndex / 7) * 7;
  const visibleDays = mobileScope === 'week'
    ? days.slice(selectedWeekStartIndex, selectedWeekStartIndex + 7)
    : days;
  const renderDayCell = (day: CalendarDay) => (
    <DayCell
      day={day}
      holidayNation={holidayNation}
      holidayNations={holidayNations}
      isCompact={isCompact}
      isExpanded={isExpanded}
      isSelected={day.id === selectedDayId}
      key={day.id}
      onSelect={() => {
        setSelectedDayId(day.id);
        onSelectItem(day);
      }}
      progressDisplay={progressDisplay}
      progressThresholds={progressThresholds}
      todayIso={todayIso}
    />
  );

  return (
    <Card
      className={cn(
        'h-full gap-0 overflow-visible rounded-xl bg-card p-0 shadow-none max-[520px]:h-auto max-[520px]:rounded-none max-[520px]:border-0 max-[520px]:bg-transparent',
        mobileScope === 'week' && 'month-calendar-card-week',
      )}
    >
      <div className="sticky top-0 z-30 grid min-w-[660px] grid-cols-7 overflow-hidden rounded-t-xl border-b bg-muted/95 backdrop-blur max-[520px]:min-w-0 max-[520px]:rounded-none max-[520px]:border-b-0 max-[520px]:bg-transparent">
        {weekdays.map((weekday, index) => (
          <div
            className={`border-r px-2 py-2 text-xs font-black uppercase last:border-r-0 max-[520px]:border-r-0 max-[520px]:px-0 max-[520px]:py-0.5 max-[520px]:text-center max-[520px]:text-[10px] ${
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
          'month-calendar-grid grid min-w-[660px] flex-1 grid-cols-7 transition-[grid-template-rows] duration-300 ease-out max-[520px]:min-w-0 max-[520px]:flex-none max-[520px]:gap-y-1',
          isCompact && 'month-calendar-grid-compact',
          mobileScope === 'week' && 'month-calendar-grid-week',
          isExpanded
            ? 'month-calendar-grid-expanded'
            : 'month-calendar-grid-fill',
        )}
      >
        {visibleDays.map((day) => (
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
