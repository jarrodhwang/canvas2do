import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Activity,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  EyeOff,
  KeyRound,
  LayoutPanelTop,
  LogOut,
  MoreHorizontal,
  Moon,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Sun,
  Trash2,
} from 'lucide-react';
import { workspaceApi } from './api/workspaceApi';
import type { AcademyPreferences, AuthSession, CanvasCalendarItem, CanvasTokenStatus, GoogleDriveFile } from './api/workspaceApi';
import { AddItemModal } from './components/AddItemModal';
import { AdminGroupsView } from './components/AdminGroupsView';
import { AdminUsersView } from './components/AdminUsersView';
import { CalendarShell } from './components/CalendarShell';
import { CanvasInboxView } from './components/CanvasInboxView';
import { CanvasPeopleView } from './components/CanvasPeopleView';
import { CourseOverviewView } from './components/CourseOverviewView';
import { DashboardCards } from './components/DashboardCards';
import { DateTimeField } from './components/DateTimeField';
import { DetailPanel } from './components/DetailPanel';
import { DriveDetailPanel } from './components/DriveDetailPanel';
import { DriveFilesView } from './components/DriveFilesView';
import { GoogleCommunicationView } from './components/GoogleCommunicationView';
import { LoginPage } from './components/LoginPage';
import { OutlookEmailView } from './components/OutlookEmailView';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import {
  CalendarProgressIndicator,
  defaultCalendarProgressThresholds,
  type CalendarProgressDisplay,
  type CalendarProgressThresholds,
} from './components/CalendarProgressIndicator';
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
import type { AgendaItem, BoardItem, CalendarDay, CalendarEvent, TimelineItem, WorkspaceModeMockData } from './data/mockWorkspaceData';
import { badgeColorClasses, dotColorClasses } from './lib/colorStyles';
import { cn } from './lib/utils';
import type { BoardColumnConfig, ColorToken, WorkspaceView } from './modes/types';
import { applyTheme, getInitialTheme, type AppTheme } from './theme';

interface WorkspaceNavigation {
  modeId: string;
  sidebarItemId: string;
  view: WorkspaceView;
}

interface WorkspaceHistoryState {
  source: 'incos-workspace';
  navigation: WorkspaceNavigation;
}

interface DriveBrowserHistoryState {
  source: 'incos-drive-browser';
}

type CanvasCalendarLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';

interface CanvasCalendarPage {
  items: CanvasCalendarItem[];
  status: CanvasCalendarLoadStatus;
}

interface AcademyCalendarSettings {
  accentColor: ColorToken;
  courseworkHideCompletedAfterHours: number;
  courseworkHideCompletedFrom: 'completedAt' | 'dueAt';
  hiddenCourseIds?: string[];
  progressDisplay: CalendarProgressDisplay;
  progressGreenAt: number;
  progressYellowAt: number;
  selectedSemester?: string;
  themeMode: AppTheme;
  topBarDefaultCollapsed: boolean;
}

interface AdminConsoleSettings {
  topBarDefaultCollapsed: boolean;
}

function isWorkspaceHistoryState(value: unknown): value is WorkspaceHistoryState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const state = value as Partial<WorkspaceHistoryState>;

  return state.source === 'incos-workspace'
    && Boolean(state.navigation)
    && typeof state.navigation?.modeId === 'string'
    && typeof state.navigation?.sidebarItemId === 'string'
    && typeof state.navigation?.view === 'string';
}

function isDriveBrowserHistoryState(value: unknown): value is DriveBrowserHistoryState {
  return Boolean(value)
    && typeof value === 'object'
    && (value as Partial<DriveBrowserHistoryState>).source === 'incos-drive-browser';
}

function getInitialAuthRedirectMessage() {
  if (typeof window === 'undefined') {
    return null;
  }

  const authError = new URLSearchParams(window.location.search).get('authError');

  return authError?.trim() || null;
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
  originalCourseCode?: string;
  semester?: string;
  starred?: boolean;
  submissionType?: string;
  termName?: string;
  title?: string;
}

interface StoredManualCoursework {
  id: string;
  title: string;
  courseCode?: string;
  courseName?: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  courseworkType?: string;
  submissionType?: string;
  completed?: boolean;
  completedAt?: string;
  hidden?: boolean;
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
  semester?: string;
  starred?: boolean;
}

interface CalendarSourceItem {
  id: string;
  source: 'canvas' | 'manual-coursework' | 'manual-assessment';
  title: string;
  type: string;
  courseId?: string;
  courseCode?: string;
  courseName?: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  htmlUrl?: string;
  semester?: string;
  color: ColorToken;
  isCompleted?: boolean;
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

interface SelectedDayCourseGroup {
  canAdd?: boolean;
  color: ColorToken;
  items: CalendarSourceItem[];
  label: string;
}

const manualLecturesStorageKey = 'incos-academy-manual-lectures';
const canvasLecturePreferencesStorageKey = 'incos-academy-canvas-lecture-preferences';
const manualCourseworkStorageKey = 'incos-academy-manual-coursework';
const canvasCourseworkPreferencesStorageKey = 'incos-academy-canvas-coursework-preferences';
const manualAssessmentsStorageKey = 'incos-academy-manual-assessments';
const canvasAssessmentPreferencesStorageKey = 'incos-academy-canvas-assessment-preferences';
const academyCalendarSettingsStorageKey = 'incos-academy-calendar-settings';
const academyCalendarHiddenCoursesStorageKey = 'incos-academy-calendar-hidden-courses';
const adminConsoleSettingsStorageKey = 'incos-admin-console-settings';
const academyPreferencesUpdatedEvent = 'incos-academy-preferences-updated';
const academyOpenCourseworkDialogEvent = 'incos-academy-open-coursework-dialog';
const academyRefreshRequestedEvent = 'incos-academy-refresh-requested';
type AcademyOpenCourseworkDialogDetail = {
  courseCode?: string;
  dueAt?: string;
  startAt?: string;
  title?: string;
};
type AcademyRefreshRequestedDetail = {
  registerTask?: (task: Promise<unknown>) => void;
};
const defaultAcademySemester = getDateBasedAcademySemester();
const topTrackExternalUrl = 'https://toptrack.topsolid.com/';
const academyAccentColors: ColorToken[] = [
  'gold',
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
  gray: { primary: 'oklch(0.556 0 0)', primaryForeground: 'oklch(0.985 0 0)' },
};

const defaultAcademyCalendarSettings: AcademyCalendarSettings = {
  accentColor: 'gold',
  courseworkHideCompletedAfterHours: 24,
  courseworkHideCompletedFrom: 'dueAt',
  progressDisplay: 'linear',
  progressGreenAt: defaultCalendarProgressThresholds.greenAt,
  progressYellowAt: defaultCalendarProgressThresholds.yellowAt,
  themeMode: 'dark',
  topBarDefaultCollapsed: false,
};
const defaultAdminConsoleSettings: AdminConsoleSettings = {
  topBarDefaultCollapsed: false,
};
const calendarAutoExpandMediaQuery = '(max-width: 1279px), (max-height: 860px)';
const dayTodoDialogMediaQuery = '(max-width: 1535px)';
const phoneAcademyMediaQuery = '(max-width: 520px)';
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

let academyPreferenceCache: AcademyPreferenceCache = {
  canvasAssessmentPreferences: {},
  canvasCourseworkPreferences: {},
  canvasLecturePreferences: {},
  calendarSettings: defaultAcademyCalendarSettings,
  manualAssessments: [],
  manualCoursework: [],
  manualLectures: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
      academyPreferenceCache.calendarSettings = normalizeAcademyCalendarSettings(value);
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

  if (!trimmedValue || /^default term$/i.test(trimmedValue)) {
    return fallback;
  }

  return trimmedValue;
}

function semesterMatches(value: string | undefined, selectedSemester: string | undefined, fallback = defaultAcademySemester) {
  return normalizeSemesterName(value, fallback) === normalizeSemesterName(selectedSemester, fallback);
}

function getInitialCalendarAutoExpanded() {
  return typeof window !== 'undefined' &&
    window.matchMedia(calendarAutoExpandMediaQuery).matches;
}

function getInitialDayTodoDialogMode() {
  return typeof window !== 'undefined' &&
    window.matchMedia(dayTodoDialogMediaQuery).matches;
}

function getInitialPhoneAcademyMode() {
  return typeof window !== 'undefined' &&
    window.matchMedia(phoneAcademyMediaQuery).matches;
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

function normalizeAcademyCalendarSettings(value: unknown): AcademyCalendarSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaultAcademyCalendarSettings;
  }

  const settings = value as Partial<AcademyCalendarSettings>;
  const progressDisplay = settings.progressDisplay === 'circular' ? 'circular' : 'linear';
  const progressGreenAt = Number.isFinite(settings.progressGreenAt)
    ? Math.min(Math.max(Number(settings.progressGreenAt), 0), 100)
    : defaultAcademyCalendarSettings.progressGreenAt;
  const progressYellowAt = Number.isFinite(settings.progressYellowAt)
    ? Math.min(Math.max(Number(settings.progressYellowAt), 0), progressGreenAt)
    : Math.min(defaultAcademyCalendarSettings.progressYellowAt, progressGreenAt);
  const courseworkHideCompletedAfterHours = Number.isFinite(settings.courseworkHideCompletedAfterHours)
    ? Math.min(Math.max(Number(settings.courseworkHideCompletedAfterHours), 0), 720)
    : defaultAcademyCalendarSettings.courseworkHideCompletedAfterHours;
  const courseworkHideCompletedFrom = settings.courseworkHideCompletedFrom === 'completedAt'
    ? 'completedAt'
    : 'dueAt';
  const hiddenCourseIds = Array.isArray(settings.hiddenCourseIds)
    ? settings.hiddenCourseIds.filter((value): value is string => typeof value === 'string')
    : undefined;
  const themeMode: AppTheme = settings.themeMode === 'light' ? 'light' : 'dark';
  const accentColor = typeof settings.accentColor === 'string' &&
    academyAccentColorOptions.includes(settings.accentColor as ColorToken)
    ? settings.accentColor as ColorToken
    : defaultAcademyCalendarSettings.accentColor;

  return {
    accentColor,
    courseworkHideCompletedAfterHours,
    courseworkHideCompletedFrom,
    hiddenCourseIds,
    progressDisplay,
    progressGreenAt,
    progressYellowAt,
    selectedSemester: typeof settings.selectedSemester === 'string' ? settings.selectedSemester : undefined,
    themeMode,
    topBarDefaultCollapsed: Boolean(settings.topBarDefaultCollapsed),
  };
}

function getStoredAcademyCalendarSettings() {
  return normalizeAcademyCalendarSettings(
    readStoredJson<unknown>(academyCalendarSettingsStorageKey, defaultAcademyCalendarSettings),
  );
}

function normalizeAdminConsoleSettings(value: unknown): AdminConsoleSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaultAdminConsoleSettings;
  }

  const settings = value as Partial<AdminConsoleSettings>;

  return {
    topBarDefaultCollapsed: Boolean(settings.topBarDefaultCollapsed),
  };
}

function getStoredAdminConsoleSettings() {
  return normalizeAdminConsoleSettings(
    readStoredJson<unknown>(adminConsoleSettingsStorageKey, defaultAdminConsoleSettings),
  );
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

function storeAdminConsoleSettings(settings: AdminConsoleSettings) {
  storeJson(adminConsoleSettingsStorageKey, settings);
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
  const accentSoft = `color-mix(in oklch, ${variables.primary} ${isDarkTheme ? '14%' : '10%'}, ${isDarkTheme ? 'oklch(0.12 0 0)' : 'white'})`;
  const accentSofter = `color-mix(in oklch, ${variables.primary} ${isDarkTheme ? '9%' : '6%'}, ${isDarkTheme ? 'oklch(0.12 0 0)' : 'white'})`;
  const accentCard = `color-mix(in oklch, ${variables.primary} ${isDarkTheme ? '8%' : '4%'}, ${isDarkTheme ? 'oklch(0.17 0 0)' : 'white'})`;
  const accentBorder = `color-mix(in oklch, ${variables.primary} ${isDarkTheme ? '28%' : '18%'}, ${isDarkTheme ? 'oklch(1 0 0 / 14%)' : 'oklch(0.88 0.035 83)'})`;
  const accentAlphaStrong = variables.primary.replace(/\)$/, ` / ${isDarkTheme ? '0.22' : '0.26'})`);
  const accentAlphaSoft = variables.primary.replace(/\)$/, ` / ${isDarkTheme ? '0.1' : '0.14'})`);

  root.style.setProperty(
    '--app-bg',
    isDarkTheme
      ? [
          `radial-gradient(circle at 14% 10%, ${accentAlphaStrong}, transparent 30%)`,
          `radial-gradient(circle at 88% 14%, ${accentAlphaSoft}, transparent 28%)`,
          'linear-gradient(135deg, oklch(0.1 0 0) 0%, oklch(0.12 0 0) 52%, oklch(0.105 0 0) 100%)',
        ].join(', ')
      : [
          `radial-gradient(circle at 12% 8%, ${accentAlphaStrong}, transparent 30%)`,
          `radial-gradient(circle at 84% 18%, ${accentAlphaSoft}, transparent 28%)`,
          `linear-gradient(135deg, ${accentSoft} 0%, ${accentSofter} 48%, oklch(0.95 0.012 88) 100%)`,
        ].join(', '),
  );
  root.style.setProperty('--background', isDarkTheme ? 'oklch(0.12 0 0)' : accentSofter);
  root.style.setProperty('--card', accentCard);
  root.style.setProperty('--popover', accentCard);
  root.style.setProperty('--secondary', accentSoft);
  root.style.setProperty('--muted', accentSoft);
  root.style.setProperty('--accent', accentSoft);
  root.style.setProperty('--border', accentBorder);
  root.style.setProperty('--input', accentBorder);
  root.style.setProperty('--sidebar', accentCard);
  root.style.setProperty('--sidebar-accent', accentSoft);
  root.style.setProperty('--sidebar-border', accentBorder);
  root.style.setProperty('--primary', variables.primary);
  root.style.setProperty('--ring', variables.primary);
  root.style.setProperty('--sidebar-primary', variables.primary);
  root.style.setProperty('--primary-foreground', variables.primaryForeground);
  root.style.setProperty('--sidebar-primary-foreground', variables.primaryForeground);
}

function clearAcademyAccentColor() {
  const root = document.documentElement;

  [
    '--app-bg',
    '--background',
    '--card',
    '--popover',
    '--secondary',
    '--muted',
    '--accent',
    '--border',
    '--input',
    '--sidebar',
    '--sidebar-accent',
    '--sidebar-border',
    '--primary',
    '--ring',
    '--sidebar-primary',
    '--primary-foreground',
    '--sidebar-primary-foreground',
  ].forEach((propertyName) => root.style.removeProperty(propertyName));
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
    calendarSettings: normalizeAcademyCalendarSettings(preferences.calendarSettings),
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
      ? normalizeAcademyCalendarSettings(detail.calendarSettings)
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
  const canvasLecture = (courseId ? canvasPreferences[courseId] : undefined) ??
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
  const manualLecture = manualLectures.find((lecture) => (
    codesMatch(item.courseCode, lecture.friendlyCourseCode) ||
    codesMatch(item.courseCode, lecture.code) ||
    codesMatch(item.courseName, lecture.friendlyName)
  ));
  const canvasLecture = Object.values(canvasPreferences).find((preference) => (
    codesMatch(item.courseCode, preference.friendlyCourseCode) ||
    codesMatch(item.courseCode, preference.originalCourseCode) ||
    codesMatch(item.courseName, preference.friendlyName)
  ));
  const label =
    preferenceById?.friendlyCourseCode?.trim() ||
    manualLecture?.friendlyCourseCode?.trim() ||
    manualLecture?.code?.trim() ||
    canvasLecture?.friendlyCourseCode?.trim() ||
    item.courseCode?.trim() ||
    item.courseName?.trim() ||
    fallbackLabel;

  return {
    color: preferenceById?.chipColor ?? manualLecture?.chipColor ?? canvasLecture?.chipColor ?? item.color,
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

function isCourseReferenceHidden(course: Pick<CalendarSourceItem, 'courseCode' | 'courseId' | 'courseName'>) {
  const hiddenManualLecture = getStoredManualLectures().some((lecture) => (
    Boolean(lecture.hidden) && coursePreferenceMatchesCourse(lecture, course)
  ));

  if (hiddenManualLecture) {
    return true;
  }

  return Object.entries(getStoredCanvasLecturePreferences()).some(([courseId, preference]) => (
    Boolean(preference.hidden) &&
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
    if (lecture.hidden || !semesterMatches(lecture.semester, selectedSemester)) {
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
        checklistProgress: item.isCompleted ? '1 of 1' : '0 of 1',
        dueAt,
        isCompleted: Boolean(item.isCompleted),
        isLocked: Boolean(item.isLocked),
        isTitleEditable: !item.isLocked,
        canOpenDetails: true,
        isCanvasSource: item.source === 'canvas',
        isStarred: Boolean(item.isStarred),
        time: formatCalendarSourceItemTime(item),
      };
    });
}

function getCalendarTimelineItems(
  items: CalendarSourceItem[],
  monthDate: Date,
  fallbackLabel: string,
): TimelineItem[] {
  const monthRange = getCalendarMonthRange(monthDate);
  const monthStartTime = monthRange.startDate.getTime();
  const monthEndTime = new Date(Date.UTC(monthRange.year, monthRange.monthIndex + 1, 1)).getTime();
  const monthDuration = Math.max(monthEndTime - monthStartTime, 1);

  return items
    .filter((item) => {
      const itemDate = new Date(getCalendarSourceItemDate(item) ?? '');

      return !Number.isNaN(itemDate.getTime()) &&
        itemDate.getTime() >= monthStartTime &&
        itemDate.getTime() < monthEndTime;
    })
    .sort((firstItem, secondItem) => (
      new Date(getCalendarSourceItemDate(firstItem) ?? '').getTime() -
      new Date(getCalendarSourceItemDate(secondItem) ?? '').getTime()
    ))
    .map((item) => {
      const itemDate = new Date(getCalendarSourceItemDate(item) ?? '');
      const courseDisplay = getCalendarCourseFilterOption(item, fallbackLabel);
      const offsetPercent = Number.isNaN(itemDate.getTime())
        ? 0
        : Math.min(Math.max(((itemDate.getTime() - monthStartTime) / monthDuration) * 100, 0), 98);

      return {
        id: item.id,
        name: courseDisplay.label,
        offsetPercent,
        widthPercent: 7,
        label: item.title,
        color: courseDisplay.color,
        canOpenDetails: true,
        isCanvasSource: item.source === 'canvas',
        isCompleted: Boolean(item.isCompleted),
        isLocked: Boolean(item.isLocked),
        isStarred: Boolean(item.isStarred),
      };
    });
}

type CalendarDueState = 'done' | 'overdue' | 'dueToday' | 'tomorrow' | 'soon' | 'normal';
type DayTodoProgress = {
  completedCount: number;
  label: string;
  percent: number;
  totalCount: number;
};

function getCalendarDueState(value?: string, isCompleted = false): CalendarDueState {
  if (isCompleted) {
    return 'done';
  }

  if (!value) {
    return 'normal';
  }

  const dueDate = new Date(value);

  if (Number.isNaN(dueDate.getTime())) {
    return 'normal';
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDueDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()).getTime();
  const daysUntilDue = Math.round((startOfDueDate - startOfToday) / 86_400_000);

  if (dueDate.getTime() < now.getTime()) {
    return 'overdue';
  }

  if (daysUntilDue === 0) {
    return 'dueToday';
  }

  if (daysUntilDue === 1) {
    return 'tomorrow';
  }

  if (daysUntilDue <= 3) {
    return 'soon';
  }

  return 'normal';
}

function getCalendarMoveDueDateTarget(item: CalendarSourceItem) {
  if (item.isLocked || item.isCompleted) {
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

function getCalendarDueChipClass(state: CalendarDueState) {
  if (state === 'overdue') {
    return 'border-red-600 bg-red-600 text-white dark:border-red-500 dark:bg-red-500 dark:text-white';
  }

  if (state === 'dueToday') {
    return 'border-red-500/45 bg-red-500/15 text-red-700 dark:border-red-400/50 dark:bg-red-400/15 dark:text-red-200';
  }

  if (state === 'tomorrow') {
    return 'border-orange-500/45 bg-orange-500/15 text-orange-800 dark:border-orange-300/55 dark:bg-orange-400/15 dark:text-orange-200';
  }

  if (state === 'soon') {
    return 'border-yellow-500/45 bg-yellow-500/15 text-yellow-800 dark:border-yellow-300/55 dark:bg-yellow-300/15 dark:text-yellow-100';
  }

  if (state === 'done') {
    return 'border-neutral-200 bg-neutral-100 text-neutral-600 dark:border-white/10 dark:bg-white/10 dark:text-muted-foreground';
  }

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
  const totalCount = items.length;
  const completedCount = items.filter((item) => item.isCompleted).length;
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
    subtitle: [courseDisplay.label, item.courseName].filter(Boolean).join(' · ') || 'Canvas LMS',
    type: label,
    color: courseDisplay.color,
    canOpenDetails: true,
    isCanvasSource: item.source === 'canvas',
    isCompleted: Boolean(item.isCompleted),
    isLocked: Boolean(item.isLocked),
    isStarred: Boolean(item.isStarred),
  };
}

function getCalendarSourceItems(canvasItems: CanvasCalendarItem[], preferenceVersion = 0): CalendarSourceItem[] {
  void preferenceVersion;

  const canvasCourseworkPreferences = getStoredCanvasCourseworkPreferences();
  const canvasAssessmentPreferences = getStoredCanvasAssessmentPreferences();
  const canvasLecturePreferences = getStoredCanvasLecturePreferences();
  const canvasSourceItems = canvasItems
    .filter((item) => {
      const isAssessment = isAssessmentType(item.type, item.title);
      const preference = isAssessment
        ? canvasAssessmentPreferences[item.id]
        : canvasCourseworkPreferences[item.id];

      return !preference?.hidden;
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
        dueAt: preference?.dueAt || item.dueAt,
        startAt: preference?.startAt || item.startAt,
        endAt: preference?.endAt || item.endAt,
        htmlUrl: preference?.htmlUrl || item.htmlUrl,
        semester: preference?.semester || (item.courseId ? canvasLecturePreferences[item.courseId]?.semester : undefined),
        color: getCanvasItemColor(item),
        isCompleted,
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
      color: getStoredCourseChipColor(item.courseCode, undefined, item.courseName) ?? canvasCalendarTypeColors[item.courseworkType || 'study'] ?? 'blue',
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

  return [
    ...canvasSourceItems,
    ...storedCanvasCourseworkItems,
    ...storedCanvasAssessmentItems,
    ...manualCourseworkItems,
    ...manualAssessmentItems,
  ];
}

function createAcademyCalendarDays(
  monthDate: Date,
  sourceItems: CalendarSourceItem[],
  loadStatus: CanvasCalendarLoadStatus,
  activeCourseOptionIds?: Set<string>,
): CalendarDay[] {
  const monthRange = getCalendarMonthRange(monthDate);
  const firstWeekday = monthRange.startDate.getUTCDay();
  const mondayOffset = (firstWeekday + 6) % 7;
  const gridStartDate = new Date(Date.UTC(monthRange.year, monthRange.monthIndex, 1 - mondayOffset));
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
    const events = dateItems.map((item) => getCalendarSourceEvent(item, activeCourseOptionIds));
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
    timeline: getCalendarTimelineItems(sourceItems, monthDate, fallbackCourseLabel),
  };
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

  useEffect(() => {
    setDraft(createCalendarTodoDetailsDraft(item));
  }, [item?.id]);

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

            if (item) {
              onSave(item, draft);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="calendar-todo-title">
                {dictionary.courseworkName}
              </Label>
              <Input
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
            <Button type="submit">{dictionary.courseworkUpdate}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AcademySettingsView({
  onSettingsChange,
  settings,
  settingsSaveError,
  settingsSaveStatus,
}: {
  onSettingsChange: (settings: AcademyCalendarSettings) => void;
  settings: AcademyCalendarSettings;
  settingsSaveError?: string;
  settingsSaveStatus?: 'idle' | 'saving' | 'saved' | 'failed';
}) {
  const { dictionary, language } = useLanguage();
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
  const dateLocale = language === 'ko' ? 'ko-KR' : 'en-CA';
  const updateSettings = (partialSettings: Partial<AcademyCalendarSettings>) => {
    onSettingsChange(normalizeAcademyCalendarSettings({
      ...settings,
      ...partialSettings,
    }));
  };
  const updateThreshold = (key: 'progressGreenAt' | 'progressYellowAt', value: string) => {
    const parsedValue = Number.parseInt(value, 10);

    updateSettings({
      [key]: Number.isFinite(parsedValue) ? parsedValue : settings[key],
    });
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
  };
  const accentVariantColors =
    academyAccentColorVariantPages[accentVariantPage] ?? academyAccentColorVariantPages[0];
  const isVariantAccentSelected = !academyAccentColors.includes(settings.accentColor);
  const loadCanvasTokenStatus = () => {
    setIsCanvasTokenLoading(true);
    setCanvasTokenError('');

    workspaceApi
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
    user: dictionary.canvasTokenSourceUser,
  };
  const handleCanvasTokenSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCanvasTokenSaving(true);
    setCanvasTokenError('');
    setCanvasTokenMessage('');

    workspaceApi
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

    workspaceApi
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
    loadCanvasTokenStatus();
  }, []);

  return (
    <div className="grid h-full min-h-0 gap-4 overflow-y-auto pb-6 pr-1">
      <Card className="rounded-xl bg-card shadow-none">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-xl font-black">{dictionary.academySettingsTitle}</CardTitle>
            {settingsSaveStatus && settingsSaveStatus !== 'idle' ? (
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
          </div>
          {settingsSaveError ? (
            <div className="mt-2 rounded-md border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-700 dark:text-red-200">
              {settingsSaveError}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-3">
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

            <form className="grid gap-3 rounded-lg border bg-card p-3" onSubmit={handleCanvasTokenSubmit}>
              <div>
                <h4 className="text-xs font-black uppercase text-muted-foreground">
                  {dictionary.canvasTokenChangeTitle}
                </h4>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(260px,1.2fr)]">
                <label className="grid gap-1.5 text-xs font-black uppercase text-muted-foreground">
                  <span>{dictionary.canvasTokenInstanceUrl}</span>
                  <Input
                    autoComplete="off"
                    inputMode="url"
                    onChange={(event) => updateCanvasTokenDraft('instanceUrl', event.target.value)}
                    placeholder="https://canvas.sfu.ca"
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
                        settings.themeMode === mode
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                          : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
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
                  <LayoutPanelTop className="size-4" />
                </span>
                <span className="truncate">{dictionary.academyTopBarSettingsTitle}</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid gap-3">
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
            <div className="grid gap-3 sm:grid-cols-[minmax(160px,220px)_minmax(0,1fr)]">
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
        </CardContent>
      </Card>
    </div>
  );
}

function AdminGeneralSettingsView({
  onSettingsChange,
  settings,
}: {
  onSettingsChange: (settings: AdminConsoleSettings) => void;
  settings: AdminConsoleSettings;
}) {
  const { dictionary } = useLanguage();

  const updateSettings = (patch: Partial<AdminConsoleSettings>) => {
    onSettingsChange({
      ...settings,
      ...patch,
    });
  };

  return (
    <div className="grid min-h-0 gap-4 lg:h-full lg:overflow-y-auto lg:pr-1">
      <Card className="rounded-xl bg-card shadow-none">
        <CardHeader>
          <CardTitle className="text-xl font-black">{dictionary.adminGeneralSettingsTitle}</CardTitle>
          <p className="text-sm font-semibold text-muted-foreground">
            {dictionary.adminGeneralSettingsSubtitle}
          </p>
        </CardHeader>
        <CardContent className="grid gap-5">
          <section className="grid gap-3 rounded-lg border bg-muted/20 p-3">
            <div>
              <h3 className="text-sm font-black text-foreground">
                {dictionary.academyTopBarSettingsTitle}
              </h3>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                {dictionary.adminTopBarSettingsHint}
              </p>
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
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

function WaitingApprovalPage({
  isChecking,
  onRefresh,
  onSignOut,
  session,
}: {
  isChecking: boolean;
  onRefresh: () => void;
  onSignOut: () => void;
  session: AuthSession | null;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-[560px] rounded-xl bg-card shadow-none">
        <CardHeader className="gap-4 p-6 sm:p-7">
          <div className="flex items-center gap-3">
            <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-yellow-400/15 text-yellow-700 dark:text-yellow-200">
              <Clock3 aria-hidden="true" className="size-6" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-2xl font-black leading-tight">Waiting for approval</CardTitle>
              <p className="mt-1 truncate text-sm font-semibold text-muted-foreground">
                {session?.email ?? 'Google account'}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 px-6 pb-6 sm:px-7 sm:pb-7">
          <div className="rounded-lg border bg-muted/35 p-3 text-sm font-semibold leading-relaxed text-muted-foreground">
            Your account has been created in Admin Console. An admin needs to activate it before you can open Workspace,
            Academy, Canvas, or API features.
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={onSignOut} type="button" variant="outline">
              <LogOut aria-hidden="true" className="size-4" />
              Sign out
            </Button>
            <Button disabled={isChecking} onClick={onRefresh} type="button">
              <RefreshCw aria-hidden="true" className={cn('size-4', isChecking && 'animate-spin')} />
              Refresh status
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function App() {
  const { activeData, activeMode } = useWorkspaceMode();
  const { dictionary, language } = useLanguage();
  const [navigation, setNavigation] = useState<WorkspaceNavigation>({
    modeId: '',
    sidebarItemId: 'dashboard',
    view: 'month',
  });
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'pending' | 'unauthenticated'>('checking');
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [isAuthSessionRefreshing, setIsAuthSessionRefreshing] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isWorkspaceSidebarCollapsed, setIsWorkspaceSidebarCollapsed] = useState(false);
  const [isAcademyTopBarCollapsed, setIsAcademyTopBarCollapsed] = useState(false);
  const [isAdminTopBarCollapsed, setIsAdminTopBarCollapsed] = useState(
    () => getStoredAdminConsoleSettings().topBarDefaultCollapsed,
  );
  const [theme, setTheme] = useState<AppTheme>(getInitialTheme);
  const [selectedDriveItem, setSelectedDriveItem] = useState<GoogleDriveFile | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => getInitialCalendarMonth(activeData));
  const [selectedCalendarDayIso, setSelectedCalendarDayIso] = useState(getTodayIsoDate);
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);
  const [isCalendarAutoExpanded, setIsCalendarAutoExpanded] = useState(getInitialCalendarAutoExpanded);
  const [isDayTodoDialogOpen, setIsDayTodoDialogOpen] = useState(false);
  const [isDayTodoDialogMode, setIsDayTodoDialogMode] = useState(getInitialDayTodoDialogMode);
  const [isPhoneAcademyMode, setIsPhoneAcademyMode] = useState(getInitialPhoneAcademyMode);
  const [academyCalendarSettings, setAcademyCalendarSettings] = useState(getStoredAcademyCalendarSettings);
  const [adminConsoleSettings, setAdminConsoleSettings] = useState(getStoredAdminConsoleSettings);
  const [hiddenCalendarCourseIds, setHiddenCalendarCourseIds] = useState(getStoredHiddenCalendarCourseIds);
  const [academyPreferencesSaveStatus, setAcademyPreferencesSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [academyPreferencesSaveError, setAcademyPreferencesSaveError] = useState('');
  const [focusedCalendarTodoId, setFocusedCalendarTodoId] = useState<string | null>(null);
  const [selectedCalendarTodoDetailsId, setSelectedCalendarTodoDetailsId] = useState<string | null>(null);
  const [canvasCalendarPages, setCanvasCalendarPages] = useState<Record<string, CanvasCalendarPage>>({});
  const [authRedirectMessage] = useState(getInitialAuthRedirectMessage);
  const [academyPreferenceVersion, setAcademyPreferenceVersion] = useState(0);
  const [selectedCourseOverviewRowId, setSelectedCourseOverviewRowId] = useState<string | null>(null);
  const [selectedCourseOverviewResourceUrl, setSelectedCourseOverviewResourceUrl] = useState<string | null>(null);
  const calendarTodoTapTimeoutRef = useRef<{ itemId: string; timeoutId: number } | null>(null);
  const isApplyingHistoryRef = useRef(false);
  const hasAppliedUrlNavigationRef = useRef(false);
  const academyPreferencesSaveSequenceRef = useRef(0);
  const isAcademyPreferencesSavingRef = useRef(false);
  const activeSidebarItem = navigation.modeId === activeMode.id ? navigation.sidebarItemId : 'dashboard';
  const activeView = navigation.modeId === activeMode.id ? navigation.view : 'month';
  const currentView = activeMode.views.includes(activeView) ? activeView : (activeMode.views[0] ?? 'month');
  const isDriveView = activeSidebarItem === 'drive';
  const isEmailView = activeSidebarItem === 'email';
  const isOutlookView = activeSidebarItem === 'outlook';
  const isChatView = activeSidebarItem === 'chat';
  const isCanvasInboxView = activeMode.id === 'academy' && activeSidebarItem === 'inbox';
  const isAcademyPeopleView = activeMode.id === 'academy' && activeSidebarItem === 'people';
  const isCommunicationView = isEmailView || isOutlookView || isChatView;
  const isCoursesView = activeMode.id === 'academy' && activeSidebarItem === 'courses';
  const isAcademySettingsView = activeMode.id === 'academy' && activeSidebarItem === 'settings';
  const isAdminUsersView = activeMode.id === 'admin-console' && activeSidebarItem === 'users';
  const isAdminGroupsView = activeMode.id === 'admin-console' && activeSidebarItem === 'groups';
  const isAdminGeneralSettingsView = activeMode.id === 'admin-console' && activeSidebarItem === 'settings-general';
  const isSettingsMainView = isAcademySettingsView || isAdminGeneralSettingsView;
  const isMainOnlyView =
    isCommunicationView ||
    isCoursesView ||
    isCanvasInboxView ||
    isAcademyPeopleView ||
    isAcademySettingsView ||
    isAdminUsersView ||
    isAdminGroupsView ||
    isAdminGeneralSettingsView;
  const isDashboardWorkspaceView = !isDriveView && !isMainOnlyView;
  const effectiveCalendarExpanded = isCalendarExpanded || isCalendarAutoExpanded;
  const canvasCalendarMonthKey = getCalendarMonthKey(calendarMonth);
  const isCalendarDataView = !isMainOnlyView && (
    currentView === 'month' ||
    currentView === 'agenda' ||
    currentView === 'board' ||
    currentView === 'timeline'
  );
  const shouldLoadCanvasCalendar =
    authStatus === 'authenticated' && activeMode.id === 'academy' && isCalendarDataView;
  const canvasCalendarPage = canvasCalendarPages[canvasCalendarMonthKey];
  const canvasCalendarItems = canvasCalendarPage?.items ?? [];
  const canvasCalendarLoadStatus: CanvasCalendarLoadStatus =
    canvasCalendarPage?.status ?? (shouldLoadCanvasCalendar ? 'loading' : 'idle');
  const canvasCalendarEmptyMessage = activeMode.id === 'academy' && canvasCalendarLoadStatus === 'failed'
    ? dictionary.canvasCalendarUnavailable
    : undefined;
  const selectedAcademySemester = normalizeSemesterName(academyCalendarSettings.selectedSemester);
  const allCalendarSourceItems = activeMode.id === 'academy'
    ? getCalendarSourceItems(canvasCalendarItems, academyPreferenceVersion)
        .filter((item) => semesterMatches(item.semester, selectedAcademySemester))
        .filter((item) => !isCourseReferenceHidden(item))
    : [];
  const calendarCourseFilterOptions = activeMode.id === 'academy'
    ? getActiveCalendarCourseOptions(
        canvasCalendarItems,
        hiddenCalendarCourseIds,
        dictionary.selectedDayTodoNoCourse,
        selectedAcademySemester,
      )
    : [];
  const activeCalendarCourseOptionIds = new Set(calendarCourseFilterOptions.map((option) => option.id));
  const calendarSourceItems = activeMode.id === 'academy'
    ? filterCalendarSourceItemsByCourse(
        allCalendarSourceItems,
        hiddenCalendarCourseIds,
        dictionary.selectedDayTodoNoCourse,
      )
    : [];
  const selectedDaySourceItems = calendarSourceItems
    .filter((item) => getLocalIsoDate(getCalendarSourceItemDate(item)) === selectedCalendarDayIso)
    .sort((firstItem, secondItem) => (
      new Date(getCalendarSourceItemDate(firstItem) ?? '').getTime() -
      new Date(getCalendarSourceItemDate(secondItem) ?? '').getTime()
    ));
  const inactiveSelectedDayCourseOptions = activeMode.id === 'academy'
    ? Array.from(
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
      )
    : [];
  const calendarBoardCourseOptions = [...calendarCourseFilterOptions, ...inactiveSelectedDayCourseOptions];
  const calendarBoardColumns = activeMode.id === 'academy'
    ? getCalendarBoardColumns(calendarBoardCourseOptions)
    : undefined;
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
  const selectedDayGroups: SelectedDayCourseGroup[] = activeMode.id === 'academy'
    ? [
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
      ]
    : Object.values(selectedDayItemsByCourse);
  const selectedDayHeading = formatSelectedDayHeading(selectedCalendarDayIso, language);
  const selectedDayRelativeBadge = formatRelativeDayBadge(selectedCalendarDayIso);
  const isSelectedCalendarDayToday = selectedCalendarDayIso === getTodayIsoDate();
  const calendarData = activeMode.id === 'academy'
    ? createAcademyCalendarData(
        activeData,
        calendarMonth,
        calendarSourceItems,
        canvasCalendarLoadStatus,
        selectedCalendarDayIso,
        dictionary.selectedDayTodoNoCourse,
        activeCalendarCourseOptionIds,
      )
    : activeData;
  const selectedDayProgressInfo = getDayTodoProgress(selectedDaySourceItems);
  const selectedCalendarTodoDetailsItem = selectedCalendarTodoDetailsId
    ? calendarSourceItems.find((item) => item.id === selectedCalendarTodoDetailsId) ?? null
    : null;
  const selectedDayProgress = selectedDayProgressInfo.percent;
  const calendarProgressThresholds: CalendarProgressThresholds = {
    greenAt: academyCalendarSettings.progressGreenAt,
    yellowAt: academyCalendarSettings.progressYellowAt,
  };
  const mainGridColumnsClass = isMainOnlyView
    ? isWorkspaceSidebarCollapsed
      ? 'grid-cols-[72px_minmax(0,1fr)] xl:grid-cols-[78px_minmax(0,1fr)]'
      : 'grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[230px_minmax(0,1fr)]'
    : isWorkspaceSidebarCollapsed
      ? 'grid-cols-[72px_minmax(0,1fr)] xl:grid-cols-[78px_minmax(0,1fr)] 2xl:grid-cols-[82px_minmax(0,1fr)_340px]'
      : 'grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[230px_minmax(0,1fr)_340px]';
  const effectiveTopBarCollapsed =
    (activeMode.id === 'academy' && isAcademyTopBarCollapsed) ||
    (activeMode.id === 'admin-console' && isAdminTopBarCollapsed);

  const navigateWorkspace = (nextNavigation: WorkspaceNavigation) => {
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
          source: 'incos-workspace',
          navigation: nextNavigation,
        } satisfies WorkspaceHistoryState,
        '',
        window.location.href,
      );
    }

    setNavigation(nextNavigation);
  };

  const openAcademyCourseworkDialog = (detail?: AcademyOpenCourseworkDialogDetail) => {
    if (activeMode.id !== 'academy') {
      setIsAddModalOpen(true);
      return;
    }

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
    if (activeMode.id !== 'academy') {
      return;
    }

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
    storeAcademyCalendarSettings(settings);

    persistAcademyPreferencesFromStorage(settings);
  };

  const persistAcademyPreferencesFromStorage = (settings = academyCalendarSettings) => {
    const saveSequence = academyPreferencesSaveSequenceRef.current + 1;
    academyPreferencesSaveSequenceRef.current = saveSequence;
    isAcademyPreferencesSavingRef.current = true;
    setAcademyPreferencesSaveStatus('saving');
    setAcademyPreferencesSaveError('');

    void workspaceApi.saveAcademyPreferences({
      manualLectures: readStoredJson<unknown[]>(manualLecturesStorageKey, []),
      canvasLecturePreferences: readStoredJson<Record<string, unknown>>(canvasLecturePreferencesStorageKey, {}),
      manualCoursework: readStoredJson<unknown[]>(manualCourseworkStorageKey, []),
      canvasCourseworkPreferences: readStoredJson<Record<string, unknown>>(canvasCourseworkPreferencesStorageKey, {}),
      manualAssessments: readStoredJson<unknown[]>(manualAssessmentsStorageKey, []),
      canvasAssessmentPreferences: readStoredJson<Record<string, unknown>>(canvasAssessmentPreferencesStorageKey, {}),
      calendarSettings: settings,
    })
      .then((preferences) => {
        if (saveSequence !== academyPreferencesSaveSequenceRef.current) {
          return;
        }

        applyAcademyPreferencesResponse(preferences);
        setAcademyCalendarSettings(academyPreferenceCache.calendarSettings);
        setHiddenCalendarCourseIds(academyPreferenceCache.calendarSettings.hiddenCourseIds ?? []);
        setAcademyPreferenceVersion((currentVersion) => currentVersion + 1);
        setAcademyPreferencesSaveStatus('saved');
        dispatchAcademyPreferencesUpdated();
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

    setAcademyCalendarSettings(nextSettings);
    persistAcademyCalendarSettings(nextSettings);
  };

  const handleAdminConsoleSettingsChange = (settings: AdminConsoleSettings) => {
    const nextSettings = normalizeAdminConsoleSettings(settings);

    setAdminConsoleSettings(nextSettings);
    setIsAdminTopBarCollapsed(nextSettings.topBarDefaultCollapsed);
    storeAdminConsoleSettings(nextSettings);
  };

  const handleThemeChange = (nextTheme: AppTheme) => {
    if (activeMode.id === 'academy') {
      handleAcademyCalendarSettingsChange({
        ...academyCalendarSettings,
        themeMode: nextTheme,
      });
      return;
    }

    setTheme(nextTheme);
  };

  const handleToggleCalendarCourse = (courseId: string) => {
    setHiddenCalendarCourseIds((currentCourseIds) => {
      const nextCourseIds = currentCourseIds.includes(courseId)
        ? currentCourseIds.filter((currentCourseId) => currentCourseId !== courseId)
        : [...currentCourseIds, courseId];
      const nextSettings = normalizeAcademyCalendarSettings({
        ...academyCalendarSettings,
        hiddenCourseIds: nextCourseIds,
      });

      storeHiddenCalendarCourseIds(nextCourseIds);
      setAcademyCalendarSettings(nextSettings);
      persistAcademyPreferencesFromStorage(nextSettings);

      return nextCourseIds;
    });
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
    courseCode = '',
    dateIso = selectedCalendarDayIso,
    focusBoardItem = false,
    title = '',
  }: {
    courseCode?: string;
    dateIso?: string;
    focusBoardItem?: boolean;
    title?: string;
  }) => {
    const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const newCoursework: StoredManualCoursework = {
      id: `manual-coursework-${randomId}`,
      title,
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

  const handleQuickAddSelectedDayCoursework = (courseCode?: string) => {
    createQuickCalendarCoursework({
      courseCode: courseCode ?? '',
      focusBoardItem: true,
    });
  };

  const handleUpdateCalendarSourceItemTitle = (item: CalendarSourceItem, title: string) => {
    if (item.isLocked) {
      return;
    }

    updateCalendarSourceItemPreference(item, (preference) => ({
      ...preference,
      title,
    }));
  };

  const handleUpdateCalendarTodoTitle = (item: BoardItem, title: string) => {
    const sourceItem = calendarSourceItems.find((calendarItem) => calendarItem.id === item.id);

    if (!sourceItem) {
      return;
    }

    handleUpdateCalendarSourceItemTitle(sourceItem, title);
  };

  const handleOpenCalendarTodoDetails = (item: { id: string }) => {
    setSelectedCalendarTodoDetailsId(item.id);
  };

  const updateCalendarSourceItemPreference = (
    item: CalendarSourceItem,
    updater: (preference: StoredCoursePreference) => StoredCoursePreference,
  ) => {
    if (item.source === 'manual-coursework') {
      const nextCoursework = getStoredManualCoursework().map((coursework) => (
        coursework.id === item.id ? updater(coursework) as StoredManualCoursework : coursework
      ));

      storeJson(manualCourseworkStorageKey, nextCoursework);
      persistAcademyPreferencesFromStorage();
      return;
    }

    if (item.source === 'manual-assessment') {
      const nextAssessments = getStoredManualAssessments().map((assessment) => (
        assessment.id === item.id ? updater(assessment) as StoredManualAssessment : assessment
      ));

      storeJson(manualAssessmentsStorageKey, nextAssessments);
      persistAcademyPreferencesFromStorage();
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
    persistAcademyPreferencesFromStorage();
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
    const nextDueAt = toIsoFromDateInput(draft.dueAt) || undefined;
    const nextStartAt = toIsoFromDateInput(draft.startAt) || undefined;
    const nextEndAt = toIsoFromDateInput(draft.endAt) || undefined;
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
    const isAcademyMode = activeMode.id === 'academy';

    applyTheme(isAcademyMode ? academyCalendarSettings.themeMode : theme, {
      persist: !isAcademyMode,
    });

    if (isAcademyMode) {
      applyAcademyAccentColor(academyCalendarSettings.accentColor);
    } else {
      clearAcademyAccentColor();
    }
  }, [academyCalendarSettings.accentColor, academyCalendarSettings.themeMode, activeMode.id, theme]);

  useEffect(() => {
    setIsAcademyTopBarCollapsed(
      activeMode.id === 'academy' && academyCalendarSettings.topBarDefaultCollapsed,
    );
  }, [academyCalendarSettings.topBarDefaultCollapsed, activeMode.id]);

  useEffect(() => {
    document.title = dictionary.workspaceName;
  }, [dictionary.workspaceName]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(calendarAutoExpandMediaQuery);
    const handleMediaChange = () => {
      setIsCalendarAutoExpanded(mediaQuery.matches);
    };

    handleMediaChange();
    mediaQuery.addEventListener('change', handleMediaChange);

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(dayTodoDialogMediaQuery);
    const handleMediaChange = () => {
      setIsDayTodoDialogMode(mediaQuery.matches);
    };

    handleMediaChange();
    mediaQuery.addEventListener('change', handleMediaChange);

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(phoneAcademyMediaQuery);
    const handleMediaChange = () => {
      setIsPhoneAcademyMode(mediaQuery.matches);
    };

    handleMediaChange();
    mediaQuery.addEventListener('change', handleMediaChange);

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange);
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

      if (event instanceof CustomEvent && event.detail) {
        if (
          isSavingAcademyPreferences &&
          isRecord(event.detail) &&
          'calendarSettings' in event.detail
        ) {
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

      setAcademyCalendarSettings(getStoredAcademyCalendarSettings());
      setHiddenCalendarCourseIds(getStoredHiddenCalendarCourseIds());
    };

    window.addEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);

    return () => {
      window.removeEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    if (authStatus !== 'authenticated' || activeMode.id !== 'academy') {
      return undefined;
    }

    workspaceApi
      .getAcademyPreferences()
      .then((preferences) => {
        if (isCancelled || isAcademyPreferencesSavingRef.current) {
          return;
        }

        applyAcademyPreferencesResponse(preferences);
        setAcademyCalendarSettings(academyPreferenceCache.calendarSettings);
        setHiddenCalendarCourseIds(academyPreferenceCache.calendarSettings.hiddenCourseIds ?? []);
        setAcademyPreferenceVersion((currentVersion) => currentVersion + 1);
        dispatchAcademyPreferencesUpdated();
      })
      .catch(() => undefined);

    return () => {
      isCancelled = true;
    };
  }, [activeMode.id, authStatus]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || activeMode.id !== 'academy') {
      return undefined;
    }

    let isSyncing = false;
    const syncAcademyPreferences = () => {
      if (isSyncing || isAcademyPreferencesSavingRef.current || document.visibilityState === 'hidden') {
        return;
      }

      isSyncing = true;
      workspaceApi
        .getAcademyPreferences()
        .then((preferences) => {
          if (isAcademyPreferencesSavingRef.current) {
            return;
          }

          applyAcademyPreferencesResponse(preferences);
          setAcademyCalendarSettings(academyPreferenceCache.calendarSettings);
          setHiddenCalendarCourseIds(academyPreferenceCache.calendarSettings.hiddenCourseIds ?? []);
          setAcademyPreferenceVersion((currentVersion) => currentVersion + 1);
          dispatchAcademyPreferencesUpdated();
        })
        .catch(() => undefined)
        .finally(() => {
          isSyncing = false;
        });
    };
    const syncInterval = window.setInterval(syncAcademyPreferences, 10000);
    const handleFocus = () => syncAcademyPreferences();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncAcademyPreferences();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(syncInterval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeMode.id, authStatus]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }

    if (!hasAppliedUrlNavigationRef.current) {
      const searchParams = new URLSearchParams(window.location.search);
      const requestedModeId = searchParams.get('mode');
      const requestedSidebarItemId = searchParams.get('item');

      if (requestedModeId === activeMode.id && requestedSidebarItemId) {
        hasAppliedUrlNavigationRef.current = true;
        setNavigation({
          modeId: activeMode.id,
          sidebarItemId: requestedSidebarItemId,
          view: currentView,
        });
        return;
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
        window.setTimeout(() => setNavigation(nextNavigation), 0);
      }
      return;
    }

    if (isDriveBrowserHistoryState(currentHistoryState)) {
      if (activeSidebarItem !== 'drive') {
        window.setTimeout(
          () =>
            setNavigation({
              modeId: activeMode.id,
              sidebarItemId: 'drive',
              view: currentView,
            }),
          0,
        );
      }
      return;
    }

    window.history.replaceState(
      {
        source: 'incos-workspace',
        navigation: {
          modeId: activeMode.id,
          sidebarItemId: activeSidebarItem,
          view: currentView,
        },
      } satisfies WorkspaceHistoryState,
      '',
      window.location.href,
    );
  }, [activeMode.id, activeSidebarItem, authStatus, currentView, navigation]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return undefined;
    }

    const handlePopState = (event: PopStateEvent) => {
      if (isWorkspaceHistoryState(event.state)) {
        isApplyingHistoryRef.current = true;
        setNavigation(event.state.navigation);
        setSelectedDriveItem(null);
        window.setTimeout(() => {
          isApplyingHistoryRef.current = false;
        }, 0);
        return;
      }

      if (isDriveBrowserHistoryState(event.state)) {
        isApplyingHistoryRef.current = true;
        setNavigation({
          modeId: activeMode.id,
          sidebarItemId: 'drive',
          view: currentView,
        });
        setSelectedDriveItem(null);
        window.setTimeout(() => {
          isApplyingHistoryRef.current = false;
        }, 0);
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [activeMode.id, authStatus, currentView]);

  useEffect(() => {
    let isCancelled = false;

    if (!shouldLoadCanvasCalendar) {
      return undefined;
    }

    const monthKey = getCalendarMonthKey(calendarMonth);
    const cachedPage = canvasCalendarPages[monthKey];

    if (cachedPage?.status === 'loaded' || cachedPage?.status === 'loading' || cachedPage?.status === 'failed') {
      return undefined;
    }

    const monthRange = getCalendarMonthRange(calendarMonth);

    setCanvasCalendarPages((currentPages) => ({
      ...currentPages,
      [monthKey]: {
        items: currentPages[monthKey]?.items ?? [],
        status: 'loading',
      },
    }));

    workspaceApi
      .getCanvasCalendarItems({
        endDate: formatDateParam(new Date(Date.UTC(
          monthRange.endDate.getUTCFullYear(),
          monthRange.endDate.getUTCMonth(),
          monthRange.endDate.getUTCDate() + 7,
        ))),
        pageSize: 100,
        startDate: formatDateParam(new Date(Date.UTC(
          monthRange.startDate.getUTCFullYear(),
          monthRange.startDate.getUTCMonth(),
          monthRange.startDate.getUTCDate() - 7,
        ))),
      })
      .then(({ items }) => {
        if (isCancelled) {
          return;
        }

        setCanvasCalendarPages((currentPages) => ({
          ...currentPages,
          [monthKey]: {
            items,
            status: 'loaded',
          },
        }));
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setCanvasCalendarPages((currentPages) => ({
          ...currentPages,
          [monthKey]: {
            items: [],
            status: 'failed',
          },
        }));
      });

    return () => {
      isCancelled = true;
    };
  }, [calendarMonth, shouldLoadCanvasCalendar]);

  useEffect(() => {
    const refreshCurrentCalendarMonth = () => {
      if (!shouldLoadCanvasCalendar) {
        return Promise.resolve();
      }

      const monthKey = getCalendarMonthKey(calendarMonth);
      const monthRange = getCalendarMonthRange(calendarMonth);

      setCanvasCalendarPages((currentPages) => ({
        ...currentPages,
        [monthKey]: {
          items: currentPages[monthKey]?.items ?? [],
          status: 'loading',
        },
      }));

      return workspaceApi
        .getCanvasCalendarItems({
          endDate: formatDateParam(new Date(Date.UTC(
            monthRange.endDate.getUTCFullYear(),
            monthRange.endDate.getUTCMonth(),
            monthRange.endDate.getUTCDate() + 7,
          ))),
          pageSize: 100,
          startDate: formatDateParam(new Date(Date.UTC(
            monthRange.startDate.getUTCFullYear(),
            monthRange.startDate.getUTCMonth(),
            monthRange.startDate.getUTCDate() - 7,
          ))),
        })
        .then(({ items }) => {
          setCanvasCalendarPages((currentPages) => ({
            ...currentPages,
            [monthKey]: {
              items,
              status: 'loaded',
            },
          }));
        })
        .catch((error: unknown) => {
          setCanvasCalendarPages((currentPages) => ({
            ...currentPages,
            [monthKey]: {
              items: [],
              status: 'failed',
            },
          }));

          throw error;
        });
    };

    const refreshAcademyPageData = async () => {
      if (authStatus !== 'authenticated' || activeMode.id !== 'academy') {
        return;
      }

      const preferencesTask = workspaceApi
        .getAcademyPreferences()
        .then((preferences) => {
          if (isAcademyPreferencesSavingRef.current) {
            return;
          }

          applyAcademyPreferencesResponse(preferences);
          setAcademyCalendarSettings(academyPreferenceCache.calendarSettings);
          setHiddenCalendarCourseIds(academyPreferenceCache.calendarSettings.hiddenCourseIds ?? []);
          setAcademyPreferenceVersion((currentVersion) => currentVersion + 1);
          dispatchAcademyPreferencesUpdated();
        });

      const [preferencesResult, calendarResult] = await Promise.allSettled([
        preferencesTask,
        refreshCurrentCalendarMonth(),
      ]);

      if (preferencesResult.status === 'rejected') {
        throw preferencesResult.reason;
      }

      if (calendarResult.status === 'rejected') {
        throw calendarResult.reason;
      }
    };

    const handleAcademyRefreshRequested = (event: Event) => {
      const refreshTask = refreshAcademyPageData();

      if (event instanceof CustomEvent) {
        const detail = event.detail as AcademyRefreshRequestedDetail | undefined;

        if (typeof detail?.registerTask === 'function') {
          detail.registerTask(refreshTask);
        }
      }
    };

    window.addEventListener(academyRefreshRequestedEvent, handleAcademyRefreshRequested);

    return () => {
      window.removeEventListener(academyRefreshRequestedEvent, handleAcademyRefreshRequested);
    };
  }, [activeMode.id, authStatus, calendarMonth, shouldLoadCanvasCalendar]);

  const applyAuthSession = (session: AuthSession) => {
    setAuthSession(session);

    if (!session.isAuthenticated) {
      setAuthStatus('unauthenticated');
      return;
    }

    if (session.canAccessWorkspace) {
      setAuthStatus('authenticated');
      return;
    }

    setAuthStatus('pending');
  };

  const refreshAuthSession = () => {
    setIsAuthSessionRefreshing(true);
    setAuthStatus((currentStatus) => (currentStatus === 'unauthenticated' ? 'checking' : currentStatus));

    return workspaceApi
      .getAuthSession()
      .then(applyAuthSession)
      .catch(() => {
        setAuthSession(null);
        setAuthStatus('unauthenticated');
      })
      .finally(() => {
        setIsAuthSessionRefreshing(false);
      });
  };

  const signOut = () => {
    void workspaceApi
      .logout()
      .catch(() => undefined)
      .finally(() => {
        setAuthSession(null);
        setAuthStatus('unauthenticated');
      });
  };

  useEffect(() => {
    let isMounted = true;

    workspaceApi
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
  }, []);

  useEffect(() => () => {
    clearCalendarTodoTap();
  }, []);

  const clearCalendarTodoTap = () => {
    if (calendarTodoTapTimeoutRef.current) {
      window.clearTimeout(calendarTodoTapTimeoutRef.current.timeoutId);
      calendarTodoTapTimeoutRef.current = null;
    }
  };

  const startCalendarTodoRename = (item: CalendarSourceItem) => {
    if (item.isLocked) {
      return;
    }

    setFocusedCalendarTodoId(item.id);
  };

  const handleCalendarTodoTap = (
    event: ReactMouseEvent,
    item: CalendarSourceItem,
    isEditingTitle: boolean,
  ) => {
    if (isCalendarTodoInteractiveTarget(event.target) || item.isLocked || isEditingTitle) {
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
          <h2 className={cn(
            'min-w-0 truncate text-xl font-black leading-tight text-foreground',
            variant === 'mobile' && 'text-base',
          )}>
            {selectedDayHeading.primary}
          </h2>
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
                      onClick={() => handleQuickAddSelectedDayCoursework(group.label)}
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
                    const dueState = getCalendarDueState(getCalendarSourceItemDate(item), Boolean(item.isCompleted));
                    const moveTarget = getCalendarMoveDueDateTarget(item);
                    const courseDisplay = getCourseDisplay(item, dictionary.selectedDayTodoNoCourse);
                    const isEditingTitle = focusedCalendarTodoId === item.id && !item.isLocked;
                    const itemRow = (
                      <div
                        className={cn(
                          'grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-lg border bg-muted/25 p-2 text-sm font-bold transition-colors',
                          variant === 'mobile' && 'border-0 bg-transparent px-1 py-1.5',
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
                        <button
                          aria-label={item.isLocked ? dictionary.selectedDayTodoLocked : item.title}
                          className={cn(
                            'mt-0.5 grid size-5 shrink-0 place-items-center rounded-[7px] border text-[11px] font-black leading-none transition-colors',
                            variant === 'mobile' && 'size-6 rounded-[8px]',
                            item.isCompleted
                              ? getCourseDoneCheckClass(courseDisplay.color)
                              : 'border-muted-foreground/30 bg-muted/70 text-muted-foreground hover:bg-muted',
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
                        <span className="min-w-0">
                          {isEditingTitle ? (
                            <input
                              aria-label={dictionary.boardAddTodoItem}
                              autoFocus
                              className="block min-w-0 max-w-full rounded-md border bg-background px-2 py-1 text-[15px] font-black leading-snug text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/45"
                              onBlur={() => setFocusedCalendarTodoId(null)}
                              onChange={(event) => handleUpdateCalendarSourceItemTitle(item, event.target.value)}
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
                                getCalendarDueChipClass(dueState),
                              )}
                            >
                              <span className="truncate">{dueLabel}</span>
                            </span>
                            <span
                              className={cn(
                                'max-w-28 truncate rounded-md border px-1.5 py-0.5',
                                badgeColorClasses[courseDisplay.color],
                              )}
                            >
                              {formatCalendarTodoType(item.type)}
                            </span>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  aria-label={dictionary.gmailMoreActions}
                                  className="grid size-7 shrink-0 place-items-center rounded-md border bg-background/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                  onClick={(event) => event.stopPropagation()}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  title={dictionary.gmailMoreActions}
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
                          </span>
                        </span>
                      </div>
                    );

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

  if (authStatus === 'pending') {
    return (
      <WaitingApprovalPage
        isChecking={isAuthSessionRefreshing}
        onRefresh={() => {
          void refreshAuthSession();
        }}
        onSignOut={signOut}
        session={authSession}
      />
    );
  }

  if (authStatus !== 'authenticated') {
    return (
      <LoginPage
        authMessage={authRedirectMessage}
        isCheckingSession={authStatus === 'checking'}
        onThemeChange={setTheme}
        theme={theme}
      />
    );
  }

  return (
    <div
      className={cn(
        'min-h-screen',
        (!isMainOnlyView || isSettingsMainView) && 'lg:h-screen lg:overflow-hidden',
        isSettingsMainView && 'h-screen overflow-hidden',
      )}
      style={
        {
          '--mode-accent': activeMode.accent.primary,
          '--mode-accent-2': activeMode.accent.secondary,
          '--workspace-accent': activeMode.accent.primary,
          '--workspace-accent-2': activeMode.accent.secondary,
        } as CSSProperties
      }
    >
      <TopBar
        isTopBarCollapsed={effectiveTopBarCollapsed}
        onBeforeModeChange={(modeId) => {
          setIsAcademyTopBarCollapsed(
            modeId === 'academy' && academyCalendarSettings.topBarDefaultCollapsed,
          );
          setIsAdminTopBarCollapsed(
            modeId === 'admin-console' && adminConsoleSettings.topBarDefaultCollapsed,
          );
        }}
        onOpenAddItem={openAcademyCourseworkDialog}
        onToggleTopBarCollapsed={
          activeMode.id === 'academy'
            ? () => setIsAcademyTopBarCollapsed((currentValue) => !currentValue)
            : activeMode.id === 'admin-console'
              ? () => setIsAdminTopBarCollapsed((currentValue) => !currentValue)
              : undefined
        }
        onThemeChange={handleThemeChange}
        theme={activeMode.id === 'academy' ? academyCalendarSettings.themeMode : theme}
      />

      <main
        className={cn(
          'mx-auto grid w-full max-w-[2400px] items-start gap-3 overflow-x-clip p-3 max-lg:block',
          isMainOnlyView && !isSettingsMainView
            ? 'lg:min-h-[calc(100vh_-_var(--top-bar-height))] lg:overflow-visible'
            : 'lg:h-[calc(100vh_-_var(--top-bar-height))] lg:grid-rows-1 lg:items-stretch lg:overflow-hidden',
          isSettingsMainView &&
            'h-[calc(100vh_-_var(--top-bar-height))] grid-rows-1 items-stretch overflow-hidden max-lg:grid max-lg:grid-cols-[200px_minmax(0,1fr)]',
          activeMode.id === 'academy' && 'max-[520px]:px-2 max-[520px]:pb-24 max-[520px]:pt-2',
          mainGridColumnsClass,
        )}
        style={{
          '--top-bar-height': effectiveTopBarCollapsed ? '42px' : '74px',
        } as CSSProperties}
      >
        <Sidebar
          activeItemId={activeSidebarItem}
          collapsed={isWorkspaceSidebarCollapsed}
          onToggleCollapsed={() => setIsWorkspaceSidebarCollapsed((current) => !current)}
          onSelectItem={(itemId) => {
            if (activeMode.id === 'project' && itemId === 'toptrack') {
              window.open(topTrackExternalUrl, '_blank', 'noopener,noreferrer');
              return;
            }

            if (itemId !== 'drive') {
              setSelectedDriveItem(null);
            }

            let nextView = currentView;

            if (itemId === 'calendar') {
              nextView = 'month';
            }

            if (itemId === 'board') {
              nextView = 'board';
            }

            if (itemId === 'timeline') {
              nextView = 'timeline';
            }

            navigateWorkspace({
              modeId: activeMode.id,
              sidebarItemId: itemId,
              view: nextView,
            });
          }}
        />
        <section
          className={cn(
            'grid w-full min-w-0 lg:min-h-0 lg:pr-1',
            isMainOnlyView && !isSettingsMainView
              ? 'lg:overflow-visible'
              : 'lg:h-full lg:overflow-x-hidden',
            isSettingsMainView && 'h-full min-h-0 overflow-y-auto overflow-x-hidden pr-1',
            isCommunicationView
              ? 'gap-4 content-stretch lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden max-lg:gap-3'
              : isDashboardWorkspaceView
                ? effectiveCalendarExpanded
                  ? 'gap-0 content-stretch lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden'
                  : 'gap-4 content-stretch lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden max-lg:gap-3'
                : 'gap-4 content-start lg:overflow-y-auto max-lg:gap-3',
          )}
        >
          {isDriveView ? (
            <DriveFilesView onSelectedItemChange={setSelectedDriveItem} />
          ) : isEmailView ? (
            <GoogleCommunicationView key="email" type="email" />
          ) : isOutlookView ? (
            <OutlookEmailView />
          ) : isChatView ? (
            <GoogleCommunicationView key="chat" type="chat" />
          ) : isCanvasInboxView ? (
            <CanvasInboxView onOpenIntegration={openAcademyCourseResource} />
          ) : isAcademyPeopleView ? (
            <CanvasPeopleView onOpenCoursePeople={openAcademyCourseResource} />
          ) : isCoursesView ? (
            <CourseOverviewView
              initialResourceUrl={selectedCourseOverviewResourceUrl}
              initialSelectedCourseRowId={selectedCourseOverviewRowId}
            />
          ) : isAcademySettingsView ? (
            <AcademySettingsView
              onSettingsChange={handleAcademyCalendarSettingsChange}
              settings={academyCalendarSettings}
              settingsSaveError={academyPreferencesSaveError}
              settingsSaveStatus={academyPreferencesSaveStatus}
            />
          ) : isAdminUsersView ? (
            <AdminUsersView />
          ) : isAdminGroupsView ? (
            <AdminGroupsView />
          ) : isAdminGeneralSettingsView ? (
            <AdminGeneralSettingsView
              onSettingsChange={handleAdminConsoleSettingsChange}
              settings={adminConsoleSettings}
            />
          ) : (
            <>
              {!effectiveCalendarExpanded ? (
                <div className="dashboard-summary-cards overflow-hidden transition-all duration-300 ease-out max-lg:hidden">
                  <DashboardCards
                    courseworkHideSettings={{
                      completedAfterHours: academyCalendarSettings.courseworkHideCompletedAfterHours,
                      completedFrom: academyCalendarSettings.courseworkHideCompletedFrom,
                    }}
                      onOpenAddItem={openAcademyCourseworkDialog}
                    onOpenCourse={openAcademyCourseResource}
                    onPlanMeeting={() => {
                      window.open(
                        'https://calendar.google.com/calendar/u/0/r/eventedit',
                        '_blank',
                        'noopener,noreferrer',
                      );
                    }}
                    onStartMeetingNow={() => {
                      window.open('https://meet.google.com/new', '_blank', 'noopener,noreferrer');
                    }}
                    onWriteInPersonMeetingReport={() => {
                      window.open('https://docs.new', '_blank', 'noopener,noreferrer');
                    }}
                  />
                </div>
              ) : null}
              {activeMode.id === 'academy' && currentView === 'board' ? (
                <div className="hidden min-h-[calc(100dvh_-_var(--top-bar-height)_-_6.5rem)] flex-col overflow-hidden rounded-xl bg-card p-3 shadow-none max-[520px]:flex">
                  {renderDayTodoContent()}
                </div>
              ) : null}
              <div
                className={cn(
                  'min-w-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col',
                  activeMode.id === 'academy' && currentView === 'board' && 'max-[520px]:hidden',
                )}
              >
                <CalendarShell
                  agendaDateLabel={selectedDayHeading.year
                    ? `${selectedDayHeading.primary} ${selectedDayHeading.year}`
                    : selectedDayHeading.primary}
                  boardColumns={calendarBoardColumns}
                  courseFilterOptions={calendarCourseFilterOptions}
                  data={calendarData}
                  emptyMessage={canvasCalendarEmptyMessage}
                  focusedBoardItemId={focusedCalendarTodoId}
                  isExpanded={effectiveCalendarExpanded}
                  isSelectedDateToday={isSelectedCalendarDayToday}
                  isLoading={activeMode.id === 'academy' && canvasCalendarLoadStatus === 'loading'}
                  mode={activeMode}
                  onAddCourseworkForDay={activeMode.id === 'academy'
                    ? handleQuickAddCalendarCourseworkForDay
                    : undefined}
                  onFinishTodoTitleEdit={() => setFocusedCalendarTodoId(null)}
                  onNextMonth={activeMode.id === 'academy'
                    ? () => setCalendarMonth((currentMonth) => addCalendarMonths(currentMonth, 1))
                    : undefined}
                  onNextAgendaDay={activeMode.id === 'academy'
                    ? () => handleMoveSelectedAgendaDay(1)
                    : undefined}
                  onOpenAddItem={activeMode.id === 'academy'
                    ? handleQuickAddCalendarTodo
                    : () => setIsAddModalOpen(true)}
                  onOpenTodo={openCalendarActionItem}
                  onOpenTodoDetails={handleOpenCalendarTodoDetails}
                  onMoveTodoDueDate={handleMoveCalendarTodoDueDate}
                  onPreviousAgendaDay={activeMode.id === 'academy'
                    ? () => handleMoveSelectedAgendaDay(-1)
                    : undefined}
                  onPreviousMonth={activeMode.id === 'academy'
                    ? () => setCalendarMonth((currentMonth) => addCalendarMonths(currentMonth, -1))
                    : undefined}
                  onRemoveTodo={handleRemoveCalendarTodo}
                  onStartTodoTitleEdit={(item) => setFocusedCalendarTodoId(item.id)}
                  onToggleCourseFilter={handleToggleCalendarCourse}
                  onSelectItem={(day) => {
                    if (day?.dateIso) {
                      setSelectedCalendarDayIso(day.dateIso);
                      if (activeMode.id === 'academy' && isDayTodoDialogMode && !isPhoneAcademyMode) {
                        setIsDayTodoDialogOpen(true);
                      }
                    }
                  }}
                  onToggleExpanded={activeMode.id === 'academy' && !isCalendarAutoExpanded
                    ? () => setIsCalendarExpanded((currentValue) => !currentValue)
                    : undefined}
                  onToday={activeMode.id === 'academy' ? handleMoveSelectedDayToToday : undefined}
                  onToggleTodoDone={handleToggleCalendarTodoDone}
                  onToggleTodoStar={handleToggleCalendarTodoStar}
                  onUpdateTodoTitle={handleUpdateCalendarTodoTitle}
                  onViewChange={(view) => {
                    const isOpeningDayScopedView = view === 'agenda' || view === 'board';
                    const isLeavingDayScopedViews = currentView !== 'agenda' && currentView !== 'board';

                    if (activeMode.id === 'academy' && isOpeningDayScopedView && isLeavingDayScopedViews) {
                      handleMoveSelectedDayToToday();
                    }

                    navigateWorkspace({
                      modeId: activeMode.id,
                      sidebarItemId: view === 'board' || view === 'timeline' ? view : 'calendar',
                      view,
                    });
                  }}
                  progressDisplay={academyCalendarSettings.progressDisplay}
                  progressThresholds={calendarProgressThresholds}
                  showCurrentTime={isSelectedCalendarDayToday}
                  view={currentView}
                />
                {activeMode.id === 'academy' && currentView === 'month' ? (
                  <div className="hidden px-1 pb-3 pt-2 max-[520px]:block">
                    {renderDayTodoContent('mobile')}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>
        {isDriveView ? (
          <DriveDetailPanel item={selectedDriveItem} />
        ) : isMainOnlyView ? null : (
          activeMode.id === 'academy' ? (
            <aside className="hidden min-h-0 w-full min-w-0 overflow-hidden rounded-xl bg-card p-4 shadow-none 2xl:flex 2xl:h-full 2xl:flex-col 2xl:self-stretch">
              {renderDayTodoContent()}
            </aside>
          ) : (
            <DetailPanel item={calendarData.detailItem} mode={activeMode} />
          )
        )}
      </main>

      {activeMode.id === 'academy' && isDashboardWorkspaceView && isDayTodoDialogMode ? (
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

      {activeMode.id === 'academy' ? (
        <CalendarTodoDetailsDialog
          item={selectedCalendarTodoDetailsItem}
          onOpenItem={openCalendarSourceItem}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setSelectedCalendarTodoDetailsId(null);
            }
          }}
          onSave={handleSaveCalendarTodoDetails}
        />
      ) : null}

      {activeMode.id === 'academy' ? (
        <nav
          className="fixed inset-x-0 bottom-0 z-50 hidden grid-cols-3 gap-2 border-t bg-card/95 px-5 py-1.5 pb-[calc(env(safe-area-inset-bottom)+0.375rem)] shadow-[0_-12px_32px_hsl(var(--background)/0.75)] backdrop-blur-xl max-[520px]:grid"
          aria-label="Academy mobile navigation"
        >
          {[
            {
              id: 'calendar',
              icon: 'calendar-days',
              label: dictionary.mobileCalendar,
              active: isDashboardWorkspaceView && currentView !== 'board',
              onClick: () => navigateWorkspace({
                modeId: activeMode.id,
                sidebarItemId: 'calendar',
                view: 'month',
              }),
            },
            {
              id: 'courses',
              icon: 'book-open',
              label: dictionary.itemLabels.courses,
              active: isCoursesView,
              onClick: () => navigateWorkspace({
                modeId: activeMode.id,
                sidebarItemId: 'courses',
                view: currentView,
              }),
            },
            {
              id: 'todo',
              icon: 'list-checks',
              label: language === 'ko' ? '할 일' : 'To Do',
              active: isDashboardWorkspaceView && currentView === 'board',
              onClick: () => {
                handleMoveSelectedDayToToday();
                navigateWorkspace({
                  modeId: activeMode.id,
                  sidebarItemId: 'calendar',
                  view: 'board',
                });
              },
            },
          ].map((item) => (
            <Button
              aria-label={item.label}
              className={cn(
                'mx-auto size-11 min-w-0 rounded-full bg-transparent p-0 transition-colors hover:bg-transparent',
                item.active
                  ? 'text-primary hover:text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              key={item.id}
              onClick={item.onClick}
              title={item.label}
              type="button"
              variant="ghost"
            >
              <WorkspaceIcon name={item.icon} size={22} />
            </Button>
          ))}
        </nav>
      ) : (
        <nav
          className="sticky bottom-0 z-30 hidden grid-cols-4 gap-2 border-t bg-card/90 p-2 backdrop-blur-xl max-lg:grid"
          aria-label="Mobile workspace navigation"
        >
          <Button className="h-10 rounded-lg bg-primary text-primary-foreground" type="button" variant="ghost">
            <WorkspaceIcon name="layout-dashboard" size={16} />
            <span>{dictionary.mobileHome}</span>
          </Button>
          <Button className="h-10 rounded-lg bg-muted/60 text-muted-foreground" type="button" variant="ghost">
            <WorkspaceIcon name="calendar-days" size={16} />
            <span>{dictionary.mobileCalendar}</span>
          </Button>
          <Button className="h-10 rounded-lg bg-muted/60 text-muted-foreground" type="button" variant="ghost">
            <WorkspaceIcon name="list-checks" size={16} />
            <span>{dictionary.mobileTasks}</span>
          </Button>
          <Button className="h-10 rounded-lg bg-muted/60 text-muted-foreground" type="button" variant="ghost">
            <WorkspaceIcon name="settings" size={16} />
            <span>{dictionary.mobileMore}</span>
          </Button>
        </nav>
      )}

      <AddItemModal
        mode={activeMode}
        onClose={() => setIsAddModalOpen(false)}
        open={isAddModalOpen}
      />
    </div>
  );
}

export default App;
