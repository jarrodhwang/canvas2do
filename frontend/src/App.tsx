import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Activity,
  BarChart3,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Languages,
  LayoutPanelTop,
  LogOut,
  MoreHorizontal,
  Moon,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  Sun,
  Trash2,
  Type as TypeIcon,
  UserRound,
} from 'lucide-react';
import { ApiError, authenticationRequiredEvent, canvasToDoApi } from './api/canvasToDoApi';
import type { AcademyPreferences, AuthSession, CanvasCalendarItem, CanvasTokenStatus } from './api/canvasToDoApi';
import { AccountSecurityPanel } from './components/AccountSecurityPanel';
import { CalendarShell } from './components/CalendarShell';
import { DateTimeField } from './components/DateTimeField';
import { LegacyAcademyImportPanel } from './components/LegacyAcademyImportPanel';
import type {
  ManualLectureClassType,
  ManualLectureSchedule,
  ManualLectureScheduleEntry,
  ManualLectureWeekday,
} from './components/ManualLectureDialog';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { CalendarProgressIndicator } from './components/CalendarProgressIndicator';
import {
  defaultCalendarProgressThresholds,
  type CalendarProgressDisplay,
  type CalendarProgressThresholds,
} from './components/calendarProgress';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from './components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { WorkspaceIcon } from './components/WorkspaceIcon';
import { useLanguage } from './context/LanguageContext';
import { useWorkspaceMode } from './context/WorkspaceModeContext';
import type { AgendaItem, BoardItem, CalendarDay, CalendarEvent, WorkspaceModeMockData } from './data/mockWorkspaceData';
import {
  canAccessSidebarItem,
  createAccessSet,
  filterModeForAccess,
  getFirstAccessibleSidebarItem,
} from './lib/accessControl';
import { badgeColorClasses, dotColorClasses } from './lib/colorStyles';
import { defaultGradeProgressColorThresholds } from './lib/gradeProgress';
import { appPath } from './lib/appPath';
import { cn } from './lib/utils';
import type { BoardColumnConfig, ColorToken, WorkspaceView } from './modes/types';
import { applyTheme, type AppTheme } from './theme';
import {
  academyNationOptions,
  getHolidayForDateByNation,
  languageOptions,
  type AcademyNation,
  type Language,
} from './i18n';

const AdminUsersView = lazy(() => import('./components/AdminUsersView').then((module) => ({ default: module.AdminUsersView })));
const AcademyGradesView = lazy(() => import('./components/AcademyGradesView').then((module) => ({ default: module.AcademyGradesView })));
const CanvasInboxView = lazy(() => import('./components/CanvasInboxView').then((module) => ({ default: module.CanvasInboxView })));
const CanvasPeopleView = lazy(() => import('./components/CanvasPeopleView').then((module) => ({ default: module.CanvasPeopleView })));
const CourseOverviewView = lazy(() => import('./components/CourseOverviewView').then((module) => ({ default: module.CourseOverviewView })));
const DashboardCards = lazy(() => import('./components/DashboardCards').then((module) => ({ default: module.DashboardCards })));

interface WorkspaceNavigation {
  modeId: string;
  sidebarItemId: string;
  view: WorkspaceView;
}

interface WorkspaceHistoryState {
  source: 'canvas-to-do';
  navigation: WorkspaceNavigation;
}

type CanvasCalendarLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';
type CalendarTodoStyle = 'comfortable' | 'compact';

// Keep the view-level timeout aligned with the API client's cancellation timeout.
// Canvas calendar aggregation can involve several paginated upstream requests, so
// a shorter UI timeout incorrectly reported an unavailable calendar while the
// request was still in progress.
const canvasCalendarLoadingTimeoutMs = 50_000;

interface CanvasCalendarPage {
  errorMessage?: string;
  isComplete?: boolean;
  items: CanvasCalendarItem[];
  requestedAt?: number;
  status: CanvasCalendarLoadStatus;
}

interface AcademyResponsiveState {
  isCalendarAutoExpanded: boolean;
  isDayTodoDialogMode: boolean;
  isExtraLarge: boolean;
  isLarge: boolean;
  isPhoneAcademyMode: boolean;
  isTwoExtraLarge: boolean;
}

interface AcademyCalendarSettings {
  accentColor: ColorToken;
  academyLogoSrc: string;
  autoRefreshIntervalMs: number;
  refocusRefreshThrottleMs: number;
  courseworkHideCompletedAfterHours: number;
  courseworkHideCompletedFrom: 'completedAt' | 'dueAt';
  courseworkHideUncompletedAfterHours: number;
  courseworkShowStudyItems: boolean;
  fontFamily: AcademyFontFamily;
  fontSizePercent: number;
  hiddenCourseIds?: string[];
  gradeProgressGreenAt: number;
  gradeProgressYellowAt: number;
  language: Language;
  nation: AcademyNation;
  calendarTodoStyle: CalendarTodoStyle;
  skipClassOnHolidays: boolean;
  showPastTermCalendarItems: boolean;
  progressDisplay: CalendarProgressDisplay;
  progressGreenAt: number;
  progressYellowAt: number;
  selectedSemester?: string;
  themeMode: AppTheme;
  themeTimerEnabled: boolean;
  themeTimerEnd: string;
  themeTimerMode: AppTheme;
  themeTimerStart: string;
  topBarDefaultCollapsed: boolean;
}

type AcademyFontFamily =
  | 'aptos'
  | 'geist'
  | 'gmarket-sans'
  | 'humanist'
  | 'inter'
  | 'mono'
  | 'nanum-gothic'
  | 'noto-sans'
  | 'noto-sans-kr'
  | 'noto-serif'
  | 'noto-serif-kr'
  | 'pretendard'
  | 'roboto'
  | 'rounded'
  | 'segoe'
  | 'serif'
  | 'sf-pro'
  | 'system';

function isWorkspaceHistoryState(value: unknown): value is WorkspaceHistoryState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const state = value as Partial<WorkspaceHistoryState>;

  return state.source === 'canvas-to-do'
    && Boolean(state.navigation)
    && typeof state.navigation?.modeId === 'string'
    && typeof state.navigation?.sidebarItemId === 'string'
    && typeof state.navigation?.view === 'string';
}

function getInitialAuthRedirectMessage() {
  if (typeof window === 'undefined') {
    return null;
  }

  const authError = new URLSearchParams(window.location.search).get('authError');

  return authError?.trim() || null;
}

interface CanvasRedirectFeedback {
  message: string;
  returnToSettings: boolean;
  tone: 'error' | 'success';
}

function getInitialCanvasRedirectFeedback(): CanvasRedirectFeedback | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const error = params.get('canvasError')?.trim();
  const connected = params.get('canvasConnected') === 'true';

  if (!error && !connected) {
    return null;
  }

  return {
    message: error || 'Your SFU Canvas account is connected.',
    returnToSettings: params.get('canvasReturn') === 'settings',
    tone: error ? 'error' : 'success',
  };
}

const monthIndexes: Record<string, number> = {
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
};

const englishMonthLabels = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const canvasCalendarTypeColors: Record<string, ColorToken> = {
  activity: 'gold',
  assignment: 'blue',
  discussion: 'purple',
  event: 'teal',
  exam: 'red',
  lab: 'teal',
  lecture: 'green',
  meeting: 'teal',
  quiz: 'orange',
};
const calendarTodoTypes = [
  'assignment',
  'discussion',
  'activity',
  'study',
  'lab',
  'tutorial',
  'essay',
  'presentation',
  'project',
  'quiz',
  'midterm',
  'final_exam',
  'exam',
];
const manualLectureClassTypeLabels: Record<ManualLectureClassType, string> = {
  lab: 'Lab',
  lecture: 'Lecture',
  seminar: 'Seminar',
  tutorial: 'Tutorial',
};
const manualLectureWeekdayIndexes: Record<ManualLectureWeekday, number> = {
  Fri: 5,
  Mon: 1,
  Sat: 6,
  Sun: 0,
  Thu: 4,
  Tue: 2,
  Wed: 3,
};
const manualLectureWeekdayAliases: Record<string, ManualLectureWeekday> = {
  friday: 'Fri',
  fri: 'Fri',
  monday: 'Mon',
  mon: 'Mon',
  saturday: 'Sat',
  sat: 'Sat',
  sunday: 'Sun',
  sun: 'Sun',
  thursday: 'Thu',
  thu: 'Thu',
  thur: 'Thu',
  thurs: 'Thu',
  tuesday: 'Tue',
  tue: 'Tue',
  tues: 'Tue',
  wednesday: 'Wed',
  wed: 'Wed',
};

interface StoredCoursePreference {
  assessmentType?: string;
  archivedAsManualLectureId?: string;
  chipColor?: ColorToken;
  code?: string;
  completed?: boolean;
  completedAt?: string;
  courseCode?: string;
  courseId?: string;
  courseName?: string;
  courseworkType?: string;
  credits?: string;
  currentGrade?: string;
  currentScore?: number;
  convertedToManualAt?: string;
  deleted?: boolean;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  friendlyCourseCode?: string;
  friendlyName?: string;
  htmlUrl?: string;
  hidden?: boolean;
  id?: string;
  isSubmitted?: boolean;
  links?: Array<{
    id?: string;
    label?: string;
    url?: string;
  }>;
  schedule?: ManualLectureSchedule;
  originalCourseCode?: string;
  semester?: string;
  semesterSource?: 'canvas' | 'fallback' | 'manual';
  starred?: boolean;
  submissionType?: string;
  termName?: string;
  title?: string;
  workflowState?: string;
}

interface StoredManualCoursework {
  id: string;
  title: string;
  courseCode?: string;
  courseName?: string;
  chipColor?: ColorToken;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  courseworkType?: string;
  submissionType?: string;
  completed?: boolean;
  completedAt?: string;
  hidden?: boolean;
  retainedFromCanvasCourseId?: string;
  semester?: string;
  starred?: boolean;
}

interface StoredManualAssessment {
  id: string;
  title: string;
  courseCode?: string;
  courseName?: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  assessmentType?: string;
  completed?: boolean;
  completedAt?: string;
  hidden?: boolean;
  retainedFromCanvasCourseId?: string;
  semester?: string;
  starred?: boolean;
}

interface CalendarSourceItem {
  id: string;
  source: 'canvas' | 'manual-coursework' | 'manual-assessment' | 'class-session';
  title: string;
  type: string;
  courseId?: string;
  courseCode?: string;
  courseName?: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  htmlUrl?: string;
  holidayName?: string;
  location?: string;
  semester?: string;
  color: ColorToken;
  displayStyle?: 'dot';
  isCanceledForHoliday?: boolean;
  isCompleted?: boolean;
  isArchivedCanvasItem?: boolean;
  isLocked?: boolean;
  isStarred?: boolean;
}

interface CalendarCourseFilterOption {
  canAdd?: boolean;
  checked: boolean;
  color: ColorToken;
  id: string;
  label: string;
}

function isLiveCanvasCalendarItem(item?: CalendarSourceItem | null) {
  return item?.source === 'canvas' && !item.isArchivedCanvasItem;
}

interface SelectedDayCourseGroup {
  canAdd?: boolean;
  color: ColorToken;
  items: CalendarSourceItem[];
  label: string;
}

const manualLecturesStorageKey = 'canvas-to-do-manual-lectures';
const canvasLecturePreferencesStorageKey = 'canvas-to-do-canvas-lecture-preferences';
const manualCourseworkStorageKey = 'canvas-to-do-manual-coursework';
const canvasCourseworkPreferencesStorageKey = 'canvas-to-do-canvas-coursework-preferences';
const manualAssessmentsStorageKey = 'canvas-to-do-manual-assessments';
const canvasAssessmentPreferencesStorageKey = 'canvas-to-do-canvas-assessment-preferences';
const academyCalendarSettingsStorageKey = 'canvas-to-do-calendar-settings';
const academyCalendarHiddenCoursesStorageKey = 'canvas-to-do-calendar-hidden-courses';
const academyPreferencesUpdatedEvent = 'canvas-to-do-preferences-updated';
const academyOpenCourseworkDialogEvent = 'canvas-to-do-open-coursework-dialog';
const academyRefreshRequestedEvent = 'canvas-to-do-refresh-requested';
type AcademyOpenCourseworkDialogDetail = {
  courseCode?: string;
  dueAt?: string;
  startAt?: string;
  title?: string;
};
type AcademyRefreshRequestedDetail = {
  forceRefresh?: boolean;
  registerTask?: (task: Promise<unknown>) => void;
};
const minimumAcademyAutoRefreshIntervalMs = 60_000;
const maximumAcademyAutoRefreshIntervalMs = 30 * 60_000;
const defaultAcademyAutoRefreshIntervalMs = 10 * 60_000;
const minimumAcademyRefocusRefreshThrottleMs = 30_000;
const maximumAcademyRefocusRefreshThrottleMs = 60 * 60_000;
const defaultAcademyRefocusRefreshThrottleMs = 5 * 60_000;
const academyAutoRefreshIntervalOptions = [
  60_000,
  5 * 60_000,
  10 * 60_000,
  30 * 60_000,
];
const academyRefocusRefreshThrottleOptions = [
  30_000,
  60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
];
const academyResumeAuthRetryDelays = [0, 1000, 2500];
const academyFontFamilyOptions: Array<{ value: AcademyFontFamily; label: string; cssValue: string }> = [
  { value: 'gmarket-sans', label: 'Gmarket Sans', cssValue: '"Gmarket Sans", "GmarketSansMedium", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif' },
  { value: 'inter', label: 'Inter', cssValue: '"Inter Variable", sans-serif' },
  { value: 'geist', label: 'Geist', cssValue: '"Geist Variable", sans-serif' },
  { value: 'system', label: 'System', cssValue: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { value: 'sf-pro', label: 'SF Pro', cssValue: '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif' },
  { value: 'segoe', label: 'Segoe UI', cssValue: '"Segoe UI", system-ui, -apple-system, sans-serif' },
  { value: 'aptos', label: 'Aptos', cssValue: 'Aptos, "Segoe UI", system-ui, sans-serif' },
  { value: 'roboto', label: 'Roboto', cssValue: 'Roboto, "Noto Sans", Arial, sans-serif' },
  { value: 'noto-sans', label: 'Noto Sans', cssValue: '"Noto Sans", "Noto Sans KR", Arial, sans-serif' },
  { value: 'pretendard', label: 'Pretendard', cssValue: '"Pretendard Variable", Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif' },
  { value: 'noto-sans-kr', label: 'Noto Sans KR', cssValue: '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif' },
  { value: 'nanum-gothic', label: 'Nanum Gothic', cssValue: '"Nanum Gothic", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif' },
  { value: 'rounded', label: 'Rounded', cssValue: '"SF Pro Rounded", "Nunito Sans", "Avenir Next Rounded Std", system-ui, sans-serif' },
  { value: 'humanist', label: 'Humanist', cssValue: '"Avenir Next", Avenir, "Gill Sans", "Segoe UI", sans-serif' },
  { value: 'serif', label: 'Serif', cssValue: 'Georgia, "Times New Roman", serif' },
  { value: 'noto-serif', label: 'Noto Serif', cssValue: '"Noto Serif", Georgia, "Times New Roman", serif' },
  { value: 'noto-serif-kr', label: 'Noto Serif KR', cssValue: '"Noto Serif KR", "Apple Myungjo", "Batang", serif' },
  { value: 'mono', label: 'Mono', cssValue: '"SFMono-Regular", Consolas, "Liberation Mono", monospace' },
];
const academyFontFamilyValues = academyFontFamilyOptions.map((option) => option.value);
const academyNationValues = academyNationOptions.map((option) => option.value);
const academyFontFamilyCss = Object.fromEntries(
  academyFontFamilyOptions.map((option) => [option.value, option.cssValue]),
) as Record<AcademyFontFamily, string>;
const academyFontSizeOptions = [85, 95, 100, 110, 120];
const defaultAcademySemester = getDateBasedAcademySemester();
const defaultCanvasTermSemester = 'Default Term';
const defaultAcademyTabIconSrc = appPath('/brand/canvas-to-do-icon.svg');
const academyAccentColors: ColorToken[] = [
  'gold',
  'butter',
  'sage',
  'powder',
  'blush',
  'red',
  'orange',
  'emerald',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'purple',
  'pink',
  'slate',
  'gray',
];
const academyAccentColorVariantPages: ColorToken[][] = [
  ['butter', 'vanilla', 'cream', 'honeydew', 'pistachio', 'sage', 'seafoam', 'powder', 'babyblue', 'periwinkle', 'wisteria', 'blush', 'cottoncandy'],
  ['peachfuzz', 'softcoral', 'flamingo', 'watermelon', 'tangerine', 'marigold', 'citron', 'neomint', 'jade', 'lagoon', 'serenity', 'veryperi', 'orchid', 'amethyst'],
  ['crimson', 'rose', 'coral', 'peach', 'apricot', 'amber', 'yellow', 'lemon', 'lime', 'olive', 'moss', 'forest'],
  ['green', 'emerald', 'mint', 'teal', 'turquoise', 'aqua', 'cyan', 'ice', 'sky', 'ocean', 'blue', 'cobalt'],
  ['navy', 'indigo', 'violet', 'purple', 'lavender', 'lilac', 'plum', 'fuchsia', 'magenta', 'pink', 'mauve', 'red'],
  ['sand', 'cocoa', 'stone', 'zinc', 'neutral', 'slate', 'graphite', 'midnight', 'gray', 'gold', 'orange', 'teal'],
];
const academyAccentColorOptions = Array.from(new Set([
  ...academyAccentColors,
  ...academyAccentColorVariantPages.flat(),
]));
const academyAccentThemeVariables: Record<ColorToken, {
  primary: string;
  primaryForeground: string;
}> = {
  blue: { primary: 'oklch(0.623 0.214 259.815)', primaryForeground: 'oklch(0.985 0 0)' },
  sky: { primary: 'oklch(0.685 0.169 237.323)', primaryForeground: 'oklch(0.985 0 0)' },
  cyan: { primary: 'oklch(0.715 0.143 215.221)', primaryForeground: 'oklch(0.145 0 0)' },
  green: { primary: 'oklch(0.696 0.17 162.48)', primaryForeground: 'oklch(0.985 0 0)' },
  emerald: { primary: 'oklch(0.696 0.17 162.48)', primaryForeground: 'oklch(0.985 0 0)' },
  indigo: { primary: 'oklch(0.585 0.233 277.117)', primaryForeground: 'oklch(0.985 0 0)' },
  amber: { primary: 'oklch(0.769 0.188 70.08)', primaryForeground: 'oklch(0.145 0 0)' },
  yellow: { primary: 'oklch(0.852 0.199 91.936)', primaryForeground: 'oklch(0.421 0.095 57.708)' },
  lime: { primary: 'oklch(0.768 0.233 130.85)', primaryForeground: 'oklch(0.145 0 0)' },
  orange: { primary: 'oklch(0.705 0.213 47.604)', primaryForeground: 'oklch(0.985 0 0)' },
  red: { primary: 'oklch(0.637 0.237 25.331)', primaryForeground: 'oklch(0.985 0 0)' },
  rose: { primary: 'oklch(0.645 0.246 16.439)', primaryForeground: 'oklch(0.985 0 0)' },
  crimson: { primary: 'oklch(0.596 0.22 19)', primaryForeground: 'oklch(0.985 0 0)' },
  coral: { primary: 'oklch(0.704 0.18 31)', primaryForeground: 'oklch(0.985 0 0)' },
  peach: { primary: 'oklch(0.79 0.122 45)', primaryForeground: 'oklch(0.21 0.03 50)' },
  apricot: { primary: 'oklch(0.755 0.13 55)', primaryForeground: 'oklch(0.21 0.03 50)' },
  purple: { primary: 'oklch(0.627 0.265 303.9)', primaryForeground: 'oklch(0.985 0 0)' },
  violet: { primary: 'oklch(0.606 0.25 292.717)', primaryForeground: 'oklch(0.985 0 0)' },
  fuchsia: { primary: 'oklch(0.667 0.295 322.15)', primaryForeground: 'oklch(0.985 0 0)' },
  pink: { primary: 'oklch(0.656 0.241 354.308)', primaryForeground: 'oklch(0.985 0 0)' },
  magenta: { primary: 'oklch(0.667 0.295 322.15)', primaryForeground: 'oklch(0.985 0 0)' },
  lavender: { primary: 'oklch(0.673 0.182 276.935)', primaryForeground: 'oklch(0.985 0 0)' },
  lilac: { primary: 'oklch(0.686 0.21 289)', primaryForeground: 'oklch(0.985 0 0)' },
  plum: { primary: 'oklch(0.514 0.237 300)', primaryForeground: 'oklch(0.985 0 0)' },
  mauve: { primary: 'oklch(0.61 0.11 10)', primaryForeground: 'oklch(0.985 0 0)' },
  teal: { primary: 'oklch(0.704 0.14 182.503)', primaryForeground: 'oklch(0.145 0 0)' },
  mint: { primary: 'oklch(0.78 0.13 174)', primaryForeground: 'oklch(0.145 0 0)' },
  aqua: { primary: 'oklch(0.715 0.143 215.221)', primaryForeground: 'oklch(0.145 0 0)' },
  turquoise: { primary: 'oklch(0.704 0.14 182.503)', primaryForeground: 'oklch(0.145 0 0)' },
  ocean: { primary: 'oklch(0.623 0.18 243)', primaryForeground: 'oklch(0.985 0 0)' },
  cobalt: { primary: 'oklch(0.623 0.214 259.815)', primaryForeground: 'oklch(0.985 0 0)' },
  navy: { primary: 'oklch(0.45 0.18 264)', primaryForeground: 'oklch(0.985 0 0)' },
  gold: { primary: 'oklch(0.852 0.199 91.936)', primaryForeground: 'oklch(0.421 0.095 57.708)' },
  lemon: { primary: 'oklch(0.89 0.19 100)', primaryForeground: 'oklch(0.25 0.04 80)' },
  olive: { primary: 'oklch(0.68 0.17 128)', primaryForeground: 'oklch(0.985 0 0)' },
  moss: { primary: 'oklch(0.56 0.15 130)', primaryForeground: 'oklch(0.985 0 0)' },
  forest: { primary: 'oklch(0.55 0.17 145)', primaryForeground: 'oklch(0.985 0 0)' },
  slate: { primary: 'oklch(0.554 0.046 257.417)', primaryForeground: 'oklch(0.985 0 0)' },
  zinc: { primary: 'oklch(0.552 0.016 285.938)', primaryForeground: 'oklch(0.985 0 0)' },
  neutral: { primary: 'oklch(0.556 0 0)', primaryForeground: 'oklch(0.985 0 0)' },
  stone: { primary: 'oklch(0.553 0.013 58.071)', primaryForeground: 'oklch(0.985 0 0)' },
  graphite: { primary: 'oklch(0.37 0.03 260)', primaryForeground: 'oklch(0.985 0 0)' },
  cocoa: { primary: 'oklch(0.42 0.1 45)', primaryForeground: 'oklch(0.985 0 0)' },
  sand: { primary: 'oklch(0.72 0.095 80)', primaryForeground: 'oklch(0.2 0.025 70)' },
  midnight: { primary: 'oklch(0.32 0.055 260)', primaryForeground: 'oklch(0.985 0 0)' },
  ice: { primary: 'oklch(0.86 0.08 210)', primaryForeground: 'oklch(0.2 0.04 230)' },
  butter: { primary: 'oklch(0.86 0.18 88)', primaryForeground: 'oklch(0.24 0.055 72)' },
  vanilla: { primary: 'oklch(0.9 0.105 92)', primaryForeground: 'oklch(0.28 0.05 76)' },
  cream: { primary: 'oklch(0.92 0.065 88)', primaryForeground: 'oklch(0.3 0.035 70)' },
  honeydew: { primary: 'oklch(0.88 0.13 128)', primaryForeground: 'oklch(0.25 0.06 130)' },
  pistachio: { primary: 'oklch(0.82 0.105 128)', primaryForeground: 'oklch(0.25 0.055 130)' },
  sage: { primary: 'oklch(0.75 0.055 130)', primaryForeground: 'oklch(0.23 0.035 130)' },
  seafoam: { primary: 'oklch(0.84 0.105 160)', primaryForeground: 'oklch(0.22 0.055 160)' },
  powder: { primary: 'oklch(0.83 0.085 235)', primaryForeground: 'oklch(0.22 0.055 235)' },
  babyblue: { primary: 'oklch(0.82 0.08 255)', primaryForeground: 'oklch(0.23 0.06 255)' },
  periwinkle: { primary: 'oklch(0.79 0.095 280)', primaryForeground: 'oklch(0.23 0.07 280)' },
  wisteria: { primary: 'oklch(0.82 0.085 300)', primaryForeground: 'oklch(0.24 0.065 300)' },
  blush: { primary: 'oklch(0.84 0.085 350)', primaryForeground: 'oklch(0.26 0.065 350)' },
  cottoncandy: { primary: 'oklch(0.8 0.105 345)', primaryForeground: 'oklch(0.25 0.07 345)' },
  peachfuzz: { primary: 'oklch(0.79 0.12 48)', primaryForeground: 'oklch(0.24 0.045 45)' },
  softcoral: { primary: 'oklch(0.73 0.16 28)', primaryForeground: 'oklch(0.985 0 0)' },
  flamingo: { primary: 'oklch(0.69 0.18 10)', primaryForeground: 'oklch(0.985 0 0)' },
  watermelon: { primary: 'oklch(0.66 0.21 6)', primaryForeground: 'oklch(0.985 0 0)' },
  tangerine: { primary: 'oklch(0.75 0.17 55)', primaryForeground: 'oklch(0.22 0.04 52)' },
  marigold: { primary: 'oklch(0.76 0.16 78)', primaryForeground: 'oklch(0.22 0.04 70)' },
  citron: { primary: 'oklch(0.82 0.16 122)', primaryForeground: 'oklch(0.2 0.05 125)' },
  neomint: { primary: 'oklch(0.82 0.12 165)', primaryForeground: 'oklch(0.2 0.055 165)' },
  jade: { primary: 'oklch(0.72 0.13 168)', primaryForeground: 'oklch(0.985 0 0)' },
  lagoon: { primary: 'oklch(0.72 0.13 205)', primaryForeground: 'oklch(0.18 0.045 205)' },
  serenity: { primary: 'oklch(0.72 0.09 260)', primaryForeground: 'oklch(0.22 0.06 260)' },
  veryperi: { primary: 'oklch(0.55 0.16 285)', primaryForeground: 'oklch(0.985 0 0)' },
  orchid: { primary: 'oklch(0.65 0.16 315)', primaryForeground: 'oklch(0.985 0 0)' },
  amethyst: { primary: 'oklch(0.59 0.16 300)', primaryForeground: 'oklch(0.985 0 0)' },
  gray: { primary: 'oklch(0.556 0 0)', primaryForeground: 'oklch(0.985 0 0)' },
};

const defaultAcademyCalendarSettings: AcademyCalendarSettings = {
  accentColor: 'gold',
  academyLogoSrc: '',
  autoRefreshIntervalMs: defaultAcademyAutoRefreshIntervalMs,
  refocusRefreshThrottleMs: defaultAcademyRefocusRefreshThrottleMs,
  courseworkHideCompletedAfterHours: 12,
  courseworkHideCompletedFrom: 'dueAt',
  courseworkHideUncompletedAfterHours: 16,
  courseworkShowStudyItems: true,
  fontFamily: 'inter',
  fontSizePercent: 100,
  gradeProgressGreenAt: defaultGradeProgressColorThresholds.greenAt,
  gradeProgressYellowAt: defaultGradeProgressColorThresholds.yellowAt,
  language: 'en',
  nation: 'ca',
  calendarTodoStyle: 'compact',
  skipClassOnHolidays: true,
  showPastTermCalendarItems: false,
  progressDisplay: 'linear',
  progressGreenAt: defaultCalendarProgressThresholds.greenAt,
  progressYellowAt: defaultCalendarProgressThresholds.yellowAt,
  themeMode: 'dark',
  themeTimerEnabled: false,
  themeTimerEnd: '18:00',
  themeTimerMode: 'light',
  themeTimerStart: '08:00',
  topBarDefaultCollapsed: false,
};
const calendarAutoExpandMaxWidth = 1279;
const calendarAutoExpandMaxHeight = 860;
const dayTodoDialogMaxWidth = 1535;
const phoneAcademyMaxWidth = 520;
const largeViewportMinWidth = 1024;
const extraLargeViewportMinWidth = 1280;
const twoExtraLargeViewportMinWidth = 1536;
const academyPreferenceStorageKeys = new Set([
  manualLecturesStorageKey,
  canvasLecturePreferencesStorageKey,
  manualCourseworkStorageKey,
  canvasCourseworkPreferencesStorageKey,
  manualAssessmentsStorageKey,
  canvasAssessmentPreferencesStorageKey,
  academyCalendarSettingsStorageKey,
]);

interface AcademyPreferenceCache {
  canvasAssessmentPreferences: Record<string, StoredCoursePreference>;
  canvasCourseworkPreferences: Record<string, StoredCoursePreference>;
  canvasLecturePreferences: Record<string, StoredCoursePreference>;
  calendarSettings: AcademyCalendarSettings;
  manualAssessments: StoredManualAssessment[];
  manualCoursework: StoredManualCoursework[];
  manualLectures: StoredCoursePreference[];
}

function createEmptyAcademyPreferenceCache(
  calendarSettings: AcademyCalendarSettings = defaultAcademyCalendarSettings,
): AcademyPreferenceCache {
  return {
    canvasAssessmentPreferences: {},
    canvasCourseworkPreferences: {},
    canvasLecturePreferences: {},
    calendarSettings,
    manualAssessments: [],
    manualCoursework: [],
    manualLectures: [],
  };
}

let academyPreferenceCache: AcademyPreferenceCache = createEmptyAcademyPreferenceCache();

function resetAcademyPreferenceCache() {
  academyPreferenceCache = createEmptyAcademyPreferenceCache();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasMeaningfulSettingsRecord(value: unknown) {
  return isRecord(value) && Object.keys(value).length > 0;
}

function getAcademyPreferenceCacheValue<T>(key: string, fallback: T): T {
  switch (key) {
    case manualLecturesStorageKey:
      return academyPreferenceCache.manualLectures as T;
    case canvasLecturePreferencesStorageKey:
      return academyPreferenceCache.canvasLecturePreferences as T;
    case manualCourseworkStorageKey:
      return academyPreferenceCache.manualCoursework as T;
    case canvasCourseworkPreferencesStorageKey:
      return academyPreferenceCache.canvasCourseworkPreferences as T;
    case manualAssessmentsStorageKey:
      return academyPreferenceCache.manualAssessments as T;
    case canvasAssessmentPreferencesStorageKey:
      return academyPreferenceCache.canvasAssessmentPreferences as T;
    case academyCalendarSettingsStorageKey:
      return academyPreferenceCache.calendarSettings as T;
    default:
      return fallback;
  }
}

function setAcademyPreferenceCacheValue(key: string, value: unknown) {
  switch (key) {
    case manualLecturesStorageKey:
      academyPreferenceCache.manualLectures = Array.isArray(value) ? value as StoredCoursePreference[] : [];
      break;
    case canvasLecturePreferencesStorageKey:
      academyPreferenceCache.canvasLecturePreferences = isRecord(value)
        ? value as Record<string, StoredCoursePreference>
        : {};
      break;
    case manualCourseworkStorageKey:
      academyPreferenceCache.manualCoursework = Array.isArray(value) ? value as StoredManualCoursework[] : [];
      break;
    case canvasCourseworkPreferencesStorageKey:
      academyPreferenceCache.canvasCourseworkPreferences = isRecord(value)
        ? value as Record<string, StoredCoursePreference>
        : {};
      break;
    case manualAssessmentsStorageKey:
      academyPreferenceCache.manualAssessments = Array.isArray(value) ? value as StoredManualAssessment[] : [];
      break;
    case canvasAssessmentPreferencesStorageKey:
      academyPreferenceCache.canvasAssessmentPreferences = isRecord(value)
        ? value as Record<string, StoredCoursePreference>
        : {};
      break;
    case academyCalendarSettingsStorageKey:
      academyPreferenceCache.calendarSettings = hasMeaningfulSettingsRecord(value)
        ? normalizeAcademyCalendarSettings(value, academyPreferenceCache.calendarSettings)
        : academyPreferenceCache.calendarSettings;
      break;
    default:
      break;
  }
}

function getAcademyPreferenceEventDetail() {
  return {
    canvasAssessmentPreferences: academyPreferenceCache.canvasAssessmentPreferences,
    canvasCourseworkPreferences: academyPreferenceCache.canvasCourseworkPreferences,
    canvasLecturePreferences: academyPreferenceCache.canvasLecturePreferences,
    calendarSettings: academyPreferenceCache.calendarSettings,
    manualAssessments: academyPreferenceCache.manualAssessments,
    manualCoursework: academyPreferenceCache.manualCoursework,
    manualLectures: academyPreferenceCache.manualLectures,
  };
}

function dispatchAcademyPreferencesUpdated() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(academyPreferencesUpdatedEvent, {
    detail: getAcademyPreferenceEventDetail(),
  }));
}

function getDateBasedAcademySemester(date = new Date()) {
  const month = date.getMonth();
  const term = month <= 3 ? 'Spring' : month <= 7 ? 'Summer' : 'Fall';

  return `${term} ${date.getFullYear()}`;
}

function normalizeSemesterName(value?: string, fallback = defaultAcademySemester) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return fallback;
  }

  if (/^default term$/i.test(trimmedValue)) {
    return defaultCanvasTermSemester;
  }

  return trimmedValue;
}

function semesterMatches(value: string | undefined, selectedSemester: string | undefined, fallback = defaultAcademySemester) {
  return normalizeSemesterName(value, fallback) === normalizeSemesterName(selectedSemester, fallback);
}

function getEffectiveAcademyViewport() {
  if (typeof window === 'undefined') {
    return {
      height: 900,
      width: 1440,
    };
  }

  return {
    height: window.innerHeight,
    width: window.innerWidth,
  };
}

function getAcademyResponsiveState(): AcademyResponsiveState {
  const viewport = getEffectiveAcademyViewport();

  return {
    isCalendarAutoExpanded:
      viewport.width <= calendarAutoExpandMaxWidth ||
      viewport.height <= calendarAutoExpandMaxHeight,
    isDayTodoDialogMode: viewport.width <= dayTodoDialogMaxWidth,
    isExtraLarge: viewport.width >= extraLargeViewportMinWidth,
    isLarge: viewport.width >= largeViewportMinWidth,
    isPhoneAcademyMode: viewport.width <= phoneAcademyMaxWidth,
    isTwoExtraLarge: viewport.width >= twoExtraLargeViewportMinWidth,
  };
}

function updateDocumentLink(rel: string, href: string) {
  let linkElement = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);

  if (!linkElement) {
    linkElement = document.createElement('link');
    linkElement.rel = rel;
    document.head.appendChild(linkElement);
  }

  linkElement.href = href;
}

function updateDocumentMeta(name: string, content: string) {
  let metaElement = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);

  if (!metaElement) {
    metaElement = document.createElement('meta');
    metaElement.name = name;
    document.head.appendChild(metaElement);
  }

  metaElement.content = content;
}

function applyDocumentBranding({
  iconSrc,
  title,
  touchIconSrc,
}: {
  iconSrc: string;
  title: string;
  touchIconSrc: string;
}) {
  document.title = title;
  updateDocumentLink('icon', iconSrc);
  updateDocumentLink('apple-touch-icon', touchIconSrc);
  updateDocumentMeta('application-name', title);
  updateDocumentMeta('apple-mobile-web-app-title', title);
}

function getCalendarMonthFromLabel(data: WorkspaceModeMockData) {
  const [rawMonth, rawYear] = data.monthLabel.split(/\s+/);
  const monthIndex = monthIndexes[rawMonth?.toLowerCase() ?? ''];
  const year = Number.parseInt(rawYear ?? '', 10);

  if (!Number.isInteger(monthIndex) || !Number.isInteger(year)) {
    return undefined;
  }

  return new Date(Date.UTC(year, monthIndex, 1));
}

function getInitialCalendarMonth(data: WorkspaceModeMockData) {
  const now = new Date();

  if (!Number.isNaN(now.getTime())) {
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  }

  const monthFromLabel = getCalendarMonthFromLabel(data);

  return monthFromLabel ?? new Date(Date.UTC(2026, 5, 1));
}

function getCalendarMonthRange(monthDate: Date) {
  const year = monthDate.getUTCFullYear();
  const monthIndex = monthDate.getUTCMonth();

  return {
    endDate: new Date(Date.UTC(year, monthIndex + 1, 0)),
    startDate: new Date(Date.UTC(year, monthIndex, 1)),
    monthIndex,
    year,
  };
}

function getCalendarMonthKey(monthDate: Date) {
  return formatDateParam(getCalendarMonthRange(monthDate).startDate);
}

function getCalendarGridStartDate(monthDate: Date) {
  const monthRange = getCalendarMonthRange(monthDate);
  const firstWeekday = monthRange.startDate.getUTCDay();
  const mondayOffset = (firstWeekday + 6) % 7;

  return new Date(Date.UTC(monthRange.year, monthRange.monthIndex, 1 - mondayOffset));
}

function getCalendarGridRange(monthDate: Date) {
  const startDate = getCalendarGridStartDate(monthDate);
  const endDate = new Date(Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate() + 41,
  ));

  return { endDate, startDate };
}

function getVisibleCalendarMonths(monthDate: Date) {
  const gridStartDate = getCalendarGridStartDate(monthDate);
  const visibleMonths = new Map<string, Date>();

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(Date.UTC(
      gridStartDate.getUTCFullYear(),
      gridStartDate.getUTCMonth(),
      gridStartDate.getUTCDate() + index,
    ));
    const monthStartDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

    visibleMonths.set(getCalendarMonthKey(monthStartDate), monthStartDate);
  }

  return [...visibleMonths.values()].sort((firstMonth, secondMonth) => (
    firstMonth.getTime() - secondMonth.getTime()
  ));
}

function getCanvasCalendarItemsForMonthKeys(
  pages: Record<string, CanvasCalendarPage>,
  monthKeys: string[],
) {
  const itemsById = new Map<string, CanvasCalendarItem>();

  monthKeys.forEach((monthKey) => {
    pages[monthKey]?.items.forEach((item) => {
      itemsById.set(item.id, item);
    });
  });

  return [...itemsById.values()];
}

function addCalendarMonths(monthDate: Date, amount: number) {
  return new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + amount, 1));
}

function formatCalendarMonthLabel(monthDate: Date) {
  return `${englishMonthLabels[monthDate.getUTCMonth()]} ${monthDate.getUTCFullYear()}`;
}

function formatDateParam(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeCourseCode(value: string) {
  return value.replace(/\s+/g, '').toLowerCase();
}

function getCourseCodeRoot(value: string) {
  const match = value.match(/[a-z]{2,}\s*\d{2,4}[a-z]?/i);

  return match ? normalizeCourseCode(match[0]) : undefined;
}

function getCourseCodeCandidates(value?: string) {
  if (!value) {
    return [];
  }

  return [normalizeCourseCode(value), getCourseCodeRoot(value)].filter(Boolean) as string[];
}

function codesMatch(firstCode?: string, secondCode?: string) {
  const firstCandidates = getCourseCodeCandidates(firstCode);
  const secondCandidates = getCourseCodeCandidates(secondCode);

  return firstCandidates.some((candidate) => secondCandidates.includes(candidate));
}

function valuesMatchExactly(firstValue?: string, secondValue?: string) {
  if (!firstValue || !secondValue) {
    return false;
  }

  return normalizeCourseCode(firstValue) === normalizeCourseCode(secondValue);
}

function readStoredJson<T>(key: string, fallback: T): T {
  if (academyPreferenceStorageKeys.has(key)) {
    return getAcademyPreferenceCacheValue(key, fallback);
  }

  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const storedValue = window.localStorage.getItem(key);

    return storedValue ? JSON.parse(storedValue) as T : fallback;
  } catch {
    return fallback;
  }
}

function getStoredCanvasLecturePreferences() {
  const storedCanvasPreferences = readStoredJson<unknown>(canvasLecturePreferencesStorageKey, {});

  return storedCanvasPreferences &&
    typeof storedCanvasPreferences === 'object' &&
    !Array.isArray(storedCanvasPreferences)
    ? storedCanvasPreferences as Record<string, StoredCoursePreference>
    : {};
}

function getStoredManualLectures() {
  const storedManualLectures = readStoredJson<unknown>(manualLecturesStorageKey, []);

  return Array.isArray(storedManualLectures)
    ? storedManualLectures as StoredCoursePreference[]
    : [];
}

function getStoredManualCoursework() {
  const storedCoursework = readStoredJson<unknown>(manualCourseworkStorageKey, []);

  return Array.isArray(storedCoursework)
    ? storedCoursework as StoredManualCoursework[]
    : [];
}

function getStoredManualAssessments() {
  const storedAssessments = readStoredJson<unknown>(manualAssessmentsStorageKey, []);

  return Array.isArray(storedAssessments)
    ? storedAssessments as StoredManualAssessment[]
    : [];
}

function getStoredCanvasCourseworkPreferences() {
  const storedPreferences = readStoredJson<unknown>(canvasCourseworkPreferencesStorageKey, {});

  return storedPreferences &&
    typeof storedPreferences === 'object' &&
    !Array.isArray(storedPreferences)
    ? storedPreferences as Record<string, StoredCoursePreference>
    : {};
}

function getStoredCanvasAssessmentPreferences() {
  const storedPreferences = readStoredJson<unknown>(canvasAssessmentPreferencesStorageKey, {});

  return storedPreferences &&
    typeof storedPreferences === 'object' &&
    !Array.isArray(storedPreferences)
    ? storedPreferences as Record<string, StoredCoursePreference>
    : {};
}

function normalizeAcademyCalendarSettings(
  value: unknown,
  fallback: AcademyCalendarSettings = defaultAcademyCalendarSettings,
): AcademyCalendarSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }

  const settings = value as Partial<AcademyCalendarSettings>;
  const calendarTodoStyle: CalendarTodoStyle = settings.calendarTodoStyle === 'comfortable' || settings.calendarTodoStyle === 'compact'
    ? settings.calendarTodoStyle
    : fallback.calendarTodoStyle;
  const showPastTermCalendarItems = typeof settings.showPastTermCalendarItems === 'boolean'
    ? settings.showPastTermCalendarItems
    : fallback.showPastTermCalendarItems;
  const progressDisplay = settings.progressDisplay === 'circular' || settings.progressDisplay === 'linear'
    ? settings.progressDisplay
    : fallback.progressDisplay;
  const progressGreenAt = Number.isFinite(settings.progressGreenAt)
    ? Math.min(Math.max(Number(settings.progressGreenAt), 0), 100)
    : fallback.progressGreenAt;
  const progressYellowAt = Number.isFinite(settings.progressYellowAt)
    ? Math.min(Math.max(Number(settings.progressYellowAt), 0), progressGreenAt)
    : Math.min(fallback.progressYellowAt, progressGreenAt);
  const gradeProgressGreenAt = Number.isFinite(settings.gradeProgressGreenAt)
    ? Math.min(Math.max(Number(settings.gradeProgressGreenAt), 0), 100)
    : fallback.gradeProgressGreenAt;
  const gradeProgressYellowAt = Number.isFinite(settings.gradeProgressYellowAt)
    ? Math.min(Math.max(Number(settings.gradeProgressYellowAt), 0), gradeProgressGreenAt)
    : Math.min(fallback.gradeProgressYellowAt, gradeProgressGreenAt);
  const courseworkHideCompletedAfterHours = Number.isFinite(settings.courseworkHideCompletedAfterHours)
    ? Math.min(Math.max(Number(settings.courseworkHideCompletedAfterHours), 0), 720)
    : fallback.courseworkHideCompletedAfterHours;
  const courseworkHideUncompletedAfterHours = Number.isFinite(settings.courseworkHideUncompletedAfterHours)
    ? Math.min(Math.max(Number(settings.courseworkHideUncompletedAfterHours), 0), 720)
    : fallback.courseworkHideUncompletedAfterHours;
  const courseworkHideCompletedFrom = settings.courseworkHideCompletedFrom === 'completedAt' ||
    (settings.courseworkHideCompletedFrom !== 'dueAt' && fallback.courseworkHideCompletedFrom === 'completedAt')
    ? 'completedAt'
    : 'dueAt';
  const courseworkShowStudyItems = typeof settings.courseworkShowStudyItems === 'boolean'
    ? settings.courseworkShowStudyItems
    : fallback.courseworkShowStudyItems;
  const hiddenCourseIds = Array.isArray(settings.hiddenCourseIds)
    ? settings.hiddenCourseIds.filter((value): value is string => typeof value === 'string')
    : fallback.hiddenCourseIds;
  const themeMode: AppTheme = settings.themeMode === 'light' || settings.themeMode === 'dark'
    ? settings.themeMode
    : fallback.themeMode;
  const themeTimerEnabled = typeof settings.themeTimerEnabled === 'boolean'
    ? settings.themeTimerEnabled
    : fallback.themeTimerEnabled;
  const themeTimerMode: AppTheme = settings.themeTimerMode === 'light' || settings.themeTimerMode === 'dark'
    ? settings.themeTimerMode
    : fallback.themeTimerMode;
  const themeTimerStart = normalizeThemeTimerTime(settings.themeTimerStart, fallback.themeTimerStart);
  const themeTimerEnd = normalizeThemeTimerTime(settings.themeTimerEnd, fallback.themeTimerEnd);
  const accentColor = typeof settings.accentColor === 'string' &&
    academyAccentColorOptions.includes(settings.accentColor as ColorToken)
    ? settings.accentColor as ColorToken
    : fallback.accentColor;
  const academyLogoSrc = typeof settings.academyLogoSrc === 'string'
    ? settings.academyLogoSrc.trim()
    : fallback.academyLogoSrc;
  const language: Language = settings.language === 'en' || settings.language === 'ko'
    ? settings.language
    : fallback.language;
  const nation: AcademyNation = typeof settings.nation === 'string' &&
    academyNationValues.includes(settings.nation as AcademyNation)
    ? settings.nation as AcademyNation
    : settings.language === 'ko'
      ? 'kr'
      : fallback.nation;
  const skipClassOnHolidays = typeof settings.skipClassOnHolidays === 'boolean'
    ? settings.skipClassOnHolidays
    : fallback.skipClassOnHolidays;
  const fontFamily = typeof settings.fontFamily === 'string' &&
    academyFontFamilyValues.includes(settings.fontFamily as AcademyFontFamily)
    ? settings.fontFamily as AcademyFontFamily
    : fallback.fontFamily;
  const fontSizePercent = Number.isFinite(settings.fontSizePercent)
    ? Math.min(Math.max(Math.round(Number(settings.fontSizePercent)), 80), 130)
    : fallback.fontSizePercent;
  const autoRefreshIntervalMs = Number.isFinite(settings.autoRefreshIntervalMs)
    ? Math.min(
        Math.max(Math.round(Number(settings.autoRefreshIntervalMs)), minimumAcademyAutoRefreshIntervalMs),
        maximumAcademyAutoRefreshIntervalMs,
      )
    : fallback.autoRefreshIntervalMs;
  const refocusRefreshThrottleMs = Number.isFinite(settings.refocusRefreshThrottleMs)
    ? Math.min(
        Math.max(Math.round(Number(settings.refocusRefreshThrottleMs)), minimumAcademyRefocusRefreshThrottleMs),
        maximumAcademyRefocusRefreshThrottleMs,
      )
    : fallback.refocusRefreshThrottleMs;

  return {
    accentColor,
    academyLogoSrc,
    autoRefreshIntervalMs,
    refocusRefreshThrottleMs,
    courseworkHideCompletedAfterHours,
    courseworkHideCompletedFrom,
    courseworkHideUncompletedAfterHours,
    courseworkShowStudyItems,
    fontFamily,
    fontSizePercent,
    gradeProgressGreenAt,
    gradeProgressYellowAt,
    hiddenCourseIds,
    language,
    nation,
    calendarTodoStyle,
    skipClassOnHolidays,
    showPastTermCalendarItems,
    progressDisplay,
    progressGreenAt,
    progressYellowAt,
    selectedSemester: normalizeSemesterName(
      typeof settings.selectedSemester === 'string' ? settings.selectedSemester : fallback.selectedSemester,
    ),
    themeMode,
    themeTimerEnabled,
    themeTimerEnd,
    themeTimerMode,
    themeTimerStart,
    topBarDefaultCollapsed: typeof settings.topBarDefaultCollapsed === 'boolean'
      ? settings.topBarDefaultCollapsed
      : fallback.topBarDefaultCollapsed,
  };
}

function normalizeThemeTimerTime(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback;
  }

  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function getThemeTimerMinutes(value: string) {
  const [hours = '0', minutes = '0'] = value.split(':');

  return (Number(hours) * 60) + Number(minutes);
}

function getOppositeThemeMode(themeMode: AppTheme): AppTheme {
  return themeMode === 'dark' ? 'light' : 'dark';
}

function isMinuteInThemeWindow(currentMinute: number, startMinute: number, endMinute: number) {
  if (startMinute === endMinute) {
    return false;
  }

  if (startMinute < endMinute) {
    return currentMinute >= startMinute && currentMinute < endMinute;
  }

  return currentMinute >= startMinute || currentMinute < endMinute;
}

function getAcademyEffectiveTheme(settings: AcademyCalendarSettings, date = new Date()): AppTheme {
  if (!settings.themeTimerEnabled) {
    return settings.themeMode;
  }

  const startMinute = getThemeTimerMinutes(settings.themeTimerStart);
  const endMinute = getThemeTimerMinutes(settings.themeTimerEnd);
  const currentMinute = (date.getHours() * 60) + date.getMinutes();
  const isTimerWindow = isMinuteInThemeWindow(currentMinute, startMinute, endMinute);

  return isTimerWindow ? settings.themeTimerMode : getOppositeThemeMode(settings.themeTimerMode);
}

function getStoredAcademyCalendarSettings() {
  return normalizeAcademyCalendarSettings(
    readStoredJson<unknown>(academyCalendarSettingsStorageKey, defaultAcademyCalendarSettings),
  );
}

function areAcademyCalendarSettingsEqual(first: AcademyCalendarSettings, second: AcademyCalendarSettings) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function waitFor(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function formatAcademyAutoRefreshInterval(milliseconds: number) {
  if (milliseconds < 60_000) {
    return `${Math.round(milliseconds / 1000)}s`;
  }

  return `${Math.round(milliseconds / 60_000)}m`;
}

function isSessionExpiredError(error: unknown) {
  return (error instanceof ApiError && error.status === 401) ||
    (error instanceof Error && /session expired|sign in again/i.test(error.message));
}

function getAuthSessionIdentityKey(session: AuthSession) {
  if (!session.isAuthenticated) {
    return null;
  }

  return [
    'user',
    session.academyPreferenceOwnerKey ?? session.email ?? '',
  ].join(':');
}

function getStoredHiddenCalendarCourseIds() {
  const hiddenCourseIds = getStoredAcademyCalendarSettings().hiddenCourseIds;

  if (hiddenCourseIds) {
    return hiddenCourseIds;
  }

  const storedIds = readStoredJson<unknown>(academyCalendarHiddenCoursesStorageKey, []);

  return Array.isArray(storedIds)
    ? storedIds.filter((value): value is string => typeof value === 'string')
    : [];
}

function storeAcademyCalendarSettings(settings: AcademyCalendarSettings) {
  storeJson(academyCalendarSettingsStorageKey, settings);
}

function storeHiddenCalendarCourseIds(courseIds: string[]) {
  storeAcademyCalendarSettings({
    ...academyPreferenceCache.calendarSettings,
    hiddenCourseIds: courseIds,
  });
}

function applyAcademyAccentColor(color: ColorToken) {
  const variables = academyAccentThemeVariables[color] ?? academyAccentThemeVariables.gold;
  const root = document.documentElement;
  const isDarkTheme = root.classList.contains('dark');
  const neutralBackground = isDarkTheme ? 'oklch(0.12 0 0)' : 'oklch(0.982 0.006 92)';
  const neutralForeground = isDarkTheme ? 'oklch(0.96 0 0)' : 'oklch(0.18 0.006 92)';
  const neutralMutedForeground = isDarkTheme ? 'oklch(0.7 0 0)' : 'oklch(0.48 0.01 92)';
  const neutralCard = isDarkTheme ? 'oklch(0.17 0 0)' : 'oklch(0.995 0.004 92)';
  const neutralMuted = isDarkTheme ? 'oklch(0.23 0 0)' : 'oklch(0.945 0.01 92)';
  const neutralBorder = isDarkTheme ? 'oklch(1 0 0 / 14%)' : 'oklch(0.88 0.012 92)';
  const accentSoft = isDarkTheme
    ? neutralMuted
    : `color-mix(in oklch, ${variables.primary} 9%, ${neutralMuted})`;
  const accentSofter = isDarkTheme
    ? neutralBackground
    : `color-mix(in oklch, ${variables.primary} 6%, ${neutralBackground})`;
  const accentCard = isDarkTheme
    ? neutralCard
    : `color-mix(in oklch, ${variables.primary} 3%, ${neutralCard})`;
  const accentBorder = isDarkTheme
    ? neutralBorder
    : `color-mix(in oklch, ${variables.primary} 16%, ${neutralBorder})`;
  const accentAlphaStrong = variables.primary.replace(/\)$/, ' / 0.24)');
  const accentAlphaSoft = variables.primary.replace(/\)$/, ' / 0.12)');

  root.style.setProperty(
    '--app-bg',
    isDarkTheme
      ? 'linear-gradient(135deg, oklch(0.095 0 0) 0%, oklch(0.12 0 0) 52%, oklch(0.105 0 0) 100%)'
      : [
          `radial-gradient(circle at 12% 8%, ${accentAlphaStrong}, transparent 30%)`,
          `radial-gradient(circle at 84% 18%, ${accentAlphaSoft}, transparent 28%)`,
          `linear-gradient(135deg, ${accentSoft} 0%, ${accentSofter} 48%, oklch(0.95 0.004 92) 100%)`,
        ].join(', '),
  );
  root.style.setProperty('--background', isDarkTheme ? neutralBackground : accentSofter);
  root.style.setProperty('--foreground', neutralForeground);
  root.style.setProperty('--card', accentCard);
  root.style.setProperty('--card-foreground', neutralForeground);
  root.style.setProperty('--popover', accentCard);
  root.style.setProperty('--popover-foreground', neutralForeground);
  root.style.setProperty('--secondary', accentSoft);
  root.style.setProperty('--secondary-foreground', neutralForeground);
  root.style.setProperty('--muted', accentSoft);
  root.style.setProperty('--muted-foreground', neutralMutedForeground);
  root.style.setProperty('--accent', accentSoft);
  root.style.setProperty('--accent-foreground', neutralForeground);
  root.style.setProperty('--border', accentBorder);
  root.style.setProperty('--input', accentBorder);
  root.style.setProperty('--sidebar', accentCard);
  root.style.setProperty('--sidebar-foreground', neutralForeground);
  root.style.setProperty('--sidebar-accent', accentSoft);
  root.style.setProperty('--sidebar-accent-foreground', neutralForeground);
  root.style.setProperty('--sidebar-border', accentBorder);
  root.style.setProperty('--primary', variables.primary);
  root.style.setProperty('--ring', variables.primary);
  root.style.setProperty('--sidebar-primary', variables.primary);
  root.style.setProperty('--primary-foreground', variables.primaryForeground);
  root.style.setProperty('--sidebar-primary-foreground', variables.primaryForeground);
}

function storeJson(key: string, value: unknown) {
  if (academyPreferenceStorageKeys.has(key)) {
    setAcademyPreferenceCacheValue(key, value);
    dispatchAcademyPreferencesUpdated();
    return;
  }

  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event(academyPreferencesUpdatedEvent));
}

function clearLegacyAcademyPreferenceStorage() {
  if (typeof window === 'undefined') {
    return;
  }

  academyPreferenceStorageKeys.forEach((storageKey) => {
    window.localStorage.removeItem(storageKey);
  });
  window.localStorage.removeItem(academyCalendarHiddenCoursesStorageKey);
}

function applyAcademyPreferencesResponse(preferences: AcademyPreferences) {
  const hasRemoteCalendarSettings = hasMeaningfulSettingsRecord(preferences.calendarSettings);

  academyPreferenceCache = {
    canvasAssessmentPreferences: isRecord(preferences.canvasAssessmentPreferences)
      ? preferences.canvasAssessmentPreferences as Record<string, StoredCoursePreference>
      : {},
    canvasCourseworkPreferences: isRecord(preferences.canvasCourseworkPreferences)
      ? preferences.canvasCourseworkPreferences as Record<string, StoredCoursePreference>
      : {},
    canvasLecturePreferences: isRecord(preferences.canvasLecturePreferences)
      ? preferences.canvasLecturePreferences as Record<string, StoredCoursePreference>
      : {},
    calendarSettings: hasRemoteCalendarSettings
      ? normalizeAcademyCalendarSettings(
          preferences.calendarSettings,
          academyPreferenceCache.calendarSettings,
        )
      : academyPreferenceCache.calendarSettings,
    manualAssessments: Array.isArray(preferences.manualAssessments)
      ? preferences.manualAssessments as StoredManualAssessment[]
      : [],
    manualCoursework: Array.isArray(preferences.manualCoursework)
      ? preferences.manualCoursework as StoredManualCoursework[]
      : [],
    manualLectures: Array.isArray(preferences.manualLectures)
      ? preferences.manualLectures as StoredCoursePreference[]
      : [],
  };
  clearLegacyAcademyPreferenceStorage();
}

function applyAcademyPreferenceEventDetail(detail: unknown) {
  if (!isRecord(detail)) {
    return;
  }

  academyPreferenceCache = {
    ...academyPreferenceCache,
    canvasAssessmentPreferences: isRecord(detail.canvasAssessmentPreferences)
      ? detail.canvasAssessmentPreferences as Record<string, StoredCoursePreference>
      : academyPreferenceCache.canvasAssessmentPreferences,
    canvasCourseworkPreferences: isRecord(detail.canvasCourseworkPreferences)
      ? detail.canvasCourseworkPreferences as Record<string, StoredCoursePreference>
      : academyPreferenceCache.canvasCourseworkPreferences,
    canvasLecturePreferences: isRecord(detail.canvasLecturePreferences)
      ? detail.canvasLecturePreferences as Record<string, StoredCoursePreference>
      : academyPreferenceCache.canvasLecturePreferences,
    calendarSettings: isRecord(detail.calendarSettings)
      ? normalizeAcademyCalendarSettings(detail.calendarSettings, academyPreferenceCache.calendarSettings)
      : academyPreferenceCache.calendarSettings,
    manualAssessments: Array.isArray(detail.manualAssessments)
      ? detail.manualAssessments as StoredManualAssessment[]
      : academyPreferenceCache.manualAssessments,
    manualCoursework: Array.isArray(detail.manualCoursework)
      ? detail.manualCoursework as StoredManualCoursework[]
      : academyPreferenceCache.manualCoursework,
    manualLectures: Array.isArray(detail.manualLectures)
      ? detail.manualLectures as StoredCoursePreference[]
      : academyPreferenceCache.manualLectures,
  };
}

function getStoredCourseChipColor(courseCode?: string, courseId?: string, courseName?: string): ColorToken | undefined {
  if (!courseCode && !courseId && !courseName) {
    return undefined;
  }

  const manualLectures = getStoredManualLectures();
  const manualLectureExact = manualLectures.find((lecture) => (
    valuesMatchExactly(courseCode, lecture.friendlyCourseCode) ||
    valuesMatchExactly(courseCode, lecture.code) ||
    valuesMatchExactly(courseCode, lecture.courseCode) ||
    valuesMatchExactly(courseName, lecture.friendlyName) ||
    valuesMatchExactly(courseName, lecture.courseName)
  ));

  if (manualLectureExact?.chipColor) {
    return manualLectureExact.chipColor;
  }

  const manualLecture = manualLectures.find((lecture) => (
    codesMatch(courseCode, lecture.friendlyCourseCode) ||
    codesMatch(courseCode, lecture.code) ||
    codesMatch(courseCode, lecture.courseCode) ||
    codesMatch(courseName, lecture.friendlyName) ||
    codesMatch(courseName, lecture.courseName)
  ));

  if (manualLecture?.chipColor) {
    return manualLecture.chipColor;
  }

  const canvasPreferences = getStoredCanvasLecturePreferences();
  const canvasLectureById = courseId ? canvasPreferences[courseId] : undefined;

  if (canvasLectureById?.chipColor) {
    return canvasLectureById.chipColor;
  }

  const canvasLectureExact = Object.values(canvasPreferences).find((preference) => (
    valuesMatchExactly(courseCode, preference.friendlyCourseCode) ||
    valuesMatchExactly(courseCode, preference.originalCourseCode) ||
    valuesMatchExactly(courseCode, preference.courseCode) ||
    valuesMatchExactly(courseName, preference.friendlyName) ||
    valuesMatchExactly(courseName, preference.courseName)
  ));

  if (canvasLectureExact?.chipColor) {
    return canvasLectureExact.chipColor;
  }

  const canvasLecture =
    Object.values(canvasPreferences).find((preference) => (
      codesMatch(courseCode, preference.friendlyCourseCode) ||
      codesMatch(courseCode, preference.originalCourseCode) ||
      codesMatch(courseCode, preference.courseCode) ||
      codesMatch(courseName, preference.friendlyName) ||
      codesMatch(courseName, preference.courseName)
    ));

  return canvasLecture?.chipColor;
}

function getCourseDisplay(item: CalendarSourceItem, fallbackLabel: string) {
  const canvasPreferences = getStoredCanvasLecturePreferences();
  const preferenceById = item.courseId ? canvasPreferences[item.courseId] : undefined;
  const manualLectures = getStoredManualLectures();
  const manualLectureExact = manualLectures.find((lecture) => (
    valuesMatchExactly(item.courseCode, lecture.friendlyCourseCode) ||
    valuesMatchExactly(item.courseCode, lecture.code) ||
    valuesMatchExactly(item.courseCode, lecture.courseCode) ||
    valuesMatchExactly(item.courseName, lecture.friendlyName) ||
    valuesMatchExactly(item.courseName, lecture.courseName)
  ));
  const canvasLectureExact = Object.values(canvasPreferences).find((preference) => (
    valuesMatchExactly(item.courseCode, preference.friendlyCourseCode) ||
    valuesMatchExactly(item.courseCode, preference.originalCourseCode) ||
    valuesMatchExactly(item.courseCode, preference.courseCode) ||
    valuesMatchExactly(item.courseName, preference.friendlyName) ||
    valuesMatchExactly(item.courseName, preference.courseName)
  ));
  const manualLecture = manualLectureExact ?? manualLectures.find((lecture) => (
    codesMatch(item.courseCode, lecture.friendlyCourseCode) ||
    codesMatch(item.courseCode, lecture.code) ||
    codesMatch(item.courseCode, lecture.courseCode) ||
    codesMatch(item.courseName, lecture.friendlyName)
  ));
  const canvasLecture = canvasLectureExact ?? Object.values(canvasPreferences).find((preference) => (
    codesMatch(item.courseCode, preference.friendlyCourseCode) ||
    codesMatch(item.courseCode, preference.originalCourseCode) ||
    codesMatch(item.courseCode, preference.courseCode) ||
    codesMatch(item.courseName, preference.friendlyName)
  ));
  const label =
    preferenceById?.friendlyCourseCode?.trim() ||
    manualLectureExact?.friendlyCourseCode?.trim() ||
    manualLectureExact?.code?.trim() ||
    manualLectureExact?.courseCode?.trim() ||
    canvasLectureExact?.friendlyCourseCode?.trim() ||
    canvasLectureExact?.originalCourseCode?.trim() ||
    canvasLectureExact?.courseCode?.trim() ||
    item.courseCode?.trim() ||
    item.courseName?.trim() ||
    manualLecture?.friendlyCourseCode?.trim() ||
    manualLecture?.code?.trim() ||
    canvasLecture?.friendlyCourseCode?.trim() ||
    fallbackLabel;

  return {
    color:
      preferenceById?.chipColor ??
      manualLectureExact?.chipColor ??
      canvasLectureExact?.chipColor ??
      item.color ??
      manualLecture?.chipColor ??
      canvasLecture?.chipColor,
    label,
  };
}

function coursePreferenceMatchesCourse(
  preference: StoredCoursePreference,
  course: Pick<CalendarSourceItem, 'courseCode' | 'courseId' | 'courseName'>,
) {
  return (
    codesMatch(course.courseCode, preference.friendlyCourseCode) ||
    codesMatch(course.courseCode, preference.code) ||
    codesMatch(course.courseCode, preference.courseCode) ||
    codesMatch(course.courseCode, preference.originalCourseCode) ||
    codesMatch(course.courseName, preference.friendlyName) ||
    codesMatch(course.courseName, preference.courseName)
  );
}

function isCourseReferenceHidden(
  course: Pick<CalendarSourceItem, 'courseCode' | 'courseId' | 'courseName'> & { source?: CalendarSourceItem['source'] },
) {
  const hiddenManualLecture = getStoredManualLectures().some((lecture) => (
    Boolean(lecture.hidden || lecture.deleted) && coursePreferenceMatchesCourse(lecture, course)
  ));

  if (hiddenManualLecture) {
    return true;
  }

  if (course.source && course.source !== 'canvas') {
    return false;
  }

  return Object.entries(getStoredCanvasLecturePreferences()).some(([courseId, preference]) => (
    Boolean(preference.hidden || preference.deleted) &&
    (
      (Boolean(course.courseId) && course.courseId === courseId) ||
      coursePreferenceMatchesCourse(preference, course)
    )
  ));
}

function normalizeExternalUrl(value?: string) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return undefined;
  }

  return /^https?:\/\//i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`;
}

function getManualLectureLinkUrl(lecture: StoredCoursePreference, linkId: string) {
  return normalizeExternalUrl(lecture.links?.find((link) => link.id === linkId)?.url);
}

function getCanvasCourseIdFromUrl(value?: string) {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value, window.location.origin);
    const match = url.pathname.match(/\/courses\/([^/?#]+)/i);

    return match ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

function getStoredManualLectureForItem(item: CalendarSourceItem) {
  const manualLectures = getStoredManualLectures();

  return manualLectures.find((lecture) => (
    codesMatch(item.courseCode, lecture.friendlyCourseCode) ||
    codesMatch(item.courseCode, lecture.code) ||
    codesMatch(item.courseName, lecture.friendlyName)
  ));
}

function getStoredCanvasCourseIdForItem(item: CalendarSourceItem) {
  if (item.courseId) {
    return item.courseId;
  }

  const courseIdFromUrl = getCanvasCourseIdFromUrl(item.htmlUrl);

  if (courseIdFromUrl) {
    return courseIdFromUrl;
  }

  const canvasPreferences = getStoredCanvasLecturePreferences();
  const matchingPreference = Object.entries(canvasPreferences).find(([, preference]) => (
    codesMatch(item.courseCode, preference.friendlyCourseCode) ||
    codesMatch(item.courseCode, preference.originalCourseCode) ||
    codesMatch(item.courseName, preference.friendlyName)
  ));

  return matchingPreference?.[0];
}

function getManualCourseworkTargetUrl(item: CalendarSourceItem, lecture: StoredCoursePreference) {
  void item;

  const submissionUrl = getManualLectureLinkUrl(lecture, 'submission-link');
  const lectureWebsiteUrl = getManualLectureLinkUrl(lecture, 'lecture-website');

  return submissionUrl ?? lectureWebsiteUrl;
}

function getCalendarSourceItemOpenTarget(item: CalendarSourceItem) {
  if (item.source === 'canvas') {
    const canvasCourseId = getStoredCanvasCourseIdForItem(item);

    return canvasCourseId
      ? {
          courseRowId: `canvas:${canvasCourseId}`,
          resourceUrl: item.htmlUrl,
        }
      : undefined;
  }

  const manualLecture = getStoredManualLectureForItem(item);

  const manualLectureId = manualLecture?.id;

  if (!manualLectureId) {
    return undefined;
  }

  return {
    courseRowId: `manual:${manualLectureId}`,
    resourceUrl: getManualCourseworkTargetUrl(item, manualLecture),
  };
}

function getCalendarCourseFilterId(label: string) {
  return normalizeCourseCode(label || 'calendar-course');
}

function getCalendarCourseFilterOption(item: CalendarSourceItem, fallbackLabel: string) {
  const courseDisplay = getCourseDisplay(item, fallbackLabel);
  const label = courseDisplay.label || fallbackLabel;

  return {
    color: courseDisplay.color,
    id: getCalendarCourseFilterId(label),
    label,
  };
}

function setCalendarCourseOption(
  optionMap: Map<string, CalendarCourseFilterOption>,
  labelValue: string | undefined,
  color: ColorToken | undefined,
  hiddenCourseIds: string[],
) {
  const label = labelValue?.trim();

  if (!label) {
    return;
  }

  const id = getCalendarCourseFilterId(label);

  if (!optionMap.has(id)) {
    optionMap.set(id, {
      checked: !hiddenCourseIds.includes(id),
      color: color ?? 'blue',
      id,
      label,
    });
  }
}

function getActiveCalendarCourseOptions(
  canvasItems: CanvasCalendarItem[],
  hiddenCourseIds: string[],
  fallbackLabel: string,
  selectedSemester: string,
): CalendarCourseFilterOption[] {
  const optionMap = new Map<string, CalendarCourseFilterOption>();
  const canvasLecturePreferences = getStoredCanvasLecturePreferences();

  getStoredManualLectures().forEach((lecture) => {
    if (lecture.hidden || lecture.deleted || !semesterMatches(lecture.semester, selectedSemester)) {
      return;
    }

    setCalendarCourseOption(
      optionMap,
      lecture.friendlyCourseCode ||
        lecture.code ||
        lecture.courseCode ||
        lecture.friendlyName ||
        lecture.courseName,
      lecture.chipColor ?? getStoredCourseChipColor(lecture.friendlyCourseCode || lecture.code || lecture.courseCode),
      hiddenCourseIds,
    );
  });

  Object.values(canvasLecturePreferences).forEach((preference) => {
    if (
      preference.archivedAsManualLectureId ||
      preference.hidden ||
      preference.deleted ||
      !semesterMatches(preference.semester ?? preference.termName, selectedSemester)
    ) {
      return;
    }

    setCalendarCourseOption(
      optionMap,
      preference.friendlyCourseCode ||
        preference.originalCourseCode ||
        preference.courseCode ||
        preference.code ||
        preference.friendlyName ||
        preference.courseName,
      preference.chipColor ?? getStoredCourseChipColor(preference.friendlyCourseCode || preference.originalCourseCode || preference.courseCode),
      hiddenCourseIds,
    );
  });

  canvasItems.forEach((item) => {
    if (!item.courseId && !item.courseCode && !item.courseName) {
      return;
    }

    if (isCourseReferenceHidden(item)) {
      return;
    }

    if (!semesterMatches(item.courseId ? canvasLecturePreferences[item.courseId]?.semester : undefined, selectedSemester)) {
      return;
    }

    const option = getCalendarCourseFilterOption({
      id: item.id,
      source: 'canvas',
      title: item.title,
      type: item.type,
      courseId: item.courseId,
      courseCode: item.courseCode,
      courseName: item.courseName,
      dueAt: item.dueAt,
      startAt: item.startAt,
      endAt: item.endAt,
      htmlUrl: item.htmlUrl,
      color: getCanvasItemColor(item),
    }, fallbackLabel);

    if (option.label !== fallbackLabel) {
      setCalendarCourseOption(optionMap, option.label, option.color, hiddenCourseIds);
    }
  });

  return [...optionMap.values()].sort((firstOption, secondOption) => (
    firstOption.label.localeCompare(secondOption.label)
  ));
}

function getActiveAwareCourseDisplay(
  item: CalendarSourceItem,
  fallbackLabel: string,
  activeCourseOptionIds?: Set<string>,
) {
  void activeCourseOptionIds;

  const courseDisplay = getCourseDisplay(item, fallbackLabel);

  return courseDisplay;
}

function isCalendarTodoInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element &&
    Boolean(target.closest('button,a,input,textarea,select,[role="menuitem"],[data-calendar-todo-action]'));
}

function filterCalendarSourceItemsByCourse(
  items: CalendarSourceItem[],
  hiddenCourseIds: string[],
  fallbackLabel: string,
) {
  if (hiddenCourseIds.length === 0) {
    return items;
  }

  return items.filter((item) => {
    const option = getCalendarCourseFilterOption(item, fallbackLabel);

    return !hiddenCourseIds.includes(option.id);
  });
}

function getCalendarBoardColumns(options: CalendarCourseFilterOption[]): BoardColumnConfig[] {
  return options
    .filter((option) => option.checked)
    .map((option) => ({
      canAdd: option.canAdd,
      id: option.id,
      label: option.label,
      color: option.color,
    }));
}

function getCalendarBoardItems(
  items: CalendarSourceItem[],
  fallbackLabel: string,
  activeCourseOptionIds?: Set<string>,
): BoardItem[] {
  void activeCourseOptionIds;

  return items
    .slice()
    .sort((firstItem, secondItem) => (
      new Date(getCalendarSourceItemDate(firstItem) ?? '').getTime() -
      new Date(getCalendarSourceItemDate(secondItem) ?? '').getTime()
    ))
    .map((item) => {
      const option = getCalendarCourseFilterOption(item, fallbackLabel);
      const dueAt = getCalendarSourceItemDate(item);

      return {
        id: item.id,
        columnId: option.id,
        title: item.title,
        type: formatCalendarTodoType(item.type),
        color: option.color,
        checklistProgress: item.source === 'class-session' ? '' : item.isCompleted ? '1 of 1' : '0 of 1',
        dueAt,
        endAt: item.endAt,
        holidayName: item.holidayName,
        isCanceledForHoliday: Boolean(item.isCanceledForHoliday),
        isCompleted: item.source === 'class-session'
          ? isPastClassSession(item) || Boolean(item.isCanceledForHoliday)
          : Boolean(item.isCompleted),
        isClassSession: item.source === 'class-session',
        isLocked: item.source === 'class-session' || Boolean(item.isLocked),
        isTitleEditable: item.source !== 'class-session' && !item.isLocked && !isLiveCanvasCalendarItem(item),
        canOpenDetails: item.source !== 'class-session',
        isCanvasSource: item.source === 'canvas',
        isArchivedCanvasItem: Boolean(item.isArchivedCanvasItem),
        isStarred: Boolean(item.isStarred),
        time: formatCalendarSourceItemTime(item),
      };
    });
}

type DayTodoProgress = {
  completedCount: number;
  label: string;
  percent: number;
  totalCount: number;
};

function getCalendarMoveDueDateTarget(item: CalendarSourceItem) {
  if (item.isLocked || item.isCompleted) {
    return null;
  }

  if (item.source === 'canvas' && !item.isArchivedCanvasItem) {
    return null;
  }

  const value = getCalendarSourceItemDate(item);

  if (!value) {
    return null;
  }

  const dueDate = new Date(value);

  if (Number.isNaN(dueDate.getTime())) {
    return null;
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDueDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()).getTime();

  if (startOfDueDate < startOfToday) {
    return 'today';
  }

  if (startOfDueDate === startOfToday) {
    return 'tomorrow';
  }

  return null;
}

function getCalendarTimeChipClass() {
  return 'border-neutral-200 bg-neutral-100 text-neutral-600 dark:border-white/10 dark:bg-white/10 dark:text-muted-foreground';
}

function getCourseDoneCheckClass(color: ColorToken) {
  if (color === 'gray') {
    return 'border-emerald-400/40 bg-emerald-500 text-white';
  }

  return {
    blue: 'border-blue-400/45 bg-blue-500 text-white',
    sky: 'border-sky-400/45 bg-sky-500 text-white',
    cyan: 'border-cyan-400/45 bg-cyan-500 text-white',
    emerald: 'border-emerald-400/40 bg-emerald-500 text-white',
    amber: 'border-amber-400/45 bg-amber-500 text-amber-950',
    apricot: 'border-[#F4A261]/45 bg-[#F4A261] text-[#7C2D12]',
    aqua: 'border-[#22D3EE]/45 bg-[#22D3EE] text-[#083344]',
    gold: 'border-yellow-400/45 bg-yellow-500 text-yellow-950',
    green: 'border-emerald-400/40 bg-emerald-500 text-white',
    indigo: 'border-indigo-400/45 bg-indigo-500 text-white',
    cobalt: 'border-[#2563EB]/45 bg-[#2563EB] text-white',
    cocoa: 'border-[#7C2D12]/45 bg-[#7C2D12] text-white',
    coral: 'border-[#FF6F61]/45 bg-[#FF6F61] text-white',
    crimson: 'border-[#DC143C]/45 bg-[#DC143C] text-white',
    forest: 'border-[#15803D]/45 bg-[#15803D] text-white',
    graphite: 'border-[#374151]/45 bg-[#374151] text-white',
    ice: 'border-[#A5F3FC]/60 bg-[#A5F3FC] text-[#155E75]',
    lavender: 'border-[#A78BFA]/45 bg-[#A78BFA] text-white',
    lemon: 'border-[#FDE047]/60 bg-[#FDE047] text-[#713F12]',
    lilac: 'border-[#C084FC]/45 bg-[#C084FC] text-white',
    lime: 'border-lime-400/45 bg-lime-500 text-lime-950',
    magenta: 'border-[#D946EF]/45 bg-[#D946EF] text-white',
    mauve: 'border-[#B56576]/45 bg-[#B56576] text-white',
    midnight: 'border-[#111827]/45 bg-[#111827] text-white',
    mint: 'border-[#5EEAD4]/45 bg-[#5EEAD4] text-[#0F766E]',
    moss: 'border-[#65A30D]/45 bg-[#65A30D] text-white',
    navy: 'border-[#1E3A8A]/45 bg-[#1E3A8A] text-white',
    orange: 'border-amber-400/45 bg-amber-500 text-amber-950',
    ocean: 'border-[#0284C7]/45 bg-[#0284C7] text-white',
    olive: 'border-[#84CC16]/45 bg-[#84CC16] text-[#365314]',
    peach: 'border-[#FFB38A]/60 bg-[#FFB38A] text-[#7C2D12]',
    fuchsia: 'border-fuchsia-400/45 bg-fuchsia-500 text-white',
    neutral: 'border-neutral-400/45 bg-neutral-500 text-white',
    pink: 'border-pink-400/45 bg-pink-500 text-white',
    plum: 'border-[#7B2CBF]/45 bg-[#7B2CBF] text-white',
    purple: 'border-violet-400/45 bg-violet-500 text-white',
    red: 'border-red-400/45 bg-red-500 text-white',
    rose: 'border-rose-400/45 bg-rose-500 text-white',
    sand: 'border-[#D6B76F]/60 bg-[#D6B76F] text-[#7C5E1E]',
    slate: 'border-slate-400/45 bg-slate-500 text-white',
    stone: 'border-stone-400/45 bg-stone-500 text-white',
    teal: 'border-teal-400/45 bg-teal-500 text-white',
    turquoise: 'border-[#2DD4BF]/45 bg-[#2DD4BF] text-[#0F766E]',
    violet: 'border-purple-400/45 bg-purple-500 text-white',
    butter: 'border-[#FFD23F]/60 bg-[#FFD23F] text-[#6F4A00]',
    vanilla: 'border-[#F9E79F]/60 bg-[#FFF2B8] text-[#745400]',
    cream: 'border-[#F7E7B7]/60 bg-[#FFF7D6] text-[#7C5E1E]',
    honeydew: 'border-[#D9F99D]/60 bg-[#D9F99D] text-[#3F6212]',
    pistachio: 'border-[#BEE6A5]/60 bg-[#BEE6A5] text-[#3F6212]',
    sage: 'border-[#B7C9A8]/60 bg-[#B7C9A8] text-[#40513B]',
    seafoam: 'border-[#A7F3D0]/60 bg-[#A7F3D0] text-[#047857]',
    powder: 'border-[#BAE6FD]/60 bg-[#BAE6FD] text-[#0369A1]',
    babyblue: 'border-[#BFDBFE]/60 bg-[#BFDBFE] text-[#1D4ED8]',
    periwinkle: 'border-[#C7D2FE]/60 bg-[#C7D2FE] text-[#4338CA]',
    wisteria: 'border-[#DDD6FE]/60 bg-[#DDD6FE] text-[#6D28D9]',
    blush: 'border-[#FBCFE8]/60 bg-[#FBCFE8] text-[#BE185D]',
    cottoncandy: 'border-[#F9A8D4]/60 bg-[#F9A8D4] text-[#BE185D]',
    peachfuzz: 'border-[#FFBE98]/60 bg-[#FFBE98] text-[#9A3412]',
    softcoral: 'border-[#FF8F7A]/60 bg-[#FF8F7A] text-white',
    flamingo: 'border-[#F9738A]/60 bg-[#F9738A] text-white',
    watermelon: 'border-[#FF4F7B]/60 bg-[#FF4F7B] text-white',
    tangerine: 'border-[#FF9F45]/60 bg-[#FF9F45] text-[#7C2D12]',
    marigold: 'border-[#F7B731]/60 bg-[#F7B731] text-[#713F12]',
    citron: 'border-[#CDE64F]/60 bg-[#CDE64F] text-[#365314]',
    neomint: 'border-[#7FE7C4]/60 bg-[#7FE7C4] text-[#047857]',
    jade: 'border-[#4AC6A3]/60 bg-[#4AC6A3] text-white',
    lagoon: 'border-[#35C2D1]/60 bg-[#35C2D1] text-[#083344]',
    serenity: 'border-[#92A8D1]/60 bg-[#92A8D1] text-[#1E3A8A]',
    veryperi: 'border-[#6667AB]/60 bg-[#6667AB] text-white',
    orchid: 'border-[#B76ECA]/60 bg-[#B76ECA] text-white',
    amethyst: 'border-[#9966CC]/60 bg-[#9966CC] text-white',
    yellow: 'border-yellow-400/45 bg-yellow-500 text-yellow-950',
    zinc: 'border-zinc-400/45 bg-zinc-500 text-white',
  }[color];
}

function formatSelectedDayHeading(value: string, language: 'en' | 'ko') {
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return { primary: value, year: '' };
  }

  const date = new Date(year, month - 1, day);
  const weekday = date.toLocaleDateString(language === 'ko' ? 'ko-KR' : 'en-CA', { weekday: 'long' });

  if (language === 'ko') {
    return {
      primary: `${month}월 ${day}일 ${weekday}`,
      year: `${year}년`,
    };
  }

  return {
    primary: `${date.toLocaleDateString('en-CA', { month: 'long' })} ${day}, ${weekday}`,
    year: String(year),
  };
}

function getLocalIsoDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getIsoDateFromUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getTodayIsoDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, '0');
  const day = `${today.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function addDaysToIsoDate(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  date.setDate(date.getDate() + amount);

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getEndOfDayIsoDateTime(value: string) {
  const date = new Date(`${value}T23:59:00`);

  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

function getCalendarDueAtForTargetDay(target: 'today' | 'tomorrow') {
  const targetDateIso = target === 'tomorrow'
    ? addDaysToIsoDate(getTodayIsoDate(), 1)
    : getTodayIsoDate();

  return getEndOfDayIsoDateTime(targetDateIso);
}

function getCalendarMonthFromIsoDate(value: string) {
  const [year, month] = value.split('-').map((part) => Number.parseInt(part, 10));

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return undefined;
  }

  return new Date(Date.UTC(year, month - 1, 1));
}

function getDayTodoProgress(items: CalendarSourceItem[]): DayTodoProgress {
  const actionableItems = items.filter((item) => item.source !== 'class-session');
  const totalCount = actionableItems.length;
  const completedCount = actionableItems.filter((item) => item.isCompleted).length;
  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return {
    completedCount,
    label: `${completedCount}/${totalCount}`,
    percent,
    totalCount,
  };
}

function formatRelativeDayBadge(value: string) {
  const selectedDate = new Date(`${value}T00:00:00`);

  if (Number.isNaN(selectedDate.getTime())) {
    return '';
  }

  const todayIso = getTodayIsoDate();
  const todayDate = new Date(`${todayIso}T00:00:00`);
  const dayDifference = Math.round((selectedDate.getTime() - todayDate.getTime()) / 86_400_000);

  if (dayDifference === 0) {
    return 'D-Day';
  }

  return dayDifference > 0
    ? `D-${dayDifference}`
    : `D+${Math.abs(dayDifference)}`;
}

function isAssessmentType(type: string, title = '') {
  const searchableValue = `${type} ${title}`.toLowerCase();

  return ['quiz', 'exam', 'midterm', 'final'].some((assessmentType) => (
    searchableValue.includes(assessmentType)
  ));
}

function getCalendarSourceItemDate(item: CalendarSourceItem) {
  return item.dueAt ?? item.startAt ?? item.endAt;
}

function formatCalendarSourceItemTime(item: CalendarSourceItem) {
  const value = getCalendarSourceItemDate(item);

  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? undefined
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatCalendarSourceItemSelectedDayTime(item: CalendarSourceItem) {
  const value = getCalendarSourceItemDate(item);

  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? undefined
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getClassSessionCompletionTime(item: CalendarSourceItem) {
  const completionDate = new Date(item.endAt ?? item.startAt ?? '');

  return Number.isNaN(completionDate.getTime()) ? undefined : completionDate.getTime();
}

function isPastClassSession(item: CalendarSourceItem) {
  if (item.source !== 'class-session') {
    return false;
  }

  const completionTime = getClassSessionCompletionTime(item);

  return typeof completionTime === 'number' && completionTime < Date.now();
}

function parseManualLectureScheduleDays(entry: ManualLectureScheduleEntry): ManualLectureWeekday[] {
  if (Array.isArray(entry.days) && entry.days.length > 0) {
    return entry.days.filter((day): day is ManualLectureWeekday => day in manualLectureWeekdayIndexes);
  }

  return (entry.day ?? '')
    .split(/[,/·|]+|\band\b/i)
    .map((part) => part.trim().toLowerCase())
    .map((part) => manualLectureWeekdayAliases[part])
    .filter((day): day is ManualLectureWeekday => Boolean(day));
}

function getStoredClassScheduleEntries(schedule?: ManualLectureSchedule): ManualLectureScheduleEntry[] {
  if (Array.isArray(schedule?.entries) && schedule.entries.length > 0) {
    return schedule.entries;
  }

  if (schedule?.day || schedule?.time || schedule?.location) {
    return [{
      classType: 'lecture',
      day: schedule.day ?? '',
      deliveryMode: schedule.deliveryMode ?? 'inPerson',
      id: 'legacy-schedule',
      location: schedule.location ?? '',
      time: schedule.time ?? '',
    }];
  }

  return [];
}

function parseDateOnly(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return undefined;
  }

  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, monthIndex, day);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseTimeInput(value?: string) {
  const match = value?.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return { hour: 0, minute: 0 };
  }

  return {
    hour: Math.min(Math.max(Number.parseInt(match[1], 10), 0), 23),
    minute: Math.min(Math.max(Number.parseInt(match[2], 10), 0), 59),
  };
}

function createDateTimeIso(date: Date, time?: string) {
  const { hour, minute } = parseTimeInput(time);
  const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);

  return nextDate.toISOString();
}

function getClassSessionWeekOfMonth(date: Date) {
  return Math.floor((date.getDate() - 1) / 7);
}

function shouldIncludeClassSessionDate(
  entry: ManualLectureScheduleEntry,
  currentDate: Date,
  startDate: Date,
) {
  const recurrence = entry.recurrence ?? 'weekly';
  const offset = entry.recurrenceOffset === 1 ? 1 : 0;

  if (recurrence === 'weekly') {
    return true;
  }

  if (recurrence === 'biweekly') {
    const weeksSinceStart = Math.floor(
      (currentDate.getTime() - startDate.getTime()) / (7 * 86_400_000),
    );

    return Math.max(weeksSinceStart, 0) % 2 === offset;
  }

  const monthsSinceStart = (
    (currentDate.getFullYear() - startDate.getFullYear()) * 12
  ) + currentDate.getMonth() - startDate.getMonth();

  if (getClassSessionWeekOfMonth(currentDate) !== getClassSessionWeekOfMonth(startDate)) {
    return false;
  }

  if (recurrence === 'monthly') {
    return monthsSinceStart >= 0;
  }

  if (recurrence === 'bimonthly') {
    return Math.max(monthsSinceStart, 0) % 2 === offset;
  }

  return true;
}

function getClassSessionCourseLabel(course: StoredCoursePreference) {
  return course.friendlyCourseCode?.trim() ||
    course.code?.trim() ||
    course.courseCode?.trim() ||
    course.originalCourseCode?.trim() ||
    course.friendlyName?.trim() ||
    course.courseName?.trim() ||
    'Course';
}

function createClassSessionItemsFromCourse(
  course: StoredCoursePreference,
  options: {
    courseId?: string;
    holidayNation?: AcademyNation;
    skipClassOnHolidays?: boolean;
    sourceId: string;
  },
): CalendarSourceItem[] {
  if (course.hidden) {
    return [];
  }

  const courseLabel = getClassSessionCourseLabel(course);
  const courseName = course.friendlyName?.trim() || course.courseName?.trim();
  const color = course.chipColor ?? getStoredCourseChipColor(courseLabel, options.courseId, courseName) ?? 'teal';

  return getStoredClassScheduleEntries(course.schedule)
    .flatMap((entry) => {
      const days = parseManualLectureScheduleDays(entry);
      const startDate = parseDateOnly(entry.startDate);
      const endDate = parseDateOnly(entry.endDate);

      if (days.length === 0 || !startDate || !endDate || startDate.getTime() > endDate.getTime()) {
        return [];
      }

      const dayIndexes = new Set(days.map((day) => manualLectureWeekdayIndexes[day]));
      const sessions: CalendarSourceItem[] = [];
      const currentDate = new Date(startDate);
      let guard = 0;

      while (currentDate.getTime() <= endDate.getTime() && guard < 370) {
        if (dayIndexes.has(currentDate.getDay()) && shouldIncludeClassSessionDate(entry, currentDate, startDate)) {
          const classLabel = manualLectureClassTypeLabels[entry.classType] ?? 'Class';
          const startAt = createDateTimeIso(currentDate, entry.startTime);
          const endAt = entry.endTime ? createDateTimeIso(currentDate, entry.endTime) : undefined;
          const dateKey = getLocalIsoDate(startAt) ?? currentDate.toISOString().slice(0, 10);
          const holiday = options.holidayNation
            ? getHolidayForDateByNation(options.holidayNation, dateKey)
            : undefined;
          const isCanceledForHoliday = Boolean(options.skipClassOnHolidays && holiday);

          sessions.push({
            color,
            courseCode: courseLabel,
            courseId: options.courseId,
            courseName,
            displayStyle: 'dot',
            endAt,
            holidayName: holiday?.label,
            id: `class:${options.sourceId}:${entry.id}:${dateKey}`,
            isCanceledForHoliday,
            isLocked: true,
            location: entry.location,
            semester: course.semester ?? course.termName,
            source: 'class-session',
            startAt,
            title: `${courseLabel} ${classLabel}`,
            type: classLabel,
          });
        }

        currentDate.setDate(currentDate.getDate() + 1);
        guard += 1;
      }

      return sessions;
    });
}

function getCanvasItemColor(item: CanvasCalendarItem) {
  const canvasPreferences = getStoredCanvasLecturePreferences();
  const preferenceById = item.courseId ? canvasPreferences[item.courseId] : undefined;
  const isCourseItem = Boolean(item.courseId || item.courseCode || item.courseName);

  return preferenceById?.chipColor
    ?? getStoredCourseChipColor(item.courseCode, item.courseId, item.courseName)
    ?? (isCourseItem ? 'blue' : undefined)
    ?? canvasCalendarTypeColors[item.type]
    ?? 'blue';
}

function getCalendarSourceEvent(
  item: CalendarSourceItem,
  activeCourseOptionIds?: Set<string>,
): CalendarEvent {
  const courseDisplay = getActiveAwareCourseDisplay(item, '', activeCourseOptionIds);

  return {
    id: item.id,
    title: item.title,
    color: courseDisplay.color,
    courseLabel: courseDisplay.label || undefined,
    displayStyle: item.displayStyle,
    holidayName: item.holidayName,
    isCanceledForHoliday: Boolean(item.isCanceledForHoliday),
    type: item.type,
    time: formatCalendarSourceItemTime(item),
  };
}

function getCalendarSourceAgendaItem(
  item: CalendarSourceItem,
  fallbackCourseLabel = '',
  activeCourseOptionIds?: Set<string>,
): AgendaItem {
  const label = item.type.charAt(0).toUpperCase() + item.type.slice(1);
  const courseDisplay = getActiveAwareCourseDisplay(item, fallbackCourseLabel, activeCourseOptionIds);

  return {
    id: item.id,
    time: formatCalendarSourceItemTime(item) ?? '--:--',
    title: item.title,
    subtitle: [courseDisplay.label, item.courseName, item.location].filter(Boolean).join(' · ') || 'Canvas LMS',
    type: label,
    color: courseDisplay.color,
    canOpenDetails: item.source !== 'class-session',
    isCanvasSource: item.source === 'canvas',
    isArchivedCanvasItem: Boolean(item.isArchivedCanvasItem),
    holidayName: item.holidayName,
    isCanceledForHoliday: Boolean(item.isCanceledForHoliday),
    isCompleted: item.source === 'class-session'
      ? isPastClassSession(item) || Boolean(item.isCanceledForHoliday)
      : Boolean(item.isCompleted),
    isLocked: item.source === 'class-session' || Boolean(item.isLocked),
    isStarred: Boolean(item.isStarred),
  };
}

function applyHolidayCancellationToClassSession(
  item: CalendarSourceItem,
  settings: AcademyCalendarSettings,
): CalendarSourceItem {
  if (item.source !== 'class-session' || !settings.skipClassOnHolidays) {
    return item;
  }

  const dateKey = getLocalIsoDate(item.startAt ?? item.dueAt ?? item.endAt);
  const holiday = dateKey ? getHolidayForDateByNation(settings.nation, dateKey) : undefined;

  if (!holiday) {
    return item;
  }

  return {
    ...item,
    holidayName: item.holidayName ?? holiday.label,
    isCanceledForHoliday: true,
  };
}

function getCalendarSourceItems(
  canvasItems: CanvasCalendarItem[],
  preferenceVersion = 0,
  calendarSettings: AcademyCalendarSettings = getStoredAcademyCalendarSettings(),
): CalendarSourceItem[] {
  void preferenceVersion;

  const classSessionCalendarOptions = {
    holidayNation: calendarSettings.nation,
    skipClassOnHolidays: calendarSettings.skipClassOnHolidays,
  };
  const canvasCourseworkPreferences = getStoredCanvasCourseworkPreferences();
  const canvasAssessmentPreferences = getStoredCanvasAssessmentPreferences();
  const canvasLecturePreferences = getStoredCanvasLecturePreferences();
  const canvasSourceItems = canvasItems
    .filter((item) => {
      const isAssessment = isAssessmentType(item.type, item.title);
      const preference = isAssessment
        ? canvasAssessmentPreferences[item.id]
        : canvasCourseworkPreferences[item.id];
      const coursePreference = item.courseId
        ? canvasLecturePreferences[item.courseId]
        : undefined;

      return !preference?.hidden && !coursePreference?.convertedToManualAt;
    })
    .map((item) => {
      const isAssessment = isAssessmentType(item.type, item.title);
      const preference = isAssessment
        ? canvasAssessmentPreferences[item.id]
        : canvasCourseworkPreferences[item.id];
      const isCompleted = Boolean(item.isSubmitted) || Boolean(preference?.completed);

      return {
        id: item.id,
        source: 'canvas' as const,
        title: preference?.title?.trim() || item.title,
        type: preference?.courseworkType || preference?.assessmentType || preference?.submissionType || item.type,
        courseId: item.courseId,
        courseCode: preference?.courseCode?.trim() || item.courseCode,
        courseName: item.courseName,
        dueAt: item.dueAt,
        startAt: item.startAt,
        endAt: item.endAt,
        htmlUrl: preference?.htmlUrl || item.htmlUrl,
        semester: preference?.semester || (item.courseId ? canvasLecturePreferences[item.courseId]?.semester : undefined),
        color: getCanvasItemColor(item),
        isCompleted,
        isArchivedCanvasItem: false,
        isLocked: Boolean(item.isSubmitted),
        isStarred: Boolean(preference?.starred),
      };
    });
  const currentCanvasItemIds = new Set(canvasItems.map((item) => item.id));
  const storedCanvasCourseworkItems = Object.entries(canvasCourseworkPreferences)
    .filter(([itemId, preference]) => (
      !currentCanvasItemIds.has(itemId) &&
      !preference.hidden &&
      Boolean(preference.title?.trim()) &&
      Boolean(preference.dueAt || preference.startAt || preference.endAt)
    ))
    .map(([itemId, preference]) => ({
      id: itemId,
      source: 'canvas' as const,
      title: preference.title?.trim() || '',
      type: preference.courseworkType || preference.submissionType || 'assignment',
      courseId: preference.courseId,
      courseCode: preference.courseCode,
      courseName: preference.courseName,
      dueAt: preference.dueAt,
      startAt: preference.startAt,
      endAt: preference.endAt,
      htmlUrl: preference.htmlUrl,
      semester: preference.semester,
      color: getStoredCourseChipColor(preference.courseCode, preference.courseId, preference.courseName) ?? 'blue',
      isCompleted: Boolean(preference.isSubmitted) || Boolean(preference.completed),
      isArchivedCanvasItem: true,
      isLocked: Boolean(preference.isSubmitted),
      isStarred: Boolean(preference.starred),
    }));
  const storedCanvasAssessmentItems = Object.entries(canvasAssessmentPreferences)
    .filter(([itemId, preference]) => (
      !currentCanvasItemIds.has(itemId) &&
      !preference.hidden &&
      Boolean(preference.title?.trim()) &&
      Boolean(preference.dueAt || preference.startAt || preference.endAt)
    ))
    .map(([itemId, preference]) => ({
      id: itemId,
      source: 'canvas' as const,
      title: preference.title?.trim() || '',
      type: preference.assessmentType || 'quiz',
      courseId: preference.courseId,
      courseCode: preference.courseCode,
      courseName: preference.courseName,
      dueAt: preference.dueAt,
      startAt: preference.startAt,
      endAt: preference.endAt,
      htmlUrl: preference.htmlUrl,
      semester: preference.semester,
      color: getStoredCourseChipColor(preference.courseCode, preference.courseId, preference.courseName) ?? 'orange',
      isCompleted: Boolean(preference.isSubmitted) || Boolean(preference.completed),
      isArchivedCanvasItem: true,
      isLocked: Boolean(preference.isSubmitted),
      isStarred: Boolean(preference.starred),
    }));
  const manualCourseworkItems = getStoredManualCoursework()
    .filter((item) => !item.hidden)
    .map((item) => ({
      id: item.id,
      source: 'manual-coursework' as const,
      title: item.title,
      type: item.courseworkType || 'study',
      courseCode: item.courseCode,
      dueAt: item.dueAt,
      startAt: item.startAt,
      endAt: item.endAt,
      semester: item.semester,
      color: item.chipColor ?? getStoredCourseChipColor(item.courseCode, undefined, item.courseName) ?? canvasCalendarTypeColors[item.courseworkType || 'study'] ?? 'blue',
      isCompleted: Boolean(item.completed),
      isStarred: Boolean(item.starred),
    }));
  const manualAssessmentItems = getStoredManualAssessments()
    .filter((item) => !item.hidden)
    .map((item) => ({
      id: item.id,
      source: 'manual-assessment' as const,
      title: item.title,
      type: item.assessmentType || 'quiz',
      courseCode: item.courseCode,
      dueAt: item.dueAt,
      startAt: item.startAt,
      endAt: item.endAt,
      semester: item.semester,
      color: getStoredCourseChipColor(item.courseCode, undefined, item.courseName) ?? canvasCalendarTypeColors[item.assessmentType || 'quiz'] ?? 'orange',
      isCompleted: Boolean(item.completed),
      isStarred: Boolean(item.starred),
    }));
  const classSessionItems = [
    ...getStoredManualLectures()
      .filter((lecture) => !lecture.hidden && !lecture.deleted)
      .flatMap((lecture) => createClassSessionItemsFromCourse(lecture, {
        ...classSessionCalendarOptions,
        sourceId: lecture.id ?? lecture.code ?? lecture.courseCode ?? lecture.courseName ?? 'manual',
      })),
    ...Object.entries(canvasLecturePreferences)
      .filter(([, preference]) => !preference.hidden && !preference.deleted && !preference.archivedAsManualLectureId)
      .flatMap(([courseId, preference]) => createClassSessionItemsFromCourse(preference, {
        ...classSessionCalendarOptions,
        courseId,
        sourceId: courseId,
      })),
  ].map((item) => applyHolidayCancellationToClassSession(item, calendarSettings));

  return [
    ...canvasSourceItems,
    ...storedCanvasCourseworkItems,
    ...storedCanvasAssessmentItems,
    ...manualCourseworkItems,
    ...manualAssessmentItems,
    ...classSessionItems,
  ];
}

function createAcademyCalendarDays(
  monthDate: Date,
  sourceItems: CalendarSourceItem[],
  loadStatus: CanvasCalendarLoadStatus,
  activeCourseOptionIds?: Set<string>,
): CalendarDay[] {
  const monthRange = getCalendarMonthRange(monthDate);
  const gridStartDate = getCalendarGridStartDate(monthDate);
  const todayIso = getTodayIsoDate();
  const itemsByDate = sourceItems.reduce<Record<string, CalendarSourceItem[]>>((nextItemsByDate, item) => {
      const date = getLocalIsoDate(getCalendarSourceItemDate(item));

      if (!date) {
        return nextItemsByDate;
      }

      nextItemsByDate[date] = [...(nextItemsByDate[date] ?? []), item];

      return nextItemsByDate;
    }, {})

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(
      gridStartDate.getUTCFullYear(),
      gridStartDate.getUTCMonth(),
      gridStartDate.getUTCDate() + index,
    ));
    const dateIso = getIsoDateFromUtcDate(date);
    const dateItems = itemsByDate[dateIso] ?? [];
    const dayCellItems = dateItems.filter((item) => (
      item.source !== 'class-session' || !item.isCanceledForHoliday
    ));
    const events = dayCellItems.map((item) => getCalendarSourceEvent(item, activeCourseOptionIds));
    const dayProgress = getDayTodoProgress(dateItems);
    const outsideMonth = date.getUTCMonth() !== monthRange.monthIndex;
    const status = outsideMonth
      ? ''
      : loadStatus === 'loading'
        ? 'Loading'
        : events.length > 0
          ? `${events.length} Canvas`
          : 'Canvas';

    return {
      id: `academy-${dateIso}`,
      dateIso,
      dateNumber: date.getUTCDate(),
      isSunday: date.getUTCDay() === 0,
      isToday: dateIso === todayIso,
      outsideMonth,
      status,
      progress: dayProgress.percent,
      progressLabel: dayProgress.label,
      events,
    };
  });
}

function createAcademyCalendarData(
  data: WorkspaceModeMockData,
  monthDate: Date,
  sourceItems: CalendarSourceItem[],
  loadStatus: CanvasCalendarLoadStatus,
  agendaDateIso: string,
  fallbackCourseLabel: string,
  activeCourseOptionIds?: Set<string>,
): WorkspaceModeMockData {
  const agenda = sourceItems
    .filter((item) => getLocalIsoDate(getCalendarSourceItemDate(item)) === agendaDateIso)
    .sort((firstItem, secondItem) => (
      new Date(getCalendarSourceItemDate(firstItem) ?? '').getTime() -
      new Date(getCalendarSourceItemDate(secondItem) ?? '').getTime()
    ))
    .map((item) => getCalendarSourceAgendaItem(item, fallbackCourseLabel, activeCourseOptionIds));

  return {
    ...data,
    agenda,
    boardItems: getCalendarBoardItems(
      sourceItems.filter((item) => getLocalIsoDate(getCalendarSourceItemDate(item)) === agendaDateIso),
      fallbackCourseLabel,
      activeCourseOptionIds,
    ),
    days: createAcademyCalendarDays(monthDate, sourceItems, loadStatus, activeCourseOptionIds),
    monthLabel: formatCalendarMonthLabel(monthDate),
  };
}

function getHolidayItemsForDateByNations(nations: AcademyNation[], dateIso: string) {
  return nations.flatMap((nation) => {
    const holiday = getHolidayForDateByNation(nation, dateIso);
    const nationOption = getAcademyNationOptionByValue(nation);

    return holiday && nationOption
      ? [{ holiday, nationOption }]
      : [];
  });
}

function formatCalendarTodoType(value: string) {
  return value
    .split(/[\s,_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatDateInputValue(value?: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const pad = (part: number) => String(part).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoFromDateInput(value: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function optionalIsoFromDateInput(value: string) {
  const isoValue = toIsoFromDateInput(value);

  return isoValue || undefined;
}

function formatSettingsDateTime(value?: string, locale = 'en-CA') {
  if (!value) {
    return '--';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  return date.toLocaleString(locale, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

let fallbackClientIdSequence = 0;

function getCurrentTimeMilliseconds() {
  return Date.now();
}

function createClientRuntimeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  fallbackClientIdSequence += 1;
  return `${new Date().getTime()}-${fallbackClientIdSequence}`;
}

function toggleCalendarSourceItemDone(item: CalendarSourceItem) {
  if (item.isLocked) {
    return;
  }

  const checkedAt = new Date().toISOString();

  if (item.source === 'manual-coursework') {
    const nextCoursework = getStoredManualCoursework().map((coursework) => (
      coursework.id === item.id ? {
        ...coursework,
        completed: !coursework.completed,
        completedAt: coursework.completed ? undefined : checkedAt,
      } : coursework
    ));
    storeJson(manualCourseworkStorageKey, nextCoursework);
    return;
  }

  if (item.source === 'manual-assessment') {
    const nextAssessments = getStoredManualAssessments().map((assessment) => (
      assessment.id === item.id ? {
        ...assessment,
        completed: !assessment.completed,
        completedAt: assessment.completed ? undefined : checkedAt,
      } : assessment
    ));
    storeJson(manualAssessmentsStorageKey, nextAssessments);
    return;
  }

  const preferenceKey = isAssessmentType(item.type, item.title)
    ? canvasAssessmentPreferencesStorageKey
    : canvasCourseworkPreferencesStorageKey;
  const currentPreferences = preferenceKey === canvasAssessmentPreferencesStorageKey
    ? getStoredCanvasAssessmentPreferences()
    : getStoredCanvasCourseworkPreferences();

  storeJson(preferenceKey, {
    ...currentPreferences,
    [item.id]: {
      ...(currentPreferences[item.id] ?? {}),
      completed: !currentPreferences[item.id]?.completed,
      completedAt: currentPreferences[item.id]?.completed ? undefined : checkedAt,
    },
  });
}

interface CalendarTodoDetailsDraft {
  dueAt: string;
  endAt: string;
  startAt: string;
  title: string;
  type: string;
}

function createCalendarTodoDetailsDraft(item?: CalendarSourceItem | null): CalendarTodoDetailsDraft {
  return {
    dueAt: formatDateInputValue(item?.dueAt),
    endAt: formatDateInputValue(item?.endAt),
    startAt: formatDateInputValue(item?.startAt),
    title: item?.title ?? '',
    type: item?.type ?? 'assignment',
  };
}

function CalendarTodoDetailsDialog({
  item,
  onOpenItem,
  onOpenChange,
  onSave,
}: {
  item?: CalendarSourceItem | null;
  onOpenItem?: (item: CalendarSourceItem) => void;
  onOpenChange: (open: boolean) => void;
  onSave: (item: CalendarSourceItem, draft: CalendarTodoDetailsDraft) => void;
}) {
  const { dictionary } = useLanguage();
  const [draft, setDraft] = useState<CalendarTodoDetailsDraft>(() => createCalendarTodoDetailsDraft(item));
  const isCanvasManaged = isLiveCanvasCalendarItem(item);

  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl p-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black">{dictionary.courseworkEditTitle}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();

            if (item && !isCanvasManaged) {
              onSave(item, draft);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {isCanvasManaged ? (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm font-bold text-muted-foreground sm:col-span-2">
                {dictionary.courseworkCanvasManagedLocked}
              </div>
            ) : null}
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="calendar-todo-title">
                {dictionary.courseworkName}
              </Label>
              <Input
                disabled={isCanvasManaged}
                id="calendar-todo-title"
                onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, title: event.target.value }))}
                value={draft.title}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="calendar-todo-type">
                {dictionary.courseworkType}
              </Label>
              <Select
                disabled={isCanvasManaged}
                onValueChange={(value) => setDraft((currentDraft) => ({ ...currentDraft, type: value }))}
                value={draft.type || 'assignment'}
              >
                <SelectTrigger id="calendar-todo-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {calendarTodoTypes.map((todoType) => (
                    <SelectItem key={todoType} value={todoType}>
                      {formatCalendarTodoType(todoType)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="calendar-todo-start">
                {dictionary.calendarTodoStartAt}
              </Label>
              <DateTimeField
                defaultTime="09:00"
                disabled={isCanvasManaged}
                id="calendar-todo-start"
                onChange={(value) => setDraft((currentDraft) => ({ ...currentDraft, startAt: value }))}
                value={draft.startAt}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="calendar-todo-due">
                {dictionary.courseworkDueAt}
              </Label>
              <DateTimeField
                defaultTime="23:59"
                disabled={isCanvasManaged}
                id="calendar-todo-due"
                onChange={(value) => setDraft((currentDraft) => ({ ...currentDraft, dueAt: value }))}
                value={draft.dueAt}
              />
            </div>
            <details className="rounded-lg border bg-muted/20 p-3 sm:col-span-2">
              <summary className="cursor-pointer text-xs font-black uppercase text-muted-foreground">
                {dictionary.courseworkActualEndAt}
              </summary>
              <div className="mt-3 space-y-2">
                <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="calendar-todo-end">
                  {dictionary.courseworkActualEndAt}
                </Label>
                <DateTimeField
                  defaultTime="23:59"
                  disabled={isCanvasManaged}
                  id="calendar-todo-end"
                  onChange={(value) => setDraft((currentDraft) => ({ ...currentDraft, endAt: value }))}
                  value={draft.endAt}
                />
              </div>
            </details>
          </div>
          <DialogFooter>
            {item && onOpenItem ? (
              <Button className="mr-auto" onClick={() => onOpenItem(item)} type="button" variant="secondary">
                <ExternalLink className="size-4" />
                {dictionary.courseOverviewOpenCanvas}
              </Button>
            ) : null}
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              {dictionary.cancel}
            </Button>
            <Button disabled={isCanvasManaged} type="submit">{dictionary.courseworkUpdate}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AcademySettingsView({
  authSession,
  focusSection,
  onFocusSectionConsumed,
  hasUnsavedChanges,
  onProfileSaved,
  onRevertSettings,
  onSaveSettings,
  onSettingsChange,
  onSignOut,
  settings,
  settingsSaveError,
  settingsSaveStatus,
}: {
  authSession: AuthSession | null;
  focusSection?: 'profile' | null;
  onFocusSectionConsumed?: () => void;
  hasUnsavedChanges: boolean;
  onProfileSaved: () => Promise<void> | void;
  onRevertSettings: () => void;
  onSaveSettings: (settings: AcademyCalendarSettings) => void | Promise<void>;
  onSettingsChange: (settings: AcademyCalendarSettings) => void;
  onSignOut: () => void;
  settings: AcademyCalendarSettings;
  settingsSaveError?: string;
  settingsSaveStatus?: 'idle' | 'saving' | 'saved' | 'failed';
}) {
  const { dictionary, language, setLanguage } = useLanguage();
  const profileDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [profileDraft, setProfileDraft] = useState(() => ({
    confirmPassword: '',
    currentPassword: '',
    displayName: authSession?.displayName ?? '',
    newPassword: '',
  }));
  const [canvasTokenStatus, setCanvasTokenStatus] = useState<CanvasTokenStatus | null>(null);
  const [isCanvasTokenLoading, setIsCanvasTokenLoading] = useState(true);
  const [isCanvasTokenSaving, setIsCanvasTokenSaving] = useState(false);
  const [isCanvasTokenResetting, setIsCanvasTokenResetting] = useState(false);
  const [canvasTokenError, setCanvasTokenError] = useState('');
  const [canvasTokenMessage, setCanvasTokenMessage] = useState('');
  const [canvasTokenDraft, setCanvasTokenDraft] = useState({
    accessToken: '',
    expiresAt: '',
    instanceUrl: '',
    startsAt: '',
  });
  const [showAccentVariants, setShowAccentVariants] = useState(false);
  const [accentVariantPage, setAccentVariantPage] = useState(0);
  const [logoUploadError, setLogoUploadError] = useState('');
  const dateLocale = language === 'ko' ? 'ko-KR' : 'en-CA';
  const selectedFontFamilyOption = academyFontFamilyOptions.find((option) => option.value === settings.fontFamily) ??
    academyFontFamilyOptions[0];
  const defaultAcademyLogoSrc = appPath('/brand/SFU_block_colour_rgb.png');
  const isAcademyLogoHidden = settings.academyLogoSrc === 'none';
  const academyLogoPreviewSrc = isAcademyLogoHidden
    ? ''
    : settings.academyLogoSrc || defaultAcademyLogoSrc;
  const hasPassword = authSession?.hasPassword !== false;
  const updateProfileDraft = (field: keyof typeof profileDraft, value: string | boolean) => {
    setProfileDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  };
  const updateSettings = (partialSettings: Partial<AcademyCalendarSettings>) => {
    onSettingsChange(normalizeAcademyCalendarSettings({
      ...settings,
      ...partialSettings,
    }));
  };
  const handleAcademyLanguageChange = (value: string) => {
    const nextLanguage = value === 'ko' ? 'ko' : 'en';

    setLanguage(nextLanguage);
    updateSettings({ language: nextLanguage });
  };
  const updateThreshold = (
    key: 'progressGreenAt' | 'progressYellowAt' | 'gradeProgressGreenAt' | 'gradeProgressYellowAt',
    value: string,
  ) => {
    const parsedValue = Number.parseInt(value, 10);

    updateSettings({
      [key]: Number.isFinite(parsedValue) ? parsedValue : settings[key],
    });
  };
  const getGradePreviewColor = (score: number) => {
    if (score >= settings.gradeProgressGreenAt) {
      return '#10b981';
    }

    if (score >= settings.gradeProgressYellowAt) {
      return '#f59e0b';
    }

    return '#ef4444';
  };
  const handleLogoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    event.target.value = '';

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setLogoUploadError(dictionary.academyTopBarLogoInvalid);
      return;
    }

    // Base64 expands by roughly one third; keep the complete preferences request
    // comfortably below the API's 1 MiB JSON body limit.
    if (file.size > 384 * 1024) {
      setLogoUploadError(dictionary.academyTopBarLogoTooLarge);
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setLogoUploadError(dictionary.academyTopBarLogoInvalid);
        return;
      }

      setLogoUploadError('');
      updateSettings({ academyLogoSrc: reader.result });
    };
    reader.onerror = () => setLogoUploadError(dictionary.academyTopBarLogoInvalid);
    reader.readAsDataURL(file);
  };
  const handleProfileSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProfileError('');
    setProfileMessage('');

    if (hasPassword && (profileDraft.newPassword || profileDraft.confirmPassword || profileDraft.currentPassword)) {
      if (profileDraft.newPassword !== profileDraft.confirmPassword) {
        setProfileError(dictionary.academyProfilePasswordMismatch);
        return;
      }

      if (profileDraft.newPassword.length < 10 || !profileDraft.currentPassword) {
        setProfileError(dictionary.academyProfilePasswordInvalid);
        return;
      }
    }

    setIsProfileSaving(true);

    canvasToDoApi
      .updateAcademyProfile({
        displayName: profileDraft.displayName,
        currentPassword: profileDraft.currentPassword || undefined,
        newPassword: profileDraft.newPassword || undefined,
      })
      .then(async () => {
        await onProfileSaved();
        setProfileDraft((currentDraft) => ({
          ...currentDraft,
          confirmPassword: '',
          currentPassword: '',
          newPassword: '',
        }));
        setProfileMessage(dictionary.academyProfileSaved);
      })
      .catch((error: unknown) => {
        setProfileError(error instanceof Error ? error.message : dictionary.academyProfileSaveFailed);
      })
      .finally(() => setIsProfileSaving(false));
  };
  const accentColorLabels: Partial<Record<ColorToken, string>> = {
    blue: dictionary.manualLectureChipColorBlue,
    cyan: dictionary.manualLectureChipColorCyan,
    emerald: dictionary.manualLectureChipColorGreen,
    gold: dictionary.manualLectureChipColorGold,
    gray: dictionary.manualLectureChipColorGray,
    indigo: dictionary.manualLectureChipColorIndigo,
    orange: dictionary.manualLectureChipColorOrange,
    pink: dictionary.manualLectureChipColorPink,
    purple: dictionary.manualLectureChipColorPurple,
    red: dictionary.manualLectureChipColorRed,
    slate: dictionary.manualLectureChipColorSlate,
    teal: dictionary.manualLectureChipColorTeal,
    butter: dictionary.manualLectureChipColorButter,
    vanilla: dictionary.manualLectureChipColorVanilla,
    cream: dictionary.manualLectureChipColorCream,
    honeydew: dictionary.manualLectureChipColorHoneydew,
    pistachio: dictionary.manualLectureChipColorPistachio,
    sage: dictionary.manualLectureChipColorSage,
    seafoam: dictionary.manualLectureChipColorSeafoam,
    powder: dictionary.manualLectureChipColorPowder,
    babyblue: dictionary.manualLectureChipColorBabyBlue,
    periwinkle: dictionary.manualLectureChipColorPeriwinkle,
    wisteria: dictionary.manualLectureChipColorWisteria,
    blush: dictionary.manualLectureChipColorBlush,
    cottoncandy: dictionary.manualLectureChipColorCottonCandy,
    peachfuzz: dictionary.manualLectureChipColorPeachFuzz,
    softcoral: dictionary.manualLectureChipColorSoftCoral,
    flamingo: dictionary.manualLectureChipColorFlamingo,
    watermelon: dictionary.manualLectureChipColorWatermelon,
    tangerine: dictionary.manualLectureChipColorTangerine,
    marigold: dictionary.manualLectureChipColorMarigold,
    citron: dictionary.manualLectureChipColorCitron,
    neomint: dictionary.manualLectureChipColorNeoMint,
    jade: dictionary.manualLectureChipColorJade,
    lagoon: dictionary.manualLectureChipColorLagoon,
    serenity: dictionary.manualLectureChipColorSerenity,
    veryperi: dictionary.manualLectureChipColorVeryPeri,
    orchid: dictionary.manualLectureChipColorOrchid,
    amethyst: dictionary.manualLectureChipColorAmethyst,
  };
  const accentVariantColors =
    academyAccentColorVariantPages[accentVariantPage] ?? academyAccentColorVariantPages[0];
  const isVariantAccentSelected = !academyAccentColors.includes(settings.accentColor);
  const loadCanvasTokenStatus = useCallback(() => {
    setIsCanvasTokenLoading(true);
    setCanvasTokenError('');

    canvasToDoApi
      .getCanvasTokenStatus()
      .then((status) => {
        setCanvasTokenStatus(status);
        setCanvasTokenDraft((currentDraft) => ({
          ...currentDraft,
          accessToken: '',
          expiresAt: formatDateInputValue(status.expiresAt),
          instanceUrl: status.instanceUrl ?? currentDraft.instanceUrl,
          startsAt: formatDateInputValue(status.startsAt),
        }));
      })
      .catch((error: unknown) => {
        setCanvasTokenError(error instanceof Error ? error.message : dictionary.canvasTokenStatusUnavailable);
      })
      .finally(() => setIsCanvasTokenLoading(false));
  }, [dictionary.canvasTokenStatusUnavailable]);
  const refreshAfterLegacyAcademyImport = async () => {
    loadCanvasTokenStatus();
    const preferences = await canvasToDoApi.getAcademyPreferences();

    applyAcademyPreferencesResponse(preferences);
    dispatchAcademyPreferencesUpdated();
  };
  const updateCanvasTokenDraft = (field: keyof typeof canvasTokenDraft, value: string) => {
    setCanvasTokenDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  };
  const canvasTokenStatusLabels: Record<string, string> = {
    connected: dictionary.canvasTokenStatusConnected,
    expired: dictionary.canvasTokenStatusExpired,
    invalid: dictionary.canvasTokenStatusInvalid,
    needs_connection: dictionary.canvasTokenStatusNeedsConnection,
    pending: dictionary.canvasTokenStatusPending,
  };
  const canvasTokenSourceLabels: Record<string, string> = {
    environment: dictionary.canvasTokenSourceEnvironment,
    none: dictionary.canvasTokenSourceNone,
    oauth: dictionary.canvasTokenSourceOauth,
    user: dictionary.canvasTokenSourceUser,
  };
  const handleCanvasTokenSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCanvasTokenSaving(true);
    setCanvasTokenError('');
    setCanvasTokenMessage('');

    canvasToDoApi
      .updateCanvasToken({
        accessToken: canvasTokenDraft.accessToken,
        expiresAt: optionalIsoFromDateInput(canvasTokenDraft.expiresAt),
        instanceUrl: canvasTokenDraft.instanceUrl,
        startsAt: optionalIsoFromDateInput(canvasTokenDraft.startsAt),
      })
      .then((status) => {
        setCanvasTokenStatus(status);
        setCanvasTokenDraft((currentDraft) => ({
          ...currentDraft,
          accessToken: '',
          expiresAt: formatDateInputValue(status.expiresAt),
          instanceUrl: status.instanceUrl ?? currentDraft.instanceUrl,
          startsAt: formatDateInputValue(status.startsAt),
        }));
        setCanvasTokenMessage(dictionary.canvasTokenSaved);
      })
      .catch((error: unknown) => {
        setCanvasTokenError(error instanceof Error ? error.message : dictionary.canvasTokenSaveFailed);
      })
      .finally(() => setIsCanvasTokenSaving(false));
  };
  const handleCanvasTokenReset = () => {
    setIsCanvasTokenResetting(true);
    setCanvasTokenError('');
    setCanvasTokenMessage('');

    canvasToDoApi
      .deleteCanvasToken()
      .then((status) => {
        setCanvasTokenStatus(status);
        setCanvasTokenDraft((currentDraft) => ({
          ...currentDraft,
          accessToken: '',
          expiresAt: formatDateInputValue(status.expiresAt),
          instanceUrl: status.instanceUrl ?? currentDraft.instanceUrl,
          startsAt: formatDateInputValue(status.startsAt),
        }));
        setCanvasTokenMessage(dictionary.canvasTokenResetSaved);
      })
      .catch((error: unknown) => {
        setCanvasTokenError(error instanceof Error ? error.message : dictionary.canvasTokenResetFailed);
      })
      .finally(() => setIsCanvasTokenResetting(false));
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(loadCanvasTokenStatus, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadCanvasTokenStatus]);

  useEffect(() => {
    if (focusSection !== 'profile') {
      return;
    }

    const profileDetails = profileDetailsRef.current;

    if (!profileDetails) {
      return;
    }

    profileDetails.open = true;
    onFocusSectionConsumed?.();
    window.setTimeout(() => {
      profileDetails.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, [focusSection, onFocusSectionConsumed]);

  return (
    <div className="h-full min-h-0 overflow-hidden pb-3 pr-1">
      <Card className="flex h-full min-h-0 flex-col rounded-xl bg-card shadow-none">
        <CardHeader className="shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-xl font-black">{dictionary.academySettingsTitle}</CardTitle>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {hasUnsavedChanges ? (
                <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase text-amber-700 dark:text-amber-200">
                  {dictionary.academySettingsUnsaved}
                </span>
              ) : settingsSaveStatus && settingsSaveStatus !== 'idle' ? (
                <span className={cn(
                  'rounded-md border px-2 py-1 text-[10px] font-black uppercase',
                  settingsSaveStatus === 'failed'
                    ? 'border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-200'
                    : settingsSaveStatus === 'saving'
                      ? 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-200'
                      : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
                )}>
                  {settingsSaveStatus === 'saving'
                    ? dictionary.academySettingsSaving
                    : settingsSaveStatus === 'failed'
                      ? dictionary.academySettingsSaveFailed
                      : dictionary.academySettingsSaved}
                </span>
              ) : null}
              <Button
                className="h-8 rounded-md px-2.5 text-xs font-black"
                disabled={!hasUnsavedChanges || settingsSaveStatus === 'saving'}
                onClick={onRevertSettings}
                type="button"
                variant="outline"
              >
                <RotateCcw className="mr-1.5 size-3.5" />
                {dictionary.academySettingsRevert}
              </Button>
              <Button
                className="h-8 rounded-md px-3 text-xs font-black"
                disabled={!hasUnsavedChanges || settingsSaveStatus === 'saving'}
                onClick={() => onSaveSettings(settings)}
                type="button"
              >
                <Check className="mr-1.5 size-3.5" />
                {settingsSaveStatus === 'saving' ? dictionary.academySettingsSaving : dictionary.academySettingsSave}
              </Button>
            </div>
          </div>
          {settingsSaveError ? (
            <div className="mt-2 rounded-md border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-200">
              {settingsSaveError}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="grid min-h-0 flex-1 gap-3 overflow-y-auto overscroll-contain pr-2">
          <details className="group rounded-lg border bg-muted/20 p-3" ref={profileDetailsRef}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-foreground">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-primary">
                  <UserRound className="size-4" />
                </span>
                <span className="truncate">{dictionary.academyProfileSettingsTitle}</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <form className="mt-3 grid gap-4 rounded-lg border bg-card p-3" onSubmit={handleProfileSubmit}>
              <div className="grid gap-4">
                <div className="grid gap-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                      <span>{dictionary.academyName}</span>
                      <Input
                        autoComplete="name"
                        disabled={isProfileSaving}
                        onChange={(event) => updateProfileDraft('displayName', event.target.value)}
                        required
                        value={profileDraft.displayName}
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                      <span>{dictionary.accountEmail}</span>
                      <Input
                        autoCapitalize="none"
                        autoComplete="email"
                        disabled
                        type="email"
                        value={authSession?.email ?? ''}
                      />
                    </label>
                    {hasPassword ? (
                      <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground md:col-span-2">
                        <span>Current password (only needed when changing password)</span>
                        <Input
                          autoComplete="current-password"
                          disabled={isProfileSaving}
                          onChange={(event) => updateProfileDraft('currentPassword', event.target.value)}
                          type="password"
                          value={profileDraft.currentPassword}
                        />
                      </label>
                    ) : (
                      <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs font-semibold text-muted-foreground md:col-span-2">
                        {dictionary.academyProfileExternalPasswordNote}
                      </div>
                    )}
                  </div>
                  {hasPassword ? <div className="grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                      <span>{dictionary.academyProfileNewPassword}</span>
                      <Input
                        autoComplete="new-password"
                        disabled={isProfileSaving}
                        onChange={(event) => updateProfileDraft('newPassword', event.target.value)}
                        type="password"
                        value={profileDraft.newPassword}
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                      <span>{dictionary.academyConfirmPassword}</span>
                      <Input
                        autoComplete="new-password"
                        disabled={isProfileSaving}
                        onChange={(event) => updateProfileDraft('confirmPassword', event.target.value)}
                        type="password"
                        value={profileDraft.confirmPassword}
                      />
                    </label>
                  </div> : null}
                  <div className="grid gap-2 rounded-md border bg-muted/25 px-3 py-2 text-xs font-semibold text-muted-foreground">
                    <div className="flex min-w-0 justify-between gap-3">
                      <span>{dictionary.accountMenu}</span>
                      <span className="min-w-0 truncate text-right text-foreground">{authSession?.provider ?? dictionary.notSet}</span>
                    </div>
                    <div className="flex min-w-0 justify-between gap-3">
                      <span>{dictionary.accountEmail}</span>
                      <span className="min-w-0 truncate text-right text-foreground">{authSession?.email ?? dictionary.notSet}</span>
                    </div>
                  </div>
                </div>
              </div>
              {profileError ? (
                <div className="rounded-md border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-200">
                  {profileError}
                </div>
              ) : null}
              {profileMessage ? (
                <div className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-200">
                  {profileMessage}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  className="rounded-md"
                  onClick={onSignOut}
                  type="button"
                  variant="outline"
                >
                  <LogOut className="size-4" />
                  {dictionary.signOut}
                </Button>
                <Button
                  className="rounded-md"
                  disabled={isProfileSaving}
                  type="submit"
                >
                  {isProfileSaving ? dictionary.academyProfileSaving : dictionary.academyProfileSave}
                </Button>
              </div>
            </form>
          </details>
          <AccountSecurityPanel onChanged={onProfileSaved} />
          <LegacyAcademyImportPanel onImported={refreshAfterLegacyAcademyImport} />
          <details className="group rounded-lg border bg-muted/20 p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-foreground">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-primary">
                  <KeyRound className="size-4" />
                </span>
                <span className="truncate">{dictionary.canvasTokenSettingsTitle}</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid gap-3">
              {canvasTokenStatus?.oauthConfigured && canvasTokenStatus.connectUrl ? (
                <div className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h4 className="text-sm font-black text-foreground">{dictionary.canvasOauthTitle}</h4>
                    <p className="mt-1 text-xs font-semibold leading-5 text-muted-foreground">
                      {dictionary.canvasOauthDescription}
                    </p>
                  </div>
                  <Button
                    className="shrink-0 rounded-md"
                    onClick={() => {
                      const connectUrl = new URL(canvasTokenStatus.connectUrl ?? '', window.location.origin);
                      connectUrl.searchParams.set('returnUrl', `${appPath('/')}?canvasReturn=settings`);
                      window.location.assign(connectUrl.toString());
                    }}
                    type="button"
                  >
                    <ExternalLink className="size-4" />
                    {dictionary.canvasOauthConnect}
                  </Button>
                </div>
              ) : null}
              <div className="flex justify-end">
                <Button
                  className="h-8 rounded-md px-2.5 text-xs font-black"
                  disabled={isCanvasTokenLoading}
                onClick={loadCanvasTokenStatus}
                type="button"
                variant="outline"
                >
                  {dictionary.canvasTokenRefresh}
                </Button>
              </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {[
                [dictionary.canvasTokenStatusLabel, canvasTokenStatus ? canvasTokenStatusLabels[canvasTokenStatus.status] ?? canvasTokenStatus.status : '--'],
                [dictionary.canvasTokenSource, canvasTokenStatus ? canvasTokenSourceLabels[canvasTokenStatus.tokenSource] ?? canvasTokenStatus.tokenSource : '--'],
                [dictionary.canvasTokenExpiresAt, formatSettingsDateTime(canvasTokenStatus?.expiresAt, dateLocale)],
                [dictionary.canvasTokenStartsAt, formatSettingsDateTime(canvasTokenStatus?.startsAt, dateLocale)],
              ].map(([label, value]) => (
                <div className="min-w-0 rounded-lg border bg-card p-3" key={label}>
                  <div className="text-[10px] font-black uppercase text-muted-foreground">{label}</div>
                  <div className="mt-1 truncate text-sm font-black text-foreground">
                    {isCanvasTokenLoading ? dictionary.canvasTokenLoading : value}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-2 rounded-lg border bg-card p-3 text-xs font-semibold text-muted-foreground">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <span>{dictionary.canvasTokenInstanceUrl}</span>
                <span className="min-w-0 truncate text-right text-foreground">
                  {canvasTokenStatus?.instanceUrl ?? dictionary.notSet}
                </span>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-3">
                <span>{dictionary.canvasTokenConnectedUser}</span>
                <span className="min-w-0 truncate text-right text-foreground">
                  {canvasTokenStatus?.userName ?? dictionary.notSet}
                </span>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-3">
                <span>{dictionary.canvasTokenUpdatedAt}</span>
                <span className="min-w-0 truncate text-right text-foreground">
                  {formatSettingsDateTime(canvasTokenStatus?.updatedAt, dateLocale)}
                </span>
              </div>
            </div>

            {canvasTokenStatus?.manualTokenEnabled !== false ? (
            <form className="grid gap-3 rounded-lg border bg-card p-3" onSubmit={handleCanvasTokenSubmit}>
              <div>
                <h4 className="text-xs font-black uppercase text-muted-foreground">
                  {dictionary.canvasManualTokenTitle}
                </h4>
                <p className="mt-1 text-xs font-semibold normal-case leading-5 text-muted-foreground">
                  {dictionary.canvasManualTokenDescription}
                </p>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(260px,1.2fr)]">
                <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                  <span>{dictionary.canvasTokenInstanceUrl}</span>
                  <Input
                    autoComplete="off"
                    inputMode="url"
                    onChange={(event) => updateCanvasTokenDraft('instanceUrl', event.target.value)}
                    placeholder="https://sfu.instructure.com"
                    required
                    value={canvasTokenDraft.instanceUrl}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                  <span>{dictionary.canvasTokenValue}</span>
                  <Input
                    autoComplete="new-password"
                    onChange={(event) => updateCanvasTokenDraft('accessToken', event.target.value)}
                    placeholder={dictionary.canvasTokenValuePlaceholder}
                    required
                    type="password"
                    value={canvasTokenDraft.accessToken}
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                  <span>{dictionary.canvasTokenStartsAt}</span>
                  <DateTimeField
                    defaultTime="00:00"
                    onChange={(value) => updateCanvasTokenDraft('startsAt', value)}
                    value={canvasTokenDraft.startsAt}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                  <span>{dictionary.canvasTokenExpiresAt}</span>
                  <DateTimeField
                    defaultTime="23:59"
                    onChange={(value) => updateCanvasTokenDraft('expiresAt', value)}
                    value={canvasTokenDraft.expiresAt}
                  />
                </label>
              </div>
              {canvasTokenError ? (
                <div className="rounded-md border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-200">
                  {canvasTokenError}
                </div>
              ) : null}
              {canvasTokenMessage ? (
                <div className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-200">
                  {canvasTokenMessage}
                </div>
              ) : null}
              <div className="flex justify-end">
                <Button
                  className="mr-auto rounded-md"
                  disabled={isCanvasTokenSaving || isCanvasTokenResetting || canvasTokenStatus?.tokenSource !== 'user'}
                  onClick={handleCanvasTokenReset}
                  type="button"
                  variant="destructive"
                >
                  {isCanvasTokenResetting ? dictionary.canvasTokenResetting : dictionary.canvasTokenReset}
                </Button>
                <Button
                  className="rounded-md"
                  disabled={isCanvasTokenSaving || isCanvasTokenResetting}
                  type="submit"
                >
                  {isCanvasTokenSaving ? dictionary.canvasTokenSaving : dictionary.canvasTokenSave}
                </Button>
              </div>
            </form>
            ) : (
              <div className="rounded-lg border bg-muted/25 p-3 text-xs font-semibold text-muted-foreground">
                {dictionary.canvasManualTokenDisabled}
              </div>
            )}
            </div>
          </details>
          <details className="group rounded-lg border bg-muted/20 p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-foreground">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-primary">
                  <Palette className="size-4" />
                </span>
                <span className="truncate">{dictionary.academyThemeSettingsTitle}</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid gap-4">
              <div className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                <span>{dictionary.academyThemeMode}</span>
                <div className="flex flex-wrap gap-2">
                  {(['dark', 'light'] as const).map((mode) => (
                    <Button
                      className={cn(
                        'h-9 rounded-lg px-3 text-xs font-black',
                        settings.themeTimerEnabled
                          ? 'cursor-not-allowed opacity-45'
                          : settings.themeMode === mode
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                          : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                      disabled={settings.themeTimerEnabled}
                      key={mode}
                      onClick={() => updateSettings({ themeMode: mode })}
                      type="button"
                      variant="outline"
                    >
                      {mode === 'dark' ? (
                        <Moon className="mr-1.5 size-3.5" />
                      ) : (
                        <Sun className="mr-1.5 size-3.5" />
                      )}
                      {mode === 'dark'
                        ? dictionary.academyThemeDark
                        : dictionary.academyThemeLight}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-xs font-black uppercase text-muted-foreground">
                      <Clock3 className="size-3.5" />
                      {dictionary.academyThemeTimerEnabled}
                    </div>
                    <div className="mt-1 text-xs font-bold text-muted-foreground">
                      {dictionary.academyThemeTimerHint}
                    </div>
                  </div>
                  <Button
                    className={cn(
                      'h-9 rounded-lg px-3 text-xs font-black',
                      settings.themeTimerEnabled
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    onClick={() => updateSettings({ themeTimerEnabled: !settings.themeTimerEnabled })}
                    type="button"
                    variant="outline"
                  >
                    {settings.themeTimerEnabled ? dictionary.settingEnabled : dictionary.settingDisabled}
                  </Button>
                </div>
                {settings.themeTimerEnabled ? (
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_120px]">
                    <div className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                      <span>{dictionary.academyThemeTimerMode}</span>
                      <div className="flex flex-wrap gap-2">
                        {(['light', 'dark'] as const).map((mode) => (
                          <Button
                            className={cn(
                              'h-9 rounded-lg px-3 text-xs font-black',
                              settings.themeTimerMode === mode
                                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                            )}
                            key={mode}
                            onClick={() => updateSettings({ themeTimerMode: mode })}
                            type="button"
                            variant="outline"
                          >
                            {mode === 'dark' ? (
                              <Moon className="mr-1.5 size-3.5" />
                            ) : (
                              <Sun className="mr-1.5 size-3.5" />
                            )}
                            {mode === 'dark'
                              ? dictionary.academyThemeDark
                              : dictionary.academyThemeLight}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                      <span>{dictionary.academyThemeTimerStart}</span>
                      <input
                        className="h-9 rounded-md border bg-background px-3 text-sm font-bold text-foreground"
                        onChange={(event) => updateSettings({ themeTimerStart: event.target.value })}
                        type="time"
                        value={settings.themeTimerStart}
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                      <span>{dictionary.academyThemeTimerEnd}</span>
                      <input
                        className="h-9 rounded-md border bg-background px-3 text-sm font-bold text-foreground"
                        onChange={(event) => updateSettings({ themeTimerEnd: event.target.value })}
                        type="time"
                        value={settings.themeTimerEnd}
                      />
                    </label>
                  </div>
                ) : null}
              </div>
              <div className="grid gap-2 text-xs font-black uppercase text-muted-foreground">
                <span>{dictionary.academyThemeAccentColor}</span>
                <div className="grid grid-cols-6 gap-2 sm:flex sm:flex-wrap">
                  {academyAccentColors.map((color) => (
                    <button
                      aria-label={accentColorLabels[color] ?? color}
                      className={cn(
                        'grid size-9 place-items-center rounded-lg border bg-card transition hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
                        settings.accentColor === color && 'border-primary bg-primary/10 ring-2 ring-primary/45',
                      )}
                      key={color}
                      onClick={() => updateSettings({ accentColor: color })}
                      title={accentColorLabels[color] ?? color}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className={cn('size-4 rounded-full border border-foreground/10', dotColorClasses[color])}
                      />
                    </button>
                  ))}
                  <button
                    aria-expanded={showAccentVariants}
                    className={cn(
                      'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs font-black normal-case text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                      (showAccentVariants || isVariantAccentSelected) && 'border-primary bg-primary/10 text-primary ring-2 ring-primary/35',
                    )}
                    onClick={() => setShowAccentVariants((currentValue) => !currentValue)}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="size-3 rounded-full"
                      style={{
                        background:
                          'conic-gradient(from 90deg, #ef4444, #f97316, #facc15, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)',
                      }}
                    />
                    {dictionary.manualLectureChipColorOther}
                  </button>
                </div>
                {showAccentVariants ? (
                  <div className="rounded-lg border bg-card p-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Button
                        aria-label={dictionary.manualLectureChipColorPrevious}
                        className="size-8 rounded-md"
                        disabled={accentVariantPage === 0}
                        onClick={() => setAccentVariantPage((currentPage) => Math.max(0, currentPage - 1))}
                        size="icon-sm"
                        type="button"
                        variant="outline"
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                      <span className="text-[11px] font-black text-muted-foreground">
                        {accentVariantPage + 1}/{academyAccentColorVariantPages.length}
                      </span>
                      <Button
                        aria-label={dictionary.manualLectureChipColorNext}
                        className="size-8 rounded-md"
                        disabled={accentVariantPage === academyAccentColorVariantPages.length - 1}
                        onClick={() => setAccentVariantPage((currentPage) => Math.min(
                          academyAccentColorVariantPages.length - 1,
                          currentPage + 1,
                        ))}
                        size="icon-sm"
                        type="button"
                        variant="outline"
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
                      {accentVariantColors.map((color) => (
                        <button
                          aria-label={accentColorLabels[color] ?? color}
                          className={cn(
                            'grid size-8 place-items-center rounded-md transition hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
                            settings.accentColor === color && 'bg-primary/12 ring-2 ring-primary/45',
                          )}
                          key={color}
                          onClick={() => updateSettings({ accentColor: color })}
                          title={accentColorLabels[color] ?? color}
                          type="button"
                        >
                          <span
                            aria-hidden="true"
                            className={cn('size-4 rounded-full border border-foreground/10', dotColorClasses[color])}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </details>
          <details className="group rounded-lg border bg-muted/20 p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-foreground">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-primary">
                  <Languages className="size-4" />
                </span>
                <span className="truncate">{dictionary.academyLanguageSettingsTitle}</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid gap-3 rounded-lg border bg-card p-3 md:grid-cols-4">
              <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                <span>{dictionary.academyLanguageSelection}</span>
                <Select onValueChange={handleAcademyLanguageChange} value={settings.language}>
                  <SelectTrigger className="h-9 rounded-md bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {languageOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                <span>{dictionary.academyNationSelection}</span>
                <Select
                  onValueChange={(value) => updateSettings({ nation: value as AcademyNation })}
                  value={settings.nation}
                >
                  <SelectTrigger className="h-9 rounded-md bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {academyNationOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <span aria-hidden="true">{option.flag}</span>
                          <span>{option.label}</span>
                          <span className="text-[10px] font-bold text-muted-foreground">{option.timeZone}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[11px] normal-case text-muted-foreground">
                  {dictionary.academyNationSelectionHint}
                </span>
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                <span>{dictionary.academyFontFamily}</span>
                <Select
                  onValueChange={(value) => updateSettings({ fontFamily: value as AcademyFontFamily })}
                  value={settings.fontFamily}
                >
                  <SelectTrigger
                    className="h-9 rounded-md bg-background"
                    style={{ fontFamily: selectedFontFamilyOption.cssValue }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {academyFontFamilyOptions.map((option) => (
                      <SelectItem
                        key={option.value}
                        style={{ fontFamily: option.cssValue }}
                        value={option.value}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <div className="grid gap-2 text-xs font-black uppercase text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <TypeIcon className="size-3.5" />
                  {dictionary.academyFontSize}
                </span>
                <div className="grid grid-cols-[minmax(0,1fr)_64px] items-center gap-2">
                  <input
                    aria-label={dictionary.academyFontSize}
                    className="h-2 w-full cursor-pointer accent-primary"
                    max={130}
                    min={80}
                    onChange={(event) => updateSettings({ fontSizePercent: Number(event.target.value) })}
                    step={5}
                    type="range"
                    value={settings.fontSizePercent}
                  />
                  <div className="grid h-9 place-items-center rounded-md border bg-muted/30 text-sm font-black text-foreground">
                    {settings.fontSizePercent}%
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {academyFontSizeOptions.map((percent) => (
                    <Button
                      className={cn(
                        'h-7 rounded-md px-2 text-[10px] font-black',
                        settings.fontSizePercent === percent &&
                          'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
                      )}
                      key={percent}
                      onClick={() => updateSettings({ fontSizePercent: percent })}
                      type="button"
                      variant="outline"
                    >
                      {percent}%
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </details>
          <details className="group rounded-lg border bg-muted/20 p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-foreground">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-primary">
                  <Clock3 className="size-4" />
                </span>
                <span className="truncate">{dictionary.academySessionSettingsTitle}</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid gap-3">
              <div className="grid gap-2 rounded-lg border bg-card p-3">
                <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                  <span>{dictionary.academyAutoRefreshInterval}</span>
                  <Select
                    onValueChange={(value) => updateSettings({ autoRefreshIntervalMs: Number(value) })}
                    value={String(settings.autoRefreshIntervalMs)}
                  >
                    <SelectTrigger className="h-9 rounded-md bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {academyAutoRefreshIntervalOptions.map((intervalMs) => (
                        <SelectItem key={intervalMs} value={String(intervalMs)}>
                          {formatAcademyAutoRefreshInterval(intervalMs)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <div className="text-xs font-bold text-muted-foreground">
                  {dictionary.academyAutoRefreshIntervalHint}
                </div>
              </div>
              <div className="grid gap-2 rounded-lg border bg-card p-3">
                <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                  <span>{dictionary.academyRefocusRefreshThrottle}</span>
                  <Select
                    onValueChange={(value) => updateSettings({ refocusRefreshThrottleMs: Number(value) })}
                    value={String(settings.refocusRefreshThrottleMs)}
                  >
                    <SelectTrigger className="h-9 rounded-md bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {academyRefocusRefreshThrottleOptions.map((intervalMs) => (
                        <SelectItem key={intervalMs} value={String(intervalMs)}>
                          {formatAcademyAutoRefreshInterval(intervalMs)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <div className="text-xs font-bold text-muted-foreground">
                  {dictionary.academyRefocusRefreshThrottleHint}
                </div>
              </div>
            </div>
          </details>
          <details className="group rounded-lg border bg-muted/20 p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-foreground">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-primary">
                  <LayoutPanelTop className="size-4" />
                </span>
                <span className="truncate">{dictionary.academyTopBarSettingsTitle}</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid gap-3">
              <div className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-[96px_minmax(0,1fr)]">
                <div className="flex items-center justify-center rounded-lg border bg-muted/30 p-3">
                  {isAcademyLogoHidden ? (
                    <span className="text-[10px] font-black uppercase text-muted-foreground">
                      {dictionary.academyTopBarLogoNone}
                    </span>
                  ) : (
                    <img
                      alt={dictionary.academyTopBarLogoPreview}
                      className="max-h-14 max-w-full object-contain"
                      key={academyLogoPreviewSrc}
                      onError={(event) => {
                        if (event.currentTarget.dataset.fallbackApplied !== 'true') {
                          event.currentTarget.dataset.fallbackApplied = 'true';
                          event.currentTarget.src = defaultAcademyLogoSrc;
                          return;
                        }

                        event.currentTarget.style.visibility = 'hidden';
                      }}
                      src={academyLogoPreviewSrc}
                    />
                  )}
                </div>
                <div className="grid min-w-0 gap-2">
                  <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <ImageIcon className="size-3.5" />
                      {dictionary.academyTopBarLogoUpload}
                    </span>
                    <Input
                      accept="image/*"
                      className="cursor-pointer file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-black file:text-primary-foreground"
                      onChange={handleLogoUpload}
                      type="file"
                    />
                  </label>
                  {logoUploadError ? (
                    <div className="rounded-md border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-200">
                      {logoUploadError}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      className="h-8 rounded-md px-2.5 text-xs font-black"
                      disabled={isAcademyLogoHidden}
                      onClick={() => updateSettings({ academyLogoSrc: 'none' })}
                      type="button"
                      variant="outline"
                    >
                      <EyeOff className="mr-1.5 size-3.5" />
                      {dictionary.academyTopBarLogoNone}
                    </Button>
                    <Button
                      className="h-8 rounded-md px-2.5 text-xs font-black"
                      disabled={!settings.academyLogoSrc}
                      onClick={() => updateSettings({ academyLogoSrc: '' })}
                      type="button"
                      variant="outline"
                    >
                      <RotateCcw className="mr-1.5 size-3.5" />
                      {dictionary.academyTopBarLogoReset}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {([false, true] as const).map((collapsed) => (
                  <Button
                    className={cn(
                      'h-9 rounded-lg px-3 text-xs font-black',
                      settings.topBarDefaultCollapsed === collapsed
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    key={String(collapsed)}
                    onClick={() => updateSettings({ topBarDefaultCollapsed: collapsed })}
                    type="button"
                    variant="outline"
                  >
                    {collapsed
                      ? dictionary.academyTopBarCollapsed
                      : dictionary.academyTopBarExpanded}
                  </Button>
                ))}
              </div>
            </div>
          </details>
          <details className="group rounded-lg border bg-muted/20 p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-foreground">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-primary">
                  <ClipboardCheck className="size-4" />
                </span>
                <span className="truncate">{dictionary.courseworkCardSettingsTitle}</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-1.5 text-xs font-black uppercase text-muted-foreground">
                    {settings.courseworkShowStudyItems ? (
                      <Eye className="size-3.5" />
                    ) : (
                      <EyeOff className="size-3.5" />
                    )}
                    {dictionary.courseworkShowStudyItems}
                  </div>
                  <div className="mt-1 text-xs font-bold text-muted-foreground">
                    {dictionary.courseworkShowStudyItemsHint}
                  </div>
                </div>
                <Button
                  className={cn(
                    'h-9 rounded-lg px-3 text-xs font-black',
                    settings.courseworkShowStudyItems
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  onClick={() => updateSettings({
                    courseworkShowStudyItems: !settings.courseworkShowStudyItems,
                  })}
                  type="button"
                  variant="outline"
                >
                  {settings.courseworkShowStudyItems ? dictionary.settingEnabled : dictionary.settingDisabled}
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(160px,220px)_minmax(160px,220px)_minmax(0,1fr)]">
                <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                  <span>{dictionary.courseworkHideCompletedAfter}</span>
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      className="h-10 min-w-0 rounded-lg border bg-background px-3 text-sm font-bold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      min={0}
                      onChange={(event) => updateSettings({
                        courseworkHideCompletedAfterHours: Number.parseFloat(event.target.value) || 0,
                      })}
                      step={0.5}
                      type="number"
                      value={settings.courseworkHideCompletedAfterHours}
                    />
                    <span className="text-xs font-black lowercase text-muted-foreground">
                      {dictionary.courseworkHideHoursSuffix}
                    </span>
                  </div>
                </label>
                <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                  <span>{dictionary.courseworkHideUncompletedAfter}</span>
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      className="h-10 min-w-0 rounded-lg border bg-background px-3 text-sm font-bold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      min={0}
                      onChange={(event) => updateSettings({
                        courseworkHideUncompletedAfterHours: Number.parseFloat(event.target.value) || 0,
                      })}
                      step={0.5}
                      type="number"
                      value={settings.courseworkHideUncompletedAfterHours}
                    />
                    <span className="text-xs font-black lowercase text-muted-foreground">
                      {dictionary.courseworkHideHoursSuffix}
                    </span>
                  </div>
                </label>
                <div className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                  <span>{dictionary.courseworkHideCompletedFrom}</span>
                  <div className="flex flex-wrap gap-2">
                    {(['completedAt', 'dueAt'] as const).map((basis) => (
                      <Button
                        className={cn(
                          'h-10 rounded-lg px-3 text-xs font-black',
                          settings.courseworkHideCompletedFrom === basis
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                            : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                        key={basis}
                        onClick={() => updateSettings({ courseworkHideCompletedFrom: basis })}
                        type="button"
                        variant="outline"
                      >
                        {basis === 'completedAt'
                          ? dictionary.courseworkHideFromCheckedAt
                          : dictionary.courseworkHideFromDueAt}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </details>
          <details className="group rounded-lg border bg-muted/20 p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-foreground">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-primary">
                  <Activity className="size-4" />
                </span>
                <span className="truncate">{dictionary.calendarProgressSettingsTitle}</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid gap-3">
            <div className="grid gap-2 rounded-lg border bg-card p-3">
              <div className="text-xs font-black uppercase text-muted-foreground">
                {dictionary.calendarTodoStyle}
              </div>
              <div className="flex flex-wrap gap-2">
                {(['comfortable', 'compact'] as const).map((style) => (
                  <Button
                    className={cn(
                      'h-9 rounded-lg px-3 text-xs font-black',
                      settings.calendarTodoStyle === style
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    key={style}
                    onClick={() => updateSettings({ calendarTodoStyle: style })}
                    type="button"
                    variant="outline"
                  >
                    {style === 'comfortable'
                      ? dictionary.calendarTodoStyleComfortable
                      : dictionary.calendarTodoStyleCompact}
                  </Button>
                ))}
              </div>
              <div className="text-xs font-bold text-muted-foreground">
                {dictionary.calendarTodoStyleHint}
              </div>
            </div>
            <div className="grid gap-2 rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase text-muted-foreground">
                    {dictionary.calendarPastTermItems}
                  </div>
                  <div className="mt-1 text-xs font-bold text-muted-foreground">
                    {dictionary.calendarPastTermItemsHint}
                  </div>
                </div>
                <Button
                  className={cn(
                    'h-9 rounded-lg px-3 text-xs font-black',
                    settings.showPastTermCalendarItems
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  onClick={() => updateSettings({
                    showPastTermCalendarItems: !settings.showPastTermCalendarItems,
                  })}
                  type="button"
                  variant="outline"
                >
                  {settings.showPastTermCalendarItems ? dictionary.settingEnabled : dictionary.settingDisabled}
                </Button>
              </div>
            </div>
            <div className="grid gap-2 rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase text-muted-foreground">
                    {dictionary.calendarNoClassOnHoliday}
                  </div>
                  <div className="mt-1 text-xs font-bold text-muted-foreground">
                    {dictionary.calendarNoClassOnHolidayHint}
                  </div>
                </div>
                <Button
                  className={cn(
                    'h-9 rounded-lg px-3 text-xs font-black',
                    settings.skipClassOnHolidays
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  onClick={() => updateSettings({
                    skipClassOnHolidays: !settings.skipClassOnHolidays,
                  })}
                  type="button"
                  variant="outline"
                >
                  {settings.skipClassOnHolidays ? dictionary.settingEnabled : dictionary.settingDisabled}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['linear', 'circular'] as const).map((display) => (
                <Button
                  className={cn(
                    'h-9 rounded-lg px-3 text-xs font-black',
                    settings.progressDisplay === display
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  key={display}
                  onClick={() => updateSettings({ progressDisplay: display })}
                  type="button"
                  variant="outline"
                >
                  {display === 'linear'
                    ? dictionary.calendarProgressLinear
                    : dictionary.calendarProgressCircular}
                </Button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                <span>{dictionary.calendarProgressGreenAt}</span>
                <input
                  className="h-10 rounded-lg border bg-background px-3 text-sm font-bold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  max={100}
                  min={0}
                  onChange={(event) => updateThreshold('progressGreenAt', event.target.value)}
                  type="number"
                  value={settings.progressGreenAt}
                />
              </label>
              <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                <span>{dictionary.calendarProgressYellowAt}</span>
                <input
                  className="h-10 rounded-lg border bg-background px-3 text-sm font-bold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  max={settings.progressGreenAt}
                  min={0}
                  onChange={(event) => updateThreshold('progressYellowAt', event.target.value)}
                  type="number"
                  value={settings.progressYellowAt}
                />
              </label>
            </div>
            <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-card p-3">
              <CalendarProgressIndicator
                className="flex-1"
                display={settings.progressDisplay}
                label={dictionary.calendarProgressLabel}
                thresholds={{
                  greenAt: settings.progressGreenAt,
                  yellowAt: settings.progressYellowAt,
                }}
                value={65}
              />
              <span className="text-xs font-black text-muted-foreground">
                {dictionary.calendarProgressRedBelow}
              </span>
            </div>
            </div>
          </details>
          <details className="group rounded-lg border bg-muted/20 p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-foreground">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-primary">
                  <BarChart3 className="size-4" />
                </span>
                <span className="truncate">{dictionary.gradeProgressSettingsTitle}</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                  <span>{dictionary.gradeProgressGreenAt}</span>
                  <input
                    className="h-10 rounded-lg border bg-background px-3 text-sm font-bold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    max={100}
                    min={0}
                    onChange={(event) => updateThreshold('gradeProgressGreenAt', event.target.value)}
                    type="number"
                    value={settings.gradeProgressGreenAt}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                  <span>{dictionary.gradeProgressYellowAt}</span>
                  <input
                    className="h-10 rounded-lg border bg-background px-3 text-sm font-bold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    max={settings.gradeProgressGreenAt}
                    min={0}
                    onChange={(event) => updateThreshold('gradeProgressYellowAt', event.target.value)}
                    type="number"
                    value={settings.gradeProgressYellowAt}
                  />
                </label>
              </div>
              <div className="grid gap-2 rounded-lg border bg-card p-3">
                {[
                  [dictionary.gradeProgressGreenPreview, 82],
                  [dictionary.gradeProgressYellowPreview, 63],
                  [dictionary.gradeProgressRedPreview, 55],
                ].map(([label, score]) => (
                  <div className="grid grid-cols-[112px_minmax(0,1fr)_44px] items-center gap-2" key={label}>
                    <span className="truncate text-xs font-black text-muted-foreground">{label}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          backgroundColor: getGradePreviewColor(score as number),
                          width: `${score}%`,
                        }}
                      />
                    </div>
                    <span className="text-right text-xs font-black text-foreground">{score}%</span>
                  </div>
                ))}
                <span className="text-xs font-semibold text-muted-foreground">
                  {dictionary.gradeProgressThresholdHint}
                </span>
              </div>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}

function getAcademyNationOptionByValue(nation: AcademyNation | null | undefined) {
  return academyNationOptions.find((option) => option.value === nation);
}

function NationFlagIcon({
  alt,
  className,
  label,
  src,
}: {
  alt: string;
  className?: string;
  label?: string;
  src?: string;
}) {
  if (!src) {
    return (
      <span
        aria-label={alt}
        className={cn(
          'pointer-events-none inline-flex h-4 min-w-7 shrink-0 items-center justify-center rounded-sm border bg-muted px-1 text-[9px] font-black leading-none text-muted-foreground',
          className,
        )}
        role="img"
      >
        {label ?? 'UTC'}
      </span>
    );
  }

  return (
    <img
      alt={alt}
      className={cn('pointer-events-none h-4 w-6 shrink-0 rounded-sm object-cover ring-1 ring-border/70', className)}
      loading="lazy"
      onError={(event) => {
        event.currentTarget.style.display = 'none';
      }}
      referrerPolicy="no-referrer"
      src={src}
    />
  );
}

function WorkspaceViewFallback() {
  return (
    <div
      aria-live="polite"
      className="grid min-h-64 content-start gap-3 rounded-xl border bg-card p-4"
    >
      <div className="h-5 w-40 rounded-md bg-muted" />
      <div className="grid gap-2">
        <div className="h-20 rounded-lg bg-muted/70" />
        <div className="h-20 rounded-lg bg-muted/50" />
        <div className="h-20 rounded-lg bg-muted/40" />
      </div>
    </div>
  );
}

function AcademyBottomNavigationButton({
  active,
  icon,
  isPhone,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  isPhone: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className={cn(
        'mx-auto min-w-0 rounded-full bg-transparent p-0 transition-colors hover:bg-transparent',
        isPhone ? 'size-11' : 'size-10',
        active
          ? 'text-primary hover:text-primary'
          : 'text-muted-foreground hover:text-foreground',
      )}
      onClick={onClick}
      title={label}
      type="button"
      variant="ghost"
    >
      <WorkspaceIcon name={icon} size={isPhone ? 22 : 20} />
    </Button>
  );
}

function App() {
  const { activeData, activeMode } = useWorkspaceMode();
  const { dictionary, language, setLanguage, translateItemLabel } = useLanguage();
  const [navigation, setNavigation] = useState<WorkspaceNavigation>({
    modeId: '',
    sidebarItemId: 'dashboard',
    view: 'month',
  });
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [isWorkspaceSidebarCollapsed, setIsWorkspaceSidebarCollapsed] = useState(false);
  const [academyTopBarCollapseOverride, setAcademyTopBarCollapseOverride] = useState<{
    defaultValue: boolean;
    value: boolean;
  } | null>(null);
  const [academySettingsFocusSection, setAcademySettingsFocusSection] = useState<'profile' | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => getInitialCalendarMonth(activeData));
  const [selectedCalendarDayIso, setSelectedCalendarDayIso] = useState(getTodayIsoDate);
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);
  const [isDayTodoDialogOpen, setIsDayTodoDialogOpen] = useState(false);
  const [academyCalendarSettings, setAcademyCalendarSettings] = useState(getStoredAcademyCalendarSettings);
  const [savedAcademyCalendarSettings, setSavedAcademyCalendarSettings] = useState(getStoredAcademyCalendarSettings);
  const [academyThemeClock, setAcademyThemeClock] = useState(() => Date.now());
  const [academyResponsiveState, setAcademyResponsiveState] = useState(() => getAcademyResponsiveState());
  const [hiddenCalendarCourseIds, setHiddenCalendarCourseIds] = useState(getStoredHiddenCalendarCourseIds);
  const [academyPreferencesSaveStatus, setAcademyPreferencesSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [academyPreferencesSaveError, setAcademyPreferencesSaveError] = useState('');
  const [isAcademySettingsLeaveDialogOpen, setIsAcademySettingsLeaveDialogOpen] = useState(false);
  const [canvasTokenStatus, setCanvasTokenStatus] = useState<CanvasTokenStatus | null>(null);
  const [isCanvasTokenExpiryDialogOpen, setIsCanvasTokenExpiryDialogOpen] = useState(false);
  const [isCanvasTokenExpirySaving, setIsCanvasTokenExpirySaving] = useState(false);
  const [canvasTokenExpiryError, setCanvasTokenExpiryError] = useState('');
  const [selectedCourseOverviewRowId, setSelectedCourseOverviewRowId] = useState<string | null>(null);
  const [selectedCourseOverviewResourceUrl, setSelectedCourseOverviewResourceUrl] = useState<string | null>(null);
  const [canvasTokenExpiryDraft, setCanvasTokenExpiryDraft] = useState({
    accessToken: '',
    expiresAt: '',
  });
  const [focusedCalendarTodoId, setFocusedCalendarTodoId] = useState<string | null>(null);
  const [selectedCalendarTodoDetailsId, setSelectedCalendarTodoDetailsId] = useState<string | null>(null);
  const [canvasCalendarPages, setCanvasCalendarPages] = useState<Record<string, CanvasCalendarPage>>({});
  const [authRedirectMessage] = useState(getInitialAuthRedirectMessage);
  const [canvasRedirectFeedback, setCanvasRedirectFeedback] = useState(getInitialCanvasRedirectFeedback);
  const [academyPreferenceVersion, setAcademyPreferenceVersion] = useState(0);
  const [hasLoadedAcademyPreferences, setHasLoadedAcademyPreferences] = useState(false);
  const [academyPreferencesLoadStatus, setAcademyPreferencesLoadStatus] =
    useState<CanvasCalendarLoadStatus>('idle');
  const calendarTodoTapTimeoutRef = useRef<{ itemId: string; timeoutId: number } | null>(null);
  const isApplyingHistoryRef = useRef(false);
  const hasAppliedUrlNavigationRef = useRef(false);
  const academyPreferencesSaveSequenceRef = useRef(0);
  const academyPreferencesLoadSequenceRef = useRef(0);
  const isAcademyPreferencesSavingRef = useRef(false);
  const academyCalendarSettingsRef = useRef(academyCalendarSettings);
  const savedAcademyCalendarSettingsRef = useRef(savedAcademyCalendarSettings);
  const academySettingsProtectedUntilRef = useRef(0);
  const hasLoadedRemoteAcademySettingsRef = useRef(false);
  const hasUnsavedAcademySettingsRef = useRef(false);
  const authSessionKeyRef = useRef<string | null>(null);
  const ignoredExpiredCanvasTokenOwnerRef = useRef<string | null>(null);
  const canvasTokenStatusLoadSequenceRef = useRef(0);
  const hasHandledCanvasRedirectRef = useRef(false);
  const pendingSettingsNavigationRef = useRef<(() => void) | null>(null);
  const academyResumeRefreshRef = useRef({
    isRunning: false,
    lastStartedAt: 0,
  });
const accessKey = (authSession?.access ?? []).join('\u001f');
  const academyAutoRefreshIntervalMs = academyCalendarSettings.autoRefreshIntervalMs;
  const academyRefocusRefreshThrottleMs = academyCalendarSettings.refocusRefreshThrottleMs;
  const accessSet = useMemo(
    () => createAccessSet(accessKey ? accessKey.split('\u001f') : []),
    [accessKey],
  );
  const {
    isCalendarAutoExpanded,
    isDayTodoDialogMode,
    isExtraLarge: isAcademyEffectiveExtraLarge,
    isLarge: isAcademyEffectiveLarge,
    isPhoneAcademyMode,
    isTwoExtraLarge: isAcademyEffectiveTwoExtraLarge,
  } = academyResponsiveState;
  const filteredActiveMode = useMemo(
    () => filterModeForAccess(activeMode, accessSet),
    [accessSet, activeMode],
  );
  const firstAccessibleSidebarItem = getFirstAccessibleSidebarItem(activeMode, accessSet);
  const requestedSidebarItem =
    navigation.modeId === activeMode.id
      ? navigation.sidebarItemId
      : firstAccessibleSidebarItem?.id ?? 'dashboard';
  const activeSidebarItem = canAccessSidebarItem(activeMode.id, requestedSidebarItem, accessSet)
    ? requestedSidebarItem
    : firstAccessibleSidebarItem?.id ?? requestedSidebarItem;
  const activeView = navigation.modeId === activeMode.id ? navigation.view : 'month';
  const currentView = activeMode.views.includes(activeView) ? activeView : (activeMode.views[0] ?? 'month');
  const isAcademySettingsView = activeSidebarItem === 'settings';
  const isAdminUsersView = activeSidebarItem === 'admin-users';
  const isCoursesView = activeSidebarItem === 'courses';
  const isGradesView = activeSidebarItem === 'grades';
  const isInboxView = activeSidebarItem === 'inbox';
  const isPeopleView = activeSidebarItem === 'people';
  const isMainOnlyView =
    isAcademySettingsView ||
    isAdminUsersView ||
    isCoursesView ||
    isGradesView ||
    isInboxView ||
    isPeopleView;
  const isDashboardWorkspaceView = !isMainOnlyView;
  const shouldAutoExpandCalendar = isCalendarAutoExpanded && isPhoneAcademyMode;
  const effectiveCalendarExpanded = isCalendarExpanded || shouldAutoExpandCalendar;
  const canvasCalendarMonthKey = getCalendarMonthKey(calendarMonth);
  const visibleCalendarMonths = useMemo(() => getVisibleCalendarMonths(calendarMonth), [calendarMonth]);
  const visibleCalendarMonthKeys = visibleCalendarMonths.map((monthDate) => getCalendarMonthKey(monthDate));
  const isCalendarDataView = !isMainOnlyView && (
    currentView === 'month' ||
    currentView === 'agenda' ||
    currentView === 'board'
  );
  const selectedAcademySemester = normalizeSemesterName(academyCalendarSettings.selectedSemester);
  const shouldFetchLiveCanvasCalendar = selectedAcademySemester !== defaultCanvasTermSemester;
  const shouldLoadCanvasCalendar =
    authStatus === 'authenticated' &&
    isCalendarDataView &&
    shouldFetchLiveCanvasCalendar;
  const canvasCalendarPage = canvasCalendarPages[canvasCalendarMonthKey];
  const isCanvasCalendarPageLoaded = canvasCalendarPage?.status === 'loaded';
  const visibleCanvasCalendarItems = getCanvasCalendarItemsForMonthKeys(
    canvasCalendarPages,
    visibleCalendarMonthKeys,
  );
  const hasIncompleteVisibleCanvasCalendar = visibleCalendarMonthKeys.some(
    (monthKey) => canvasCalendarPages[monthKey]?.isComplete === false,
  );
  const canvasCalendarLoadStatus: CanvasCalendarLoadStatus =
    canvasCalendarPage?.status ?? (shouldLoadCanvasCalendar ? 'loading' : 'idle');
  const isWaitingForAcademyPreferences =
    !hasLoadedAcademyPreferences &&
    academyPreferencesLoadStatus !== 'failed';
  const hasFailedAcademyPreferencesLoad =
    !hasLoadedAcademyPreferences &&
    academyPreferencesLoadStatus === 'failed';
  const effectiveCanvasCalendarLoadStatus: CanvasCalendarLoadStatus =
    isWaitingForAcademyPreferences
      ? 'loading'
      : hasFailedAcademyPreferencesLoad
        ? 'failed'
        : canvasCalendarLoadStatus;
  const canvasCalendarEmptyMessage = effectiveCanvasCalendarLoadStatus === 'failed'
    ? hasFailedAcademyPreferencesLoad
      ? dictionary.academyPreferencesUnavailable
      : canvasCalendarPage?.errorMessage ?? dictionary.canvasCalendarUnavailable
    : undefined;
  const canRenderAcademyCalendarSourceItems = hasLoadedAcademyPreferences;
  const allCalendarSourceItems = canRenderAcademyCalendarSourceItems
    ? getCalendarSourceItems(visibleCanvasCalendarItems, academyPreferenceVersion, academyCalendarSettings)
        .filter((item) => (
          academyCalendarSettings.showPastTermCalendarItems ||
          semesterMatches(item.semester, selectedAcademySemester)
        ))
        .filter((item) => !isCourseReferenceHidden(item))
    : [];
  const calendarCourseFilterOptions = canRenderAcademyCalendarSourceItems
    ? getActiveCalendarCourseOptions(
        visibleCanvasCalendarItems,
        hiddenCalendarCourseIds,
        dictionary.selectedDayTodoNoCourse,
        selectedAcademySemester,
      )
    : [];
  const activeCalendarCourseOptionIds = new Set(calendarCourseFilterOptions.map((option) => option.id));
  const calendarSourceItems = filterCalendarSourceItemsByCourse(
    allCalendarSourceItems,
    hiddenCalendarCourseIds,
    dictionary.selectedDayTodoNoCourse,
  );
  const selectedDaySourceItems = calendarSourceItems
    .filter((item) => getLocalIsoDate(getCalendarSourceItemDate(item)) === selectedCalendarDayIso)
    .sort((firstItem, secondItem) => (
      new Date(getCalendarSourceItemDate(firstItem) ?? '').getTime() -
      new Date(getCalendarSourceItemDate(secondItem) ?? '').getTime()
    ));
  const inactiveSelectedDayCourseOptions = Array.from(
    selectedDaySourceItems.reduce<Map<string, CalendarCourseFilterOption>>((options, item) => {
      const option = getCalendarCourseFilterOption(item, dictionary.selectedDayTodoNoCourse);

      if (!activeCalendarCourseOptionIds.has(option.id) && !options.has(option.id)) {
        options.set(option.id, {
          ...option,
          canAdd: false,
          checked: true,
        });
      }

      return options;
    }, new Map()).values(),
  );
  const calendarBoardCourseOptions = [...calendarCourseFilterOptions, ...inactiveSelectedDayCourseOptions];
  const calendarBoardColumns = getCalendarBoardColumns(calendarBoardCourseOptions);
  const selectedDayItemsByCourse = selectedDaySourceItems.reduce<Record<string, SelectedDayCourseGroup>>((groups, item) => {
    const courseDisplay = getActiveAwareCourseDisplay(
      item,
      dictionary.selectedDayTodoNoCourse,
      activeCalendarCourseOptionIds,
    );

    return {
      ...groups,
      [courseDisplay.label]: {
        color: courseDisplay.color,
        items: [...(groups[courseDisplay.label]?.items ?? []), item],
        label: courseDisplay.label,
      },
    };
  }, {});
  const selectedDayGroups: SelectedDayCourseGroup[] = [
    ...calendarCourseFilterOptions
      .filter((option) => option.checked)
      .map((option) => ({
        color: option.color,
        canAdd: option.canAdd !== false,
        items: selectedDayItemsByCourse[option.label]?.items ?? [],
        label: option.label,
      })),
    ...Object.values(selectedDayItemsByCourse)
      .filter((group) => !calendarCourseFilterOptions.some((option) => option.label === group.label))
      .map((group) => ({ ...group, canAdd: false })),
  ];
  const selectedDayHeading = formatSelectedDayHeading(selectedCalendarDayIso, language);
  const selectedDayHolidayItems = getHolidayItemsForDateByNations(
    [academyCalendarSettings.nation],
    selectedCalendarDayIso,
  );
  const selectedDayRelativeBadge = formatRelativeDayBadge(selectedCalendarDayIso);
  const activeCalendarTodayIso = getTodayIsoDate();
  const isSelectedCalendarDayToday = selectedCalendarDayIso === activeCalendarTodayIso;
  const calendarData = createAcademyCalendarData(
    activeData,
    calendarMonth,
    calendarSourceItems,
    effectiveCanvasCalendarLoadStatus,
    selectedCalendarDayIso,
    dictionary.selectedDayTodoNoCourse,
    activeCalendarCourseOptionIds,
  );
  const selectedDayProgressInfo = getDayTodoProgress(selectedDaySourceItems);
  const selectedCalendarTodoDetailsItem = selectedCalendarTodoDetailsId
    ? calendarSourceItems.find((item) => item.id === selectedCalendarTodoDetailsId) ?? null
    : null;
  const selectedDayProgress = selectedDayProgressInfo.percent;
  const calendarProgressThresholds: CalendarProgressThresholds = {
    greenAt: academyCalendarSettings.progressGreenAt,
    yellowAt: academyCalendarSettings.progressYellowAt,
  };
  const shouldForceDashboardCalendarFill =
    isDashboardWorkspaceView &&
    effectiveCalendarExpanded &&
    !isPhoneAcademyMode;
  const canShowAcademyDashboardSideTodo =
    isDashboardWorkspaceView &&
    isAcademyEffectiveTwoExtraLarge;
  const shouldUseCompactDashboardMonth =
    isDashboardWorkspaceView &&
    !isPhoneAcademyMode &&
    !effectiveCalendarExpanded &&
    !canShowAcademyDashboardSideTodo;
  const shouldUseAcademyFullHeightLayout =
    isAcademyEffectiveLarge ||
    shouldForceDashboardCalendarFill ||
    shouldUseCompactDashboardMonth;
  const shouldHideCompactAcademyTopBar =
    isDashboardWorkspaceView &&
    !isPhoneAcademyMode &&
    !canShowAcademyDashboardSideTodo;
  const shouldShowAcademyBottomNav = !isAcademyEffectiveLarge;
  const mainGridColumnsClass = isMainOnlyView
    ? isWorkspaceSidebarCollapsed
      ? 'grid-cols-[78px_minmax(0,1fr)]'
      : 'grid-cols-[220px_minmax(0,1fr)]'
    : isWorkspaceSidebarCollapsed
      ? canShowAcademyDashboardSideTodo
        ? 'grid-cols-[82px_minmax(0,1fr)_340px]'
        : 'grid-cols-[78px_minmax(0,1fr)]'
      : canShowAcademyDashboardSideTodo
        ? 'grid-cols-[230px_minmax(0,1fr)_340px]'
        : 'grid-cols-[220px_minmax(0,1fr)]';
  const effectiveTopBarCollapsed =
    academyTopBarCollapseOverride?.defaultValue === academyCalendarSettings.topBarDefaultCollapsed
      ? academyTopBarCollapseOverride.value
      : academyCalendarSettings.topBarDefaultCollapsed;
  const hasUnsavedAcademySettings = !areAcademyCalendarSettingsEqual(
    academyCalendarSettings,
    savedAcademyCalendarSettings,
  );
  const academyEffectiveTheme = getAcademyEffectiveTheme(
    academyCalendarSettings,
    new Date(academyThemeClock),
  );

  useEffect(() => {
    academyCalendarSettingsRef.current = academyCalendarSettings;
  }, [academyCalendarSettings]);

  useEffect(() => {
    savedAcademyCalendarSettingsRef.current = savedAcademyCalendarSettings;
  }, [savedAcademyCalendarSettings]);

  useEffect(() => {
    hasUnsavedAcademySettingsRef.current = hasUnsavedAcademySettings;
  }, [hasUnsavedAcademySettings]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedAcademySettingsRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = dictionary.academySettingsBeforeUnload;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [dictionary.academySettingsBeforeUnload]);

  const requestSettingsNavigation = (action: () => void) => {
    if (isAcademySettingsView && hasUnsavedAcademySettingsRef.current) {
      pendingSettingsNavigationRef.current = action;
      setIsAcademySettingsLeaveDialogOpen(true);
      return;
    }

    action();
  };

  const applyRemoteAcademyPreferences = (preferences: AcademyPreferences) => {
    const previousSavedSettings = savedAcademyCalendarSettingsRef.current;
    const currentSettings = academyCalendarSettingsRef.current;
    const hasUnsavedSettings = hasUnsavedAcademySettingsRef.current;
    const hasRemoteCalendarSettings = hasMeaningfulSettingsRecord(preferences.calendarSettings);
    const shouldIgnoreEmptyRemoteSettings =
      (!preferences.exists || !hasRemoteCalendarSettings) &&
      (
        hasLoadedRemoteAcademySettingsRef.current ||
        !areAcademyCalendarSettingsEqual(currentSettings, defaultAcademyCalendarSettings) ||
        !areAcademyCalendarSettingsEqual(previousSavedSettings, defaultAcademyCalendarSettings)
      );
    const shouldKeepCurrentSettings =
      hasUnsavedSettings ||
      isAcademyPreferencesSavingRef.current ||
      Date.now() < academySettingsProtectedUntilRef.current ||
      shouldIgnoreEmptyRemoteSettings;

    applyAcademyPreferencesResponse(preferences);

    const nextVisibleSettings = shouldKeepCurrentSettings
      ? currentSettings
      : academyPreferenceCache.calendarSettings;
    const nextSavedSettings = hasUnsavedSettings
      ? previousSavedSettings
      : nextVisibleSettings;

    if (!areAcademyCalendarSettingsEqual(academyPreferenceCache.calendarSettings, nextVisibleSettings)) {
      academyPreferenceCache = {
        ...academyPreferenceCache,
        calendarSettings: nextVisibleSettings,
      };
    }

    if (currentSettings.topBarDefaultCollapsed !== nextVisibleSettings.topBarDefaultCollapsed) {
      setAcademyTopBarCollapseOverride(null);
    }

    savedAcademyCalendarSettingsRef.current = nextSavedSettings;
    hasLoadedRemoteAcademySettingsRef.current = true;

    return nextSavedSettings;
  };

  const beginAcademyPreferencesLoad = () => {
    academyPreferencesLoadSequenceRef.current += 1;

    return academyPreferencesLoadSequenceRef.current;
  };

  const isCurrentAcademyPreferencesLoad = (loadSequence: number) => (
    loadSequence === academyPreferencesLoadSequenceRef.current
  );

  const resetAcademyRuntimeState = useCallback(() => {
    resetAcademyPreferenceCache();
    clearLegacyAcademyPreferenceStorage();
    setCanvasCalendarPages({});
    setAcademyPreferenceVersion((currentVersion) => currentVersion + 1);
    setSavedAcademyCalendarSettings(defaultAcademyCalendarSettings);
    savedAcademyCalendarSettingsRef.current = defaultAcademyCalendarSettings;
    setAcademyCalendarSettings(defaultAcademyCalendarSettings);
    academyCalendarSettingsRef.current = defaultAcademyCalendarSettings;
    setHiddenCalendarCourseIds([]);
    hasLoadedRemoteAcademySettingsRef.current = false;
    hasUnsavedAcademySettingsRef.current = false;
    setHasLoadedAcademyPreferences(false);
    setAcademyPreferencesLoadStatus('idle');
    academyPreferencesLoadSequenceRef.current += 1;
    academyPreferencesSaveSequenceRef.current += 1;
    academySettingsProtectedUntilRef.current = 0;
    isAcademyPreferencesSavingRef.current = false;
    setAcademyPreferencesSaveStatus('idle');
    setAcademyPreferencesSaveError('');
    setCanvasTokenStatus(null);
    setIsCanvasTokenExpiryDialogOpen(false);
    setIsCanvasTokenExpirySaving(false);
    setCanvasTokenExpiryError('');
    setCanvasTokenExpiryDraft({ accessToken: '', expiresAt: '' });
    setAcademyTopBarCollapseOverride(null);
    ignoredExpiredCanvasTokenOwnerRef.current = null;
    canvasTokenStatusLoadSequenceRef.current += 1;
  }, []);

  const canvasTokenOwnerKey = authSession
    ? getAuthSessionIdentityKey(authSession) ?? authSession.email ?? null
    : null;

  const ignoreExpiredCanvasToken = () => {
    ignoredExpiredCanvasTokenOwnerRef.current = canvasTokenOwnerKey;
    setCanvasTokenExpiryDraft({ accessToken: '', expiresAt: '' });
    setCanvasTokenExpiryError('');
    setIsCanvasTokenExpiryDialogOpen(false);
  };

  const handleExpiredCanvasTokenSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canvasTokenExpiryDraft.accessToken.trim()) {
      setCanvasTokenExpiryError(dictionary.canvasTokenValueRequired);
      return;
    }

    if (!canvasTokenExpiryDraft.expiresAt) {
      setCanvasTokenExpiryError(dictionary.canvasTokenExpiryRequired);
      return;
    }

    setIsCanvasTokenExpirySaving(true);
    setCanvasTokenExpiryError('');
    canvasTokenStatusLoadSequenceRef.current += 1;

    canvasToDoApi
      .updateCanvasToken({
        accessToken: canvasTokenExpiryDraft.accessToken,
        expiresAt: optionalIsoFromDateInput(canvasTokenExpiryDraft.expiresAt),
        instanceUrl: canvasTokenStatus?.instanceUrl ?? 'https://sfu.instructure.com',
      })
      .then((status) => {
        setCanvasTokenStatus(status);
        setCanvasTokenExpiryDraft({ accessToken: '', expiresAt: '' });
        setIsCanvasTokenExpiryDialogOpen(false);
        ignoredExpiredCanvasTokenOwnerRef.current = null;
        window.dispatchEvent(new CustomEvent<AcademyRefreshRequestedDetail>(academyRefreshRequestedEvent, {
          detail: { forceRefresh: true },
        }));
      })
      .catch((error: unknown) => {
        setCanvasTokenExpiryError(error instanceof Error ? error.message : dictionary.canvasTokenSaveFailed);
      })
      .finally(() => setIsCanvasTokenExpirySaving(false));
  };

  useEffect(() => {
    if (
      authStatus !== 'authenticated' ||
      !canvasTokenOwnerKey
    ) {
      return undefined;
    }

    let isCancelled = false;
    const loadSequence = ++canvasTokenStatusLoadSequenceRef.current;

    canvasToDoApi
      .getCanvasTokenStatus()
      .then((status) => {
        if (isCancelled || loadSequence !== canvasTokenStatusLoadSequenceRef.current) {
          return;
        }

        setCanvasTokenStatus(status);

        if (
          status.status === 'expired' &&
          status.manualTokenEnabled !== false &&
          !status.oauthConfigured &&
          ignoredExpiredCanvasTokenOwnerRef.current !== canvasTokenOwnerKey
        ) {
          setCanvasTokenExpiryDraft({ accessToken: '', expiresAt: '' });
          setCanvasTokenExpiryError('');
          setIsCanvasTokenExpiryDialogOpen(true);
        } else if (status.status !== 'expired') {
          ignoredExpiredCanvasTokenOwnerRef.current = null;
        }
      })
      .catch(() => {
        // A status check must not block Academy when the workspace API is temporarily unavailable.
      });

    return () => {
      isCancelled = true;
    };
  }, [authStatus, canvasTokenOwnerKey]);

  const runPendingSettingsNavigation = () => {
    const pendingAction = pendingSettingsNavigationRef.current;

    pendingSettingsNavigationRef.current = null;
    setIsAcademySettingsLeaveDialogOpen(false);
    pendingAction?.();
  };

  const navigateWorkspace = useCallback((nextNavigation: WorkspaceNavigation) => {
    const isSameNavigation =
      navigation.modeId === nextNavigation.modeId
      && navigation.sidebarItemId === nextNavigation.sidebarItemId
      && navigation.view === nextNavigation.view;

    if (isSameNavigation) {
      return;
    }

    if (!isApplyingHistoryRef.current) {
      window.history.pushState(
        {
          source: 'canvas-to-do',
          navigation: nextNavigation,
        } satisfies WorkspaceHistoryState,
        '',
        window.location.href,
      );
    }

    setNavigation(nextNavigation);
  }, [navigation]);

  useEffect(() => {
    if (
      authStatus !== 'authenticated' ||
      !canvasRedirectFeedback ||
      hasHandledCanvasRedirectRef.current
    ) {
      return;
    }

    const navigationTimeoutId = canvasRedirectFeedback.returnToSettings
      ? window.setTimeout(() => {
          hasHandledCanvasRedirectRef.current = true;
          navigateWorkspace({
            modeId: 'academy',
            sidebarItemId: 'settings',
            view: currentView,
          });
        }, 0)
      : undefined;

    if (!canvasRedirectFeedback.returnToSettings) {
      hasHandledCanvasRedirectRef.current = true;
    }

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('canvasConnected');
    currentUrl.searchParams.delete('canvasError');
    currentUrl.searchParams.delete('canvasReturn');
    window.history.replaceState(
      window.history.state,
      '',
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    );

    return () => {
      if (typeof navigationTimeoutId === 'number') {
        window.clearTimeout(navigationTimeoutId);
      }
    };
  }, [authStatus, canvasRedirectFeedback, currentView, navigateWorkspace]);

  const handleSelectSidebarItem = (itemId: string) => {
    if (!canAccessSidebarItem(activeMode.id, itemId, accessSet)) {
      return;
    }

    const navigateToItem = () => {
      let nextView = currentView;

      if (itemId === 'calendar') {
        nextView = 'month';
      }

      if (itemId === 'board') {
        nextView = 'board';
      }

      navigateWorkspace({
        modeId: activeMode.id,
        sidebarItemId: itemId,
        view: nextView,
      });
    };

    if (
      itemId !== 'settings' &&
      isAcademySettingsView &&
      hasUnsavedAcademySettingsRef.current
    ) {
      requestSettingsNavigation(navigateToItem);
      return;
    }

    navigateToItem();
  };

  useEffect(() => {
    if (
      authStatus !== 'authenticated' ||
      !firstAccessibleSidebarItem
    ) {
      return;
    }

    const requestedItemId = navigation.modeId === activeMode.id
      ? navigation.sidebarItemId
      : firstAccessibleSidebarItem.id;

    if (canAccessSidebarItem(activeMode.id, requestedItemId, accessSet)) {
      return;
    }

    const navigationTimeoutId = window.setTimeout(() => {
      navigateWorkspace({
        modeId: activeMode.id,
        sidebarItemId: firstAccessibleSidebarItem.id,
        view: currentView,
      });
    }, 0);

    return () => window.clearTimeout(navigationTimeoutId);
  }, [
    accessSet,
    activeMode.id,
    authStatus,
    currentView,
    firstAccessibleSidebarItem,
    navigation.modeId,
    navigation.sidebarItemId,
    navigateWorkspace,
  ]);

  const openAcademyCourseworkDialog = (detail?: AcademyOpenCourseworkDialogDetail) => {
    if (isMainOnlyView || effectiveCalendarExpanded) {
      setIsCalendarExpanded(false);
      navigateWorkspace({
        modeId: activeMode.id,
        sidebarItemId: 'dashboard',
        view: currentView,
      });
    }

    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(academyOpenCourseworkDialogEvent, { detail }));
    }, 0);
  };

  const openAcademyCourseResource = (courseRowId?: string | null, resourceUrl?: string | null) => {
    setSelectedCourseOverviewRowId(courseRowId ?? null);
    setSelectedCourseOverviewResourceUrl(resourceUrl ?? null);
    navigateWorkspace({
      modeId: activeMode.id,
      sidebarItemId: 'courses',
      view: currentView,
    });
  };

  const openCalendarSourceItem = (item: CalendarSourceItem) => {
    const target = getCalendarSourceItemOpenTarget(item);

    if (!target) {
      return;
    }

    openAcademyCourseResource(target.courseRowId, target.resourceUrl);
  };

  const openCalendarActionItem = (item: { id: string }) => {
    const sourceItem = calendarSourceItems.find((calendarItem) => calendarItem.id === item.id);

    if (sourceItem) {
      openCalendarSourceItem(sourceItem);
    }
  };

  const persistAcademyCalendarSettings = (settings: AcademyCalendarSettings) => {
    return persistAcademyPreferencesFromStorage(settings, { calendarSettingsOnly: true });
  };

  const persistAcademyPreferencesFromStorage = (
    settings?: AcademyCalendarSettings,
    options: { calendarSettingsOnly?: boolean } = {},
  ) => {
    const settingsToSave = normalizeAcademyCalendarSettings(
      settings ?? savedAcademyCalendarSettingsRef.current,
      academyCalendarSettingsRef.current,
    );
    const saveSequence = academyPreferencesSaveSequenceRef.current + 1;
    academyPreferencesSaveSequenceRef.current = saveSequence;
    academyPreferencesLoadSequenceRef.current += 1;
    isAcademyPreferencesSavingRef.current = true;
    academySettingsProtectedUntilRef.current = getCurrentTimeMilliseconds() + 30000;
    setAcademyPreferencesSaveStatus('saving');
    setAcademyPreferencesSaveError('');

    const shouldSubmitCalendarSettings = options.calendarSettingsOnly || settings !== undefined;
    const preferencesPayload = options.calendarSettingsOnly
      ? { calendarSettings: settingsToSave }
      : {
          manualLectures: readStoredJson<unknown[]>(manualLecturesStorageKey, []),
          canvasLecturePreferences: readStoredJson<Record<string, unknown>>(canvasLecturePreferencesStorageKey, {}),
          manualCoursework: readStoredJson<unknown[]>(manualCourseworkStorageKey, []),
          canvasCourseworkPreferences: readStoredJson<Record<string, unknown>>(canvasCourseworkPreferencesStorageKey, {}),
          manualAssessments: readStoredJson<unknown[]>(manualAssessmentsStorageKey, []),
          canvasAssessmentPreferences: readStoredJson<Record<string, unknown>>(canvasAssessmentPreferencesStorageKey, {}),
          ...(shouldSubmitCalendarSettings ? { calendarSettings: settingsToSave } : {}),
        };

    return canvasToDoApi.saveAcademyPreferences(preferencesPayload)
      .then((preferences) => {
        if (saveSequence !== academyPreferencesSaveSequenceRef.current) {
          return;
        }

        applyAcademyPreferencesResponse(preferences);
        const nextSavedSettings = shouldSubmitCalendarSettings
          ? normalizeAcademyCalendarSettings(settingsToSave, academyPreferenceCache.calendarSettings)
          : academyPreferenceCache.calendarSettings;

        academyPreferenceCache = {
          ...academyPreferenceCache,
          calendarSettings: nextSavedSettings,
        };

        setSavedAcademyCalendarSettings(nextSavedSettings);
        savedAcademyCalendarSettingsRef.current = nextSavedSettings;
        academySettingsProtectedUntilRef.current = Date.now() + 15000;
        if (
          !hasUnsavedAcademySettingsRef.current ||
          areAcademyCalendarSettingsEqual(settingsToSave, academyCalendarSettingsRef.current)
        ) {
          setAcademyCalendarSettings(nextSavedSettings);
          academyCalendarSettingsRef.current = nextSavedSettings;
        }
        storeAcademyCalendarSettings(nextSavedSettings);
        setHiddenCalendarCourseIds(nextSavedSettings.hiddenCourseIds ?? []);
        setAcademyPreferenceVersion((currentVersion) => currentVersion + 1);
        setAcademyPreferencesSaveStatus('saved');
      })
      .catch((error: unknown) => {
        if (saveSequence !== academyPreferencesSaveSequenceRef.current) {
          return;
        }

        setAcademyPreferencesSaveStatus('failed');
        setAcademyPreferencesSaveError(error instanceof Error ? error.message : dictionary.academySettingsSaveFailed);
      })
      .finally(() => {
        if (saveSequence === academyPreferencesSaveSequenceRef.current) {
          isAcademyPreferencesSavingRef.current = false;
        }
      });
  };

  const handleAcademyCalendarSettingsChange = (settings: AcademyCalendarSettings) => {
    const nextSettings = normalizeAcademyCalendarSettings(settings);

    if (academyCalendarSettingsRef.current.topBarDefaultCollapsed !== nextSettings.topBarDefaultCollapsed) {
      setAcademyTopBarCollapseOverride(null);
    }

    academyCalendarSettingsRef.current = nextSettings;
    setAcademyCalendarSettings(nextSettings);
    setAcademyPreferencesSaveStatus('idle');
    setAcademyPreferencesSaveError('');
  };

  const handleSaveAcademyCalendarSettings = (settings?: AcademyCalendarSettings) => {
    const nextSettings = normalizeAcademyCalendarSettings(
      settings ?? academyCalendarSettingsRef.current,
      academyCalendarSettingsRef.current,
    );

    academyCalendarSettingsRef.current = nextSettings;
    setAcademyCalendarSettings(nextSettings);
    setLanguage(nextSettings.language);
    return persistAcademyCalendarSettings(nextSettings);
  };

  const handleToggleCourseworkStudyItems = () => {
    const nextSettings = normalizeAcademyCalendarSettings(
      {
        ...academyCalendarSettingsRef.current,
        courseworkShowStudyItems: !academyCalendarSettingsRef.current.courseworkShowStudyItems,
      },
      academyCalendarSettingsRef.current,
    );

    academyCalendarSettingsRef.current = nextSettings;
    setAcademyCalendarSettings(nextSettings);
    storeAcademyCalendarSettings(nextSettings);
    setAcademyPreferencesSaveStatus('saving');
    setAcademyPreferencesSaveError('');
    persistAcademyCalendarSettings(nextSettings);
  };

  const handleRevertAcademyCalendarSettings = () => {
    const nextSettings = savedAcademyCalendarSettingsRef.current;

    if (academyCalendarSettingsRef.current.topBarDefaultCollapsed !== nextSettings.topBarDefaultCollapsed) {
      setAcademyTopBarCollapseOverride(null);
    }

    academyCalendarSettingsRef.current = nextSettings;
    setAcademyCalendarSettings(nextSettings);
    setLanguage(nextSettings.language);
    setHiddenCalendarCourseIds(nextSettings.hiddenCourseIds ?? []);
    setAcademyPreferencesSaveStatus('idle');
    setAcademyPreferencesSaveError('');
  };

  const handleThemeChange = (nextTheme: AppTheme) => {
    const nextSettings = normalizeAcademyCalendarSettings({
      ...academyCalendarSettingsRef.current,
      themeMode: nextTheme,
      themeTimerEnabled: false,
    });

    academyCalendarSettingsRef.current = nextSettings;
    setAcademyCalendarSettings(nextSettings);
    storeAcademyCalendarSettings(nextSettings);
    void persistAcademyCalendarSettings(nextSettings);
  };

  const handleToggleCalendarCourse = (courseId: string) => {
    const nextCourseIds = hiddenCalendarCourseIds.includes(courseId)
      ? hiddenCalendarCourseIds.filter((currentCourseId) => currentCourseId !== courseId)
      : [...hiddenCalendarCourseIds, courseId];
    const nextSettings = normalizeAcademyCalendarSettings({
      ...academyCalendarSettingsRef.current,
      hiddenCourseIds: nextCourseIds,
    });

    storeHiddenCalendarCourseIds(nextCourseIds);
    academyCalendarSettingsRef.current = nextSettings;
    setHiddenCalendarCourseIds(nextCourseIds);
    setAcademyCalendarSettings(nextSettings);
    void persistAcademyPreferencesFromStorage(nextSettings);
  };

  const handleMoveSelectedAgendaDay = (amount: number) => {
    const nextDateIso = addDaysToIsoDate(selectedCalendarDayIso, amount);
    const nextCalendarMonth = getCalendarMonthFromIsoDate(nextDateIso);

    setSelectedCalendarDayIso(nextDateIso);

    if (nextCalendarMonth) {
      setCalendarMonth(nextCalendarMonth);
    }
  };

  const handleMoveSelectedDayToToday = () => {
    const todayIso = getTodayIsoDate();
    const todayCalendarMonth = getCalendarMonthFromIsoDate(todayIso);

    setSelectedCalendarDayIso(todayIso);

    if (todayCalendarMonth) {
      setCalendarMonth(todayCalendarMonth);
    }
  };

  const createQuickCalendarCoursework = ({
    chipColor,
    courseCode = '',
    dateIso = selectedCalendarDayIso,
    focusBoardItem = false,
    title = '',
  }: {
    chipColor?: ColorToken;
    courseCode?: string;
    dateIso?: string;
    focusBoardItem?: boolean;
    title?: string;
  }) => {
    const randomId = createClientRuntimeId();
    const newCoursework: StoredManualCoursework = {
      id: `manual-coursework-${randomId}`,
      title,
      chipColor,
      courseCode,
      dueAt: getEndOfDayIsoDateTime(dateIso),
      startAt: new Date().toISOString(),
      courseworkType: 'study',
      submissionType: 'no_submission',
      completed: false,
      semester: selectedAcademySemester,
    };
    const nextCoursework = [...getStoredManualCoursework(), newCoursework];

    storeJson(manualCourseworkStorageKey, nextCoursework);
    setSelectedCalendarDayIso(dateIso);
    if (focusBoardItem) {
      setFocusedCalendarTodoId(newCoursework.id);
    }
    persistAcademyPreferencesFromStorage();
  };

  const handleQuickAddCalendarTodo = (column: BoardColumnConfig) => {
    createQuickCalendarCoursework({
      chipColor: column.color,
      courseCode: column.label,
      focusBoardItem: true,
    });
  };

  const handleQuickAddCalendarCourseworkForDay = (day: CalendarDay) => {
    if (!day.dateIso) {
      return;
    }

    setSelectedCalendarDayIso(day.dateIso);
    openAcademyCourseworkDialog({
      dueAt: getEndOfDayIsoDateTime(day.dateIso),
      startAt: new Date().toISOString(),
    });
  };

  const handleQuickAddSelectedDayCoursework = (courseCode?: string, chipColor?: ColorToken) => {
    createQuickCalendarCoursework({
      chipColor,
      courseCode: courseCode ?? '',
      focusBoardItem: true,
    });
  };

  const handleUpdateCalendarSourceItemTitle = (
    item: CalendarSourceItem,
    title: string,
    options: { persist?: boolean } = {},
  ) => {
    if (item.isLocked || isLiveCanvasCalendarItem(item)) {
      return;
    }

    updateCalendarSourceItemPreference(item, (preference) => ({
      ...preference,
      title,
    }), options);
  };

  const handleUpdateCalendarTodoTitle = (item: BoardItem, title: string) => {
    const sourceItem = calendarSourceItems.find((calendarItem) => calendarItem.id === item.id);

    if (!sourceItem) {
      return;
    }

    handleUpdateCalendarSourceItemTitle(sourceItem, title, { persist: false });
  };

  const handleFinishCalendarTodoTitleEdit = () => {
    setFocusedCalendarTodoId(null);
    persistAcademyPreferencesFromStorage();
  };

  const handleOpenCalendarTodoDetails = (item: { id: string }) => {
    setSelectedCalendarTodoDetailsId(item.id);
  };

  const updateCalendarSourceItemPreference = (
    item: CalendarSourceItem,
    updater: (preference: StoredCoursePreference) => StoredCoursePreference,
    options: { persist?: boolean } = {},
  ) => {
    const shouldPersist = options.persist !== false;

    if (item.source === 'manual-coursework') {
      const nextCoursework = getStoredManualCoursework().map((coursework) => (
        coursework.id === item.id ? updater(coursework) as StoredManualCoursework : coursework
      ));

      storeJson(manualCourseworkStorageKey, nextCoursework);
      if (shouldPersist) {
        persistAcademyPreferencesFromStorage();
      }
      return;
    }

    if (item.source === 'manual-assessment') {
      const nextAssessments = getStoredManualAssessments().map((assessment) => (
        assessment.id === item.id ? updater(assessment) as StoredManualAssessment : assessment
      ));

      storeJson(manualAssessmentsStorageKey, nextAssessments);
      if (shouldPersist) {
        persistAcademyPreferencesFromStorage();
      }
      return;
    }

    const preferenceKey = isAssessmentType(item.type, item.title)
      ? canvasAssessmentPreferencesStorageKey
      : canvasCourseworkPreferencesStorageKey;
    const currentPreferences = preferenceKey === canvasAssessmentPreferencesStorageKey
      ? getStoredCanvasAssessmentPreferences()
      : getStoredCanvasCourseworkPreferences();

    storeJson(preferenceKey, {
      ...currentPreferences,
      [item.id]: updater(currentPreferences[item.id] ?? {}),
    });
    if (shouldPersist) {
      persistAcademyPreferencesFromStorage();
    }
  };

  const handleToggleCalendarTodoStar = (item: { id: string }) => {
    const sourceItem = calendarSourceItems.find((calendarItem) => calendarItem.id === item.id);

    if (!sourceItem) {
      return;
    }

    updateCalendarSourceItemPreference(sourceItem, (preference) => ({
      ...preference,
      starred: !preference.starred,
    }));
  };

  const handleMoveCalendarTodoDueDate = (item: { id: string }, target: 'today' | 'tomorrow') => {
    const sourceItem = calendarSourceItems.find((calendarItem) => calendarItem.id === item.id);

    if (!sourceItem || sourceItem.isLocked || sourceItem.isCompleted) {
      return;
    }

    if (sourceItem.source === 'canvas' && !sourceItem.isArchivedCanvasItem) {
      return;
    }

    if (
      sourceItem.source === 'canvas' &&
      sourceItem.isArchivedCanvasItem &&
      !window.confirm(dictionary.courseworkMoveArchivedCanvasConfirm)
    ) {
      return;
    }

    updateCalendarSourceItemPreference(sourceItem, (preference) => ({
      ...preference,
      dueAt: getCalendarDueAtForTargetDay(target),
    }));
  };

  const handleRemoveCalendarTodo = (item: { id: string }) => {
    const sourceItem = calendarSourceItems.find((calendarItem) => calendarItem.id === item.id);

    if (!sourceItem) {
      return;
    }

    if (sourceItem.source === 'manual-coursework') {
      const nextCoursework = getStoredManualCoursework().map((coursework) => (
        coursework.id === sourceItem.id
          ? { ...coursework, hidden: true }
          : coursework
      ));

      storeJson(manualCourseworkStorageKey, nextCoursework);
      persistAcademyPreferencesFromStorage();
      return;
    }

    if (sourceItem.source === 'manual-assessment') {
      const nextAssessments = getStoredManualAssessments().map((assessment) => (
        assessment.id === sourceItem.id
          ? { ...assessment, hidden: true }
          : assessment
      ));

      storeJson(manualAssessmentsStorageKey, nextAssessments);
      persistAcademyPreferencesFromStorage();
      return;
    }

    updateCalendarSourceItemPreference(sourceItem, (preference) => ({
      ...preference,
      hidden: true,
    }));
  };

  const handleSaveCalendarTodoDetails = (item: CalendarSourceItem, draft: CalendarTodoDetailsDraft) => {
    const draftDueAt = toIsoFromDateInput(draft.dueAt) || undefined;
    const draftStartAt = toIsoFromDateInput(draft.startAt) || undefined;
    const draftEndAt = toIsoFromDateInput(draft.endAt) || undefined;
    const shouldKeepCanvasDates = item.source === 'canvas' && !item.isArchivedCanvasItem;
    const nextDueAt = shouldKeepCanvasDates ? item.dueAt : draftDueAt;
    const nextStartAt = shouldKeepCanvasDates ? item.startAt : draftStartAt;
    const nextEndAt = shouldKeepCanvasDates ? item.endAt : draftEndAt;
    const nextTitle = draft.title.trim();
    const nextType = draft.type || 'assignment';

    if (item.source === 'manual-coursework') {
      const nextCoursework = getStoredManualCoursework().map((coursework) => (
        coursework.id === item.id
          ? {
              ...coursework,
              dueAt: nextDueAt,
              endAt: nextEndAt,
              startAt: nextStartAt,
              title: nextTitle,
              courseworkType: nextType,
            }
          : coursework
      ));

      storeJson(manualCourseworkStorageKey, nextCoursework);
      setSelectedCalendarTodoDetailsId(null);
      persistAcademyPreferencesFromStorage();
      return;
    }

    if (item.source === 'manual-assessment') {
      const nextAssessments = getStoredManualAssessments().map((assessment) => (
        assessment.id === item.id
          ? {
              ...assessment,
              dueAt: nextDueAt,
              endAt: nextEndAt,
              startAt: nextStartAt,
              title: nextTitle,
              assessmentType: nextType,
            }
          : assessment
      ));

      storeJson(manualAssessmentsStorageKey, nextAssessments);
      setSelectedCalendarTodoDetailsId(null);
      persistAcademyPreferencesFromStorage();
      return;
    }

    const preferenceKey = isAssessmentType(item.type, item.title)
      ? canvasAssessmentPreferencesStorageKey
      : canvasCourseworkPreferencesStorageKey;
    const currentPreferences = preferenceKey === canvasAssessmentPreferencesStorageKey
      ? getStoredCanvasAssessmentPreferences()
      : getStoredCanvasCourseworkPreferences();
    const typeKey = preferenceKey === canvasAssessmentPreferencesStorageKey
      ? 'assessmentType'
      : 'courseworkType';

    storeJson(preferenceKey, {
      ...currentPreferences,
      [item.id]: {
        ...(currentPreferences[item.id] ?? {}),
        dueAt: nextDueAt,
        endAt: nextEndAt,
        startAt: nextStartAt,
        title: nextTitle || undefined,
        [typeKey]: nextType,
      },
    });
    setSelectedCalendarTodoDetailsId(null);
    persistAcademyPreferencesFromStorage();
  };

  const handleToggleCalendarTodoDone = (item: { id: string }) => {
    const sourceItem = calendarSourceItems.find((calendarItem) => calendarItem.id === item.id);

    if (sourceItem) {
      toggleCalendarSourceItemDone(sourceItem);
      persistAcademyPreferencesFromStorage();
    }
  };

  useEffect(() => {
    if (!academyCalendarSettings.themeTimerEnabled) {
      return undefined;
    }

    const initialTimeoutId = window.setTimeout(() => {
      setAcademyThemeClock(Date.now());
    }, 0);
    const intervalId = window.setInterval(() => {
      setAcademyThemeClock(Date.now());
    }, 60_000);

    return () => {
      window.clearTimeout(initialTimeoutId);
      window.clearInterval(intervalId);
    };
  }, [
    academyCalendarSettings.themeTimerEnabled,
    academyCalendarSettings.themeTimerEnd,
    academyCalendarSettings.themeTimerMode,
    academyCalendarSettings.themeTimerStart,
  ]);

  useEffect(() => {
    applyTheme(academyEffectiveTheme, { persist: false });
    applyAcademyAccentColor(academyCalendarSettings.accentColor);
  }, [
    academyCalendarSettings.accentColor,
    academyEffectiveTheme,
  ]);

  useEffect(() => {
    if (language !== academyCalendarSettings.language) {
      setLanguage(academyCalendarSettings.language);
    }
  }, [academyCalendarSettings.language, language, setLanguage]);

  useEffect(() => {
    applyDocumentBranding({
      iconSrc: defaultAcademyTabIconSrc,
      title: dictionary.productName,
      touchIconSrc: defaultAcademyTabIconSrc,
    });
  }, [dictionary.productName]);

  useEffect(() => {
    const updateResponsiveState = () => {
      setAcademyResponsiveState(getAcademyResponsiveState());
    };

    updateResponsiveState();
    window.addEventListener('resize', updateResponsiveState);
    window.addEventListener('orientationchange', updateResponsiveState);

    return () => {
      window.removeEventListener('resize', updateResponsiveState);
      window.removeEventListener('orientationchange', updateResponsiveState);
    };
  }, []);

  useEffect(() => {
    if (!authRedirectMessage || typeof window === 'undefined') {
      return;
    }

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('authError');
    window.history.replaceState(
      window.history.state,
      '',
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    );
  }, [authRedirectMessage]);

  useEffect(() => {
    const handleAcademyPreferencesUpdated = (event: Event) => {
      const isSavingAcademyPreferences = isAcademyPreferencesSavingRef.current;
      const isSettingsProtected = Date.now() < academySettingsProtectedUntilRef.current;

      if (event instanceof CustomEvent && event.detail) {
        if (isRecord(event.detail) && 'calendarSettings' in event.detail) {
          if (isRecord(event.detail.calendarSettings)) {
            const previousSettings = academyCalendarSettingsRef.current;
            const previousSemester = normalizeSemesterName(previousSettings.selectedSemester);
            const calendarSettingKeys = Object.keys(event.detail.calendarSettings);
            const isSelectedSemesterPatch =
              calendarSettingKeys.length <= 2 &&
              calendarSettingKeys.includes('selectedSemester');
            const eventSettings = normalizeAcademyCalendarSettings(
              event.detail.calendarSettings,
              academyCalendarSettingsRef.current,
            );
            const shouldKeepCurrentSettings =
              hasUnsavedAcademySettingsRef.current ||
              isSavingAcademyPreferences ||
              (isSettingsProtected && !isSelectedSemesterPatch);
            const nextSettings = isSelectedSemesterPatch
              ? normalizeAcademyCalendarSettings({
                  ...academyCalendarSettingsRef.current,
                  selectedSemester: eventSettings.selectedSemester,
                }, academyCalendarSettingsRef.current)
              : shouldKeepCurrentSettings
                ? academyCalendarSettingsRef.current
                : eventSettings;
            const nextSemester = normalizeSemesterName(nextSettings.selectedSemester);

            if (previousSettings.topBarDefaultCollapsed !== nextSettings.topBarDefaultCollapsed) {
              setAcademyTopBarCollapseOverride(null);
            }

            academyPreferenceCache = {
              ...academyPreferenceCache,
              calendarSettings: nextSettings,
            };
            if (!shouldKeepCurrentSettings || previousSemester !== nextSemester) {
              academySettingsProtectedUntilRef.current = Date.now() + 15000;
            }
            academyCalendarSettingsRef.current = nextSettings;
            setAcademyCalendarSettings(nextSettings);
            setHiddenCalendarCourseIds(nextSettings.hiddenCourseIds ?? []);

            if (!hasUnsavedAcademySettingsRef.current) {
              savedAcademyCalendarSettingsRef.current = nextSettings;
              setSavedAcademyCalendarSettings(nextSettings);
            }

            if (previousSemester !== nextSemester) {
              setCanvasCalendarPages({});
            }
          }

          const detailWithoutSettings = { ...event.detail };

          delete detailWithoutSettings.calendarSettings;

          applyAcademyPreferenceEventDetail(detailWithoutSettings);
        } else {
          applyAcademyPreferenceEventDetail(event.detail);
        }
      }

      setAcademyPreferenceVersion((currentVersion) => currentVersion + 1);
      if (isSavingAcademyPreferences) {
        return;
      }
    };

    window.addEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);

    return () => {
      window.removeEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    if (authStatus !== 'authenticated') {
      return undefined;
    }

    const requestStartTimeoutId = window.setTimeout(() => {
      if (isCancelled) {
        return;
      }

      const loadSequence = beginAcademyPreferencesLoad();

      setAcademyPreferencesLoadStatus('loading');
      void canvasToDoApi
        .getAcademyPreferences()
        .then((preferences) => {
          if (
            isCancelled ||
            isAcademyPreferencesSavingRef.current ||
            !isCurrentAcademyPreferencesLoad(loadSequence)
          ) {
            return;
          }

          const nextSavedSettings = applyRemoteAcademyPreferences(preferences);
          setSavedAcademyCalendarSettings(nextSavedSettings);
          if (!hasUnsavedAcademySettingsRef.current) {
            academyCalendarSettingsRef.current = nextSavedSettings;
            setAcademyCalendarSettings(nextSavedSettings);
            setHiddenCalendarCourseIds(nextSavedSettings.hiddenCourseIds ?? []);
          }
          setAcademyPreferenceVersion((currentVersion) => currentVersion + 1);
          setHasLoadedAcademyPreferences(true);
          setAcademyPreferencesLoadStatus('loaded');
          dispatchAcademyPreferencesUpdated();
        })
        .catch((error) => {
          if (isSessionExpiredError(error)) {
            setAuthSession(null);
            setAuthStatus('unauthenticated');
          } else if (!isCancelled) {
            setHasLoadedAcademyPreferences(false);
            setAcademyPreferencesLoadStatus('failed');
          }
        });
    }, 0);

    return () => {
      isCancelled = true;
      window.clearTimeout(requestStartTimeoutId);
    };
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return undefined;
    }

    let isSyncing = false;
    const syncAcademyPreferences = () => {
      if (isSyncing || isAcademyPreferencesSavingRef.current || document.visibilityState === 'hidden') {
        return;
      }

      isSyncing = true;
      if (!hasLoadedAcademyPreferences) {
        setAcademyPreferencesLoadStatus('loading');
      }
      const loadSequence = beginAcademyPreferencesLoad();

      canvasToDoApi
        .getAcademyPreferences()
        .then((preferences) => {
          if (
            isAcademyPreferencesSavingRef.current ||
            !isCurrentAcademyPreferencesLoad(loadSequence)
          ) {
            return;
          }

          const nextSavedSettings = applyRemoteAcademyPreferences(preferences);
          setSavedAcademyCalendarSettings(nextSavedSettings);
          if (!hasUnsavedAcademySettingsRef.current) {
            academyCalendarSettingsRef.current = nextSavedSettings;
            setAcademyCalendarSettings(nextSavedSettings);
            setHiddenCalendarCourseIds(nextSavedSettings.hiddenCourseIds ?? []);
          }
          setAcademyPreferenceVersion((currentVersion) => currentVersion + 1);
          setHasLoadedAcademyPreferences(true);
          setAcademyPreferencesLoadStatus('loaded');
          dispatchAcademyPreferencesUpdated();
        })
        .catch((error) => {
          if (isSessionExpiredError(error)) {
            setAuthSession(null);
            setAuthStatus('unauthenticated');
          } else if (!hasLoadedAcademyPreferences) {
            setHasLoadedAcademyPreferences(false);
            setAcademyPreferencesLoadStatus('failed');
          }
        })
        .finally(() => {
          isSyncing = false;
        });
    };
    const syncInterval = window.setInterval(syncAcademyPreferences, academyAutoRefreshIntervalMs);

    return () => {
      window.clearInterval(syncInterval);
    };
  }, [
    academyAutoRefreshIntervalMs,
    authStatus,
    hasLoadedAcademyPreferences,
  ]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }

    let navigationTimeoutId: number | undefined;

    if (!hasAppliedUrlNavigationRef.current) {
      const searchParams = new URLSearchParams(window.location.search);
      const requestedModeId = searchParams.get('mode');
      const requestedSidebarItemId = searchParams.get('item');

      if (requestedModeId === activeMode.id && requestedSidebarItemId) {
        navigationTimeoutId = window.setTimeout(() => {
          hasAppliedUrlNavigationRef.current = true;
          setNavigation({
            modeId: activeMode.id,
            sidebarItemId: requestedSidebarItemId,
            view: currentView,
          });
        }, 0);
        return () => window.clearTimeout(navigationTimeoutId);
      }
    }

    const currentHistoryState = window.history.state;

    if (isWorkspaceHistoryState(currentHistoryState)) {
      const nextNavigation = currentHistoryState.navigation;
      const isSameNavigation =
        navigation.modeId === nextNavigation.modeId
        && navigation.sidebarItemId === nextNavigation.sidebarItemId
        && navigation.view === nextNavigation.view;

      if (!isSameNavigation) {
        navigationTimeoutId = window.setTimeout(() => setNavigation(nextNavigation), 0);
      }
      return () => {
        if (typeof navigationTimeoutId === 'number') {
          window.clearTimeout(navigationTimeoutId);
        }
      };
    }

    window.history.replaceState(
      {
        source: 'canvas-to-do',
        navigation: {
          modeId: activeMode.id,
          sidebarItemId: activeSidebarItem,
          view: currentView,
        },
      } satisfies WorkspaceHistoryState,
      '',
      window.location.href,
    );

    return undefined;
  }, [activeMode.id, activeSidebarItem, authStatus, currentView, navigation]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return undefined;
    }

    const handlePopState = (event: PopStateEvent) => {
      if (isWorkspaceHistoryState(event.state)) {
        isApplyingHistoryRef.current = true;
        setNavigation(event.state.navigation);
        window.setTimeout(() => {
          isApplyingHistoryRef.current = false;
        }, 0);
        return;
      }

    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [activeMode.id, authStatus, currentView]);

  useEffect(() => {
    let isCancelled = false;
    let responseTimeoutId: number | undefined;

    if (!shouldLoadCanvasCalendar) {
      return undefined;
    }

    const monthKey = getCalendarMonthKey(calendarMonth);

    if (isCanvasCalendarPageLoaded) {
      return undefined;
    }

    const gridRange = getCalendarGridRange(calendarMonth);
    const requestedAt = Date.now();
    const requestStartTimeoutId = window.setTimeout(() => {
      if (isCancelled) {
        return;
      }

      setCanvasCalendarPages((currentPages) => ({
        ...currentPages,
        [monthKey]: {
          items: currentPages[monthKey]?.items ?? [],
          requestedAt,
          status: 'loading',
        },
      }));

      responseTimeoutId = window.setTimeout(() => {
        if (isCancelled) {
          return;
        }

        setCanvasCalendarPages((currentPages) => {
          const currentPage = currentPages[monthKey];

          if (currentPage?.status !== 'loading' || currentPage.requestedAt !== requestedAt) {
            return currentPages;
          }

          return {
            ...currentPages,
            [monthKey]: {
              items: currentPage.items ?? [],
              status: 'failed',
            },
          };
        });
      }, canvasCalendarLoadingTimeoutMs);

      void canvasToDoApi
        .getCanvasCalendarItems({
          endDate: formatDateParam(gridRange.endDate),
          pageSize: 100,
          startDate: formatDateParam(gridRange.startDate),
        })
        .then(({ isComplete, items }) => {
          if (typeof responseTimeoutId === 'number') {
            window.clearTimeout(responseTimeoutId);
          }
          if (isCancelled) {
            return;
          }

          setCanvasCalendarPages((currentPages) => {
            const currentPage = currentPages[monthKey];

            if (currentPage?.requestedAt !== requestedAt) {
              return currentPages;
            }

            return {
              ...currentPages,
              [monthKey]: {
                isComplete,
                items,
                status: 'loaded',
              },
            };
          });
        })
        .catch((error) => {
          if (typeof responseTimeoutId === 'number') {
            window.clearTimeout(responseTimeoutId);
          }
          if (isCancelled) {
            return;
          }

          if (isSessionExpiredError(error)) {
            setAuthSession(null);
            setAuthStatus('unauthenticated');
            return;
          }

          setCanvasCalendarPages((currentPages) => {
            const currentPage = currentPages[monthKey];

            if (currentPage?.requestedAt !== requestedAt) {
              return currentPages;
            }

            return {
              ...currentPages,
              [monthKey]: {
                items: [],
                errorMessage: error instanceof Error ? error.message : undefined,
                status: 'failed',
              },
            };
          });
        });
    }, 0);

    return () => {
      isCancelled = true;
      window.clearTimeout(requestStartTimeoutId);
      if (typeof responseTimeoutId === 'number') {
        window.clearTimeout(responseTimeoutId);
      }
    };
  }, [calendarMonth, isCanvasCalendarPageLoaded, selectedAcademySemester, shouldLoadCanvasCalendar]);

  useEffect(() => {
    const refreshCurrentCalendarMonth = (forceRefresh = false) => {
      if (!shouldLoadCanvasCalendar) {
        return Promise.resolve();
      }

      const monthKey = getCalendarMonthKey(calendarMonth);
      const gridRange = getCalendarGridRange(calendarMonth);
      const requestedAt = Date.now();

      setCanvasCalendarPages((currentPages) => ({
        ...currentPages,
        [monthKey]: {
          items: currentPages[monthKey]?.items ?? [],
          requestedAt,
          status: 'loading',
        },
      }));

      let timeoutId: number | undefined;
      const timeoutTask = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          setCanvasCalendarPages((currentPages) => {
            const currentPage = currentPages[monthKey];

            if (currentPage?.status !== 'loading' || currentPage.requestedAt !== requestedAt) {
              return currentPages;
            }

            return {
              ...currentPages,
              [monthKey]: {
                items: currentPage.items ?? [],
                status: 'failed',
              },
            };
          });

          reject(new Error(dictionary.canvasCalendarUnavailable));
        }, canvasCalendarLoadingTimeoutMs);
      });

      const calendarTask = canvasToDoApi.getCanvasCalendarItems({
        endDate: formatDateParam(gridRange.endDate),
        forceRefresh,
        pageSize: 100,
        startDate: formatDateParam(gridRange.startDate),
      });

      return Promise.race([calendarTask, timeoutTask])
        .then(({ isComplete, items }) => {
          if (typeof timeoutId === 'number') {
            window.clearTimeout(timeoutId);
          }

          setCanvasCalendarPages((currentPages) => {
            const currentPage = currentPages[monthKey];

            if (currentPage?.requestedAt !== requestedAt) {
              return currentPages;
            }

            return {
              ...currentPages,
              [monthKey]: {
                isComplete,
                items,
                status: 'loaded',
              },
            };
          });
        })
        .catch((error: unknown) => {
          if (typeof timeoutId === 'number') {
            window.clearTimeout(timeoutId);
          }

          if (isSessionExpiredError(error)) {
            setAuthSession(null);
            setAuthStatus('unauthenticated');
            throw error;
          }

          setCanvasCalendarPages((currentPages) => {
            const currentPage = currentPages[monthKey];

            if (currentPage?.requestedAt !== requestedAt) {
              return currentPages;
            }

            return {
              ...currentPages,
              [monthKey]: {
                items: [],
                errorMessage: error instanceof Error ? error.message : undefined,
                status: 'failed',
              },
            };
          });

          throw error;
        });
    };

    const refreshAcademyPageData = async (forceRefresh = false) => {
      if (authStatus !== 'authenticated') {
        return;
      }

      const loadSequence = beginAcademyPreferencesLoad();
      if (!hasLoadedAcademyPreferences) {
        setAcademyPreferencesLoadStatus('loading');
      }
      const preferencesTask = canvasToDoApi
        .getAcademyPreferences()
        .then((preferences) => {
          if (
            isAcademyPreferencesSavingRef.current ||
            !isCurrentAcademyPreferencesLoad(loadSequence)
          ) {
            return;
          }

          const nextSavedSettings = applyRemoteAcademyPreferences(preferences);
          setSavedAcademyCalendarSettings(nextSavedSettings);
          if (!hasUnsavedAcademySettingsRef.current) {
            academyCalendarSettingsRef.current = nextSavedSettings;
            setAcademyCalendarSettings(nextSavedSettings);
            setHiddenCalendarCourseIds(nextSavedSettings.hiddenCourseIds ?? []);
          }
          setAcademyPreferenceVersion((currentVersion) => currentVersion + 1);
          setHasLoadedAcademyPreferences(true);
          setAcademyPreferencesLoadStatus('loaded');
          dispatchAcademyPreferencesUpdated();
        })
        .catch((error) => {
          if (isSessionExpiredError(error)) {
            setAuthSession(null);
            setAuthStatus('unauthenticated');
          } else if (!hasLoadedAcademyPreferences) {
            setHasLoadedAcademyPreferences(false);
            setAcademyPreferencesLoadStatus('failed');
          }

          throw error;
        });

      const [preferencesResult, calendarResult] = await Promise.allSettled([
        preferencesTask,
        refreshCurrentCalendarMonth(forceRefresh),
      ]);

      if (preferencesResult.status === 'rejected') {
        throw preferencesResult.reason;
      }

      if (calendarResult.status === 'rejected') {
        throw calendarResult.reason;
      }
    };

    const handleAcademyRefreshRequested = (event: Event) => {
      const detail = event instanceof CustomEvent
        ? event.detail as AcademyRefreshRequestedDetail | undefined
        : undefined;
      const refreshTask = refreshAcademyPageData(Boolean(detail?.forceRefresh));

      if (typeof detail?.registerTask === 'function') {
        detail.registerTask(refreshTask);
      }
    };

    window.addEventListener(academyRefreshRequestedEvent, handleAcademyRefreshRequested);

    return () => {
      window.removeEventListener(academyRefreshRequestedEvent, handleAcademyRefreshRequested);
    };
  }, [
    authStatus,
    calendarMonth,
    dictionary.canvasCalendarUnavailable,
    hasLoadedAcademyPreferences,
    selectedAcademySemester,
    shouldLoadCanvasCalendar,
  ]);

  const applyAuthSession = useCallback((session: AuthSession) => {
    const nextSessionKey = getAuthSessionIdentityKey(session);

    canvasToDoApi.setAcademyPreferenceOwnerKey(session.academyPreferenceOwnerKey);

    if (authSessionKeyRef.current !== nextSessionKey) {
      authSessionKeyRef.current = nextSessionKey;
      resetAcademyRuntimeState();
    }

    setAuthSession(session);

    if (!session.isAuthenticated) {
      setAuthStatus('unauthenticated');
      return;
    }

    setAuthStatus('authenticated');
  }, [resetAcademyRuntimeState]);

  useEffect(() => {
    const handleAuthenticationRequired = () => {
      applyAuthSession({ isAuthenticated: false });
    };

    window.addEventListener(authenticationRequiredEvent, handleAuthenticationRequired);
    return () => window.removeEventListener(authenticationRequiredEvent, handleAuthenticationRequired);
  }, [applyAuthSession]);

  const refreshAuthSession = () => {
    setAuthStatus((currentStatus) => (currentStatus === 'unauthenticated' ? 'checking' : currentStatus));

    return canvasToDoApi
      .getAuthSession()
      .then(applyAuthSession)
      .catch(() => {
        setAuthSession(null);
        setAuthStatus('unauthenticated');
      })
      ;
  };

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      return undefined;
    }

    // The initial page lifecycle may finish in a background tab. Establish the
    // resume baseline here so the first click used to focus that tab does not
    // refresh the entire page again.
    academyResumeRefreshRef.current.lastStartedAt = Date.now();

    const refreshAuthSessionWithRetry = async () => {
      let lastError: unknown;

      for (const delayMs of academyResumeAuthRetryDelays) {
        if (delayMs > 0) {
          await waitFor(delayMs);
        }

        try {
          return await canvasToDoApi.getAuthSession();
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError;
    };

    const requestAcademyDataRefresh = () => new Promise<void>((resolve, reject) => {
      let registeredTask = false;

      window.dispatchEvent(new CustomEvent<AcademyRefreshRequestedDetail>(
        academyRefreshRequestedEvent,
        {
          detail: {
            forceRefresh: true,
            registerTask: (task) => {
              registeredTask = true;
              task.then(() => resolve(), reject);
            },
          },
        },
      ));

      if (!registeredTask) {
        resolve();
      }
    });

    const refreshResumedApp = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      const now = Date.now();
      const resumeState = academyResumeRefreshRef.current;

      if (
        resumeState.isRunning ||
        now - resumeState.lastStartedAt < academyRefocusRefreshThrottleMs
      ) {
        return;
      }

      resumeState.isRunning = true;
      resumeState.lastStartedAt = now;

      void refreshAuthSessionWithRetry()
        .then(async (session) => {
          applyAuthSession(session);

          if (
            session.isAuthenticated
          ) {
            await requestAcademyDataRefresh();
          }
        })
        .catch(() => {
          // Keep the current screen if the API is restarting or offline. A real expired
          // session is handled by /auth/session returning isAuthenticated=false.
        })
        .finally(() => {
          academyResumeRefreshRef.current.isRunning = false;
        });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshResumedApp();
      }
    };

    window.addEventListener('focus', refreshResumedApp);
    window.addEventListener('pageshow', refreshResumedApp);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', refreshResumedApp);
      window.removeEventListener('pageshow', refreshResumedApp);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [academyAutoRefreshIntervalMs, academyRefocusRefreshThrottleMs, applyAuthSession, authStatus]);

  const signOut = () => {
    void canvasToDoApi
      .logout()
      .then(() => {
        applyAuthSession({ isAuthenticated: false });
      })
      .catch(() => {
        setCanvasRedirectFeedback({
          message: 'Canvas To Do could not end your server session. Check your connection and try again.',
          returnToSettings: false,
          tone: 'error',
        });
      });
  };

  useEffect(() => {
    let isMounted = true;

    canvasToDoApi
      .getAuthSession()
      .then((session) => {
        if (isMounted) {
          applyAuthSession(session);
        }
      })
      .catch(() => {
        if (isMounted) {
          setAuthSession(null);
          setAuthStatus('unauthenticated');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [applyAuthSession]);

  useEffect(() => () => {
    if (calendarTodoTapTimeoutRef.current) {
      window.clearTimeout(calendarTodoTapTimeoutRef.current.timeoutId);
      calendarTodoTapTimeoutRef.current = null;
    }
  }, []);

  const clearCalendarTodoTap = () => {
    if (calendarTodoTapTimeoutRef.current) {
      window.clearTimeout(calendarTodoTapTimeoutRef.current.timeoutId);
      calendarTodoTapTimeoutRef.current = null;
    }
  };

  const startCalendarTodoRename = (item: CalendarSourceItem) => {
    if (item.isLocked || isLiveCanvasCalendarItem(item)) {
      return;
    }

    setFocusedCalendarTodoId(item.id);
  };

  const handleCalendarTodoTap = (
    event: ReactMouseEvent,
    item: CalendarSourceItem,
    isEditingTitle: boolean,
  ) => {
    if (isCalendarTodoInteractiveTarget(event.target) || item.isLocked || isLiveCanvasCalendarItem(item) || isEditingTitle) {
      return;
    }

    if (calendarTodoTapTimeoutRef.current?.itemId === item.id) {
      clearCalendarTodoTap();
      event.preventDefault();
      startCalendarTodoRename(item);
      return;
    }

    clearCalendarTodoTap();
    calendarTodoTapTimeoutRef.current = {
      itemId: item.id,
      timeoutId: window.setTimeout(() => {
        calendarTodoTapTimeoutRef.current = null;
        toggleCalendarSourceItemDone(item);
        persistAcademyPreferencesFromStorage();
      }, 350),
    };
  };

  const renderDayTodoContent = (variant: 'card' | 'dialog' | 'mobile' = 'card') => (
    <>
      <div className={cn(
        'min-w-0 rounded-lg border bg-muted/25 p-3',
        variant === 'card' && 'mb-4',
        variant === 'mobile' && 'mb-3 border-0 bg-transparent px-1 py-0',
      )}>
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={cn(
              'min-w-0 truncate text-xl font-black leading-tight text-foreground',
              variant === 'mobile' && 'text-base',
            )}>
              {selectedDayHeading.primary}
            </h2>
            {selectedDayHolidayItems.length > 0 ? (
              <div className="mt-1 flex max-w-full flex-wrap gap-1">
                {selectedDayHolidayItems.map(({ holiday, nationOption }) => (
                  <span
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-red-500/35 bg-red-500/10 px-2 py-0.5 text-xs font-black text-red-600"
                    key={`${nationOption.value}-${holiday.date}-${holiday.label}`}
                  >
                    <NationFlagIcon
                      alt={`${nationOption.shortLabel} flag`}
                      src={nationOption.flagIconSrc}
                    />
                    <span className="truncate">
                      {nationOption.shortLabel} · {holiday.label}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button
              className={cn(
                'rounded-md border px-2 py-0.5 text-xs font-black transition-colors',
                isSelectedCalendarDayToday
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              disabled={isSelectedCalendarDayToday}
              onClick={handleMoveSelectedDayToToday}
              type="button"
            >
              {dictionary.itemLabels.today}
            </button>
            {selectedDayRelativeBadge ? (
              <span className="rounded-md border bg-background px-2 py-0.5 text-xs font-black text-foreground">
                {selectedDayRelativeBadge}
              </span>
            ) : null}
          </div>
        </div>
        <CalendarProgressIndicator
          className={cn('mt-3', variant === 'mobile' && 'hidden')}
          display={academyCalendarSettings.progressDisplay}
          label={dictionary.calendarProgressLabel}
          thresholds={calendarProgressThresholds}
          value={selectedDayProgress}
          valueLabel={selectedDayProgressInfo.label}
        />
      </div>
      <div className={cn(
        'min-h-0 flex-1 overflow-y-auto pr-1',
        variant === 'dialog' && 'max-h-[64vh]',
        variant === 'mobile' && 'max-h-none overflow-visible pr-0',
      )}>
        {selectedDayGroups.length === 0 ? (
          <div className={cn(
            'rounded-lg border border-dashed bg-muted/35 p-4 text-sm font-bold text-muted-foreground',
            variant === 'mobile' && 'mx-1 border-border/60 bg-muted/15 px-3 py-3 text-xs',
          )}>
            {dictionary.selectedDayTodoEmpty}
          </div>
        ) : (
          <div className={cn('grid gap-4', variant === 'mobile' && 'gap-3')}>
            {selectedDayGroups.map((group) => (
              <section className="min-w-0" key={group.label}>
                <div className={cn('mb-2 flex min-w-0 items-center gap-2', variant === 'mobile' && 'mb-1.5 px-1')}>
                  <div
                    className={cn(
                      'inline-flex max-w-full rounded-md border px-2 py-1 text-xs font-black',
                      variant === 'mobile' && 'rounded-full px-3 py-1.5',
                      badgeColorClasses[group.color],
                    )}
                  >
                    <span className="truncate">{group.label}</span>
                  </div>
                  {group.canAdd !== false ? (
                    <button
                      aria-label={`${dictionary.courseworkAdd} · ${group.label}`}
                      className={cn(
                        'grid size-7 shrink-0 place-items-center rounded-md border text-xs font-black transition hover:brightness-95',
                        variant === 'mobile' && 'ml-auto rounded-full bg-muted/40',
                        badgeColorClasses[group.color],
                      )}
                      onClick={() => handleQuickAddSelectedDayCoursework(group.label, group.color)}
                      title={`${dictionary.courseworkAdd} · ${group.label}`}
                      type="button"
                    >
                      <Plus className="size-4" />
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  {group.items.length === 0 ? (
                    <div className="rounded-lg border border-dashed bg-muted/25 px-3 py-2 text-xs font-bold text-muted-foreground">
                      {dictionary.selectedDayTodoEmpty}
                    </div>
                  ) : group.items.map((item) => {
                    const dueLabel = formatCalendarSourceItemSelectedDayTime(item) ?? dictionary.allDay;
                    const moveTarget = getCalendarMoveDueDateTarget(item);
                    const courseDisplay = getCourseDisplay(item, dictionary.selectedDayTodoNoCourse);
                    const isClassSession = item.source === 'class-session';
                    const isPastClassSessionItem = isPastClassSession(item);
                    const isCanceledForHoliday = Boolean(item.isCanceledForHoliday);
                    const isInactiveClassSession = isClassSession && (isPastClassSessionItem || isCanceledForHoliday);
                    const holidayBadgeLabel = language === 'ko' ? '공휴일' : 'Holiday';
                    const isEditingTitle = focusedCalendarTodoId === item.id && !item.isLocked && !isLiveCanvasCalendarItem(item);
                    const itemRow = (
                      <div
                        className={cn(
                          'relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-lg border p-2 text-sm font-bold transition-colors',
                          isClassSession
                            ? 'border-dashed border-border/70 bg-transparent py-1.5 text-xs'
                            : 'bg-muted/25',
                          isClassSession && isPastClassSessionItem && !isCanceledForHoliday && 'border-border/60 bg-muted/35 opacity-80',
                          !isClassSession && item.isCompleted && 'border-foreground/25 bg-muted/45',
                          variant === 'mobile' && (isClassSession
                            ? 'border-0 bg-transparent px-1 py-1'
                            : 'border-0 bg-transparent px-1 py-1.5'),
                          item.isLocked ? 'cursor-default' : 'cursor-pointer hover:bg-muted/45',
                        )}
                        onKeyDown={(event) => {
                          if (isCalendarTodoInteractiveTarget(event.target)) {
                            return;
                          }

                          if ((event.key === 'Enter' || event.key === ' ') && !item.isLocked) {
                            event.preventDefault();
                            toggleCalendarSourceItemDone(item);
                            persistAcademyPreferencesFromStorage();
                          }
                        }}
                        onClick={(event) => {
                          handleCalendarTodoTap(event, item, isEditingTitle);
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        {isCanceledForHoliday ? (
                          <span
                            className="absolute -right-1 -top-2 z-10 max-w-24 truncate rounded-full border border-red-500/35 bg-card px-1.5 py-0.5 text-[9px] font-black uppercase leading-none text-red-600 shadow-sm"
                            title={item.holidayName}
                          >
                            {holidayBadgeLabel}
                          </span>
                        ) : null}
                        {isClassSession ? (
                          <span
                            aria-hidden="true"
                            className={cn(
                              'mt-1 shrink-0 rounded-full',
                              isCanceledForHoliday
                                ? 'size-2.5 bg-muted-foreground/35'
                                : isPastClassSessionItem
                                  ? 'size-2.5 bg-muted-foreground/35'
                                : cn('size-2.5', dotColorClasses[courseDisplay.color]),
                              variant === 'mobile' && (
                                isCanceledForHoliday
                                  ? 'mt-1.5 size-3 bg-muted-foreground/35'
                                  : isPastClassSessionItem
                                    ? 'mt-1.5 size-3 bg-muted-foreground/35'
                                    : 'mt-1.5 size-3'
                              ),
                            )}
                          />
                        ) : (
                          <button
                            aria-label={item.isLocked ? dictionary.selectedDayTodoLocked : item.title}
                            className={cn(
                              'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-black leading-none transition-colors',
                              variant === 'mobile' && 'size-6',
                              item.isCompleted
                                ? getCourseDoneCheckClass(courseDisplay.color)
                                : 'border-dashed border-muted-foreground/35 bg-background/70 text-muted-foreground hover:bg-muted',
                              item.isLocked && 'cursor-default opacity-90',
                            )}
                            disabled={item.isLocked}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleCalendarSourceItemDone(item);
                              persistAcademyPreferencesFromStorage();
                            }}
                            title={item.isLocked ? dictionary.selectedDayTodoLocked : item.title}
                            type="button"
                          >
                            {item.isCompleted ? '✓' : ''}
                          </button>
                        )}
                        <span className="min-w-0">
                          {isEditingTitle ? (
                            <input
                              aria-label={dictionary.boardAddTodoItem}
                              autoFocus
                              className="block min-w-0 max-w-full rounded-md border bg-background px-2 py-1 text-[15px] font-black leading-snug text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/45"
                              onBlur={handleFinishCalendarTodoTitleEdit}
                              onChange={(event) => handleUpdateCalendarSourceItemTitle(
                                item,
                                event.target.value,
                                { persist: false },
                              )}
                              onClick={(event) => event.stopPropagation()}
                              onFocus={(event) => event.currentTarget.select()}
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === 'Enter' || event.key === 'Escape') {
                                  event.currentTarget.blur();
                                }
                              }}
                              placeholder={dictionary.boardAddTodoItem}
                              value={item.title}
                            />
                          ) : (
                            <span
                              className={cn(
                                'block truncate text-[15px] font-black leading-snug text-foreground',
                                variant === 'mobile' && 'text-sm',
                                isClassSession && 'text-[13px] font-semibold text-muted-foreground',
                                isInactiveClassSession && !isCanceledForHoliday && 'text-muted-foreground line-through decoration-2',
                                isCanceledForHoliday && 'text-foreground line-through decoration-2 decoration-red-500',
                                !isClassSession && item.isCompleted && 'text-muted-foreground line-through decoration-2',
                              )}
                            >
                              {item.title || dictionary.boardAddTodoItem}
                            </span>
                          )}
                          <span className={cn(
                            'mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] font-black text-muted-foreground',
                            variant === 'mobile' && 'mt-0.5',
                          )}>
                            <span
                              className={cn(
                                'inline-flex h-5 w-20 shrink-0 items-center justify-center rounded-md border px-1.5 text-[10px] font-black',
                                isClassSession && 'h-4 w-auto min-w-14 px-1.5 text-[9px]',
                                getCalendarTimeChipClass(),
                              )}
                            >
                              <span className="truncate">{dueLabel}</span>
                            </span>
                            {isClassSession && item.location ? (
                              <span className="max-w-32 truncate text-[10px] font-semibold text-muted-foreground">
                                {item.location}
                              </span>
                            ) : null}
                            {isCanceledForHoliday && item.holidayName ? (
                              <span className="max-w-32 truncate text-[10px] font-semibold text-muted-foreground">
                                {item.holidayName}
                              </span>
                            ) : null}
                            {!isClassSession ? (
                              <span
                                className={cn(
                                  'max-w-28 truncate rounded-md border px-1.5 py-0.5',
                                  badgeColorClasses[courseDisplay.color],
                                )}
                              >
                                {formatCalendarTodoType(item.type)}
                              </span>
                            ) : null}
                            {!isClassSession ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  aria-label={dictionary.moreActions}
                                  className="grid size-7 shrink-0 place-items-center rounded-md border bg-background/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                  onClick={(event) => event.stopPropagation()}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  title={dictionary.moreActions}
                                  type="button"
                                >
                                  <MoreHorizontal className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem onSelect={() => openCalendarSourceItem(item)}>
                                  <ExternalLink className="size-4" />
                                  <span>{dictionary.courseOverviewOpenCanvas}</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleOpenCalendarTodoDetails(item)}>
                                  <Pencil className="size-4" />
                                  <span>{dictionary.courseworkOpenDetails}</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleToggleCalendarTodoStar(item)}>
                                  <Star className={cn('size-4', item.isStarred && 'fill-amber-400 text-amber-500')} />
                                  <span>{item.isStarred ? dictionary.courseworkUnstar : dictionary.courseworkStar}</span>
                                </DropdownMenuItem>
                                {moveTarget ? (
                                  <DropdownMenuItem onSelect={() => handleMoveCalendarTodoDueDate(item, moveTarget)}>
                                    <CalendarPlus className="size-4" />
                                    <span>
                                      {moveTarget === 'today'
                                        ? dictionary.courseworkDoToday
                                        : dictionary.courseworkDoTomorrow}
                                    </span>
                                  </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuItem
                                  disabled={item.isLocked}
                                  onSelect={() => {
                                    toggleCalendarSourceItemDone(item);
                                    persistAcademyPreferencesFromStorage();
                                  }}
                                >
                                  <Check className="size-4" />
                                  <span>
                                    {item.isLocked
                                      ? dictionary.courseworkSubmittedInCanvas
                                      : item.isCompleted
                                        ? dictionary.courseworkMarkNotDone
                                        : dictionary.courseworkMarkDone}
                                  </span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleRemoveCalendarTodo(item)}>
                                  {item.source === 'canvas' ? <EyeOff className="size-4" /> : <Trash2 className="size-4" />}
                                  <span>
                                    {item.source === 'canvas'
                                      ? dictionary.courseworkHideCanvas
                                      : dictionary.courseworkDelete}
                                  </span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            ) : null}
                          </span>
                        </span>
                      </div>
                    );

                    if (isClassSession) {
                      return <div key={item.id}>{itemRow}</div>;
                    }

                    return (
                      <ContextMenu key={item.id}>
                        <ContextMenuTrigger asChild>{itemRow}</ContextMenuTrigger>
                        <ContextMenuContent className="w-56">
                          <ContextMenuLabel>{item.title}</ContextMenuLabel>
                          <ContextMenuItem onSelect={() => openCalendarSourceItem(item)}>
                            <ExternalLink className="size-4" />
                            <span>{dictionary.courseOverviewOpenCanvas}</span>
                          </ContextMenuItem>
                          <ContextMenuItem onSelect={() => handleOpenCalendarTodoDetails(item)}>
                            <Pencil className="size-4" />
                            <span>{dictionary.courseworkOpenDetails}</span>
                          </ContextMenuItem>
                          <ContextMenuItem onSelect={() => handleToggleCalendarTodoStar(item)}>
                            <Star className={cn('size-4', item.isStarred && 'fill-amber-400 text-amber-500')} />
                            <span>{item.isStarred ? dictionary.courseworkUnstar : dictionary.courseworkStar}</span>
                          </ContextMenuItem>
                          {moveTarget ? (
                            <ContextMenuItem onSelect={() => handleMoveCalendarTodoDueDate(item, moveTarget)}>
                              <CalendarPlus className="size-4" />
                              <span>
                                {moveTarget === 'today'
                                  ? dictionary.courseworkDoToday
                                  : dictionary.courseworkDoTomorrow}
                              </span>
                            </ContextMenuItem>
                          ) : null}
                          <ContextMenuItem
                            disabled={item.isLocked}
                            onSelect={() => {
                              toggleCalendarSourceItemDone(item);
                              persistAcademyPreferencesFromStorage();
                            }}
                          >
                            <Check className="size-4" />
                            <span>
                              {item.isLocked
                                ? dictionary.courseworkSubmittedInCanvas
                                : item.isCompleted
                                  ? dictionary.courseworkMarkNotDone
                                  : dictionary.courseworkMarkDone}
                            </span>
                          </ContextMenuItem>
                          <ContextMenuItem onSelect={() => handleRemoveCalendarTodo(item)}>
                            {item.source === 'canvas' ? <EyeOff className="size-4" /> : <Trash2 className="size-4" />}
                            <span>
                              {item.source === 'canvas'
                                ? dictionary.courseworkHideCanvas
                                : dictionary.courseworkDelete}
                            </span>
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
  if (authStatus !== 'authenticated') {
    return (
      <LoginPage
        academyLogoSrc={academyCalendarSettings.academyLogoSrc}
        authMessage={authRedirectMessage}
        isCheckingSession={authStatus === 'checking'}
        onAcademyAuthenticated={refreshAuthSession}
        onThemeChange={(nextTheme) => {
          setAcademyCalendarSettings((currentSettings) => normalizeAcademyCalendarSettings({
            ...currentSettings,
            themeMode: nextTheme,
          }));
        }}
        theme={academyEffectiveTheme}
      />
    );
  }

  return (
    <div
      className={cn(
        'min-h-screen academy-typography',
        (!isMainOnlyView || isAcademySettingsView) && 'lg:h-screen lg:overflow-hidden',
        shouldUseAcademyFullHeightLayout &&
          (!isMainOnlyView || isAcademySettingsView) &&
          'h-screen overflow-hidden',
        isAcademySettingsView && 'h-screen overflow-hidden',
      )}
      style={
        {
          '--academy-font-family': academyFontFamilyCss[academyCalendarSettings.fontFamily],
          '--academy-font-size-scale': `${academyCalendarSettings.fontSizePercent / 100}`,
        } as CSSProperties
      }
    >
      {shouldHideCompactAcademyTopBar ? null : (
        <TopBar
          academyLogoSrc={academyCalendarSettings.academyLogoSrc}
          authSession={authSession}
          isTopBarCollapsed={effectiveTopBarCollapsed}
          onOpenAddItem={openAcademyCourseworkDialog}
          onOpenProfile={() => {
            setAcademySettingsFocusSection('profile');
            handleSelectSidebarItem('settings');
          }}
          onSignOut={signOut}
          onToggleTopBarCollapsed={() => setAcademyTopBarCollapseOverride({
            defaultValue: academyCalendarSettings.topBarDefaultCollapsed,
            value: !effectiveTopBarCollapsed,
          })}
          onThemeChange={handleThemeChange}
          theme={academyEffectiveTheme}
        />
      )}

      {canvasRedirectFeedback ? (
        <div
          className={cn(
            'mx-3 mt-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm font-semibold lg:mx-4',
            canvasRedirectFeedback.tone === 'error'
              ? 'border-destructive/35 bg-destructive/10 text-destructive'
              : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
          )}
          role={canvasRedirectFeedback.tone === 'error' ? 'alert' : 'status'}
        >
          <span>{canvasRedirectFeedback.message}</span>
          <Button onClick={() => setCanvasRedirectFeedback(null)} size="sm" type="button" variant="ghost">
            Dismiss
          </Button>
        </div>
      ) : null}

      <Dialog
        onOpenChange={(open) => {
          setIsAcademySettingsLeaveDialogOpen(open);
          if (!open) {
            pendingSettingsNavigationRef.current = null;
          }
        }}
        open={isAcademySettingsLeaveDialogOpen}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{dictionary.academySettingsLeaveTitle}</DialogTitle>
          </DialogHeader>
          <p className="text-sm font-semibold text-muted-foreground">
            {dictionary.academySettingsLeaveDescription}
          </p>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              onClick={() => {
                pendingSettingsNavigationRef.current = null;
                setIsAcademySettingsLeaveDialogOpen(false);
              }}
              type="button"
              variant="outline"
            >
              {dictionary.academySettingsLeaveCancel}
            </Button>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                onClick={() => {
                  handleRevertAcademyCalendarSettings();
                  runPendingSettingsNavigation();
                }}
                type="button"
                variant="outline"
              >
                {dictionary.academySettingsLeaveRevert}
              </Button>
              <Button
                disabled={academyPreferencesSaveStatus === 'saving'}
                onClick={() => {
                  void handleSaveAcademyCalendarSettings()
                    .then(() => {
                      runPendingSettingsNavigation();
                    });
                }}
                type="button"
              >
                {academyPreferencesSaveStatus === 'saving'
                  ? dictionary.academySettingsSaving
                  : dictionary.academySettingsLeaveSave}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !isCanvasTokenExpirySaving) {
            ignoreExpiredCanvasToken();
          }
        }}
        open={isCanvasTokenExpiryDialogOpen}
      >
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{dictionary.canvasTokenExpiredDialogTitle}</DialogTitle>
          </DialogHeader>
          <p className="text-sm font-semibold text-muted-foreground">
            {dictionary.canvasTokenExpiredDialogDescription}
          </p>
          <form className="grid gap-3" onSubmit={handleExpiredCanvasTokenSubmit}>
            <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
              <span>{dictionary.canvasTokenValue}</span>
              <Input
                autoComplete="new-password"
                disabled={isCanvasTokenExpirySaving}
                onChange={(event) => setCanvasTokenExpiryDraft((currentDraft) => ({
                  ...currentDraft,
                  accessToken: event.target.value,
                }))}
                placeholder={dictionary.canvasTokenValuePlaceholder}
                type="password"
                value={canvasTokenExpiryDraft.accessToken}
              />
            </label>
            <div className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
              <span>{dictionary.canvasTokenExpiresAt}</span>
              <DateTimeField
                defaultTime="23:59"
                disabled={isCanvasTokenExpirySaving}
                id="expired-canvas-token-expires-at"
                onChange={(value) => setCanvasTokenExpiryDraft((currentDraft) => ({
                  ...currentDraft,
                  expiresAt: value,
                }))}
                value={canvasTokenExpiryDraft.expiresAt}
              />
            </div>
            {canvasTokenExpiryError ? (
              <div className="rounded-md border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-200">
                {canvasTokenExpiryError}
              </div>
            ) : null}
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                disabled={isCanvasTokenExpirySaving}
                onClick={ignoreExpiredCanvasToken}
                type="button"
                variant="outline"
              >
                {dictionary.canvasTokenIgnoreAndContinue}
              </Button>
              <Button disabled={isCanvasTokenExpirySaving} type="submit">
                {isCanvasTokenExpirySaving ? dictionary.canvasTokenSaving : dictionary.canvasTokenSave}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <main
        className={cn(
          'mx-auto grid w-full max-w-[2400px] items-start gap-3 overflow-x-clip p-3',
          !isAcademyEffectiveLarge && 'block',
          isMainOnlyView && !isAcademySettingsView
            ? 'lg:min-h-[calc(100vh_-_var(--top-bar-height))] lg:overflow-visible'
            : 'lg:h-[calc(100vh_-_var(--top-bar-height))] lg:grid-rows-1 lg:items-stretch lg:overflow-hidden',
          shouldUseAcademyFullHeightLayout &&
            (isMainOnlyView && !isAcademySettingsView
              ? 'min-h-[calc(100vh_-_var(--top-bar-height))] overflow-visible'
              : 'h-[calc(100vh_-_var(--top-bar-height))] grid-rows-1 items-stretch overflow-hidden'),
          isAcademySettingsView &&
            'h-[calc(100vh_-_var(--top-bar-height))] grid-rows-1 items-stretch overflow-hidden',
          shouldShowAcademyBottomNav && 'pb-20 max-[520px]:pb-24',
          'max-[520px]:px-2 max-[520px]:pb-24 max-[520px]:pt-2',
          mainGridColumnsClass,
        )}
        style={{
          '--top-bar-height': shouldHideCompactAcademyTopBar
            ? '0px'
            : effectiveTopBarCollapsed
              ? '42px'
              : '74px',
        } as CSSProperties}
      >
        <Sidebar
          activeItemId={activeSidebarItem}
          collapsed={isWorkspaceSidebarCollapsed}
          mode={filteredActiveMode}
          onToggleCollapsed={() => setIsWorkspaceSidebarCollapsed((current) => !current)}
          onSelectItem={handleSelectSidebarItem}
        />
        <section
          className={cn(
            'grid w-full min-w-0 lg:min-h-0 lg:pr-1',
            shouldUseAcademyFullHeightLayout && 'min-h-0 pr-1',
            isMainOnlyView && !isAcademySettingsView
              ? 'lg:overflow-visible'
              : 'lg:h-full lg:overflow-x-hidden',
            shouldUseAcademyFullHeightLayout &&
              (isMainOnlyView && !isAcademySettingsView
                ? 'overflow-visible'
                : 'h-full overflow-x-hidden'),
            isAcademySettingsView && 'h-full min-h-0 overflow-y-auto overflow-x-hidden pr-1',
            isDashboardWorkspaceView
                ? effectiveCalendarExpanded
                  ? 'gap-0 content-stretch lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden'
                  : 'gap-4 content-stretch lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden max-lg:gap-3'
                : 'gap-4 content-start lg:overflow-y-auto max-lg:gap-3',
            shouldUseAcademyFullHeightLayout &&
              (isDashboardWorkspaceView
                  ? effectiveCalendarExpanded
                    ? 'grid-rows-[minmax(0,1fr)] overflow-hidden'
                    : 'grid-rows-[auto_minmax(0,1fr)] overflow-hidden'
                  : 'overflow-y-auto'),
          )}
        >
          <Suspense
            fallback={<WorkspaceViewFallback />}
            key={authSession ? getAuthSessionIdentityKey(authSession) ?? 'anonymous' : 'anonymous'}
          >
            {isAcademySettingsView ? (
              <AcademySettingsView
                authSession={authSession}
                focusSection={academySettingsFocusSection}
                hasUnsavedChanges={hasUnsavedAcademySettings}
                onFocusSectionConsumed={() => setAcademySettingsFocusSection(null)}
                onProfileSaved={refreshAuthSession}
                onRevertSettings={handleRevertAcademyCalendarSettings}
                onSaveSettings={handleSaveAcademyCalendarSettings}
                onSettingsChange={handleAcademyCalendarSettingsChange}
                onSignOut={signOut}
                settings={academyCalendarSettings}
                settingsSaveError={academyPreferencesSaveError}
                settingsSaveStatus={academyPreferencesSaveStatus}
              />
            ) : isAdminUsersView ? (
              <AdminUsersView />
            ) : isCoursesView ? (
              <CourseOverviewView
                initialResourceUrl={selectedCourseOverviewResourceUrl}
                initialSelectedCourseRowId={selectedCourseOverviewRowId}
                selectedSemester={selectedAcademySemester}
              />
            ) : isGradesView ? (
              <AcademyGradesView selectedSemester={selectedAcademySemester} />
            ) : isInboxView ? (
              <CanvasInboxView
                onOpenIntegration={openAcademyCourseResource}
                selectedSemester={selectedAcademySemester}
              />
            ) : isPeopleView ? (
              <CanvasPeopleView
                onOpenCoursePeople={openAcademyCourseResource}
                selectedSemester={selectedAcademySemester}
              />
            ) : (
              <>
                <div
                  className={cn(
                    'dashboard-summary-container overflow-hidden transition-all duration-300 ease-out',
                    effectiveCalendarExpanded && 'contents',
                  )}
                >
                  <DashboardCards
                    academyAutoRefreshIntervalMs={academyAutoRefreshIntervalMs}
                    compactAcademySummary={shouldUseCompactDashboardMonth}
                    courseworkHideSettings={{
                      completedAfterHours: academyCalendarSettings.courseworkHideCompletedAfterHours,
                      completedFrom: academyCalendarSettings.courseworkHideCompletedFrom,
                      uncompletedAfterHours: academyCalendarSettings.courseworkHideUncompletedAfterHours,
                    }}
                    courseworkShowStudyItems={academyCalendarSettings.courseworkShowStudyItems}
                    effectiveWideSummaryCards={isAcademyEffectiveExtraLarge}
                    hideSummaryCards={effectiveCalendarExpanded}
                    onOpenAddItem={openAcademyCourseworkDialog}
                    onOpenCourse={openAcademyCourseResource}
                    onToggleCourseworkStudyItems={handleToggleCourseworkStudyItems}
                    selectedSemester={selectedAcademySemester}
                  />
                </div>
              {currentView === 'board' ? (
                <div
                  className={cn(
                    'min-h-[calc(100dvh_-_var(--top-bar-height)_-_6.5rem)] flex-col overflow-hidden rounded-xl bg-card p-3 shadow-none',
                    isPhoneAcademyMode ? 'flex' : 'hidden',
                  )}
                >
                  {renderDayTodoContent()}
                </div>
              ) : null}
              <div
                className={cn(
                  'min-w-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col',
                  (shouldForceDashboardCalendarFill || shouldUseCompactDashboardMonth) &&
                    'flex h-full min-h-0 flex-col',
                  currentView === 'board' &&
                    isPhoneAcademyMode &&
                    'hidden',
                )}
              >
                <CalendarShell
                  agendaDateLabel={selectedDayHeading.year
                    ? `${selectedDayHeading.primary} ${selectedDayHeading.year}`
                    : selectedDayHeading.primary}
                  boardColumns={calendarBoardColumns}
                  calendarTodoStyle={academyCalendarSettings.calendarTodoStyle}
                  courseFilterOptions={calendarCourseFilterOptions}
                  data={calendarData}
                  emptyMessage={canvasCalendarEmptyMessage}
                  warningMessage={hasIncompleteVisibleCanvasCalendar
                    ? dictionary.canvasCalendarIncomplete
                    : undefined}
                  fillHeight={shouldUseAcademyFullHeightLayout && isDashboardWorkspaceView}
                  focusedBoardItemId={focusedCalendarTodoId}
                  holidayNation={academyCalendarSettings.nation}
                  isExpanded={effectiveCalendarExpanded}
                  isCompactMonth={shouldUseCompactDashboardMonth}
                  isSelectedDateToday={isSelectedCalendarDayToday}
                  isLoading={effectiveCanvasCalendarLoadStatus === 'loading'}
                  mode={activeMode}
                  onAddCourseworkForDay={handleQuickAddCalendarCourseworkForDay}
                  onFinishTodoTitleEdit={handleFinishCalendarTodoTitleEdit}
                  onNextMonth={() => setCalendarMonth((currentMonth) => addCalendarMonths(currentMonth, 1))}
                  onNextAgendaDay={() => handleMoveSelectedAgendaDay(1)}
                  onOpenAddItem={handleQuickAddCalendarTodo}
                  onOpenTodo={openCalendarActionItem}
                  onOpenTodoDetails={handleOpenCalendarTodoDetails}
                  onMoveTodoDueDate={handleMoveCalendarTodoDueDate}
                  onPreviousAgendaDay={() => handleMoveSelectedAgendaDay(-1)}
                  onPreviousMonth={() => setCalendarMonth((currentMonth) => addCalendarMonths(currentMonth, -1))}
                  onRemoveTodo={handleRemoveCalendarTodo}
                  onStartTodoTitleEdit={(item) => setFocusedCalendarTodoId(item.id)}
                  onToggleCourseFilter={handleToggleCalendarCourse}
                  onSelectItem={(day) => {
                    if (day?.dateIso) {
                      setSelectedCalendarDayIso(day.dateIso);
                      if (isDayTodoDialogMode && !isPhoneAcademyMode) {
                        setIsDayTodoDialogOpen(true);
                      }
                    }
                  }}
                  onToggleExpanded={!shouldAutoExpandCalendar
                    ? () => setIsCalendarExpanded((currentValue) => !currentValue)
                    : undefined}
                  onToday={handleMoveSelectedDayToToday}
                  onToggleTodoDone={handleToggleCalendarTodoDone}
                  onToggleTodoStar={handleToggleCalendarTodoStar}
                  onUpdateTodoTitle={handleUpdateCalendarTodoTitle}
                  onViewChange={(view) => {
                    const isOpeningDayScopedView = view === 'agenda' || view === 'board';
                    const isLeavingDayScopedViews = currentView !== 'agenda' && currentView !== 'board';

                    if (isOpeningDayScopedView && isLeavingDayScopedViews) {
                      handleMoveSelectedDayToToday();
                    }

                    navigateWorkspace({
                      modeId: activeMode.id,
                      sidebarItemId: view === 'board' ? view : 'calendar',
                      view,
                    });
                  }}
                  progressDisplay={academyCalendarSettings.progressDisplay}
                  progressThresholds={calendarProgressThresholds}
                  showCurrentTime={isSelectedCalendarDayToday}
                  todayIso={activeCalendarTodayIso}
                  view={currentView}
                />
                {currentView === 'month' ? (
                  <div
                    className={cn(
                      'px-1 pb-3 pt-2',
                      isPhoneAcademyMode ? 'block' : 'hidden',
                    )}
                  >
                    {renderDayTodoContent('mobile')}
                  </div>
                ) : null}
              </div>
              </>
            )}
          </Suspense>
        </section>
        {isMainOnlyView ? null : (
          <aside
            className={cn(
              'min-h-0 w-full min-w-0 overflow-hidden rounded-xl bg-card p-4 shadow-none',
              canShowAcademyDashboardSideTodo
                ? 'flex h-full flex-col self-stretch'
                : 'hidden',
            )}
          >
            {renderDayTodoContent()}
          </aside>
        )}
      </main>

      {isDashboardWorkspaceView && isDayTodoDialogMode ? (
        <>
          <Dialog onOpenChange={setIsDayTodoDialogOpen} open={isDayTodoDialogOpen}>
            <DialogContent className="grid max-h-[calc(100vh-2rem)] overflow-hidden sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-base font-black">
                  {dictionary.selectedDayTodoTitle}
                </DialogTitle>
              </DialogHeader>
              <div className="min-h-0 overflow-hidden">
                {renderDayTodoContent('dialog')}
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}

      <CalendarTodoDetailsDialog
        item={selectedCalendarTodoDetailsItem}
        key={selectedCalendarTodoDetailsItem?.id ?? 'closed-calendar-todo-details'}
        onOpenItem={openCalendarSourceItem}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedCalendarTodoDetailsId(null);
          }
        }}
        onSave={handleSaveCalendarTodoDetails}
      />

      <nav
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 gap-2 border-t bg-card/95 py-1.5 pb-[calc(env(safe-area-inset-bottom)+0.375rem)] shadow-[0_-12px_32px_hsl(var(--background)/0.75)] backdrop-blur-xl',
          shouldShowAcademyBottomNav ? 'grid' : 'hidden',
          isPhoneAcademyMode ? 'flex overflow-x-auto px-2' : 'px-4',
        )}
        aria-label="Academy navigation"
        style={isPhoneAcademyMode
          ? undefined
          : {
              gridTemplateColumns: `repeat(${Math.max(
                1,
                filteredActiveMode.sidebar.flatMap((section) => section.items).length,
              )}, minmax(0, 1fr))`,
            }}
      >
        {isPhoneAcademyMode ? (
          <>
            {filteredActiveMode.sidebar.flatMap((section) => section.items).map((item) => (
              <div className="min-w-12 flex-1" key={item.id}>
                <AcademyBottomNavigationButton
                  active={activeSidebarItem === item.id && currentView !== 'board'}
                  icon={item.icon}
                  isPhone
                  label={translateItemLabel(item.id, item.label)}
                  onClick={() => handleSelectSidebarItem(item.id)}
                />
              </div>
            ))}
            <AcademyBottomNavigationButton
              active={isDashboardWorkspaceView && currentView === 'board'}
              icon="list-checks"
              isPhone
              label={language === 'ko' ? '할 일' : 'To Do'}
              onClick={() => {
                handleMoveSelectedDayToToday();
                navigateWorkspace({
                  modeId: activeMode.id,
                  sidebarItemId: 'calendar',
                  view: 'board',
                });
              }}
            />
          </>
        ) : filteredActiveMode.sidebar.flatMap((section) => section.items).map((item) => (
          <AcademyBottomNavigationButton
            active={activeSidebarItem === item.id}
            icon={item.icon}
            isPhone={false}
            key={item.id}
            label={translateItemLabel(item.id, item.label)}
            onClick={() => handleSelectSidebarItem(item.id)}
          />
        ))}
      </nav>
    </div>
  );
}

export default App;
