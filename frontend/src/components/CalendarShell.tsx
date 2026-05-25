import type { WorkspaceModeMockData } from '../data/mockWorkspaceData';
import { useLanguage } from '../context/LanguageContext';
import { formatMonthHeading, getViewLabel } from '../i18n';
import type { WorkspaceModeConfig, WorkspaceView } from '../modes/types';
import { AgendaView } from './AgendaView';
import { BoardView } from './BoardView';
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

const viewLabels: Record<WorkspaceView, { label: string; icon: string }> = {
  month: { label: 'Month', icon: 'calendar-days' },
  agenda: { label: 'Agenda', icon: 'list-checks' },
  board: { label: 'Board', icon: 'columns-3' },
  timeline: { label: 'Timeline', icon: 'gantt-chart' },
};

interface CalendarShellProps {
  mode: WorkspaceModeConfig;
  data: WorkspaceModeMockData;
  view: WorkspaceView;
  onOpenAddItem?: () => void;
  onViewChange: (view: WorkspaceView) => void;
  onSelectItem: () => void;
}

export function CalendarShell({
  mode,
  data,
  view,
  onOpenAddItem,
  onViewChange,
  onSelectItem,
}: CalendarShellProps) {
  const { dictionary, language } = useLanguage();
  const monthHeading = formatMonthHeading(language, data.monthLabel);
  const hasFilters = mode.filters.length > 0;

  return (
    <Card className="rounded-xl bg-card shadow-none">
      <CardHeader className="flex flex-row items-start justify-between gap-4 max-md:flex-col">
        <div className="min-w-0">
          <h2 className="flex items-end gap-2 text-3xl font-black leading-none">
            <span>{monthHeading.primary}</span>
            {monthHeading.secondary ? (
              <span className="pb-0.5 text-base font-black text-muted-foreground">
                {monthHeading.secondary}
              </span>
            ) : null}
          </h2>
          {mode.calendar.subtitle ? (
            <p className="mt-1 text-sm text-muted-foreground">{mode.calendar.subtitle}</p>
          ) : null}
        </div>
        <div className="flex max-w-full items-center gap-2">
          {hasFilters ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={dictionary.boardCourseMenu}
                  className="size-10 shrink-0 rounded-lg border bg-muted text-muted-foreground hover:text-foreground"
                  title={dictionary.boardCourseMenu}
                  type="button"
                  variant="outline"
                >
                  <WorkspaceIcon name="book-open" size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 p-2">
                <FilterPanel variant="menu" />
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

      <CardContent>
        <div className="min-w-0 overflow-x-auto">
          {view === 'month' ? <MonthCalendar days={data.days} onSelectItem={onSelectItem} /> : null}
          {view === 'agenda' ? <AgendaView items={data.agenda} onSelectItem={onSelectItem} /> : null}
          {view === 'board' ? (
            <BoardView
              columns={mode.board.columns}
              items={data.boardItems}
              onAddItem={onOpenAddItem}
              onSelectItem={onSelectItem}
            />
          ) : null}
          {view === 'timeline' ? (
            <TimelineView items={data.timeline} label={mode.timeline.label} />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
