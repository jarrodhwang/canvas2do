import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FolderKanban,
  GanttChart,
  LayoutDashboard,
  ListTodo,
  Pencil,
  Plus,
  RefreshCw,
  Share2,
  Tags,
  Trash2,
  Users,
} from 'lucide-react';
import {
  workspaceManagementApi,
  type SaveWorkspaceCalendarEntryRequest,
  type SaveWorkspaceCustomerRequest,
  type SaveWorkspaceIssueRequest,
  type SaveWorkspaceProjectRequest,
  type WorkspaceCalendarEntry,
  type WorkspaceCalendarShare,
  type WorkspaceCustomer,
  type WorkspaceIssue,
  type WorkspaceManagementOverview,
  type WorkspaceProject,
} from '../api/workspaceManagementApi';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

type WorkspaceManagementSection =
  | 'dashboard'
  | 'project'
  | 'calendar'
  | 'board'
  | 'timeline'
  | 'issues'
  | 'bugs'
  | 'features'
  | 'customers'
  | 'categories';

type ModalState =
  | { kind: 'calendar'; item?: WorkspaceCalendarEntry; startLocal?: string }
  | { kind: 'customer'; item?: WorkspaceCustomer }
  | { kind: 'issue'; item?: WorkspaceIssue; projectId?: string }
  | { kind: 'project'; item?: WorkspaceProject }
  | null;

interface WorkspaceManagementViewProps {
  access: string[];
  canManageCalendar: boolean;
  onNavigate: (sidebarItemId: string) => void;
  section: string;
  timeZone: string;
}

const emptyOverview: WorkspaceManagementOverview = {
  calendarItems: [],
  categories: [
    { name: 'TopSolid', children: ['CAM', 'Mold'] },
    { name: 'Eureka', children: [] },
    { name: 'Boxcon', children: [] },
  ],
  customers: [],
  generatedAtUtc: '1970-01-01T00:00:00.000Z',
  groups: [],
  issues: [],
  projects: [],
  users: [],
};

const issueStatusLabels: Record<WorkspaceIssue['status'], string> = {
  doing: 'Doing',
  solved: 'Solved',
  todo: 'To do',
  waiting: 'Waiting',
};

const issueStatusStyles: Record<WorkspaceIssue['status'], string> = {
  doing: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-200',
  solved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
  todo: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200',
  waiting: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-200',
};

const priorityStyles: Record<WorkspaceIssue['priority'], string> = {
  high: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-200',
  low: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-200',
  normal: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-200',
  urgent: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200',
};

const calendarTypeStyles: Record<WorkspaceCalendarEntry['itemType'], string> = {
  deadline: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200',
  'follow-up': 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200',
  meeting: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-200',
  work: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-200',
};

function normalizeSection(section: string): WorkspaceManagementSection {
  const supported: WorkspaceManagementSection[] = [
    'dashboard',
    'project',
    'calendar',
    'board',
    'timeline',
    'issues',
    'bugs',
    'features',
    'customers',
    'categories',
  ];

  return supported.includes(section as WorkspaceManagementSection)
    ? section as WorkspaceManagementSection
    : 'dashboard';
}

function getDateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    month: value('month'),
    second: value('second'),
    year: value('year'),
  };
}

function zonedLocalToUtc(localValue: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue);

  if (!match) {
    return '';
  }

  const desired = {
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    month: Number(match[2]),
    second: 0,
    year: Number(match[1]),
  };
  const desiredEpoch = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );
  let candidateEpoch = desiredEpoch;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = getDateTimeParts(new Date(candidateEpoch), timeZone);
    const actualEpoch = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );

    candidateEpoch += desiredEpoch - actualEpoch;
  }

  return new Date(candidateEpoch).toISOString();
}

function toLocalDateTimeInput(isoValue: string | undefined, timeZone: string) {
  if (!isoValue) {
    return '';
  }

  const parts = getDateTimeParts(new Date(isoValue), timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function toLocalDateInput(isoValue: string | undefined, timeZone: string) {
  return toLocalDateTimeInput(isoValue, timeZone).slice(0, 10);
}

function localDateKey(isoValue: string, timeZone: string) {
  return toLocalDateInput(isoValue, timeZone);
}

function formatDateTime(isoValue: string | undefined, timeZone: string, includeTime = true) {
  if (!isoValue) {
    return 'No date';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    ...(includeTime ? { timeStyle: 'short' as const } : {}),
    timeZone,
  }).format(new Date(isoValue));
}

function getDefaultLocalStart(timeZone: string) {
  const now = new Date();
  now.setMinutes(now.getMinutes() < 30 ? 30 : 60, 0, 0);

  return toLocalDateTimeInput(now.toISOString(), timeZone);
}

function addLocalHours(localValue: string, hours: number, timeZone: string) {
  const utcValue = zonedLocalToUtc(localValue, timeZone);

  return utcValue
    ? toLocalDateTimeInput(new Date(new Date(utcValue).getTime() + (hours * 60 * 60 * 1000)).toISOString(), timeZone)
    : '';
}

function addMonths(value: Date, amount: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + amount, 1));
}

function buildMonthDays(value: Date) {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month, index - firstWeekday + 1));
    const dateKey = date.toISOString().slice(0, 10);

    return {
      date,
      dateKey,
      isCurrentMonth: date.getUTCMonth() === month,
    };
  });
}

function createGoogleCalendarUrl(item: WorkspaceCalendarEntry) {
  const googleDate = (value: string) => new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    dates: `${googleDate(item.startAtUtc)}/${googleDate(item.endAtUtc)}`,
    details: [item.description, item.projectName && `Project: ${item.projectName}`, 'Created in Incos Workspace']
      .filter(Boolean)
      .join('\n'),
    text: item.title,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function SectionHeader({
  actions,
  description,
  icon,
  title,
}: {
  actions?: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl border bg-card text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-black text-foreground">{title}</h2>
          <p className="mt-0.5 text-sm font-semibold text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

function EmptyState({ action, description, title }: { action?: React.ReactNode; description: string; title: string }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-xl border border-dashed bg-muted/15 p-6 text-center">
      <div>
        <div className="font-black text-foreground">{title}</div>
        <p className="mt-1 max-w-md text-sm font-semibold text-muted-foreground">{description}</p>
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}

function IssueRow({
  canManage,
  issue,
  onEdit,
  onStatusChange,
  timeZone,
  updating,
}: {
  canManage: boolean;
  issue: WorkspaceIssue;
  onEdit: () => void;
  onStatusChange: (status: WorkspaceIssue['status']) => void;
  timeZone: string;
  updating: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-xl border bg-background p-3 lg:grid-cols-[minmax(0,1fr)_180px_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-black text-foreground">{issue.title}</span>
          <Badge className={priorityStyles[issue.priority]} variant="outline">{issue.priority}</Badge>
          <Badge variant="outline">{issue.issueType}</Badge>
          {!issue.projectId ? <Badge variant="secondary">Standalone</Badge> : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-muted-foreground">
          <span>{issue.customerCompany}</span>
          <span>{issue.projectName ?? 'No project'}</span>
          <span>{issue.dueAtUtc ? `Due ${formatDateTime(issue.dueAtUtc, timeZone)}` : 'No due date'}</span>
        </div>
      </div>
      <label className="grid gap-1 text-xs font-black uppercase text-muted-foreground">
        <span className="sr-only">Status for {issue.title}</span>
        <select
          className={cn('h-9 rounded-lg border px-2 text-sm font-black', issueStatusStyles[issue.status])}
          disabled={!canManage || updating}
          onChange={(event) => onStatusChange(event.target.value as WorkspaceIssue['status'])}
          value={issue.status}
        >
          {Object.entries(issueStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      {canManage ? (
        <Button aria-label={`Edit ${issue.title}`} onClick={onEdit} size="icon-sm" type="button" variant="outline">
          <Pencil className="size-4" />
        </Button>
      ) : <span />}
    </div>
  );
}

export function WorkspaceManagementView({ access, canManageCalendar, onNavigate, section, timeZone }: WorkspaceManagementViewProps) {
  const activeSection = normalizeSection(section);
  const [overview, setOverview] = useState<WorkspaceManagementOverview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [mutationError, setMutationError] = useState('');
  const [updatingIssueId, setUpdatingIssueId] = useState<string | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const localToday = toLocalDateInput(new Date().toISOString(), timeZone);
    const [year, month] = localToday.split('-').map(Number);

    return new Date(Date.UTC(year, month - 1, 1));
  });

  useEffect(() => {
    const controller = new AbortController();

    workspaceManagementApi.getOverview(controller.signal)
      .then((result) => {
        setOverview(result);
        setLoadError('');
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setLoadError(error instanceof Error ? error.message : 'Unable to load Workspace data.');
        }
      });

    return () => controller.abort();
  }, []);

  const data = overview ?? emptyOverview;
  const assignedAccess = useMemo(
    () => new Set(access.map((value) => value.toLowerCase())),
    [access],
  );
  const hasAccess = (...keys: string[]) => assignedAccess.has('workspace') || keys.some((key) => assignedAccess.has(key));
  const canManageCustomers = hasAccess('workspace-customers', 'workspace-project', 'workspace-issues');
  const canManageProjects = hasAccess('workspace-project');
  const canManageIssues = hasAccess('workspace-board', 'workspace-issues', 'workspace-bugs', 'workspace-features');
  const openIssues = useMemo(
    () => data.issues.filter((issue) => issue.status !== 'solved'),
    [data.issues],
  );
  const upcomingItems = useMemo(
    () => data.calendarItems
      .filter((item) => new Date(item.endAtUtc).getTime() >= new Date(data.generatedAtUtc).getTime())
      .slice(0, 8),
    [data.calendarItems, data.generatedAtUtc],
  );
  const monthDays = useMemo(() => buildMonthDays(visibleMonth), [visibleMonth]);
  const calendarByDate = useMemo(() => {
    const grouped = new Map<string, WorkspaceCalendarEntry[]>();

    data.calendarItems.forEach((item) => {
      const key = localDateKey(item.startAtUtc, timeZone);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });

    return grouped;
  }, [data.calendarItems, timeZone]);

  const refreshOverview = async (showSpinner = false) => {
    if (showSpinner) {
      setIsRefreshing(true);
    }

    try {
      const result = await workspaceManagementApi.getOverview();
      setOverview(result);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load Workspace data.');
    } finally {
      if (showSpinner) {
        setIsRefreshing(false);
      }
    }
  };

  const runMutation = async (task: () => Promise<unknown>) => {
    setMutationError('');

    try {
      await task();
      setModal(null);
      await refreshOverview();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save Workspace data.';
      setMutationError(message);
      throw error;
    }
  };

  const handleIssueStatusChange = async (issue: WorkspaceIssue, status: WorkspaceIssue['status']) => {
    if (status === issue.status) {
      return;
    }

    setUpdatingIssueId(issue.id);
    setMutationError('');

    try {
      await workspaceManagementApi.updateIssueStatus(issue.id, status);
      await refreshOverview();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Unable to update issue status.');
    } finally {
      setUpdatingIssueId(null);
    }
  };

  if (!overview && !loadError) {
    return (
      <div className="grid min-h-[360px] place-items-center rounded-xl border bg-card">
        <div className="flex items-center gap-2 text-sm font-black text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" />
          Loading Workspace…
        </div>
      </div>
    );
  }

  const refreshButton = (
    <Button disabled={isRefreshing} onClick={() => void refreshOverview(true)} size="sm" type="button" variant="outline">
      <RefreshCw className={cn('size-4', isRefreshing && 'animate-spin')} />
      Refresh
    </Button>
  );

  const customerFirstAction = data.customers.length === 0
    ? () => setModal({ kind: 'customer' })
    : () => setModal({ kind: 'project' });

  const renderDashboard = () => (
    <div className="grid gap-4">
      <SectionHeader
        actions={refreshButton}
        description={`General workload shown in ${timeZone}. Times are stored as UTC.`}
        icon={<LayoutDashboard className="size-5" />}
        title="Workspace overview"
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: <FolderKanban className="size-4" />, label: 'Active projects', value: data.projects.filter((project) => project.status === 'active').length },
          { icon: <ListTodo className="size-4" />, label: 'Open workload', value: openIssues.length },
          { icon: <CalendarDays className="size-4" />, label: 'Upcoming schedule', value: upcomingItems.length },
          { icon: <Building2 className="size-4" />, label: 'Customer companies', value: data.customers.length },
        ].map((metric) => (
          <Card className="shadow-none" key={metric.label}>
            <CardContent className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase text-muted-foreground">{metric.label}</div>
                <div className="mt-2 text-3xl font-black">{metric.value}</div>
              </div>
              <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">{metric.icon}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Card className="shadow-none">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="font-black">Next on the calendar</CardTitle>
            <Button onClick={() => onNavigate('calendar')} size="sm" type="button" variant="ghost">View calendar</Button>
          </CardHeader>
          <CardContent className="grid gap-2">
            {upcomingItems.length === 0 ? (
              <EmptyState
                action={canManageCalendar ? <Button onClick={() => setModal({ kind: 'calendar' })} size="sm"><Plus className="size-4" />Add schedule</Button> : undefined}
                description="Add work, meetings, deadlines, or follow-ups."
                title="No upcoming schedule"
              />
            ) : upcomingItems.map((item) => (
              <button
                className="flex w-full items-start justify-between gap-3 rounded-lg border bg-background p-3 text-left transition hover:bg-muted/30"
                key={item.id}
                onClick={() => canManageCalendar && item.canEdit && setModal({ item, kind: 'calendar' })}
                type="button"
              >
                <div className="min-w-0">
                  <div className="truncate font-black">{item.title}</div>
                  <div className="mt-1 text-xs font-semibold text-muted-foreground">{formatDateTime(item.startAtUtc, timeZone)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {item.shares.length > 0 || !item.canEdit ? <Share2 className="size-3.5 text-muted-foreground" /> : null}
                  <Badge className={calendarTypeStyles[item.itemType]} variant="outline">{item.itemType}</Badge>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="font-black">To do</CardTitle>
            {canManageIssues ? <Button onClick={() => setModal({ kind: 'issue' })} size="sm" type="button" variant="ghost"><Plus className="size-4" />Issue</Button> : null}
          </CardHeader>
          <CardContent className="grid gap-2">
            {openIssues.slice(0, 6).map((issue) => (
              <button
                className="grid gap-1 rounded-lg border bg-background p-3 text-left transition hover:bg-muted/30"
                key={issue.id}
                onClick={() => canManageIssues && setModal({ item: issue, kind: 'issue' })}
                type="button"
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate font-black">{issue.title}</span>
                  <Badge className={issueStatusStyles[issue.status]} variant="outline">{issueStatusLabels[issue.status]}</Badge>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">{issue.customerCompany} · {issue.projectName ?? 'Standalone'}</span>
              </button>
            ))}
            {openIssues.length === 0 ? (
              <EmptyState description="Issues and customer requests will appear here." title="Nothing waiting" />
            ) : null}
          </CardContent>
        </Card>
      </div>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-black"><ExternalLink className="size-4" />Google Workspace</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => window.open('https://calendar.google.com/', '_blank', 'noopener,noreferrer')} size="sm" type="button" variant="outline">Google Calendar</Button>
          <Button onClick={() => onNavigate('drive')} size="sm" type="button" variant="outline">Drive</Button>
          <Button onClick={() => onNavigate('email')} size="sm" type="button" variant="outline">Gmail</Button>
          <Button onClick={() => onNavigate('chat')} size="sm" type="button" variant="outline">Chat</Button>
        </CardContent>
      </Card>
    </div>
  );

  const renderProjects = () => (
    <div className="grid gap-4">
      <SectionHeader
        actions={(
          <>
            {canManageCustomers ? <Button onClick={() => setModal({ kind: 'customer' })} size="sm" type="button" variant="outline"><Building2 className="size-4" />Customer</Button> : null}
            {canManageProjects ? <Button onClick={customerFirstAction} size="sm" type="button"><Plus className="size-4" />Project</Button> : null}
          </>
        )}
        description="Customer work grouped by product category—not software-development repositories."
        icon={<BriefcaseBusiness className="size-5" />}
        title="Projects"
      />
      {data.projects.length === 0 ? (
        <EmptyState
          action={canManageProjects ? <Button onClick={customerFirstAction} size="sm"><Plus className="size-4" />{data.customers.length ? 'Create project' : 'Add customer first'}</Button> : undefined}
          description="Every project is allocated to a customer company and a Workspace category."
          title="No projects yet"
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {data.projects.map((project) => (
            <Card className="shadow-none" key={project.id}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate font-black">{project.name}</CardTitle>
                  <div className="mt-1 text-xs font-bold text-muted-foreground">{project.customerCompany}</div>
                </div>
                {canManageProjects ? <Button aria-label={`Edit ${project.name}`} onClick={() => setModal({ item: project, kind: 'project' })} size="icon-sm" type="button" variant="ghost"><Pencil className="size-4" /></Button> : null}
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{project.category}{project.subcategory ? ` / ${project.subcategory}` : ''}</Badge>
                  <Badge variant="outline">{project.status}</Badge>
                </div>
                <p className="line-clamp-2 min-h-10 text-sm font-semibold text-muted-foreground">{project.description || 'No project description.'}</p>
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/25 p-3 text-xs">
                  <div><span className="font-bold text-muted-foreground">Open issues</span><div className="mt-1 text-lg font-black">{project.openIssueCount}</div></div>
                  <div><span className="font-bold text-muted-foreground">Due</span><div className="mt-1 font-black">{project.dueAtUtc ? formatDateTime(project.dueAtUtc, timeZone, false) : 'Not set'}</div></div>
                </div>
                {canManageIssues ? <Button onClick={() => setModal({ kind: 'issue', projectId: project.id })} size="sm" type="button" variant="outline"><Plus className="size-4" />Add issue</Button> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  const renderIssues = (filter?: WorkspaceIssue['issueType']) => {
    const filteredIssues = filter ? data.issues.filter((issue) => issue.issueType === filter) : data.issues;
    const title = filter === 'request' ? 'Customer requests' : filter === 'task' ? 'Work items' : 'Issues';

    return (
      <div className="grid gap-4">
        <SectionHeader
          actions={canManageIssues ? <Button onClick={() => setModal({ kind: 'issue' })} size="sm" type="button"><Plus className="size-4" />New issue</Button> : undefined}
          description="Create an issue inside a project or leave the project blank for a standalone issue."
          icon={<CircleAlert className="size-5" />}
          title={title}
        />
        <div className="flex flex-wrap gap-2">
          {(['todo', 'doing', 'waiting', 'solved'] as const).map((status) => (
            <Badge className={issueStatusStyles[status]} key={status} variant="outline">
              {issueStatusLabels[status]} {filteredIssues.filter((issue) => issue.status === status).length}
            </Badge>
          ))}
        </div>
        <div className="grid gap-2">
          {filteredIssues.map((issue) => (
            <IssueRow
              canManage={canManageIssues}
              issue={issue}
              key={issue.id}
              onEdit={() => setModal({ item: issue, kind: 'issue' })}
              onStatusChange={(status) => void handleIssueStatusChange(issue, status)}
              timeZone={timeZone}
              updating={updatingIssueId === issue.id}
            />
          ))}
          {filteredIssues.length === 0 ? (
            <EmptyState
              action={canManageIssues ? <Button onClick={() => setModal({ kind: 'issue' })} size="sm"><Plus className="size-4" />Create issue</Button> : undefined}
              description="Issues must belong to a customer company; linking a project is optional."
              title="No issues in this view"
            />
          ) : null}
        </div>
      </div>
    );
  };

  const renderBoard = () => (
    <div className="grid gap-4">
      <SectionHeader
        actions={canManageIssues ? <Button onClick={() => setModal({ kind: 'issue' })} size="sm"><Plus className="size-4" />Add work</Button> : undefined}
        description="Move general workload through To do, Doing, Waiting, and Solved."
        icon={<ListTodo className="size-5" />}
        title="Workload board"
      />
      <div className="grid items-start gap-3 xl:grid-cols-4">
        {(['todo', 'doing', 'waiting', 'solved'] as const).map((status) => {
          const items = data.issues.filter((issue) => issue.status === status);

          return (
            <Card className="shadow-none" key={status}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="font-black">{issueStatusLabels[status]}</CardTitle>
                <Badge className={issueStatusStyles[status]} variant="outline">{items.length}</Badge>
              </CardHeader>
              <CardContent className="grid gap-2">
                {items.map((issue) => (
                  <button
                    className="grid gap-2 rounded-lg border bg-background p-3 text-left transition hover:bg-muted/30"
                    key={issue.id}
                    onClick={() => canManageIssues && setModal({ item: issue, kind: 'issue' })}
                    type="button"
                  >
                    <span className="font-black">{issue.title}</span>
                    <span className="text-xs font-semibold text-muted-foreground">{issue.customerCompany}</span>
                    <div className="flex flex-wrap gap-1"><Badge className={priorityStyles[issue.priority]} variant="outline">{issue.priority}</Badge><Badge variant="secondary">{issue.projectName ?? 'Standalone'}</Badge></div>
                  </button>
                ))}
                {items.length === 0 ? <div className="rounded-lg border border-dashed p-4 text-center text-xs font-bold text-muted-foreground">No items</div> : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );

  const renderCalendar = () => {
    const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC', year: 'numeric' }).format(visibleMonth);
    const todayKey = toLocalDateInput(new Date().toISOString(), timeZone);

    return (
      <div className="grid gap-4">
        <SectionHeader
          actions={(
            <>
              <Button onClick={() => window.open('https://calendar.google.com/', '_blank', 'noopener,noreferrer')} size="sm" type="button" variant="outline"><ExternalLink className="size-4" />Google Calendar</Button>
              {canManageCalendar ? <Button onClick={() => setModal({ kind: 'calendar' })} size="sm" type="button"><Plus className="size-4" />Schedule</Button> : null}
            </>
          )}
          description={`Stored in UTC and displayed in ${timeZone}. Shared users see the same instant in their own setting.`}
          icon={<CalendarDays className="size-5" />}
          title="Shared calendar"
        />
        <Card className="shadow-none">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <Button aria-label="Previous month" onClick={() => setVisibleMonth((current) => addMonths(current, -1))} size="icon-sm" type="button" variant="outline"><ChevronLeft className="size-4" /></Button>
            <CardTitle className="text-center font-black">{monthLabel}</CardTitle>
            <Button aria-label="Next month" onClick={() => setVisibleMonth((current) => addMonths(current, 1))} size="icon-sm" type="button" variant="outline"><ChevronRight className="size-4" /></Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-7 border-b text-center text-xs font-black uppercase text-muted-foreground">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div className="py-2" key={day}>{day}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {monthDays.map((day) => {
                  const items = calendarByDate.get(day.dateKey) ?? [];

                  return (
                    <div
                      className={cn(
                        'min-h-28 border-b border-r p-1.5 last:border-r-0',
                        !day.isCurrentMonth && 'bg-muted/20 text-muted-foreground',
                        day.dateKey === todayKey && 'bg-primary/5 ring-1 ring-inset ring-primary/30',
                      )}
                      key={day.dateKey}
                    >
                      <button
                        aria-label={`Add schedule on ${day.dateKey}`}
                        className="mb-1 grid size-7 place-items-center rounded-full text-xs font-black hover:bg-muted"
                        disabled={!canManageCalendar}
                        onClick={() => canManageCalendar && setModal({ kind: 'calendar', startLocal: `${day.dateKey}T09:00` })}
                        type="button"
                      >
                        {day.date.getUTCDate()}
                      </button>
                      <div className="grid gap-1">
                        {items.slice(0, 3).map((item) => (
                          <button
                            className={cn('truncate rounded-md border px-1.5 py-1 text-left text-[11px] font-black', calendarTypeStyles[item.itemType])}
                            key={item.id}
                            onClick={() => canManageCalendar && item.canEdit && setModal({ item, kind: 'calendar' })}
                            title={`${item.title} — ${formatDateTime(item.startAtUtc, timeZone)}`}
                            type="button"
                          >
                            {item.shares.length > 0 || !item.canEdit ? '↗ ' : ''}{item.title}
                          </button>
                        ))}
                        {items.length > 3 ? <span className="px-1 text-[10px] font-black text-muted-foreground">+{items.length - 3} more</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader><CardTitle className="font-black">Schedule details</CardTitle></CardHeader>
          <CardContent className="grid gap-2 lg:grid-cols-2">
            {data.calendarItems.map((item) => (
              <div className="flex items-start justify-between gap-3 rounded-lg border bg-background p-3" key={item.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-black">{item.title}</span><Badge className={calendarTypeStyles[item.itemType]} variant="outline">{item.itemType}</Badge></div>
                  <div className="mt-1 text-xs font-semibold text-muted-foreground">{formatDateTime(item.startAtUtc, timeZone)} – {formatDateTime(item.endAtUtc, timeZone)}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs font-semibold text-muted-foreground">
                    {item.projectName ? <span>{item.projectName}</span> : null}
                    {!item.canEdit ? <span>Shared by {item.ownerLabel}</span> : null}
                    {item.shares.length > 0 ? <span>Shared with {item.shares.map((share) => share.targetLabel).join(', ')}</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button aria-label="Add to Google Calendar" onClick={() => window.open(createGoogleCalendarUrl(item), '_blank', 'noopener,noreferrer')} size="icon-sm" type="button" variant="ghost"><ExternalLink className="size-4" /></Button>
                  {canManageCalendar && item.canEdit ? <Button aria-label={`Edit ${item.title}`} onClick={() => setModal({ item, kind: 'calendar' })} size="icon-sm" type="button" variant="outline"><Pencil className="size-4" /></Button> : null}
                </div>
              </div>
            ))}
            {data.calendarItems.length === 0 ? <EmptyState description="Create a schedule and optionally share it with a user or group." title="Calendar is empty" /> : null}
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderTimeline = () => {
    const timelineRows = [
      ...data.projects.map((project) => ({
        category: `${project.category}${project.subcategory ? ` / ${project.subcategory}` : ''}`,
        customer: project.customerCompany,
        end: project.dueAtUtc,
        id: `project-${project.id}`,
        start: project.startAtUtc,
        title: project.name,
        type: 'Project',
      })),
      ...data.issues.filter((issue) => issue.dueAtUtc).map((issue) => ({
        category: issue.projectName ?? 'Standalone issue',
        customer: issue.customerCompany,
        end: issue.dueAtUtc,
        id: `issue-${issue.id}`,
        start: issue.createdAt,
        title: issue.title,
        type: 'Issue',
      })),
    ].sort((first, second) => new Date(first.end ?? '9999-12-31').getTime() - new Date(second.end ?? '9999-12-31').getTime());

    return (
      <div className="grid gap-4">
        <SectionHeader
          description={`Project and issue dates displayed in ${timeZone}.`}
          icon={<GanttChart className="size-5" />}
          title="Work timeline"
        />
        <Card className="shadow-none">
          <CardContent className="grid gap-2">
            {timelineRows.map((row) => (
              <div className="grid gap-2 rounded-lg border bg-background p-3 md:grid-cols-[90px_minmax(0,1fr)_minmax(220px,0.7fr)] md:items-center" key={row.id}>
                <Badge variant={row.type === 'Project' ? 'default' : 'secondary'}>{row.type}</Badge>
                <div className="min-w-0"><div className="truncate font-black">{row.title}</div><div className="text-xs font-semibold text-muted-foreground">{row.customer} · {row.category}</div></div>
                <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground"><Clock3 className="size-3.5" /><span>{row.start ? formatDateTime(row.start, timeZone, false) : 'No start'} → {row.end ? formatDateTime(row.end, timeZone, false) : 'No due date'}</span></div>
              </div>
            ))}
            {timelineRows.length === 0 ? <EmptyState description="Add project start/due dates or issue due dates to build the timeline." title="No dated work" /> : null}
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderCustomers = () => (
    <div className="grid gap-4">
      <SectionHeader
        actions={canManageCustomers ? <Button onClick={() => setModal({ kind: 'customer' })} size="sm"><Plus className="size-4" />Customer company</Button> : undefined}
        description="Projects and standalone issues are always allocated to a customer company."
        icon={<Building2 className="size-5" />}
        title="Customers"
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.customers.map((customer) => (
          <Card className="shadow-none" key={customer.id}>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div><CardTitle className="font-black">{customer.companyName}</CardTitle><p className="mt-1 text-xs font-semibold text-muted-foreground">{customer.contactName || 'No contact name'}</p></div>
              {canManageCustomers ? <Button aria-label={`Edit ${customer.companyName}`} onClick={() => setModal({ item: customer, kind: 'customer' })} size="icon-sm" variant="ghost"><Pencil className="size-4" /></Button> : null}
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="text-sm font-semibold text-muted-foreground">{customer.contactEmail || 'No email'}{customer.phone ? ` · ${customer.phone}` : ''}</div>
              <div className="grid grid-cols-2 gap-2"><div className="rounded-lg bg-muted/30 p-3"><div className="text-xs font-bold text-muted-foreground">Projects</div><div className="mt-1 text-xl font-black">{customer.projectCount}</div></div><div className="rounded-lg bg-muted/30 p-3"><div className="text-xs font-bold text-muted-foreground">Issues</div><div className="mt-1 text-xl font-black">{customer.issueCount}</div></div></div>
            </CardContent>
          </Card>
        ))}
      </div>
      {data.customers.length === 0 ? <EmptyState action={canManageCustomers ? <Button onClick={() => setModal({ kind: 'customer' })} size="sm"><Plus className="size-4" />Add first customer</Button> : undefined} description="A customer company is required before creating projects or issues." title="No customer companies" /> : null}
    </div>
  );

  const renderCategories = () => (
    <div className="grid gap-4">
      <SectionHeader
        description="A controlled taxonomy keeps filtering and reporting consistent."
        icon={<Tags className="size-5" />}
        title="Project categories"
      />
      <div className="grid gap-3 md:grid-cols-3">
        {data.categories.map((category) => {
          const projects = data.projects.filter((project) => project.category === category.name);

          return (
            <Card className="shadow-none" key={category.name}>
              <CardHeader><CardTitle className="font-black">{category.name}</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                {category.children.length > 0 ? <div className="flex flex-wrap gap-2">{category.children.map((child) => <Badge key={child} variant="secondary">{child}</Badge>)}</div> : <div className="text-sm font-semibold text-muted-foreground">Top-level category</div>}
                <div className="rounded-lg bg-muted/30 p-3"><div className="text-xs font-bold text-muted-foreground">Allocated projects</div><div className="mt-1 text-2xl font-black">{projects.length}</div></div>
                {category.name === 'TopSolid' ? <div className="grid grid-cols-2 gap-2 text-xs font-bold text-muted-foreground"><span>CAM: {projects.filter((project) => project.subcategory === 'CAM').length}</span><span>Mold: {projects.filter((project) => project.subcategory === 'Mold').length}</span></div> : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );

  let content: ReactNode;

  switch (activeSection) {
    case 'project':
      content = renderProjects();
      break;
    case 'calendar':
      content = renderCalendar();
      break;
    case 'board':
      content = renderBoard();
      break;
    case 'timeline':
      content = renderTimeline();
      break;
    case 'issues':
      content = renderIssues();
      break;
    case 'bugs':
      content = renderIssues('task');
      break;
    case 'features':
      content = renderIssues('request');
      break;
    case 'customers':
      content = renderCustomers();
      break;
    case 'categories':
      content = renderCategories();
      break;
    default:
      content = renderDashboard();
  }

  return (
    <div className="grid min-h-0 gap-4 pb-3">
      {loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm font-bold text-red-700 dark:text-red-200">
          <span>{loadError}</span>
          <Button onClick={() => void refreshOverview(true)} size="sm" type="button" variant="outline">Retry</Button>
        </div>
      ) : null}
      {mutationError && !modal ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm font-bold text-red-700 dark:text-red-200">{mutationError}</div>
      ) : null}
      {content}

      {modal?.kind === 'customer' && canManageCustomers ? (
        <CustomerDialog
          error={mutationError}
          initial={modal.item}
          onClose={() => { setModal(null); setMutationError(''); }}
          onSave={(request) => runMutation(() => workspaceManagementApi.saveCustomer(request, modal.item?.id))}
        />
      ) : null}
      {modal?.kind === 'project' && canManageProjects ? (
        <ProjectDialog
          customers={data.customers}
          error={mutationError}
          initial={modal.item}
          onClose={() => { setModal(null); setMutationError(''); }}
          onSave={(request) => runMutation(() => workspaceManagementApi.saveProject(request, modal.item?.id))}
          timeZone={timeZone}
        />
      ) : null}
      {modal?.kind === 'issue' && canManageIssues ? (
        <IssueDialog
          customers={data.customers}
          error={mutationError}
          initial={modal.item}
          initialProjectId={modal.projectId}
          onClose={() => { setModal(null); setMutationError(''); }}
          onSave={(request) => runMutation(() => workspaceManagementApi.saveIssue(request, modal.item?.id))}
          projects={data.projects}
          timeZone={timeZone}
        />
      ) : null}
      {modal?.kind === 'calendar' && canManageCalendar ? (
        <CalendarEntryDialog
          error={mutationError}
          groups={data.groups}
          initial={modal.item}
          initialStartLocal={modal.startLocal}
          issues={data.issues}
          onClose={() => { setModal(null); setMutationError(''); }}
          onDelete={modal.item ? () => runMutation(() => workspaceManagementApi.deleteCalendarEntry(modal.item!.id)) : undefined}
          onSave={(request) => runMutation(() => workspaceManagementApi.saveCalendarEntry(request, modal.item?.id))}
          projects={data.projects}
          timeZone={timeZone}
          users={data.users}
        />
      ) : null}
    </div>
  );
}

function DialogError({ message }: { message: string }) {
  return message ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs font-bold text-red-700 dark:text-red-200">{message}</div> : null;
}

function CustomerDialog({
  error,
  initial,
  onClose,
  onSave,
}: {
  error: string;
  initial?: WorkspaceCustomer;
  onClose: () => void;
  onSave: (request: SaveWorkspaceCustomerRequest) => Promise<unknown>;
}) {
  const [form, setForm] = useState({
    companyName: initial?.companyName ?? '',
    contactEmail: initial?.contactEmail ?? '',
    contactName: initial?.contactName ?? '',
    phone: initial?.phone ?? '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);

    try {
      await onSave(form);
    } catch {
      // The parent renders the API error while keeping this dialog open.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent className="sm:max-w-lg">
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader><DialogTitle className="font-black">{initial ? 'Edit customer company' : 'Add customer company'}</DialogTitle><DialogDescription>Projects and standalone issues use this company allocation.</DialogDescription></DialogHeader>
          <DialogError message={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 sm:col-span-2"><Label htmlFor="workspace-customer-company">Company name</Label><Input autoFocus id="workspace-customer-company" maxLength={180} onChange={(event) => setForm((current) => ({ ...current, companyName: event.target.value }))} required value={form.companyName} /></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-customer-contact">Contact name</Label><Input id="workspace-customer-contact" maxLength={160} onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))} value={form.contactName} /></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-customer-email">Contact email</Label><Input id="workspace-customer-email" maxLength={320} onChange={(event) => setForm((current) => ({ ...current, contactEmail: event.target.value }))} type="email" value={form.contactEmail} /></label>
            <label className="grid gap-1.5 sm:col-span-2"><Label htmlFor="workspace-customer-phone">Phone</Label><Input id="workspace-customer-phone" maxLength={80} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} value={form.phone} /></label>
          </div>
          <DialogFooter><Button disabled={saving} onClick={onClose} type="button" variant="outline">Cancel</Button><Button disabled={saving || !form.companyName.trim()} type="submit">{saving ? 'Saving…' : 'Save company'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProjectDialog({
  customers,
  error,
  initial,
  onClose,
  onSave,
  timeZone,
}: {
  customers: WorkspaceCustomer[];
  error: string;
  initial?: WorkspaceProject;
  onClose: () => void;
  onSave: (request: SaveWorkspaceProjectRequest) => Promise<unknown>;
  timeZone: string;
}) {
  const [form, setForm] = useState({
    category: initial?.category ?? 'TopSolid',
    customerId: initial?.customerId ?? customers[0]?.id ?? '',
    description: initial?.description ?? '',
    dueDate: toLocalDateInput(initial?.dueAtUtc, timeZone),
    name: initial?.name ?? '',
    startDate: toLocalDateInput(initial?.startAtUtc, timeZone),
    status: initial?.status ?? 'active' as WorkspaceProject['status'],
    subcategory: initial?.subcategory ?? 'CAM',
  });
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);

    try {
      await onSave({
        category: form.category,
        customerId: form.customerId,
        description: form.description,
        dueAtUtc: form.dueDate ? zonedLocalToUtc(`${form.dueDate}T17:00`, timeZone) : undefined,
        name: form.name,
        startAtUtc: form.startDate ? zonedLocalToUtc(`${form.startDate}T09:00`, timeZone) : undefined,
        status: form.status,
        subcategory: form.category === 'TopSolid' ? form.subcategory : undefined,
      });
    } catch {
      // The parent renders the API error while keeping this dialog open.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader><DialogTitle className="font-black">{initial ? 'Edit project' : 'Create project'}</DialogTitle><DialogDescription>Allocate the work to a customer and product category.</DialogDescription></DialogHeader>
          <DialogError message={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 sm:col-span-2"><Label htmlFor="workspace-project-name">Project name</Label><Input autoFocus id="workspace-project-name" maxLength={180} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required value={form.name} /></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-project-customer">Customer company</Label><select className="h-8 rounded-lg border bg-background px-2 text-sm" id="workspace-project-customer" onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value }))} required value={form.customerId}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.companyName}</option>)}</select></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-project-status">Status</Label><select className="h-8 rounded-lg border bg-background px-2 text-sm" id="workspace-project-status" onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as WorkspaceProject['status'] }))} value={form.status}><option value="planned">Planned</option><option value="active">Active</option><option value="waiting">Waiting</option><option value="completed">Completed</option></select></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-project-category">Category</Label><select className="h-8 rounded-lg border bg-background px-2 text-sm" id="workspace-project-category" onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} value={form.category}><option value="TopSolid">TopSolid</option><option value="Eureka">Eureka</option><option value="Boxcon">Boxcon</option></select></label>
            {form.category === 'TopSolid' ? <label className="grid gap-1.5"><Label htmlFor="workspace-project-subcategory">TopSolid area</Label><select className="h-8 rounded-lg border bg-background px-2 text-sm" id="workspace-project-subcategory" onChange={(event) => setForm((current) => ({ ...current, subcategory: event.target.value }))} value={form.subcategory}><option value="CAM">CAM</option><option value="Mold">Mold</option></select></label> : <div />}
            <label className="grid gap-1.5"><Label htmlFor="workspace-project-start">Start date ({timeZone})</Label><Input id="workspace-project-start" onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} type="date" value={form.startDate} /></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-project-due">Due date ({timeZone})</Label><Input id="workspace-project-due" onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} type="date" value={form.dueDate} /></label>
            <label className="grid gap-1.5 sm:col-span-2"><Label htmlFor="workspace-project-description">Description</Label><Textarea id="workspace-project-description" maxLength={10000} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} value={form.description} /></label>
          </div>
          <DialogFooter><Button disabled={saving} onClick={onClose} type="button" variant="outline">Cancel</Button><Button disabled={saving || !form.name.trim() || !form.customerId} type="submit">{saving ? 'Saving…' : 'Save project'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IssueDialog({
  customers,
  error,
  initial,
  initialProjectId,
  onClose,
  onSave,
  projects,
  timeZone,
}: {
  customers: WorkspaceCustomer[];
  error: string;
  initial?: WorkspaceIssue;
  initialProjectId?: string;
  onClose: () => void;
  onSave: (request: SaveWorkspaceIssueRequest) => Promise<unknown>;
  projects: WorkspaceProject[];
  timeZone: string;
}) {
  const initialProject = projects.find((project) => project.id === (initial?.projectId ?? initialProjectId));
  const [form, setForm] = useState({
    customerId: initial?.customerId ?? initialProject?.customerId ?? customers[0]?.id ?? '',
    description: initial?.description ?? '',
    dueAtLocal: toLocalDateTimeInput(initial?.dueAtUtc, timeZone),
    issueType: initial?.issueType ?? 'issue' as WorkspaceIssue['issueType'],
    priority: initial?.priority ?? 'normal' as WorkspaceIssue['priority'],
    projectId: initial?.projectId ?? initialProjectId ?? '',
    status: initial?.status ?? 'todo' as WorkspaceIssue['status'],
    title: initial?.title ?? '',
  });
  const [saving, setSaving] = useState(false);
  const availableProjects = projects.filter((project) => project.customerId === form.customerId);

  const setCustomer = (customerId: string) => {
    setForm((current) => ({
      ...current,
      customerId,
      projectId: projects.some((project) => project.id === current.projectId && project.customerId === customerId)
        ? current.projectId
        : '',
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);

    try {
      await onSave({
        customerId: form.customerId,
        description: form.description,
        dueAtUtc: form.dueAtLocal ? zonedLocalToUtc(form.dueAtLocal, timeZone) : undefined,
        issueType: form.issueType,
        priority: form.priority,
        projectId: form.projectId || undefined,
        status: form.status,
        title: form.title,
      });
    } catch {
      // The parent renders the API error while keeping this dialog open.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader><DialogTitle className="font-black">{initial ? 'Edit issue' : 'Create issue'}</DialogTitle><DialogDescription>A project is optional; the customer company is always required.</DialogDescription></DialogHeader>
          <DialogError message={error} />
          {customers.length === 0 ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-bold text-amber-700 dark:text-amber-200">Add a customer company before creating an issue.</div> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 sm:col-span-2"><Label htmlFor="workspace-issue-title">Title</Label><Input autoFocus id="workspace-issue-title" maxLength={240} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required value={form.title} /></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-issue-customer">Customer company</Label><select className="h-8 rounded-lg border bg-background px-2 text-sm" id="workspace-issue-customer" onChange={(event) => setCustomer(event.target.value)} required value={form.customerId}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.companyName}</option>)}</select></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-issue-project">Project (optional)</Label><select className="h-8 rounded-lg border bg-background px-2 text-sm" id="workspace-issue-project" onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))} value={form.projectId}><option value="">Standalone issue</option>{availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-issue-type">Type</Label><select className="h-8 rounded-lg border bg-background px-2 text-sm" id="workspace-issue-type" onChange={(event) => setForm((current) => ({ ...current, issueType: event.target.value as WorkspaceIssue['issueType'] }))} value={form.issueType}><option value="issue">Issue</option><option value="request">Customer request</option><option value="task">Task</option><option value="meeting">Meeting action</option></select></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-issue-priority">Priority</Label><select className="h-8 rounded-lg border bg-background px-2 text-sm" id="workspace-issue-priority" onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as WorkspaceIssue['priority'] }))} value={form.priority}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-issue-status">Status</Label><select className="h-8 rounded-lg border bg-background px-2 text-sm" id="workspace-issue-status" onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as WorkspaceIssue['status'] }))} value={form.status}><option value="todo">To do</option><option value="doing">Doing</option><option value="waiting">Waiting</option><option value="solved">Solved</option></select></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-issue-due">Due ({timeZone})</Label><Input id="workspace-issue-due" onChange={(event) => setForm((current) => ({ ...current, dueAtLocal: event.target.value }))} type="datetime-local" value={form.dueAtLocal} /></label>
            <label className="grid gap-1.5 sm:col-span-2"><Label htmlFor="workspace-issue-description">Description</Label><Textarea id="workspace-issue-description" maxLength={10000} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} value={form.description} /></label>
          </div>
          <DialogFooter><Button disabled={saving} onClick={onClose} type="button" variant="outline">Cancel</Button><Button disabled={saving || !form.title.trim() || !form.customerId} type="submit">{saving ? 'Saving…' : 'Save issue'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CalendarEntryDialog({
  error,
  groups,
  initial,
  initialStartLocal,
  issues,
  onClose,
  onDelete,
  onSave,
  projects,
  timeZone,
  users,
}: {
  error: string;
  groups: WorkspaceManagementOverview['groups'];
  initial?: WorkspaceCalendarEntry;
  initialStartLocal?: string;
  issues: WorkspaceIssue[];
  onClose: () => void;
  onDelete?: () => Promise<unknown>;
  onSave: (request: SaveWorkspaceCalendarEntryRequest) => Promise<unknown>;
  projects: WorkspaceProject[];
  timeZone: string;
  users: WorkspaceManagementOverview['users'];
}) {
  const defaultStart = initialStartLocal ?? getDefaultLocalStart(timeZone);
  const [form, setForm] = useState({
    description: initial?.description ?? '',
    endLocal: initial ? toLocalDateTimeInput(initial.endAtUtc, timeZone) : addLocalHours(defaultStart, 1, timeZone),
    isAllDay: initial?.isAllDay ?? false,
    issueId: initial?.issueId ?? '',
    itemType: initial?.itemType ?? 'work' as WorkspaceCalendarEntry['itemType'],
    projectId: initial?.projectId ?? '',
    shares: initial?.shares ?? [] as WorkspaceCalendarShare[],
    startLocal: initial ? toLocalDateTimeInput(initial.startAtUtc, timeZone) : defaultStart,
    title: initial?.title ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const availableIssues = issues.filter((issue) => !form.projectId || issue.projectId === form.projectId);

  const toggleShare = (share: WorkspaceCalendarShare) => {
    setForm((current) => {
      const exists = current.shares.some((item) => item.targetType === share.targetType && item.targetKey === share.targetKey);

      return {
        ...current,
        shares: exists
          ? current.shares.filter((item) => item.targetType !== share.targetType || item.targetKey !== share.targetKey)
          : [...current.shares, share],
      };
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const startAtUtc = zonedLocalToUtc(form.startLocal, timeZone);
    const endAtUtc = zonedLocalToUtc(form.endLocal, timeZone);

    if (!startAtUtc || !endAtUtc) {
      return;
    }

    setSaving(true);

    try {
      await onSave({
        description: form.description,
        endAtUtc,
        isAllDay: form.isAllDay,
        issueId: form.issueId || undefined,
        itemType: form.itemType,
        projectId: form.projectId || undefined,
        shares: form.shares,
        sourceTimeZone: timeZone,
        startAtUtc,
        status: 'scheduled',
        title: form.title,
      });
    } catch {
      // The parent renders the API error while keeping this dialog open.
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!onDelete || !window.confirm('Delete this calendar item?')) {
      return;
    }

    setDeleting(true);
    try {
      await onDelete();
    } catch {
      // The parent renders the API error while keeping this dialog open.
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader><DialogTitle className="font-black">{initial ? 'Edit calendar item' : 'Add calendar item'}</DialogTitle><DialogDescription>Enter time in {timeZone}. The API stores the resulting instant in UTC.</DialogDescription></DialogHeader>
          <DialogError message={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 sm:col-span-2"><Label htmlFor="workspace-calendar-title">Title</Label><Input autoFocus id="workspace-calendar-title" maxLength={240} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required value={form.title} /></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-calendar-type">Type</Label><select className="h-8 rounded-lg border bg-background px-2 text-sm" id="workspace-calendar-type" onChange={(event) => setForm((current) => ({ ...current, itemType: event.target.value as WorkspaceCalendarEntry['itemType'] }))} value={form.itemType}><option value="work">Work</option><option value="meeting">Meeting</option><option value="deadline">Deadline</option><option value="follow-up">Follow-up</option></select></label>
            <label className="flex items-end gap-2 pb-1 text-sm font-bold"><input checked={form.isAllDay} onChange={(event) => setForm((current) => ({ ...current, isAllDay: event.target.checked }))} type="checkbox" />All-day label</label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-calendar-start">Start ({timeZone})</Label><Input id="workspace-calendar-start" onChange={(event) => setForm((current) => ({ ...current, startLocal: event.target.value }))} required type="datetime-local" value={form.startLocal} /></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-calendar-end">End ({timeZone})</Label><Input id="workspace-calendar-end" onChange={(event) => setForm((current) => ({ ...current, endLocal: event.target.value }))} required type="datetime-local" value={form.endLocal} /></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-calendar-project">Project (optional)</Label><select className="h-8 rounded-lg border bg-background px-2 text-sm" id="workspace-calendar-project" onChange={(event) => setForm((current) => ({ ...current, issueId: '', projectId: event.target.value }))} value={form.projectId}><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            <label className="grid gap-1.5"><Label htmlFor="workspace-calendar-issue">Issue (optional)</Label><select className="h-8 rounded-lg border bg-background px-2 text-sm" id="workspace-calendar-issue" onChange={(event) => setForm((current) => ({ ...current, issueId: event.target.value }))} value={form.issueId}><option value="">No issue</option>{availableIssues.map((issue) => <option key={issue.id} value={issue.id}>{issue.title}</option>)}</select></label>
            <label className="grid gap-1.5 sm:col-span-2"><Label htmlFor="workspace-calendar-description">Description</Label><Textarea id="workspace-calendar-description" maxLength={10000} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} value={form.description} /></label>
          </div>
          <div className="grid gap-3 rounded-xl border bg-muted/15 p-3">
            <div className="flex items-center gap-2"><Share2 className="size-4 text-primary" /><div><div className="text-sm font-black">Share calendar item</div><div className="text-xs font-semibold text-muted-foreground">Recipients can view this schedule but only you can edit it.</div></div></div>
            <div className="grid max-h-44 gap-1 overflow-y-auto sm:grid-cols-2">
              {users.map((user) => {
                const share = { targetKey: user.email, targetLabel: user.displayName, targetType: 'user' as const };
                const checked = form.shares.some((item) => item.targetType === 'user' && item.targetKey === user.email);
                return <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold hover:bg-muted" key={user.email}><input checked={checked} onChange={() => toggleShare(share)} type="checkbox" /><Users className="size-3.5" /><span className="truncate">{user.displayName}</span></label>;
              })}
              {groups.map((group) => {
                const share = { targetKey: group.id, targetLabel: group.name, targetType: 'group' as const };
                const checked = form.shares.some((item) => item.targetType === 'group' && item.targetKey === group.id);
                return <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold hover:bg-muted" key={group.id}><input checked={checked} onChange={() => toggleShare(share)} type="checkbox" /><Share2 className="size-3.5" /><span className="truncate">{group.name}</span></label>;
              })}
              {users.length === 0 && groups.length === 0 ? <span className="text-xs font-semibold text-muted-foreground">No active users or groups are available.</span> : null}
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <div>{onDelete ? <Button disabled={deleting || saving} onClick={() => void remove()} type="button" variant="outline"><Trash2 className="size-4 text-destructive" />{deleting ? 'Deleting…' : 'Delete'}</Button> : null}</div>
            <div className="flex gap-2"><Button disabled={saving || deleting} onClick={onClose} type="button" variant="outline">Cancel</Button><Button disabled={saving || deleting || !form.title.trim() || !form.startLocal || !form.endLocal} type="submit">{saving ? 'Saving…' : 'Save schedule'}</Button></div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
