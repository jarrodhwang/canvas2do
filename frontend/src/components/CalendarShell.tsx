import type { WorkspaceModeMockData } from '../data/mockWorkspaceData';
import { ChevronLeft, ChevronRight, LoaderCircle, Maximize2, Minimize2 } from 'lucide-react';
import { useRef, useState, type WheelEvent } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { formatMonthHeading, getViewLabel } from '../i18n';
import { cn } from '../lib/utils';
import type { WorkspaceModeConfig, WorkspaceView } from '../modes/types';
import { AgendaView } from './AgendaView';
import { BoardView } from './BoardView';
import type { CalendarProgressDisplay, CalendarProgressThresholds } from './CalendarProgressIndicator';
import { FilterPanel } from './FilterPanel';
import { MonthCalendar } from './MonthCalendar';
import { TimelineView } from './TimelineView';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { WorkspaceIcon } from './WorkspaceIcon';

type CalendarActionItem = { id: string };

interface CourseFilterOption {
  checked: boolean;
  color: WorkspaceModeConfig['filters'][number]['options'][number]['color'];
  id: string;
  label: string;
}

const viewLabels: Record<WorkspaceView, { label: string; icon: string }> = {
  month: { label: 'Month', icon: 'calendar-days' },
  agenda: { label: 'Agenda', icon: 'list-checks' },
  board: { label: 'Board', icon: 'columns-3' },
  timeline: { label: 'Timeline', icon: 'gantt-chart' },
};

interface CalendarShellProps {
  mode: WorkspaceModeConfig;
  data: WorkspaceModeMockData;
  agendaDateLabel?: string;
  boardColumns?: WorkspaceModeConfig['board']['columns'];
  courseFilterOptions?: CourseFilterOption[];
  emptyMessage?: string;
  focusedBoardItemId?: string | null;
  isExpanded?: boolean;
  isSelectedDateToday?: boolean;
  isLoading?: boolean;
  view: WorkspaceView;
  onNextMonth?: () => void;
  onFinishTodoTitleEdit?: () => void;
  onOpenAddItem?: (column: WorkspaceModeConfig['board']['columns'][number]) => void;
  onOpenTodoDetails?: (item: CalendarActionItem) => void;
  onNextAgendaDay?: () => void;
  onPreviousAgendaDay?: () => void;
  onPreviousMonth?: () => void;
  onRemoveTodo?: (item: CalendarActionItem) => void;
  onToday?: () => void;
  onToggleCourseFilter?: (courseId: string) => void;
  onToggleExpanded?: () => void;
  onToggleTodoStar?: (item: CalendarActionItem) => void;
  onToggleTodoDone?: (item: CalendarActionItem) => void;
  onUpdateTodoTitle?: (item: WorkspaceModeMockData['boardItems'][number], title: string) => void;
  onViewChange: (view: WorkspaceView) => void;
  onSelectItem: (day?: WorkspaceModeMockData['days'][number]) => void;
  progressDisplay: CalendarProgressDisplay;
  progressThresholds: CalendarProgressThresholds;
  showCurrentTime?: boolean;
}

export function CalendarShell({
  mode,
  data,
  agendaDateLabel,
  boardColumns,
  courseFilterOptions,
  emptyMessage,
  focusedBoardItemId,
  isExpanded = false,
  isSelectedDateToday = false,
  isLoading = false,
  view,
  onNextMonth,
  onFinishTodoTitleEdit,
  onOpenAddItem,
  onOpenTodoDetails,
  onNextAgendaDay,
  onPreviousAgendaDay,
  onPreviousMonth,
  onRemoveTodo,
  onToday,
  onToggleCourseFilter,
  onToggleExpanded,
  onToggleTodoStar,
  onToggleTodoDone,
  onUpdateTodoTitle,
  onViewChange,
  onSelectItem,
  progressDisplay,
  progressThresholds,
  showCurrentTime = false,
}: CalendarShellProps) {
  const { dictionary, language } = useLanguage();
  const monthWheelLockRef = useRef(0);
  const [monthTransitionDirection, setMonthTransitionDirection] = useState<'next' | 'previous'>('next');
  const monthHeading = formatMonthHeading(language, data.monthLabel);
  const hasFilters = mode.id === 'academy'
    ? Boolean(courseFilterOptions?.length)
    : mode.filters.length > 0;
  const hasMonthControls = Boolean(onPreviousMonth && onNextMonth);
  const hasMonthControlsForView = view === 'month' && hasMonthControls;
  const hasDayControls = (view === 'agenda' || view === 'board') && Boolean(onPreviousAgendaDay && onNextAgendaDay);
  const showCalendarLoading = isLoading && (view === 'month' || view === 'agenda' || view === 'board' || view === 'timeline');
  const previousMonthLabel = language === 'ko' ? '이전 달' : 'Previous month';
  const nextMonthLabel = language === 'ko' ? '다음 달' : 'Next month';
  const previousDayLabel = language === 'ko' ? '이전 날짜' : 'Previous day';
  const nextDayLabel = language === 'ko' ? '다음 날짜' : 'Next day';
  const todayLabel = language === 'ko' ? '오늘' : 'Today';
  const headingLabel = hasDayControls && agendaDateLabel
    ? { primary: agendaDateLabel, secondary: '' }
    : monthHeading;
  const previousLabel = hasDayControls ? previousDayLabel : previousMonthLabel;
  const nextLabel = hasDayControls ? nextDayLabel : nextMonthLabel;
  const showDateControls = hasMonthControlsForView || hasDayControls;
  const handlePreviousPeriod = () => {
    if (hasDayControls) {
      onPreviousAgendaDay?.();
      return;
    }

    handlePreviousMonth();
  };
  const handleNextPeriod = () => {
    if (hasDayControls) {
      onNextAgendaDay?.();
      return;
    }

    handleNextMonth();
  };
  const handlePreviousMonth = () => {
    setMonthTransitionDirection('previous');
    onPreviousMonth?.();
  };
  const handleNextMonth = () => {
    setMonthTransitionDirection('next');
    onNextMonth?.();
  };
  const handleMonthWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (view !== 'month' || !onNextMonth || !onPreviousMonth || showCalendarLoading) {
      return;
    }

    if (Math.abs(event.deltaY) < 60 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      return;
    }

    const target = event.currentTarget;
    const canScrollDown = target.scrollTop + target.clientHeight < target.scrollHeight - 2;
    const canScrollUp = target.scrollTop > 2;

    if ((event.deltaY > 0 && canScrollDown) || (event.deltaY < 0 && canScrollUp)) {
      return;
    }

    event.preventDefault();

    const now = window.Date.now();

    if (now - monthWheelLockRef.current < 700) {
      return;
    }

    monthWheelLockRef.current = now;

    if (event.deltaY > 0) {
      handleNextMonth();
      return;
    }

    handlePreviousMonth();
  };

  return (
    <div className="group/calendar relative transition-all duration-300 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
    <Card className="gap-0 rounded-xl bg-card py-2 shadow-none transition-all duration-300 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
      {onToggleExpanded ? (
        <button
          aria-label={isExpanded ? dictionary.calendarCollapse : dictionary.calendarExpand}
          className="group/calendar-handle mx-3 flex h-2 items-center justify-center rounded-md text-muted-foreground outline-none transition-all duration-200 hover:h-5 hover:bg-muted/70 hover:text-foreground focus-visible:h-5 focus-visible:bg-muted/70 focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={onToggleExpanded}
          title={isExpanded ? dictionary.calendarCollapse : dictionary.calendarExpand}
          type="button"
        >
          <span className="flex w-full items-center justify-center gap-2">
            <span className="h-1 w-24 rounded-full bg-border transition-colors group-hover/calendar-handle:bg-muted-foreground/60" />
            <span className="hidden items-center gap-1 text-[10px] font-black uppercase group-hover/calendar-handle:inline-flex group-focus-visible/calendar-handle:inline-flex">
              {isExpanded ? (
                <Minimize2 aria-hidden="true" className="size-3" strokeWidth={2.5} />
              ) : (
                <Maximize2 aria-hidden="true" className="size-3" strokeWidth={2.5} />
              )}
              {isExpanded ? dictionary.calendarCollapse : dictionary.calendarExpand}
            </span>
            <span className="h-1 w-24 rounded-full bg-border transition-colors group-hover/calendar-handle:bg-muted-foreground/60" />
          </span>
        </button>
      ) : null}
      <CardHeader className="flex flex-row items-start justify-between gap-3 px-3 pb-2 pt-1 max-md:flex-col">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {showDateControls ? (
              <Button
                aria-label={previousLabel}
                className="size-9 shrink-0 rounded-lg border bg-muted text-muted-foreground hover:text-foreground"
                onClick={handlePreviousPeriod}
                title={previousLabel}
                type="button"
                variant="outline"
              >
                <ChevronLeft aria-hidden="true" size={16} strokeWidth={2.4} />
              </Button>
            ) : null}
            <h2 className="flex min-w-0 items-end gap-2 text-3xl font-black leading-none">
              <span className="truncate">{headingLabel.primary}</span>
              {headingLabel.secondary ? (
                <span className="shrink-0 pb-0.5 text-base font-black text-muted-foreground">
                  {headingLabel.secondary}
                </span>
              ) : null}
            </h2>
            {showDateControls ? (
              <Button
                aria-label={nextLabel}
                className="size-9 shrink-0 rounded-lg border bg-muted text-muted-foreground hover:text-foreground"
                onClick={handleNextPeriod}
                title={nextLabel}
                type="button"
                variant="outline"
              >
                <ChevronRight aria-hidden="true" size={16} strokeWidth={2.4} />
              </Button>
            ) : null}
            {hasDayControls && onToday ? (
              <Button
                className={cn(
                  'h-8 shrink-0 rounded-md border px-2.5 text-xs font-black disabled:opacity-100',
                  isSelectedDateToday
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
                disabled={isSelectedDateToday}
                onClick={onToday}
                title={todayLabel}
                type="button"
                variant="outline"
              >
                {todayLabel}
              </Button>
            ) : null}
          </div>
          {mode.calendar.subtitle ? (
            <p className="mt-1 text-sm text-muted-foreground">{mode.calendar.subtitle}</p>
          ) : null}
        </div>
        <div className="flex max-w-full items-center gap-2">
          {(hasFilters || courseFilterOptions?.length) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={dictionary.boardCourseMenu}
                  className="h-10 shrink-0 gap-2 rounded-lg border bg-muted px-3 text-sm font-black text-muted-foreground hover:text-foreground"
                  title={dictionary.boardCourseMenu}
                  type="button"
                  variant="outline"
                >
                  <WorkspaceIcon name="book-open" size={17} />
                  <span>{dictionary.boardCourseMenu}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 p-2">
                <FilterPanel
                  courseOptions={courseFilterOptions}
                  onToggleCourseOption={onToggleCourseFilter}
                  variant="menu"
                />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Tabs className="max-w-full" onValueChange={(nextView) => onViewChange(nextView as WorkspaceView)} value={view}>
            <TabsList className="h-10 rounded-lg border bg-muted p-1">
            {mode.views.map((modeView) => (
              <TabsTrigger
                className="h-8 rounded-md px-3 text-xs font-black text-muted-foreground data-active:bg-primary data-active:text-primary-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                key={modeView}
                value={modeView}
              >
                <WorkspaceIcon name={viewLabels[modeView].icon} size={15} />
                <span>{getViewLabel(language, modeView)}</span>
              </TabsTrigger>
            ))}
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>

      <CardContent className="px-3 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
        <div className="relative min-w-0 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
          <div
            className={cn(
              'min-w-0 overscroll-contain',
              view === 'month'
                ? cn(
                    'overflow-auto rounded-xl transition-[max-height] duration-300 ease-out xl:min-h-0 xl:flex-1',
                    isExpanded
                      ? 'max-h-[calc(100dvh-146px)] xl:h-full xl:max-h-none'
                      : 'max-h-[clamp(320px,calc(100dvh-220px),780px)] xl:h-full xl:max-h-none max-md:max-h-[clamp(300px,calc(100dvh-190px),680px)]',
                  )
                : view === 'agenda'
                  ? 'max-h-[72vh] overflow-auto rounded-xl pr-1 lg:max-h-[calc(100vh-310px)]'
                : 'overflow-x-auto',
              showCalendarLoading && 'opacity-35 blur-[1px]',
            )}
            onWheel={handleMonthWheel}
          >
            {view === 'month' ? (
              <div
                className={cn(
                  'calendar-month-transition h-full',
                  monthTransitionDirection === 'next'
                    ? 'calendar-month-transition-next'
                    : 'calendar-month-transition-previous',
                )}
                key={data.monthLabel}
              >
                <MonthCalendar
                  days={data.days}
                  isExpanded={isExpanded}
                  onSelectItem={onSelectItem}
                  progressDisplay={progressDisplay}
                  progressThresholds={progressThresholds}
                />
              </div>
            ) : null}
            {view === 'agenda' ? (
              <AgendaView
                emptyLabel={dictionary.selectedDayTodoEmpty}
                items={data.agenda}
                onOpenItemDetails={onOpenTodoDetails}
                onRemoveItem={onRemoveTodo}
                onSelectItem={onSelectItem}
                onToggleItemDone={onToggleTodoDone}
                onToggleItemStar={onToggleTodoStar}
                showCurrentTime={showCurrentTime}
              />
            ) : null}
            {view === 'board' ? (
              <BoardView
                columns={boardColumns ?? mode.board.columns}
                focusedItemId={focusedBoardItemId}
                items={data.boardItems}
                onAddItem={onOpenAddItem}
                onFinishItemTitleEdit={onFinishTodoTitleEdit}
                onOpenItemDetails={onOpenTodoDetails}
                onRemoveItem={onRemoveTodo}
                onToggleItemDone={onToggleTodoDone}
                onToggleItemStar={onToggleTodoStar}
                onUpdateItemTitle={onUpdateTodoTitle}
                showCurrentTime={showCurrentTime}
              />
            ) : null}
            {view === 'timeline' ? (
              <TimelineView
                items={data.timeline}
                label={mode.timeline.label}
                monthLabel={data.monthLabel}
                onOpenItemDetails={onOpenTodoDetails}
                onRemoveItem={onRemoveTodo}
                onToggleItemDone={onToggleTodoDone}
                onToggleItemStar={onToggleTodoStar}
              />
            ) : null}
          </div>
          {showCalendarLoading ? (
            <div
              aria-live="polite"
              className="absolute inset-0 z-20 flex min-h-[440px] items-center justify-center rounded-xl bg-card/85 px-4 text-center backdrop-blur-sm"
              role="status"
            >
              <div className="flex min-w-0 flex-col items-center gap-3 rounded-xl border bg-card px-5 py-4 shadow-sm">
                <LoaderCircle aria-hidden="true" className="animate-spin text-primary" size={28} strokeWidth={2.5} />
                <div className="text-base font-black text-foreground">
                  {dictionary.canvasCalendarLoading}
                </div>
              </div>
            </div>
          ) : emptyMessage && (view === 'month' || view === 'agenda') ? (
            <div
              aria-live="polite"
              className="pointer-events-none absolute inset-0 z-10 flex min-h-[440px] items-center justify-center rounded-xl px-4 text-center"
              role="status"
            >
              <div className="max-w-sm rounded-xl border border-dashed bg-card/95 px-5 py-4 text-sm font-black text-muted-foreground shadow-sm">
                {emptyMessage}
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
