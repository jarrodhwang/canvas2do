import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, EyeOff, MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-react';
import { workspaceApi } from './api/workspaceApi';
import type { CanvasCalendarItem, GoogleDriveFile } from './api/workspaceApi';
import { AddItemModal } from './components/AddItemModal';
import { CalendarShell } from './components/CalendarShell';
import { CanvasInboxView } from './components/CanvasInboxView';
import { CourseOverviewView } from './components/CourseOverviewView';
import { DashboardCards } from './components/DashboardCards';
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
import { badgeColorClasses } from './lib/colorStyles';
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
  progressDisplay: CalendarProgressDisplay;
  progressGreenAt: number;
  progressYellowAt: number;
  selectedSemester?: string;
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
  chipColor?: ColorToken;
  code?: string;
  completed?: boolean;
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
  isSubmitted?: boolean;
  originalCourseCode?: string;
  semester?: string;
  starred?: boolean;
  submissionType?: string;
  title?: string;
}

interface StoredManualCoursework {
  id: string;
  title: string;
  courseCode?: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  courseworkType?: string;
  submissionType?: string;
  completed?: boolean;
  hidden?: boolean;
  semester?: string;
  starred?: boolean;
}

interface StoredManualAssessment {
  id: string;
  title: string;
  courseCode?: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  assessmentType?: string;
  completed?: boolean;
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
  checked: boolean;
  color: ColorToken;
  id: string;
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
const academyPreferencesUpdatedEvent = 'incos-academy-preferences-updated';
const academyOpenCourseworkDialogEvent = 'incos-academy-open-coursework-dialog';

const defaultAcademyCalendarSettings: AcademyCalendarSettings = {
  progressDisplay: 'linear',
  progressGreenAt: defaultCalendarProgressThresholds.greenAt,
  progressYellowAt: defaultCalendarProgressThresholds.yellowAt,
  topBarDefaultCollapsed: false,
};
const calendarAutoExpandMediaQuery = '(max-width: 1279px), (max-height: 860px)';
const dayTodoDialogMediaQuery = '(max-width: 1535px)';

function getInitialCalendarAutoExpanded() {
  return typeof window !== 'undefined' &&
    window.matchMedia(calendarAutoExpandMediaQuery).matches;
}

function getInitialDayTodoDialogMode() {
  return typeof window !== 'undefined' &&
    window.matchMedia(dayTodoDialogMediaQuery).matches;
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

  return {
    progressDisplay,
    progressGreenAt,
    progressYellowAt,
    selectedSemester: typeof settings.selectedSemester === 'string' ? settings.selectedSemester : undefined,
    topBarDefaultCollapsed: Boolean(settings.topBarDefaultCollapsed),
  };
}

function getStoredAcademyCalendarSettings() {
  return normalizeAcademyCalendarSettings(
    readStoredJson<unknown>(academyCalendarSettingsStorageKey, defaultAcademyCalendarSettings),
  );
}

function getStoredHiddenCalendarCourseIds() {
  const storedIds = readStoredJson<unknown>(academyCalendarHiddenCoursesStorageKey, []);

  return Array.isArray(storedIds)
    ? storedIds.filter((value): value is string => typeof value === 'string')
    : [];
}

function storeAcademyCalendarSettings(settings: AcademyCalendarSettings) {
  storeJson(academyCalendarSettingsStorageKey, settings);
}

function storeHiddenCalendarCourseIds(courseIds: string[]) {
  storeJson(academyCalendarHiddenCoursesStorageKey, courseIds);
}

function storeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event(academyPreferencesUpdatedEvent));
}

function getStoredCourseChipColor(courseCode?: string): ColorToken | undefined {
  if (!courseCode) {
    return undefined;
  }

  const storedManualLectures = readStoredJson<unknown>(manualLecturesStorageKey, []);
  const manualLectures = Array.isArray(storedManualLectures)
    ? storedManualLectures as StoredCoursePreference[]
    : [];
  const manualLecture = manualLectures.find((lecture) => (
    codesMatch(courseCode, lecture.friendlyCourseCode) || codesMatch(courseCode, lecture.code)
  ));

  if (manualLecture?.chipColor) {
    return manualLecture.chipColor;
  }

  const canvasPreferences = getStoredCanvasLecturePreferences();
  const canvasLecture = Object.values(canvasPreferences).find((preference) => (
    codesMatch(courseCode, preference.friendlyCourseCode) || codesMatch(courseCode, preference.originalCourseCode)
  ));

  return canvasLecture?.chipColor;
}

function getCourseDisplay(item: CalendarSourceItem, fallbackLabel: string) {
  const canvasPreferences = getStoredCanvasLecturePreferences();
  const preferenceById = item.courseId ? canvasPreferences[item.courseId] : undefined;
  const storedManualLectures = readStoredJson<unknown>(manualLecturesStorageKey, []);
  const manualLectures = Array.isArray(storedManualLectures)
    ? storedManualLectures as StoredCoursePreference[]
    : [];
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

function getCalendarCourseFilterOptions(
  items: CalendarSourceItem[],
  hiddenCourseIds: string[],
  fallbackLabel: string,
): CalendarCourseFilterOption[] {
  const optionMap = new Map<string, CalendarCourseFilterOption>();

  items.forEach((item) => {
    const option = getCalendarCourseFilterOption(item, fallbackLabel);

    if (!optionMap.has(option.id)) {
      optionMap.set(option.id, {
        ...option,
        checked: !hiddenCourseIds.includes(option.id),
      });
    }
  });

  return [...optionMap.values()].sort((firstOption, secondOption) => (
    firstOption.label.localeCompare(secondOption.label)
  ));
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
      id: option.id,
      label: option.label,
      color: option.color,
    }));
}

function getCalendarBoardItems(items: CalendarSourceItem[], fallbackLabel: string): BoardItem[] {
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
        isTitleEditable: item.source === 'manual-coursework',
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
        label: `${formatCalendarTodoType(item.type)} · ${item.title}`,
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
    gold: 'border-yellow-400/45 bg-yellow-500 text-yellow-950',
    green: 'border-emerald-400/40 bg-emerald-500 text-white',
    orange: 'border-amber-400/45 bg-amber-500 text-amber-950',
    purple: 'border-violet-400/45 bg-violet-500 text-white',
    red: 'border-red-400/45 bg-red-500 text-white',
    teal: 'border-teal-400/45 bg-teal-500 text-white',
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
    ?? getStoredCourseChipColor(item.courseCode)
    ?? getStoredCourseChipColor(item.courseName)
    ?? (isCourseItem ? 'green' : undefined)
    ?? canvasCalendarTypeColors[item.type]
    ?? 'blue';
}

function getCalendarSourceEvent(item: CalendarSourceItem): CalendarEvent {
  const courseDisplay = getCourseDisplay(item, '');

  return {
    id: item.id,
    title: item.title,
    color: courseDisplay.color,
    courseLabel: courseDisplay.label || undefined,
    type: item.type,
    time: formatCalendarSourceItemTime(item),
  };
}

function getCalendarSourceAgendaItem(item: CalendarSourceItem): AgendaItem {
  const label = item.type.charAt(0).toUpperCase() + item.type.slice(1);
  const courseDisplay = getCourseDisplay(item, '');

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
        semester: preference?.semester,
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
      color: getStoredCourseChipColor(preference.courseCode) ?? 'blue',
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
      color: getStoredCourseChipColor(preference.courseCode) ?? 'orange',
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
      type: item.courseworkType || 'assignment',
      courseCode: item.courseCode,
      dueAt: item.dueAt,
      startAt: item.startAt,
      endAt: item.endAt,
      semester: item.semester,
      color: getStoredCourseChipColor(item.courseCode) ?? canvasCalendarTypeColors[item.courseworkType || 'assignment'] ?? 'blue',
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
      color: getStoredCourseChipColor(item.courseCode) ?? canvasCalendarTypeColors[item.assessmentType || 'quiz'] ?? 'orange',
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
    const events = dateItems.map(getCalendarSourceEvent);
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
): WorkspaceModeMockData {
  const agenda = sourceItems
    .filter((item) => getLocalIsoDate(getCalendarSourceItemDate(item)) === agendaDateIso)
    .sort((firstItem, secondItem) => (
      new Date(getCalendarSourceItemDate(firstItem) ?? '').getTime() -
      new Date(getCalendarSourceItemDate(secondItem) ?? '').getTime()
    ))
    .map(getCalendarSourceAgendaItem);

  return {
    ...data,
    agenda,
    boardItems: getCalendarBoardItems(
      sourceItems.filter((item) => getLocalIsoDate(getCalendarSourceItemDate(item)) === agendaDateIso),
      fallbackCourseLabel,
    ),
    days: createAcademyCalendarDays(monthDate, sourceItems, loadStatus),
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

function toggleCalendarSourceItemDone(item: CalendarSourceItem) {
  if (item.isLocked) {
    return;
  }

  if (item.source === 'manual-coursework') {
    const nextCoursework = getStoredManualCoursework().map((coursework) => (
      coursework.id === item.id
        ? { ...coursework, completed: !coursework.completed }
        : coursework
    ));
    storeJson(manualCourseworkStorageKey, nextCoursework);
    return;
  }

  if (item.source === 'manual-assessment') {
    const nextAssessments = getStoredManualAssessments().map((assessment) => (
      assessment.id === item.id
        ? { ...assessment, completed: !assessment.completed }
        : assessment
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
  onOpenChange,
  onSave,
}: {
  item?: CalendarSourceItem | null;
  onOpenChange: (open: boolean) => void;
  onSave: (item: CalendarSourceItem, draft: CalendarTodoDetailsDraft) => void;
}) {
  const { dictionary, language } = useLanguage();
  const [draft, setDraft] = useState<CalendarTodoDetailsDraft>(() => createCalendarTodoDetailsDraft(item));

  useEffect(() => {
    setDraft(createCalendarTodoDetailsDraft(item));
  }, [item]);

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
                autoFocus
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
              <Input
                id="calendar-todo-start"
                lang={language === 'ko' ? 'ko-KR' : 'en-CA'}
                onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, startAt: event.target.value }))}
                type="datetime-local"
                value={draft.startAt}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="calendar-todo-due">
                {dictionary.courseworkDueAt}
              </Label>
              <Input
                id="calendar-todo-due"
                lang={language === 'ko' ? 'ko-KR' : 'en-CA'}
                onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, dueAt: event.target.value }))}
                type="datetime-local"
                value={draft.dueAt}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="calendar-todo-end">
                {dictionary.calendarTodoEndAt}
              </Label>
              <Input
                id="calendar-todo-end"
                lang={language === 'ko' ? 'ko-KR' : 'en-CA'}
                onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, endAt: event.target.value }))}
                type="datetime-local"
                value={draft.endAt}
              />
            </div>
          </div>
          <DialogFooter>
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
}: {
  onSettingsChange: (settings: AcademyCalendarSettings) => void;
  settings: AcademyCalendarSettings;
}) {
  const { dictionary } = useLanguage();
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

  return (
    <div className="grid min-h-0 gap-4 xl:h-full xl:overflow-y-auto xl:pr-1">
      <Card className="rounded-xl bg-card shadow-none">
        <CardHeader>
          <CardTitle className="text-xl font-black">{dictionary.academySettingsTitle}</CardTitle>
          <p className="text-sm font-semibold text-muted-foreground">
            {dictionary.academySettingsSubtitle}
          </p>
        </CardHeader>
        <CardContent className="grid gap-5">
          <section className="grid gap-3 rounded-lg border bg-muted/20 p-3">
            <div>
              <h3 className="text-sm font-black text-foreground">
                {dictionary.academyTopBarSettingsTitle}
              </h3>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                {dictionary.academyTopBarSettingsHint}
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
          <section className="grid gap-3 rounded-lg border bg-muted/20 p-3">
            <div>
              <h3 className="text-sm font-black text-foreground">
                {dictionary.calendarProgressSettingsTitle}
              </h3>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                {dictionary.calendarProgressThresholdHint}
              </p>
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
          </section>
        </CardContent>
      </Card>
    </div>
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
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isWorkspaceSidebarCollapsed, setIsWorkspaceSidebarCollapsed] = useState(false);
  const [isAcademyTopBarCollapsed, setIsAcademyTopBarCollapsed] = useState(false);
  const [theme, setTheme] = useState<AppTheme>(getInitialTheme);
  const [selectedDriveItem, setSelectedDriveItem] = useState<GoogleDriveFile | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => getInitialCalendarMonth(activeData));
  const [selectedCalendarDayIso, setSelectedCalendarDayIso] = useState(getTodayIsoDate);
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);
  const [isCalendarAutoExpanded, setIsCalendarAutoExpanded] = useState(getInitialCalendarAutoExpanded);
  const [isDayTodoDialogOpen, setIsDayTodoDialogOpen] = useState(false);
  const [isDayTodoDialogMode, setIsDayTodoDialogMode] = useState(getInitialDayTodoDialogMode);
  const [academyCalendarSettings, setAcademyCalendarSettings] = useState(getStoredAcademyCalendarSettings);
  const [hiddenCalendarCourseIds, setHiddenCalendarCourseIds] = useState(getStoredHiddenCalendarCourseIds);
  const [focusedCalendarTodoId, setFocusedCalendarTodoId] = useState<string | null>(null);
  const [selectedCalendarTodoDetailsId, setSelectedCalendarTodoDetailsId] = useState<string | null>(null);
  const [canvasCalendarPages, setCanvasCalendarPages] = useState<Record<string, CanvasCalendarPage>>({});
  const [authRedirectMessage] = useState(getInitialAuthRedirectMessage);
  const [academyPreferenceVersion, setAcademyPreferenceVersion] = useState(0);
  const [selectedCourseOverviewRowId, setSelectedCourseOverviewRowId] = useState<string | null>(null);
  const isApplyingHistoryRef = useRef(false);
  const hasAppliedUrlNavigationRef = useRef(false);
  const activeSidebarItem = navigation.modeId === activeMode.id ? navigation.sidebarItemId : 'dashboard';
  const activeView = navigation.modeId === activeMode.id ? navigation.view : 'month';
  const currentView = activeMode.views.includes(activeView) ? activeView : (activeMode.views[0] ?? 'month');
  const isDriveView = activeSidebarItem === 'drive';
  const isEmailView = activeSidebarItem === 'email';
  const isOutlookView = activeSidebarItem === 'outlook';
  const isChatView = activeSidebarItem === 'chat';
  const isCanvasInboxView = activeMode.id === 'academy' && activeSidebarItem === 'inbox';
  const isCommunicationView = isEmailView || isOutlookView || isChatView;
  const isCoursesView = activeMode.id === 'academy' && activeSidebarItem === 'courses';
  const isAcademySettingsView = activeMode.id === 'academy' && activeSidebarItem === 'settings';
  const isMainOnlyView = isCommunicationView || isCoursesView || isCanvasInboxView || isAcademySettingsView;
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
  const canvasCalendarEmptyMessage = activeMode.id === 'academy' && canvasCalendarLoadStatus === 'loaded' && canvasCalendarItems.length === 0
    ? dictionary.canvasCalendarEmpty
    : activeMode.id === 'academy' && canvasCalendarLoadStatus === 'failed'
      ? dictionary.canvasCalendarUnavailable
      : undefined;
  const allCalendarSourceItems = activeMode.id === 'academy'
    ? getCalendarSourceItems(canvasCalendarItems, academyPreferenceVersion)
    : [];
  const calendarCourseFilterOptions = activeMode.id === 'academy'
    ? getCalendarCourseFilterOptions(allCalendarSourceItems, hiddenCalendarCourseIds, dictionary.selectedDayTodoNoCourse)
    : [];
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
  const calendarBoardColumns = activeMode.id === 'academy'
    ? getCalendarBoardColumns(calendarCourseFilterOptions)
    : undefined;
  const selectedDayGroups = selectedDaySourceItems.reduce<Record<string, { color: ColorToken; items: CalendarSourceItem[]; label: string }>>((groups, item) => {
    const courseDisplay = getCourseDisplay(item, dictionary.selectedDayTodoNoCourse);

    return {
      ...groups,
      [courseDisplay.label]: {
        color: courseDisplay.color,
        items: [...(groups[courseDisplay.label]?.items ?? []), item],
        label: courseDisplay.label,
      },
    };
  }, {});
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
  const effectiveTopBarCollapsed = activeMode.id === 'academy' && isAcademyTopBarCollapsed;

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

  const openAcademyCourseworkDialog = () => {
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
      window.dispatchEvent(new Event(academyOpenCourseworkDialogEvent));
    }, 0);
  };

  const persistAcademyCalendarSettings = (settings: AcademyCalendarSettings) => {
    storeAcademyCalendarSettings(settings);

    persistAcademyPreferencesFromStorage(settings);
  };

  const persistAcademyPreferencesFromStorage = (settings = academyCalendarSettings) => {
    void workspaceApi.saveAcademyPreferences({
      manualLectures: readStoredJson<unknown[]>(manualLecturesStorageKey, []),
      canvasLecturePreferences: readStoredJson<Record<string, unknown>>(canvasLecturePreferencesStorageKey, {}),
      manualCoursework: readStoredJson<unknown[]>(manualCourseworkStorageKey, []),
      canvasCourseworkPreferences: readStoredJson<Record<string, unknown>>(canvasCourseworkPreferencesStorageKey, {}),
      manualAssessments: readStoredJson<unknown[]>(manualAssessmentsStorageKey, []),
      canvasAssessmentPreferences: readStoredJson<Record<string, unknown>>(canvasAssessmentPreferencesStorageKey, {}),
      calendarSettings: settings,
    }).catch(() => undefined);
  };

  const handleAcademyCalendarSettingsChange = (settings: AcademyCalendarSettings) => {
    const nextSettings = normalizeAcademyCalendarSettings(settings);

    setAcademyCalendarSettings(nextSettings);
    persistAcademyCalendarSettings(nextSettings);
  };

  const handleToggleCalendarCourse = (courseId: string) => {
    setHiddenCalendarCourseIds((currentCourseIds) => {
      const nextCourseIds = currentCourseIds.includes(courseId)
        ? currentCourseIds.filter((currentCourseId) => currentCourseId !== courseId)
        : [...currentCourseIds, courseId];

      storeHiddenCalendarCourseIds(nextCourseIds);

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

  const handleQuickAddCalendarTodo = (column: BoardColumnConfig) => {
    const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const newCoursework: StoredManualCoursework = {
      id: `manual-coursework-${randomId}`,
      title: '',
      courseCode: column.label,
      dueAt: getEndOfDayIsoDateTime(selectedCalendarDayIso),
      startAt: new Date().toISOString(),
      courseworkType: 'assignment',
      submissionType: 'no_submission',
      completed: false,
      semester: academyCalendarSettings.selectedSemester,
    };
    const nextCoursework = [...getStoredManualCoursework(), newCoursework];

    storeJson(manualCourseworkStorageKey, nextCoursework);
    setFocusedCalendarTodoId(newCoursework.id);
    persistAcademyPreferencesFromStorage();
  };

  const handleUpdateCalendarTodoTitle = (item: BoardItem, title: string) => {
    if (!item.isTitleEditable) {
      return;
    }

    const nextCoursework = getStoredManualCoursework().map((coursework) => (
      coursework.id === item.id
        ? { ...coursework, title }
        : coursework
    ));

    storeJson(manualCourseworkStorageKey, nextCoursework);
    persistAcademyPreferencesFromStorage();
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

  const handleRemoveCalendarTodo = (item: { id: string }) => {
    const sourceItem = calendarSourceItems.find((calendarItem) => calendarItem.id === item.id);

    if (!sourceItem) {
      return;
    }

    if (sourceItem.source === 'manual-coursework') {
      const nextCoursework = getStoredManualCoursework().filter((coursework) => coursework.id !== sourceItem.id);

      storeJson(manualCourseworkStorageKey, nextCoursework);
      persistAcademyPreferencesFromStorage();
      return;
    }

    if (sourceItem.source === 'manual-assessment') {
      const nextAssessments = getStoredManualAssessments().filter((assessment) => assessment.id !== sourceItem.id);

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
    applyTheme(theme);
  }, [theme]);

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
    const handleAcademyPreferencesUpdated = () => {
      setAcademyPreferenceVersion((currentVersion) => currentVersion + 1);
      setAcademyCalendarSettings(getStoredAcademyCalendarSettings());
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
        if (isCancelled || !preferences.calendarSettings) {
          return;
        }

        const nextSettings = normalizeAcademyCalendarSettings(preferences.calendarSettings);

        setAcademyCalendarSettings(nextSettings);
        storeAcademyCalendarSettings(nextSettings);
      })
      .catch(() => undefined);

    return () => {
      isCancelled = true;
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
      .getCanvasIntegration()
      .then((integration) => {
        if (!integration.connected) {
          throw new Error('Canvas LMS is not connected.');
        }

        return workspaceApi.getCanvasCalendarItems({
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
        });
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
    let isMounted = true;

    workspaceApi
      .getAuthSession()
      .then((session) => {
        if (isMounted) {
          setAuthStatus(session.isAuthenticated ? 'authenticated' : 'unauthenticated');
        }
      })
      .catch(() => {
        if (isMounted) {
          setAuthStatus('unauthenticated');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const renderDayTodoContent = (variant: 'card' | 'dialog' = 'card') => (
    <>
      <div className={cn('min-w-0 rounded-lg border bg-muted/25 p-3', variant === 'card' && 'mb-4')}>
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h2 className="min-w-0 truncate text-xl font-black leading-tight text-foreground">
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
          className="mt-3"
          display={academyCalendarSettings.progressDisplay}
          label={dictionary.calendarProgressLabel}
          thresholds={calendarProgressThresholds}
          value={selectedDayProgress}
          valueLabel={selectedDayProgressInfo.label}
        />
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto pr-1', variant === 'dialog' && 'max-h-[64vh]')}>
        {selectedDaySourceItems.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/35 p-4 text-sm font-bold text-muted-foreground">
            {dictionary.selectedDayTodoEmpty}
          </div>
        ) : (
          <div className="grid gap-4">
            {Object.values(selectedDayGroups).map((group) => (
              <section className="min-w-0" key={group.label}>
                <div
                  className={cn(
                    'mb-2 inline-flex max-w-full rounded-md border px-2 py-1 text-xs font-black',
                    badgeColorClasses[group.color],
                  )}
                >
                  <span className="truncate">{group.label}</span>
                </div>
                <div className="grid gap-2">
                  {group.items.map((item) => {
                    const dueLabel = formatCalendarSourceItemSelectedDayTime(item) ?? dictionary.allDay;
                    const dueState = getCalendarDueState(getCalendarSourceItemDate(item), Boolean(item.isCompleted));
                    const courseDisplay = getCourseDisplay(item, dictionary.selectedDayTodoNoCourse);
                    const itemRow = (
                      <div
                        className={cn(
                          'grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-lg border bg-muted/25 p-2 text-sm font-bold transition-colors',
                          item.isLocked ? 'cursor-default' : 'cursor-pointer hover:bg-muted/45',
                        )}
                        onKeyDown={(event) => {
                          if ((event.key === 'Enter' || event.key === ' ') && !item.isLocked) {
                            event.preventDefault();
                            toggleCalendarSourceItemDone(item);
                            persistAcademyPreferencesFromStorage();
                          }
                        }}
                        onClick={() => {
                          if (!item.isLocked) {
                            toggleCalendarSourceItemDone(item);
                            persistAcademyPreferencesFromStorage();
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <button
                          aria-label={item.isLocked ? dictionary.selectedDayTodoLocked : item.title}
                          className={cn(
                            'mt-0.5 grid size-5 shrink-0 place-items-center rounded-[7px] border text-[11px] font-black leading-none transition-colors',
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
                          <span className="block truncate text-[15px] font-black leading-snug text-foreground">{item.title}</span>
                          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] font-black text-muted-foreground">
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
                                <DropdownMenuItem onSelect={() => handleOpenCalendarTodoDetails(item)}>
                                  <Pencil className="size-4" />
                                  <span>{dictionary.courseworkOpenDetails}</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleToggleCalendarTodoStar(item)}>
                                  <Star className={cn('size-4', item.isStarred && 'fill-amber-400 text-amber-500')} />
                                  <span>{item.isStarred ? dictionary.courseworkUnstar : dictionary.courseworkStar}</span>
                                </DropdownMenuItem>
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
                          <ContextMenuItem onSelect={() => handleOpenCalendarTodoDetails(item)}>
                            <Pencil className="size-4" />
                            <span>{dictionary.courseworkOpenDetails}</span>
                          </ContextMenuItem>
                          <ContextMenuItem onSelect={() => handleToggleCalendarTodoStar(item)}>
                            <Star className={cn('size-4', item.isStarred && 'fill-amber-400 text-amber-500')} />
                            <span>{item.isStarred ? dictionary.courseworkUnstar : dictionary.courseworkStar}</span>
                          </ContextMenuItem>
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
        authMessage={authRedirectMessage}
        isCheckingSession={authStatus === 'checking'}
        onThemeChange={setTheme}
        theme={theme}
      />
    );
  }

  return (
    <div
      className="min-h-screen xl:h-screen xl:overflow-hidden"
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
        isAcademyTopBarCollapsed={effectiveTopBarCollapsed}
        onOpenAddItem={openAcademyCourseworkDialog}
        onToggleAcademyTopBarCollapsed={activeMode.id === 'academy'
          ? () => setIsAcademyTopBarCollapsed((currentValue) => !currentValue)
          : undefined}
        onThemeChange={setTheme}
        theme={theme}
      />

      <main
        className={cn(
          'mx-auto grid w-full max-w-[2400px] items-start gap-3 overflow-x-clip p-3 xl:h-[calc(100vh_-_var(--top-bar-height))] xl:grid-rows-1 xl:items-stretch xl:overflow-hidden max-lg:block',
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
            'grid w-full min-w-0 xl:h-full xl:min-h-0 xl:overflow-x-hidden xl:pr-1',
            isCommunicationView
              ? 'gap-4 content-stretch xl:overflow-hidden max-lg:gap-3'
              : isDashboardWorkspaceView
                ? effectiveCalendarExpanded
                  ? 'gap-0 content-stretch xl:grid-rows-[minmax(0,1fr)] xl:overflow-hidden'
                  : 'gap-4 content-stretch xl:grid-rows-[auto_minmax(0,1fr)] xl:overflow-hidden max-lg:gap-3'
                : 'gap-4 content-start xl:overflow-y-auto max-lg:gap-3',
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
            <CanvasInboxView />
          ) : isCoursesView ? (
            <CourseOverviewView initialSelectedCourseRowId={selectedCourseOverviewRowId} />
          ) : isAcademySettingsView ? (
            <AcademySettingsView
              onSettingsChange={handleAcademyCalendarSettingsChange}
              settings={academyCalendarSettings}
            />
          ) : (
            <>
              {!effectiveCalendarExpanded ? (
                <div className="dashboard-summary-cards overflow-hidden transition-all duration-300 ease-out max-lg:hidden">
                  <DashboardCards
                    onOpenAddItem={openAcademyCourseworkDialog}
                    onOpenCourse={(courseRowId) => {
                      setSelectedCourseOverviewRowId(courseRowId ?? null);
                      navigateWorkspace({
                        modeId: activeMode.id,
                        sidebarItemId: 'courses',
                        view: currentView,
                      });
                    }}
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
                onOpenTodoDetails={handleOpenCalendarTodoDetails}
                onPreviousAgendaDay={activeMode.id === 'academy'
                  ? () => handleMoveSelectedAgendaDay(-1)
                  : undefined}
                onPreviousMonth={activeMode.id === 'academy'
                  ? () => setCalendarMonth((currentMonth) => addCalendarMonths(currentMonth, -1))
                  : undefined}
                onRemoveTodo={handleRemoveCalendarTodo}
                onToggleCourseFilter={handleToggleCalendarCourse}
                onSelectItem={(day) => {
                  if (day?.dateIso) {
                    setSelectedCalendarDayIso(day.dateIso);
                    if (activeMode.id === 'academy' && isDayTodoDialogMode) {
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
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setSelectedCalendarTodoDetailsId(null);
            }
          }}
          onSave={handleSaveCalendarTodoDetails}
        />
      ) : null}

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

      <AddItemModal
        mode={activeMode}
        onClose={() => setIsAddModalOpen(false)}
        open={isAddModalOpen}
      />
    </div>
  );
}

export default App;
