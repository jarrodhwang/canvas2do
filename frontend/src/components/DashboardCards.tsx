import {
  BookOpen,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Eye,
  EyeOff,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent, type ReactElement, type TouchEvent } from 'react';

import { canvasToDoApi, type AcademyPreferences, type CanvasCalendarItem, type CanvasCourse, type SaveAcademyPreferencesRequest } from '../api/canvasToDoApi';
import { useLanguage } from '../context/LanguageContext';
import { useWorkspaceMode } from '../context/WorkspaceModeContext';
import { shouldConvertCanvasCourseToManual } from '../lib/canvasCourseMigration';
import type { ColorToken, DashboardCardConfig } from '../modes/types';
import { compareSemestersNewestFirst } from '../lib/semesterSort';
import { cn } from '../lib/utils';
import { dotColorClasses } from '../lib/colorStyles';
import { DateTimeField } from './DateTimeField';
import { EventPill } from './EventPill';
import { PhoneCourseworkForm } from './PhoneCourseworkForm';
import {
  ManualLectureDialog,
  type ManualLecture,
  type ManualLectureAssessment,
  type ManualLectureLink,
  type ManualLectureSchedule,
} from './ManualLectureDialog';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

type DashboardRow = DashboardCardConfig['rows'][number];
type LectureRowSource = 'manual' | 'canvas';
type CourseworkRowSource = 'manual' | 'canvas';
type AssessmentRowSource = 'manual' | 'canvas';
type CourseworkDueState = 'done' | 'overdue' | 'dueToday' | 'tomorrow' | 'soon' | 'normal';
type CourseworkCompletedHideBasis = 'completedAt' | 'dueAt';

interface CourseworkHideSettings {
  completedAfterHours: number;
  completedFrom: CourseworkCompletedHideBasis;
  uncompletedAfterHours: number;
}

const defaultCourseworkHideSettings: CourseworkHideSettings = {
  completedAfterHours: 24,
  completedFrom: 'dueAt',
  uncompletedAfterHours: 72,
};
const noTermSemester = 'Default Term';
type RenderableDashboardRow = DashboardRow & {
  assessmentKey?: string;
  assessmentSource?: AssessmentRowSource;
  assessmentType?: string;
  canvasAssessmentId?: string;
  canvasCourseworkId?: string;
  canvasCourseId?: string;
  chipColor?: ColorToken;
  courseName?: string;
  courseworkKey?: string;
  courseworkSource?: CourseworkRowSource;
  courseworkType?: string;
  isCompleted?: boolean;
  dueState?: CourseworkDueState;
  dueAt?: string;
  friendlyCourseCode?: string;
  friendlyName?: string;
  isCanvasSubmitted?: boolean;
  isArchivedCanvasItem?: boolean;
  isStarred?: boolean;
  lectureKey?: string;
  lectureSource?: LectureRowSource;
  manualAssessmentId?: string;
  manualCourseworkId?: string;
  manualLectureId?: string;
  originalCourseCode?: string;
  semester?: string;
  submissionType?: string;
};
type RenderableDashboardCard = Omit<DashboardCardConfig, 'rows'> & {
  rows: RenderableDashboardRow[];
};

function isLiveCanvasDashboardRow(row: RenderableDashboardRow) {
  return (row.courseworkSource === 'canvas' || row.assessmentSource === 'canvas') && !row.isArchivedCanvasItem;
}

type CanvasCourseLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';
type AcademyPreferenceLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';
type DashboardSnackbar = {
  message: string;
  tone: 'success' | 'error';
};
type CanvasLecturePreferences = Record<string, {
  accessClosed?: boolean;
  accessRestrictedByDate?: boolean;
  assessments?: ManualLectureAssessment[];
  archivedAsManualLectureId?: string;
  canvasAccessLostAt?: string | null;
  chipColor?: ColorToken;
  courseName?: string;
  credits?: string;
  currentGrade?: string;
  currentScore?: number;
  convertedToManualAt?: string;
  deleted?: boolean;
  friendlyCourseCode?: string;
  friendlyName?: string;
  hidden?: boolean;
  htmlUrl?: string;
  isPublished?: boolean;
  labSection?: string;
  lastSeenAt?: string;
  lectureSection?: string;
  links?: ManualLectureLink[];
  originalCourseCode?: string;
  schedule?: ManualLectureSchedule;
  semesterSource?: 'canvas' | 'fallback' | 'manual';
  starred?: boolean;
  semester?: string;
  termName?: string;
  termEndAt?: string;
  termStartAt?: string;
  tutorialSection?: string;
  workflowState?: string;
}>;

function isManuallyManagedCanvasCourse(courseId: string | undefined, preferences: CanvasLecturePreferences) {
  return Boolean(
    courseId &&
    preferences[courseId]?.convertedToManualAt &&
    preferences[courseId]?.accessClosed === true,
  );
}

interface ManualCourseworkItem {
  id: string;
  title: string;
  courseCode: string;
  dueAt: string;
  startAt?: string;
  endAt?: string;
  courseworkType: string;
  submissionType: string;
  completed?: boolean;
  completedAt?: string;
  chipColor?: ColorToken;
  hidden?: boolean;
  retainedFromCanvasCourseId?: string;
  semester?: string;
  starred?: boolean;
}
interface ManualAssessmentItem {
  id: string;
  title: string;
  courseCode: string;
  dueAt: string;
  startAt?: string;
  endAt?: string;
  assessmentType: string;
  completed?: boolean;
  completedAt?: string;
  hidden?: boolean;
  retainedFromCanvasCourseId?: string;
  semester?: string;
  starred?: boolean;
}
type CanvasCourseworkPreferences = Record<string, {
  assignmentId?: string;
  chipColor?: ColorToken;
  completed?: boolean;
  completedAt?: string;
  courseCode?: string;
  courseId?: string;
  courseName?: string;
  courseworkType?: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  htmlUrl?: string;
  hidden?: boolean;
  isSubmitted?: boolean;
  originalCourseCode?: string;
  semester?: string;
  starred?: boolean;
  submittedAt?: string;
  submissionType?: string;
  title?: string;
}>;
type CanvasAssessmentPreferences = Record<string, {
  assignmentId?: string;
  assessmentType?: string;
  completed?: boolean;
  completedAt?: string;
  courseCode?: string;
  courseId?: string;
  courseName?: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  htmlUrl?: string;
  hidden?: boolean;
  isSubmitted?: boolean;
  originalCourseCode?: string;
  semester?: string;
  starred?: boolean;
  submittedAt?: string;
  title?: string;
}>;

const manualLecturesStorageKey = 'canvas-to-do-manual-lectures';
const canvasLecturePreferencesStorageKey = 'canvas-to-do-canvas-lecture-preferences';
const manualCourseworkStorageKey = 'canvas-to-do-manual-coursework';
const canvasCourseworkPreferencesStorageKey = 'canvas-to-do-canvas-coursework-preferences';
const manualAssessmentsStorageKey = 'canvas-to-do-manual-assessments';
const canvasAssessmentPreferencesStorageKey = 'canvas-to-do-canvas-assessment-preferences';
const academyCalendarSettingsStorageKey = 'canvas-to-do-calendar-settings';
const academyPreferencesUpdatedEvent = 'canvas-to-do-preferences-updated';
const academyOpenCourseworkDialogEvent = 'canvas-to-do-open-coursework-dialog';
const academyRefreshRequestedEvent = 'canvas-to-do-refresh-requested';
const defaultAcademyAutoRefreshIntervalMs = 10 * 60_000;
const dashboardRefreshFreshThresholdMs = 30 * 60_000;
const dashboardRefreshRecentThresholdMs = 45 * 60_000;
type AcademyOpenCourseworkDialogDetail = Partial<Pick<
  ManualCourseworkItem,
  'courseCode' | 'dueAt' | 'startAt' | 'title' | 'semester'
>>;
type AcademyRefreshRequestedDetail = {
  forceRefresh?: boolean;
  registerTask?: (task: Promise<unknown>) => void;
};
let academyPreferencesSaveSequence = 0;
let academyPreferencesSaveQueue: Promise<void> = Promise.resolve();
const canvasSubmissionSyncProtectionMs = 15000;
let academyCalendarSettingsCache: Record<string, unknown> = {};
let academyCalendarSettingsProtectedUntil = 0;
const academyCalendarSettingsProtectionMs = 15_000;
const defaultAcademySemester = getDateBasedAcademySemester();
const defaultCourseChipColor: ColorToken = 'blue';
const lectureChipColors: ColorToken[] = [
  'butter',
  'sage',
  'powder',
  'blush',
  'red',
  'orange',
  'gold',
  'emerald',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
  'slate',
];
const lectureChipColorVariantPages: ColorToken[][] = [
  ['butter', 'vanilla', 'cream', 'honeydew', 'pistachio', 'sage', 'seafoam', 'powder', 'babyblue', 'periwinkle', 'wisteria', 'blush', 'cottoncandy'],
  ['peachfuzz', 'softcoral', 'flamingo', 'watermelon', 'tangerine', 'marigold', 'citron', 'neomint', 'jade', 'lagoon', 'serenity', 'veryperi', 'orchid', 'amethyst'],
  ['red', 'crimson', 'rose', 'coral', 'peach', 'apricot', 'amber', 'orange', 'yellow', 'gold', 'lemon', 'lime', 'olive', 'moss', 'forest', 'emerald'],
  ['green', 'mint', 'turquoise', 'teal', 'aqua', 'cyan', 'ice', 'sky', 'ocean', 'cobalt', 'blue', 'navy', 'midnight', 'indigo', 'violet', 'lavender'],
  ['purple', 'lilac', 'plum', 'mauve', 'fuchsia', 'magenta', 'pink', 'slate', 'zinc', 'neutral', 'stone', 'graphite', 'cocoa', 'sand', 'gray'],
];
const courseworkTypes = [
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
];
const submissionTypes = [
  'online_upload',
  'online_text_entry',
  'external_tool',
  'paper',
  'in_person',
  'no_submission',
];
const assessmentTypes = ['quiz', 'midterm', 'final_exam', 'exam'];

interface CourseworkCourseOption {
  label: string;
  semester?: string;
  value: string;
}

function createLectureSectionsSummary(lecture: {
  labSection?: string;
  lectureSection?: string;
  tutorialSection?: string;
}) {
  return [
    lecture.lectureSection ? `Lec ${lecture.lectureSection}` : '',
    lecture.labSection ? `Lab ${lecture.labSection}` : '',
    lecture.tutorialSection ? `Tut ${lecture.tutorialSection}` : '',
  ].filter(Boolean).join(' · ');
}

function normalizeCourseCode(value: string) {
  return value.replace(/\s+/g, '').toLowerCase();
}

function getDateBasedAcademySemester(date = new Date()) {
  const month = date.getMonth();
  const term = month <= 3 ? 'Spring' : month <= 7 ? 'Summer' : 'Fall';

  return `${term} ${date.getFullYear()}`;
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

function normalizeSemesterName(value?: string, fallback = defaultAcademySemester) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return fallback;
  }

  if (/^default term$/i.test(trimmedValue)) {
    return noTermSemester;
  }

  return trimmedValue;
}

function normalizeCanvasSemesterName(value?: string) {
  const trimmedValue = value?.trim();

  if (!trimmedValue || /^default term$/i.test(trimmedValue)) {
    return noTermSemester;
  }

  return trimmedValue;
}

function getCommonReportedCanvasSemester(courses: CanvasCourse[] | null) {
  const termNames = new Set(
    (courses ?? [])
      .map((course) => normalizeCanvasSemesterName(course.termName))
      .filter(Boolean) as string[],
  );

  return termNames.size === 1 ? Array.from(termNames)[0] : undefined;
}

function getCanvasCourseSemester(
  course: CanvasCourse,
  preferences: CanvasLecturePreferences,
  fallbackSemester = defaultAcademySemester,
) {
  const coursePreferences = preferences[course.id] ?? {};
  const preferenceSemester = coursePreferences.semester ?? coursePreferences.termName;

  if (preferenceSemester) {
    return normalizeSemesterName(preferenceSemester, fallbackSemester);
  }

  const reportedSemester = normalizeCanvasSemesterName(course.termName);

  return reportedSemester;
}

function getCanvasItemSemester(
  item: Pick<CanvasCalendarItem, 'courseId' | 'courseCode' | 'contextCode'>,
  itemPreference: { semester?: string } | undefined,
  canvasCourses: CanvasCourse[] | null,
  lecturePreferences: CanvasLecturePreferences,
  fallbackSemester = defaultAcademySemester,
) {
  if (itemPreference?.semester) {
    return normalizeSemesterName(itemPreference.semester, fallbackSemester);
  }

  const courseFromCanvas = item.courseId
    ? canvasCourses?.find((course) => course.id === item.courseId)
    : undefined;

  if (courseFromCanvas) {
    return getCanvasCourseSemester(courseFromCanvas, lecturePreferences, fallbackSemester);
  }

  const coursePreference = item.courseId ? lecturePreferences[item.courseId] : undefined;

  if (coursePreference?.semester || coursePreference?.termName) {
    return normalizeSemesterName(coursePreference.semester ?? coursePreference.termName, fallbackSemester);
  }

  const itemCourseCode = item.courseCode ?? item.contextCode?.replace(/^course_/i, '');
  const matchingCoursePreference = Object.values(lecturePreferences).find((preference) => (
    codesMatch(itemCourseCode, preference.friendlyCourseCode) ||
    codesMatch(itemCourseCode, preference.originalCourseCode)
  ));

  return normalizeSemesterName(
    matchingCoursePreference?.semester ?? matchingCoursePreference?.termName,
    fallbackSemester,
  );
}

function semesterMatches(value: string | undefined, selectedSemester: string | undefined, fallbackSemester: string) {
  return !selectedSemester || normalizeSemesterName(value, fallbackSemester) === selectedSemester;
}

function lectureMatchesCourseCode(lecture: ManualLecture, courseCode?: string) {
  return (
    codesMatch(courseCode, lecture.code) ||
    codesMatch(courseCode, lecture.friendlyCourseCode)
  );
}

function lectureSemesterMatches(lecture: ManualLecture, semester: string | undefined, fallbackSemester: string) {
  return normalizeSemesterName(lecture.semester, fallbackSemester) === normalizeSemesterName(semester, fallbackSemester);
}

function findArchivedCanvasCourseId(lecture: ManualLecture, preferences: CanvasLecturePreferences) {
  return Object.entries(preferences).find(([, preference]) => (
    preference.archivedAsManualLectureId === lecture.id
  ))?.[0];
}

function isManualCourseworkForLecture(
  item: Pick<ManualCourseworkItem | ManualAssessmentItem, 'courseCode' | 'semester'>,
  lecture: ManualLecture,
  fallbackSemester: string,
) {
  return lectureSemesterMatches(lecture, item.semester, fallbackSemester) &&
    lectureMatchesCourseCode(lecture, item.courseCode);
}

function isCanvasCourseworkPreferenceForLecture(
  preference: CanvasCourseworkPreferences[string] | CanvasAssessmentPreferences[string],
  lecture: ManualLecture,
  archivedCanvasCourseId: string | undefined,
  fallbackSemester: string,
) {
  const courseMatches = (
    Boolean(archivedCanvasCourseId && preference.courseId === archivedCanvasCourseId) ||
    lectureMatchesCourseCode(lecture, preference.courseCode) ||
    lectureMatchesCourseCode(lecture, preference.originalCourseCode)
  );

  return courseMatches && lectureSemesterMatches(lecture, preference.semester, fallbackSemester);
}

function mergeDefinedSnapshot<TPreference extends object>(
  preference: TPreference | undefined,
  snapshot: Record<string, unknown>,
) {
  const nextPreference = { ...(preference ?? {}) } as TPreference;
  let changed = false;

  Object.entries(snapshot).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }

    if ((nextPreference as Record<string, unknown>)[key] !== value) {
      (nextPreference as Record<string, unknown>)[key] = value;
      changed = true;
    }
  });

  return { changed, nextPreference };
}

type CanvasSubmissionPreference = {
  assignmentId?: string;
  completed?: boolean;
  completedAt?: string;
  courseId?: string;
  hidden?: boolean;
  isSubmitted?: boolean;
  submittedAt?: string;
};
type ProtectedCanvasSubmissionStatus = Pick<CanvasCalendarItem, 'isSubmitted' | 'submittedAt'> & {
  expiresAt: number;
};

function syncCanvasSubmissionPreference<TPreference extends CanvasSubmissionPreference>(
  preference: TPreference,
  item: Pick<CanvasCalendarItem, 'isSubmitted' | 'submittedAt'>,
) {
  const isSubmitted = Boolean(item.isSubmitted);
  const submittedAt = isSubmitted ? item.submittedAt : undefined;
  const nextPreference = {
    ...preference,
    completed: isSubmitted,
    isSubmitted,
  } as TPreference;

  if (submittedAt) {
    nextPreference.completedAt = submittedAt;
    nextPreference.submittedAt = submittedAt;
  } else {
    delete nextPreference.completedAt;
    delete nextPreference.submittedAt;
  }

  const changed =
    preference.completed !== nextPreference.completed ||
    preference.completedAt !== nextPreference.completedAt ||
    preference.isSubmitted !== nextPreference.isSubmitted ||
    preference.submittedAt !== nextPreference.submittedAt;

  return { changed, nextPreference };
}

function getCanvasAssignmentReference(
  itemId: string,
  preference: CanvasSubmissionPreference,
  item?: CanvasCalendarItem,
) {
  const courseId = item?.courseId ?? preference.courseId;
  const assignmentId = item?.assignmentId ?? preference.assignmentId;

  if (courseId && assignmentId) {
    return { assignmentId, courseId };
  }

  const idMatch = /^canvas-assignment-(?<courseId>[^-]+)-(?<assignmentId>[^-]+)$/i.exec(itemId);

  if (!idMatch?.groups?.courseId || !idMatch.groups.assignmentId) {
    return undefined;
  }

  return {
    assignmentId: idMatch.groups.assignmentId,
    courseId: idMatch.groups.courseId,
  };
}

function addCanvasAssignmentReferenceKey(
  keys: Set<string>,
  itemId: string,
  preference: CanvasSubmissionPreference,
  item?: CanvasCalendarItem,
) {
  const reference = getCanvasAssignmentReference(itemId, preference, item);

  if (reference) {
    keys.add(`${reference.courseId}:${reference.assignmentId}`);
  }
}

function isRecoverableCanvasSubmissionPreference(preference: CanvasSubmissionPreference) {
  return Boolean(preference.hidden || (preference.completed && !preference.isSubmitted));
}

function addRecoverableCanvasAssignmentReferenceKey(
  keys: Set<string>,
  itemId: string,
  preference: CanvasSubmissionPreference,
  item?: CanvasCalendarItem,
) {
  if (!isRecoverableCanvasSubmissionPreference(preference)) {
    return;
  }

  addCanvasAssignmentReferenceKey(keys, itemId, preference, item);
}

function getCanvasSubmissionProtectionKeys(
  itemId: string,
  preference: CanvasSubmissionPreference,
  item?: CanvasCalendarItem,
) {
  const keys = [itemId];
  const reference = getCanvasAssignmentReference(itemId, preference, item);

  if (reference) {
    keys.push(`${reference.courseId}:${reference.assignmentId}`);
  }

  return keys;
}

function protectCanvasSubmissionStatus(
  protectedStatuses: Map<string, ProtectedCanvasSubmissionStatus>,
  itemId: string,
  preference: CanvasSubmissionPreference,
  item: CanvasCalendarItem | undefined,
  status: Pick<CanvasCalendarItem, 'isSubmitted' | 'submittedAt'>,
) {
  const protectedStatus = {
    isSubmitted: status.isSubmitted,
    submittedAt: status.submittedAt,
    expiresAt: Date.now() + canvasSubmissionSyncProtectionMs,
  };

  getCanvasSubmissionProtectionKeys(itemId, preference, item).forEach((key) => {
    protectedStatuses.set(key, protectedStatus);
  });
}

function clearProtectedCanvasSubmissionStatus(
  protectedStatuses: Map<string, ProtectedCanvasSubmissionStatus>,
  itemId: string,
  preference: CanvasSubmissionPreference,
  item?: CanvasCalendarItem,
) {
  getCanvasSubmissionProtectionKeys(itemId, preference, item).forEach((key) => {
    protectedStatuses.delete(key);
  });
}

function getProtectedCanvasSubmissionStatus(
  protectedStatuses: Map<string, ProtectedCanvasSubmissionStatus>,
  itemId: string,
  preference: CanvasSubmissionPreference,
  item?: CanvasCalendarItem,
) {
  const now = Date.now();

  for (const key of getCanvasSubmissionProtectionKeys(itemId, preference, item)) {
    const protectedStatus = protectedStatuses.get(key);

    if (!protectedStatus) {
      continue;
    }

    if (protectedStatus.expiresAt <= now) {
      protectedStatuses.delete(key);
      continue;
    }

    return protectedStatus;
  }

  return undefined;
}

function getCourseChipColorForCode(
  courseCode: string | undefined,
  manualLectures: ManualLecture[],
  canvasPreferences: CanvasLecturePreferences,
  fallback: ColorToken = defaultCourseChipColor,
) {
  if (!courseCode) {
    return fallback;
  }

  const manualLecture = manualLectures.find((lecture) => (
    codesMatch(courseCode, lecture.friendlyCourseCode) || codesMatch(courseCode, lecture.code)
  ));

  if (manualLecture?.chipColor) {
    return manualLecture.chipColor;
  }

  const canvasCoursePreference = Object.values(canvasPreferences).find((preference) => (
    codesMatch(courseCode, preference.friendlyCourseCode) || codesMatch(courseCode, preference.originalCourseCode)
  ));

  return canvasCoursePreference?.chipColor ?? fallback;
}

function getFriendlyCourseCodeForCode(
  courseCode: string | undefined,
  manualLectures: ManualLecture[],
  canvasPreferences: CanvasLecturePreferences,
) {
  if (!courseCode) {
    return undefined;
  }

  const manualLecture = manualLectures.find((lecture) => (
    codesMatch(courseCode, lecture.friendlyCourseCode) || codesMatch(courseCode, lecture.code)
  ));

  if (manualLecture?.friendlyCourseCode || manualLecture?.code) {
    return manualLecture.friendlyCourseCode || manualLecture.code;
  }

  const canvasCoursePreference = Object.values(canvasPreferences).find((preference) => (
    codesMatch(courseCode, preference.friendlyCourseCode) || codesMatch(courseCode, preference.originalCourseCode)
  ));

  return canvasCoursePreference?.friendlyCourseCode || courseCode;
}

function createCanvasLectureRows(
  courses: CanvasCourse[],
  preferences: CanvasLecturePreferences,
  fallbackSemester = defaultAcademySemester,
): RenderableDashboardRow[] {
  return courses
    .filter((course) => {
      const preference = preferences[course.id] ?? {};
      const restoreAccessibleConversion = Boolean(
        preference.convertedToManualAt && course.accessClosed !== true,
      );

      return course.accessClosed !== true &&
        (restoreAccessibleConversion || (!preference.hidden && !preference.deleted));
    })
    .sort((firstCourse, secondCourse) => (
      Number(Boolean(preferences[secondCourse.id]?.starred)) -
      Number(Boolean(preferences[firstCourse.id]?.starred))
    ))
    .map((course) => {
      const coursePreferences = preferences[course.id] ?? {};
      const originalCourseCode = course.courseCode?.trim() || course.id;
      const sections = createLectureSectionsSummary(coursePreferences);
      const displayName = coursePreferences.friendlyName?.trim() || course.name;
      const semester = getCanvasCourseSemester(course, preferences, fallbackSemester);

      return {
        id: course.id,
        label: coursePreferences.friendlyCourseCode?.trim() || originalCourseCode,
        value: sections ? `${displayName} · ${sections}` : displayName,
        canvasCourseId: course.id,
        chipColor: coursePreferences.chipColor ?? defaultCourseChipColor,
        courseName: course.name,
        friendlyCourseCode: coursePreferences.friendlyCourseCode,
        friendlyName: coursePreferences.friendlyName,
        isStarred: Boolean(coursePreferences.starred),
        lectureKey: `canvas:${course.id}`,
        lectureSource: 'canvas',
        originalCourseCode: coursePreferences.originalCourseCode?.trim() || originalCourseCode,
        semester,
      };
    });
}

function createStoredCanvasLectureRows(
  preferences: CanvasLecturePreferences,
  liveCourses: CanvasCourse[] | null,
  fallbackSemester = defaultAcademySemester,
): RenderableDashboardRow[] {
  const liveCourseIds = new Set((liveCourses ?? []).map((course) => String(course.id ?? '')));

  return Object.entries(preferences)
    .filter(([courseId, preference]) => (
      !liveCourseIds.has(courseId) &&
      !preference.hidden &&
      !preference.deleted &&
      Boolean(
        preference.friendlyCourseCode?.trim() ||
        preference.originalCourseCode?.trim() ||
        preference.friendlyName?.trim() ||
        preference.courseName?.trim()
      )
    ))
    .map(([courseId, preference]) => {
      const originalCourseCode = preference.originalCourseCode?.trim() || preference.friendlyCourseCode?.trim() || courseId;
      const displayName = preference.friendlyName?.trim() || preference.courseName?.trim() || originalCourseCode;
      const sections = createLectureSectionsSummary(preference);
      const semester = normalizeSemesterName(preference.semester ?? preference.termName, fallbackSemester);

      return {
        id: `stored-canvas:${courseId}`,
        label: preference.friendlyCourseCode?.trim() || originalCourseCode,
        value: sections ? `${displayName} · ${sections}` : displayName,
        canvasCourseId: courseId,
        chipColor: preference.chipColor ?? defaultCourseChipColor,
        courseName: preference.courseName,
        friendlyCourseCode: preference.friendlyCourseCode,
        friendlyName: preference.friendlyName,
        href: preference.htmlUrl,
        isArchivedCanvasItem: true,
        isStarred: Boolean(preference.starred),
        lectureKey: `canvas:${courseId}`,
        lectureSource: 'canvas' as const,
        originalCourseCode,
        semester,
      };
    });
}

function isGeneratedArchivedCanvasLectureForAccessibleCourse(
  lecture: ManualLecture,
  preferences: CanvasLecturePreferences,
  courses: CanvasCourse[] | null,
) {
  const archivedCourseId = Object.entries(preferences).find(([, preference]) => (
    preference.archivedAsManualLectureId === lecture.id
  ))?.[0];

  return Boolean(archivedCourseId && courses?.some((course) => (
    course.id === archivedCourseId && course.accessClosed !== true
  )));
}

function isGeneratedConvertedCanvasLectureForAccessibleCourse(
  lecture: ManualLecture,
  courses: CanvasCourse[] | null,
) {
  return Boolean(courses?.some((course) => (
    course.accessClosed !== true && lecture.id === `manual-canvas-${course.id}`
  )));
}

function isConvertedCanvasCourseCurrentlyAccessible(
  courseId: string | undefined,
  preferences: CanvasLecturePreferences,
  courses: CanvasCourse[] | null,
) {
  return Boolean(
    courseId &&
    preferences[courseId]?.convertedToManualAt &&
    courses?.some((course) => course.id === courseId && course.accessClosed !== true),
  );
}

function isRetainedFromAccessibleCanvasCourse(
  item: Pick<ManualCourseworkItem | ManualAssessmentItem, 'retainedFromCanvasCourseId'>,
  courses: CanvasCourse[] | null,
) {
  return Boolean(item.retainedFromCanvasCourseId && courses?.some((course) => (
    course.id === item.retainedFromCanvasCourseId && course.accessClosed !== true
  )));
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

function getDateLocale(language: string) {
  return language === 'ko' ? 'ko-KR' : 'en-CA';
}

function formatCourseworkDue(value?: string, locale = 'en-CA') {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString(locale, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  });
}

function getCourseworkDueState(value?: string, isCompleted = false): CourseworkDueState {
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

function compareCourseworkDueDates(firstRow: RenderableDashboardRow, secondRow: RenderableDashboardRow) {
  const firstTime = firstRow.dueAt ? new Date(firstRow.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const secondTime = secondRow.dueAt ? new Date(secondRow.dueAt).getTime() : Number.POSITIVE_INFINITY;

  return firstTime - secondTime;
}

function compareCourseworkCompletionThenDue(firstRow: RenderableDashboardRow, secondRow: RenderableDashboardRow) {
  if (Boolean(firstRow.isCompleted) !== Boolean(secondRow.isCompleted)) {
    return firstRow.isCompleted ? -1 : 1;
  }

  return compareCourseworkDueDates(firstRow, secondRow);
}

function getValidDateTime(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function shouldShowCourseworkItem(
  dueAt?: string,
  isCompleted = false,
  completedAt?: string,
  hideSettings = defaultCourseworkHideSettings,
) {
  if (!dueAt) {
    return true;
  }

  const dueDate = getValidDateTime(dueAt);

  if (!dueDate) {
    return true;
  }

  if (isCompleted) {
    const hideAfterMs = Math.max(hideSettings.completedAfterHours, 0) * 60 * 60 * 1000;
    const referenceDate = hideSettings.completedFrom === 'completedAt'
      ? getValidDateTime(completedAt) ?? dueDate
      : dueDate;

    return Date.now() - referenceDate.getTime() <= hideAfterMs;
  }

  const elapsedSinceDue = Date.now() - dueDate.getTime();

  if (elapsedSinceDue <= 0) {
    return true;
  }

  const hideAfterMs = Math.max(hideSettings.uncompletedAfterHours, 0) * 60 * 60 * 1000;

  return elapsedSinceDue <= hideAfterMs;
}

function formatSubmissionType(value?: string) {
  if (!value) {
    return '';
  }

  return value
    .split(/[\s,_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatCourseworkType(value?: string) {
  return formatSubmissionType(value);
}

function getFutureDateString(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);

  return date.toISOString().slice(0, 10);
}

function getPastDateString(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);

  return date.toISOString().slice(0, 10);
}

function isCourseworkCanvasItem(item: CanvasCalendarItem) {
  const title = item.title.toLowerCase();
  const type = item.type.toLowerCase();
  const isAssessment = ['quiz', 'exam', 'midterm', 'final'].some((assessmentType) => (
    type.includes(assessmentType) || title.includes(assessmentType)
  ));

  return !isAssessment && Boolean(item.dueAt || item.startAt);
}

function isAssessmentCanvasItem(item: CanvasCalendarItem) {
  const title = item.title.toLowerCase();
  const type = item.type.toLowerCase();

  return Boolean(item.dueAt || item.startAt) &&
    ['quiz', 'exam', 'midterm', 'final'].some((assessmentType) => (
      type.includes(assessmentType) || title.includes(assessmentType)
    ));
}

function getEffectiveCanvasSubmissionStatus(
  item: Pick<CanvasCalendarItem, 'isSubmitted' | 'submittedAt'>,
  preference: CanvasSubmissionPreference,
) {
  const isSubmitted = typeof preference.isSubmitted === 'boolean'
    ? preference.isSubmitted
    : Boolean(item.isSubmitted);

  return {
    isSubmitted,
    submittedAt: isSubmitted
      ? preference.submittedAt ?? item.submittedAt
      : undefined,
  };
}

function createCanvasAssessmentRows(
  items: CanvasCalendarItem[],
  preferences: CanvasAssessmentPreferences,
  lecturePreferences: CanvasLecturePreferences,
  manualLectures: ManualLecture[],
  locale: string,
  canvasCourses: CanvasCourse[] | null,
  selectedSemester: string | undefined,
  fallbackSemester: string,
  hideSettings: CourseworkHideSettings,
): RenderableDashboardRow[] {
  return items
    .filter(isAssessmentCanvasItem)
    .filter((item) => {
      const itemPreferences = preferences[item.id] ?? {};

      if (isManuallyManagedCanvasCourse(item.courseId, lecturePreferences)) {
        return false;
      }

      const dueAt = item.dueAt || item.startAt;
      const submissionStatus = getEffectiveCanvasSubmissionStatus(item, itemPreferences);
      const semester = getCanvasItemSemester(
        item,
        itemPreferences,
        canvasCourses,
        lecturePreferences,
        fallbackSemester,
      );

      const restoreAccessibleConversion = isConvertedCanvasCourseCurrentlyAccessible(
        item.courseId,
        lecturePreferences,
        canvasCourses,
      );

      return (restoreAccessibleConversion || !itemPreferences.hidden) &&
        semesterMatches(semester, selectedSemester, fallbackSemester) &&
        shouldShowCourseworkItem(
          dueAt,
          submissionStatus.isSubmitted || Boolean(itemPreferences.completed),
          submissionStatus.submittedAt ?? itemPreferences.completedAt,
          hideSettings,
        );
    })
    .sort((firstItem, secondItem) => (
      new Date(firstItem.dueAt ?? firstItem.startAt ?? 0).getTime() -
      new Date(secondItem.dueAt ?? secondItem.startAt ?? 0).getTime()
    ))
    .map((item) => {
      const itemPreferences = preferences[item.id] ?? {};
      const coursePreferences = item.courseId ? lecturePreferences[item.courseId] : undefined;
      const courseCode =
        coursePreferences?.friendlyCourseCode?.trim() ||
        item.courseCode?.trim() ||
        item.contextCode?.replace(/^course_/i, '') ||
        'Canvas';
      const dueAt = item.dueAt || item.startAt;
      const assessmentType = itemPreferences.assessmentType || item.type;
      const { isSubmitted: isCanvasSubmitted } = getEffectiveCanvasSubmissionStatus(item, itemPreferences);
      const isCompleted = isCanvasSubmitted || Boolean(itemPreferences.completed);
      const semester = getCanvasItemSemester(
        item,
        itemPreferences,
        canvasCourses,
        lecturePreferences,
        fallbackSemester,
      );

      return {
        id: item.id,
        label: coursePreferences?.friendlyCourseCode?.trim() ||
          getFriendlyCourseCodeForCode(courseCode, manualLectures, lecturePreferences) ||
          courseCode,
        value: itemPreferences.title?.trim() || item.title,
        assessmentKey: `canvas:${item.id}`,
        assessmentSource: 'canvas',
        assessmentType: formatCourseworkType(assessmentType),
        canvasAssessmentId: item.id,
        canvasCourseId: item.courseId,
        chipColor: coursePreferences?.chipColor ??
          getCourseChipColorForCode(courseCode, manualLectures, lecturePreferences),
        description: formatCourseworkDue(dueAt, locale),
        dueState: getCourseworkDueState(dueAt, isCompleted),
        dueAt,
        href: item.htmlUrl,
        isCanvasSubmitted,
        isArchivedCanvasItem: false,
        isCompleted,
        isStarred: Boolean(itemPreferences.starred),
        originalCourseCode: item.courseCode,
        semester,
      };
    });
}

function createManualAssessmentRows(
  items: ManualAssessmentItem[],
  manualLectures: ManualLecture[],
  canvasPreferences: CanvasLecturePreferences,
  locale: string,
  selectedSemester: string | undefined,
  fallbackSemester: string,
  hideSettings: CourseworkHideSettings,
): RenderableDashboardRow[] {
  return items
    .filter((item) => (
      !item.hidden &&
      semesterMatches(item.semester, selectedSemester, fallbackSemester) &&
      shouldShowCourseworkItem(item.dueAt, Boolean(item.completed), item.completedAt, hideSettings)
    ))
    .sort((firstItem, secondItem) => (
      new Date(firstItem.dueAt || 0).getTime() - new Date(secondItem.dueAt || 0).getTime()
    ))
    .map((item) => ({
      id: item.id,
      label: getFriendlyCourseCodeForCode(item.courseCode, manualLectures, canvasPreferences) ||
        item.courseCode,
      value: item.title,
      assessmentKey: `manual:${item.id}`,
      assessmentSource: 'manual',
      assessmentType: formatCourseworkType(item.assessmentType),
      chipColor: getCourseChipColorForCode(item.courseCode, manualLectures, canvasPreferences),
      description: formatCourseworkDue(item.dueAt, locale),
      dueState: getCourseworkDueState(item.dueAt, Boolean(item.completed)),
      dueAt: item.dueAt,
      isCompleted: Boolean(item.completed),
      isStarred: Boolean(item.starred),
      manualAssessmentId: item.id,
      originalCourseCode: item.courseCode,
      semester: normalizeSemesterName(item.semester, fallbackSemester),
    }));
}

function createCanvasCourseworkRows(
  items: CanvasCalendarItem[],
  preferences: CanvasCourseworkPreferences,
  lecturePreferences: CanvasLecturePreferences,
  manualLectures: ManualLecture[],
  locale: string,
  canvasCourses: CanvasCourse[] | null,
  selectedSemester: string | undefined,
  fallbackSemester: string,
  hideSettings: CourseworkHideSettings,
): RenderableDashboardRow[] {
  return items
    .filter(isCourseworkCanvasItem)
    .filter((item) => {
      const itemPreferences = preferences[item.id] ?? {};

      if (isManuallyManagedCanvasCourse(item.courseId, lecturePreferences)) {
        return false;
      }

      const dueAt = item.dueAt || item.startAt;
      const submissionStatus = getEffectiveCanvasSubmissionStatus(item, itemPreferences);
      const semester = getCanvasItemSemester(
        item,
        itemPreferences,
        canvasCourses,
        lecturePreferences,
        fallbackSemester,
      );

      const restoreAccessibleConversion = isConvertedCanvasCourseCurrentlyAccessible(
        item.courseId,
        lecturePreferences,
        canvasCourses,
      );

      return (restoreAccessibleConversion || !itemPreferences.hidden) &&
        semesterMatches(semester, selectedSemester, fallbackSemester) &&
        shouldShowCourseworkItem(
          dueAt,
          submissionStatus.isSubmitted || Boolean(itemPreferences.completed),
          submissionStatus.submittedAt ?? itemPreferences.completedAt,
          hideSettings,
        );
    })
    .sort((firstItem, secondItem) => (
      new Date(firstItem.dueAt ?? firstItem.startAt ?? 0).getTime() -
      new Date(secondItem.dueAt ?? secondItem.startAt ?? 0).getTime()
    ))
    .map((item) => {
      const itemPreferences = preferences[item.id] ?? {};
      const coursePreferences = item.courseId ? lecturePreferences[item.courseId] : undefined;
      const courseCode =
        itemPreferences.courseCode?.trim() ||
        coursePreferences?.friendlyCourseCode?.trim() ||
        item.courseCode?.trim() ||
        item.contextCode?.replace(/^course_/i, '') ||
        'Canvas';
      const dueAt = item.dueAt || item.startAt;
      const courseworkType = itemPreferences.courseworkType || item.type;
      const { isSubmitted: isCanvasSubmitted } = getEffectiveCanvasSubmissionStatus(item, itemPreferences);
      const isCompleted = isCanvasSubmitted || Boolean(itemPreferences.completed);
      const submissionType =
        formatSubmissionType(itemPreferences.submissionType?.trim()) ||
        item.submissionTypes?.map(formatSubmissionType).filter(Boolean).join(', ') ||
        formatSubmissionType(item.type);
      const semester = getCanvasItemSemester(
        item,
        itemPreferences,
        canvasCourses,
        lecturePreferences,
        fallbackSemester,
      );

      return {
        id: item.id,
        label: coursePreferences?.friendlyCourseCode?.trim() ||
          getFriendlyCourseCodeForCode(courseCode, manualLectures, lecturePreferences) ||
          courseCode,
        value: itemPreferences.title?.trim() || item.title,
        canvasCourseId: item.courseId,
        canvasCourseworkId: item.id,
        chipColor: coursePreferences?.chipColor ??
          getCourseChipColorForCode(courseCode, manualLectures, lecturePreferences),
        courseworkType: formatCourseworkType(courseworkType),
        courseworkKey: `canvas:${item.id}`,
        courseworkSource: 'canvas',
        description: formatCourseworkDue(dueAt, locale),
        dueState: getCourseworkDueState(dueAt, isCompleted),
        dueAt,
        href: item.htmlUrl,
        isCanvasSubmitted,
        isArchivedCanvasItem: false,
        isCompleted,
        isStarred: Boolean(itemPreferences.starred),
        originalCourseCode: item.courseCode,
        semester,
        submissionType,
      };
    });
}

function createManualCourseworkRows(
  items: ManualCourseworkItem[],
  manualLectures: ManualLecture[],
  canvasPreferences: CanvasLecturePreferences,
  locale: string,
  selectedSemester: string | undefined,
  fallbackSemester: string,
  hideSettings: CourseworkHideSettings,
): RenderableDashboardRow[] {
  return items
    .filter((item) => (
      !item.hidden &&
      semesterMatches(item.semester, selectedSemester, fallbackSemester) &&
      shouldShowCourseworkItem(item.dueAt, Boolean(item.completed), item.completedAt, hideSettings)
    ))
    .sort((firstItem, secondItem) => (
      new Date(firstItem.dueAt || 0).getTime() - new Date(secondItem.dueAt || 0).getTime()
    ))
    .map((item) => ({
      id: item.id,
      label: getFriendlyCourseCodeForCode(item.courseCode, manualLectures, canvasPreferences) ||
        item.courseCode,
      value: item.title,
      chipColor: getCourseChipColorForCode(item.courseCode, manualLectures, canvasPreferences),
      courseworkType: formatCourseworkType(item.courseworkType),
      courseworkKey: `manual:${item.id}`,
      courseworkSource: 'manual',
      description: formatCourseworkDue(item.dueAt, locale),
      dueState: getCourseworkDueState(item.dueAt, Boolean(item.completed)),
      dueAt: item.dueAt,
      isCompleted: Boolean(item.completed),
      isStarred: Boolean(item.starred),
      manualCourseworkId: item.id,
      originalCourseCode: item.courseCode,
      semester: normalizeSemesterName(item.semester, fallbackSemester),
      submissionType: formatSubmissionType(item.submissionType),
    }));
}

function createStoredCanvasCourseworkRows(
  preferences: CanvasCourseworkPreferences,
  currentItemIds: Set<string>,
  lecturePreferences: CanvasLecturePreferences,
  manualLectures: ManualLecture[],
  locale: string,
  selectedSemester: string | undefined,
  fallbackSemester: string,
  hideSettings: CourseworkHideSettings,
): RenderableDashboardRow[] {
  return Object.entries(preferences)
    .filter(([itemId, preference]) => {
      const dateValue = preference.dueAt ?? preference.startAt ?? preference.endAt;

      return !currentItemIds.has(itemId) &&
        !preference.hidden &&
        Boolean(preference.title?.trim()) &&
        semesterMatches(preference.semester, selectedSemester, fallbackSemester) &&
        shouldShowCourseworkItem(
          dateValue,
          Boolean(preference.isSubmitted) || Boolean(preference.completed),
          preference.submittedAt ?? preference.completedAt,
          hideSettings,
        );
    })
    .sort(([, firstPreference], [, secondPreference]) => (
      new Date(firstPreference.dueAt ?? firstPreference.startAt ?? firstPreference.endAt ?? 0).getTime() -
      new Date(secondPreference.dueAt ?? secondPreference.startAt ?? secondPreference.endAt ?? 0).getTime()
    ))
    .map(([itemId, preference]) => {
      const coursePreferences = preference.courseId ? lecturePreferences[preference.courseId] : undefined;
      const courseCode = preference.courseCode?.trim() || preference.originalCourseCode?.trim() || '';
      const isCompleted = Boolean(preference.isSubmitted) || Boolean(preference.completed);
      const dateValue = preference.dueAt ?? preference.startAt ?? preference.endAt;

      return {
        id: itemId,
        label: coursePreferences?.friendlyCourseCode?.trim() ||
          getFriendlyCourseCodeForCode(courseCode, manualLectures, lecturePreferences) ||
          courseCode,
        value: preference.title?.trim() || '',
        canvasCourseId: preference.courseId,
        canvasCourseworkId: itemId,
        chipColor: coursePreferences?.chipColor ??
          getCourseChipColorForCode(courseCode, manualLectures, lecturePreferences),
        courseworkKey: `canvas:${itemId}`,
        courseworkSource: 'canvas',
        courseworkType: formatCourseworkType(preference.courseworkType),
        description: formatCourseworkDue(dateValue, locale),
        dueAt: dateValue,
        dueState: getCourseworkDueState(dateValue, isCompleted),
        href: preference.htmlUrl,
        isCanvasSubmitted: Boolean(preference.isSubmitted),
        isArchivedCanvasItem: true,
        isCompleted,
        isStarred: Boolean(preference.starred),
        originalCourseCode: preference.originalCourseCode ?? preference.courseCode,
        semester: normalizeSemesterName(preference.semester, fallbackSemester),
        submissionType: formatSubmissionType(preference.submissionType),
      };
    });
}

function createStoredCanvasAssessmentRows(
  preferences: CanvasAssessmentPreferences,
  currentItemIds: Set<string>,
  lecturePreferences: CanvasLecturePreferences,
  manualLectures: ManualLecture[],
  locale: string,
  selectedSemester: string | undefined,
  fallbackSemester: string,
  hideSettings: CourseworkHideSettings,
): RenderableDashboardRow[] {
  return Object.entries(preferences)
    .filter(([itemId, preference]) => {
      const dateValue = preference.dueAt ?? preference.startAt ?? preference.endAt;

      return !currentItemIds.has(itemId) &&
        !preference.hidden &&
        Boolean(preference.title?.trim()) &&
        semesterMatches(preference.semester, selectedSemester, fallbackSemester) &&
        shouldShowCourseworkItem(
          dateValue,
          Boolean(preference.isSubmitted) || Boolean(preference.completed),
          preference.submittedAt ?? preference.completedAt,
          hideSettings,
        );
    })
    .sort(([, firstPreference], [, secondPreference]) => (
      new Date(firstPreference.dueAt ?? firstPreference.startAt ?? firstPreference.endAt ?? 0).getTime() -
      new Date(secondPreference.dueAt ?? secondPreference.startAt ?? secondPreference.endAt ?? 0).getTime()
    ))
    .map(([itemId, preference]) => {
      const coursePreferences = preference.courseId ? lecturePreferences[preference.courseId] : undefined;
      const courseCode = preference.courseCode?.trim() || preference.originalCourseCode?.trim() || '';
      const isCompleted = Boolean(preference.isSubmitted) || Boolean(preference.completed);
      const dateValue = preference.dueAt ?? preference.startAt ?? preference.endAt;

      return {
        id: itemId,
        label: coursePreferences?.friendlyCourseCode?.trim() ||
          getFriendlyCourseCodeForCode(courseCode, manualLectures, lecturePreferences) ||
          courseCode,
        value: preference.title?.trim() || '',
        assessmentKey: `canvas:${itemId}`,
        assessmentSource: 'canvas',
        assessmentType: formatCourseworkType(preference.assessmentType),
        canvasAssessmentId: itemId,
        canvasCourseId: preference.courseId,
        chipColor: coursePreferences?.chipColor ??
          getCourseChipColorForCode(courseCode, manualLectures, lecturePreferences),
        description: formatCourseworkDue(dateValue, locale),
        dueAt: dateValue,
        dueState: getCourseworkDueState(dateValue, isCompleted),
        href: preference.htmlUrl,
        isCanvasSubmitted: Boolean(preference.isSubmitted),
        isArchivedCanvasItem: true,
        isCompleted,
        isStarred: Boolean(preference.starred),
        originalCourseCode: preference.originalCourseCode ?? preference.courseCode,
        semester: normalizeSemesterName(preference.semester, fallbackSemester),
      };
    });
}

function createLoadingRows(label: string): RenderableDashboardRow[] {
  return [{ id: 'loading', label: '', value: label }];
}

function createMessageRows(message: string): RenderableDashboardRow[] {
  return [{ id: 'message', label: '', value: message }];
}

function getDefaultCourseworkDueAt() {
  const dueDate = new Date();
  dueDate.setHours(23, 59, 0, 0);

  return dueDate.toISOString();
}

function getCourseworkDueAtForTargetDay(target: 'today' | 'tomorrow') {
  const dueDate = new Date();

  if (target === 'tomorrow') {
    dueDate.setDate(dueDate.getDate() + 1);
  }

  dueDate.setHours(23, 59, 0, 0);

  return dueDate.toISOString();
}

function getVisibleManualLectures(lectures: ManualLecture[]) {
  return lectures
    .filter((lecture) => !lecture.hidden && !lecture.deleted)
    .sort((firstLecture, secondLecture) => Number(Boolean(secondLecture.starred)) - Number(Boolean(firstLecture.starred)));
}

function getManualLectureLinkUrl(lecture: ManualLecture, linkId: string) {
  const url = lecture.links.find((link) => link.id === linkId)?.url.trim();

  if (!url) {
    return undefined;
  }

  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function createManualLectureRows(lectures: ManualLecture[]): RenderableDashboardRow[] {
  return lectures.map((lecture) => {
    const sections = createLectureSectionsSummary(lecture);

    return {
      id: lecture.id,
      label: lecture.friendlyCourseCode || lecture.code || 'Manual',
      value: sections
        ? `${lecture.friendlyName || lecture.name} · ${sections}`
        : lecture.friendlyName || lecture.name,
      chipColor: lecture.chipColor ?? defaultCourseChipColor,
      courseName: lecture.name,
      friendlyCourseCode: lecture.friendlyCourseCode,
      friendlyName: lecture.friendlyName,
      isStarred: Boolean(lecture.starred),
      lectureKey: `manual:${lecture.id}`,
      lectureSource: 'manual',
      manualLectureId: lecture.id,
      originalCourseCode: lecture.code || 'Manual',
      semester: normalizeSemesterName((lecture as ManualLecture & { semester?: string }).semester),
    };
  });
}

function getArchivedCanvasLectureId(courseId: string) {
  const safeCourseId = courseId.replace(/[^A-Za-z0-9_-]+/g, '-');

  return `archived-canvas-${safeCourseId}`;
}

function createArchivedManualLectureFromCanvasPreference(
  courseId: string,
  preference: CanvasLecturePreferences[string],
  fallbackSemester: string,
): ManualLecture | null {
  const courseCode = preference.friendlyCourseCode?.trim() ||
    preference.originalCourseCode?.trim() ||
    courseId;
  const courseName = preference.friendlyName?.trim() ||
    preference.courseName?.trim() ||
    courseCode;

  if (!courseCode && !courseName) {
    return null;
  }

  const archivedLectureId = preference.archivedAsManualLectureId || getArchivedCanvasLectureId(courseId);
  const links = [...(preference.links ?? [])];

  if (preference.htmlUrl && !links.some((link) => link.url === preference.htmlUrl)) {
    links.unshift({
      id: `${archivedLectureId}-canvas-link`,
      label: 'Canvas course',
      url: preference.htmlUrl,
    });
  }

  return {
    id: archivedLectureId,
    name: courseName,
    code: courseCode,
    lectureSection: preference.lectureSection ?? '',
    labSection: preference.labSection ?? '',
    tutorialSection: preference.tutorialSection ?? '',
    credits: preference.credits ?? '',
    assessments: preference.assessments ?? [],
    schedule: preference.schedule ?? {
      deliveryMode: 'inPerson',
      day: '',
      time: '',
      location: '',
      entries: [],
    },
    links,
    chipColor: preference.chipColor ?? defaultCourseChipColor,
    deleted: preference.deleted,
    friendlyCourseCode: preference.friendlyCourseCode,
    friendlyName: preference.friendlyName,
    hidden: preference.hidden,
    semester: normalizeSemesterName(preference.semester ?? preference.termName, fallbackSemester),
    starred: preference.starred,
  };
}

function getStoredAcademyCalendarSettings() {
  return academyCalendarSettingsCache;
}

function cacheAcademyCalendarSettings(settings: unknown, options: { protect?: boolean; source?: 'local' | 'server' } = {}) {
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const nextSettings = settings as Record<string, unknown>;
    const mergedSettings = {
      ...academyCalendarSettingsCache,
      ...nextSettings,
    };
    const isProtectedServerSnapshot =
      options.source === 'server' &&
      Date.now() < academyCalendarSettingsProtectedUntil &&
      JSON.stringify(mergedSettings) !== JSON.stringify(academyCalendarSettingsCache);

    if (isProtectedServerSnapshot) {
      return;
    }

    academyCalendarSettingsCache = mergedSettings;
    if (options.protect) {
      academyCalendarSettingsProtectedUntil = Date.now() + academyCalendarSettingsProtectionMs;
    }
  }
}

function getSelectedSemesterFromSettings(settings: unknown) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return undefined;
  }

  const selectedSemester = (settings as { selectedSemester?: unknown }).selectedSemester;

  return typeof selectedSemester === 'string'
    ? normalizeSemesterName(selectedSemester)
    : undefined;
}

function getLastCanvasTermNameFromSettings(settings: unknown) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return undefined;
  }

  const lastCanvasTermName = (settings as { lastCanvasTermName?: unknown }).lastCanvasTermName;

  return typeof lastCanvasTermName === 'string'
    ? normalizeCanvasSemesterName(lastCanvasTermName)
    : undefined;
}

function storeAcademyCalendarSettingsPatch(patch: Record<string, unknown>) {
  cacheAcademyCalendarSettings({
    ...academyCalendarSettingsCache,
    ...patch,
  }, { protect: true });

  return academyCalendarSettingsCache;
}

function storeSelectedAcademySemester(semester: string) {
  const selectedSemester = normalizeSemesterName(semester);

  storeAcademyCalendarSettingsPatch({
    selectedSemester,
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(academyPreferencesUpdatedEvent, {
      detail: {
        calendarSettings: { selectedSemester },
      },
    }));
  }
}

function storeCanvasTermSelection(semester: string) {
  return storeAcademyCalendarSettingsPatch({
    lastCanvasTermName: semester,
    selectedSemester: semester,
  });
}

function cacheAcademyPreferences(
  lectures: ManualLecture[],
  preferences: CanvasLecturePreferences,
  coursework: ManualCourseworkItem[],
  courseworkPreferences: CanvasCourseworkPreferences,
  assessments: ManualAssessmentItem[],
  assessmentPreferences: CanvasAssessmentPreferences,
  calendarSettings: Record<string, unknown> = getStoredAcademyCalendarSettings(),
  options: { emitCalendarSettings?: boolean } = {},
) {
  if (typeof window === 'undefined') {
    return;
  }

  cacheAcademyCalendarSettings(calendarSettings);
  clearLegacyAcademyPreferenceStorage();
  const detail = {
    canvasAssessmentPreferences: assessmentPreferences,
    canvasCourseworkPreferences: courseworkPreferences,
    canvasLecturePreferences: preferences,
    manualAssessments: assessments,
    manualCoursework: coursework,
    manualLectures: lectures,
    ...(options.emitCalendarSettings === false ? {} : {
      calendarSettings: getStoredAcademyCalendarSettings(),
    }),
  };

  window.dispatchEvent(new CustomEvent(academyPreferencesUpdatedEvent, {
    detail,
  }));
}

function clearLegacyAcademyPreferenceStorage() {
  if (typeof window === 'undefined') {
    return;
  }

  [
    manualLecturesStorageKey,
    canvasLecturePreferencesStorageKey,
    manualCourseworkStorageKey,
    canvasCourseworkPreferencesStorageKey,
    manualAssessmentsStorageKey,
    canvasAssessmentPreferencesStorageKey,
    academyCalendarSettingsStorageKey,
  ].forEach((storageKey) => {
    window.localStorage.removeItem(storageKey);
  });
}

function getAcademyPreferenceValues(preferences: AcademyPreferences) {
  return {
    canvasAssessmentPreferences: isCanvasAssessmentPreferences(preferences.canvasAssessmentPreferences)
      ? preferences.canvasAssessmentPreferences
      : {},
    canvasCourseworkPreferences: isCanvasCourseworkPreferences(preferences.canvasCourseworkPreferences)
      ? preferences.canvasCourseworkPreferences
      : {},
    canvasLecturePreferences: isCanvasLecturePreferences(preferences.canvasLecturePreferences)
      ? preferences.canvasLecturePreferences
      : {},
    manualAssessments: Array.isArray(preferences.manualAssessments)
      ? preferences.manualAssessments as ManualAssessmentItem[]
      : [],
    manualCoursework: Array.isArray(preferences.manualCoursework)
      ? preferences.manualCoursework as ManualCourseworkItem[]
      : [],
    manualLectures: Array.isArray(preferences.manualLectures)
      ? preferences.manualLectures as ManualLecture[]
      : [],
  };
}

function cacheAcademyPreferencesResponse(preferences: AcademyPreferences) {
  const values = getAcademyPreferenceValues(preferences);

  cacheAcademyCalendarSettings(preferences.calendarSettings, { source: 'server' });
  cacheAcademyPreferences(
    values.manualLectures,
    values.canvasLecturePreferences,
    values.manualCoursework,
    values.canvasCourseworkPreferences,
    values.manualAssessments,
    values.canvasAssessmentPreferences,
    getStoredAcademyCalendarSettings(),
    { emitCalendarSettings: false },
  );
}

type AcademyPreferenceValues = ReturnType<typeof getAcademyPreferenceValues>;

function persistAcademyPreferences(
  lectures: ManualLecture[],
  preferences: CanvasLecturePreferences,
  coursework: ManualCourseworkItem[],
  courseworkPreferences: CanvasCourseworkPreferences,
  assessments: ManualAssessmentItem[],
  assessmentPreferences: CanvasAssessmentPreferences,
  options: { calendarSettings?: Record<string, unknown> } = {},
) {
  const saveSequence = ++academyPreferencesSaveSequence;

  cacheAcademyPreferences(
    lectures,
    preferences,
    coursework,
    courseworkPreferences,
    assessments,
    assessmentPreferences,
    getStoredAcademyCalendarSettings(),
    { emitCalendarSettings: Boolean(options.calendarSettings) },
  );

  return saveAcademyPreferencesInOrder({
    manualLectures: lectures,
    canvasLecturePreferences: preferences,
    manualCoursework: coursework,
    canvasCourseworkPreferences: courseworkPreferences,
    manualAssessments: assessments,
    canvasAssessmentPreferences: assessmentPreferences,
    ...(options.calendarSettings ? { calendarSettings: options.calendarSettings } : {}),
  })
    .then((savedPreferences) => {
      if (saveSequence === academyPreferencesSaveSequence) {
        cacheAcademyPreferencesResponse(savedPreferences);
      }
    })
    .catch(() => undefined);
}

function persistAcademyPreferencePatch(patch: SaveAcademyPreferencesRequest) {
  const saveSequence = ++academyPreferencesSaveSequence;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(academyPreferencesUpdatedEvent, { detail: patch }));
  }

  void saveAcademyPreferencesInOrder(patch)
    .then((savedPreferences) => {
      if (saveSequence === academyPreferencesSaveSequence) {
        cacheAcademyPreferencesResponse(savedPreferences);
      }
    })
    .catch(() => undefined);
}

function saveAcademyPreferencesInOrder(request: SaveAcademyPreferencesRequest) {
  const requestScope = canvasToDoApi.getAcademyPreferenceRequestScope();
  const saveTask = academyPreferencesSaveQueue.then(() => (
    canvasToDoApi.saveAcademyPreferences(request, requestScope)
  ));

  academyPreferencesSaveQueue = saveTask.then(
    () => undefined,
    () => undefined,
  );

  return saveTask;
}

function isCanvasLecturePreferences(value: unknown): value is CanvasLecturePreferences {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCanvasCourseworkPreferences(value: unknown): value is CanvasCourseworkPreferences {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCanvasAssessmentPreferences(value: unknown): value is CanvasAssessmentPreferences {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCompleteAcademyPreferencePayload(value: unknown): value is AcademyPreferenceValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const preferences = value as Partial<AcademyPreferenceValues>;

  return (
    Array.isArray(preferences.manualLectures) &&
    isCanvasLecturePreferences(preferences.canvasLecturePreferences) &&
    Array.isArray(preferences.manualCoursework) &&
    isCanvasCourseworkPreferences(preferences.canvasCourseworkPreferences) &&
    Array.isArray(preferences.manualAssessments) &&
    isCanvasAssessmentPreferences(preferences.canvasAssessmentPreferences)
  );
}

function createCanvasEditableLecture(
  course: CanvasCourse,
  preference: CanvasLecturePreferences[string] | undefined,
): ManualLecture {
  return {
    id: `canvas:${course.id}`,
    name: preference?.friendlyName?.trim() || course.name,
    code: preference?.friendlyCourseCode?.trim() || course.courseCode?.trim() || course.id,
    lectureSection: preference?.lectureSection ?? '',
    labSection: preference?.labSection ?? '',
    tutorialSection: preference?.tutorialSection ?? '',
    credits: preference?.credits ?? '',
    assessments: preference?.assessments ?? [],
    schedule: preference?.schedule ?? {
      deliveryMode: 'inPerson',
      day: '',
      time: '',
      location: '',
      entries: [],
    },
    links: preference?.links ?? [],
    chipColor: preference?.chipColor ?? defaultCourseChipColor,
    friendlyCourseCode: preference?.friendlyCourseCode,
    friendlyName: preference?.friendlyName,
    hidden: preference?.hidden,
    starred: preference?.starred,
    semester: normalizeSemesterName(preference?.semester ?? preference?.termName ?? normalizeCanvasSemesterName(course.termName)),
  };
}

function getCourseworkCourseOptions(
  canvasCourses: CanvasCourse[] | null,
  canvasPreferences: CanvasLecturePreferences,
  manualLectures: ManualLecture[],
  selectedSemester: string | undefined,
  fallbackSemester: string,
  currentCourseCode?: string,
): CourseworkCourseOption[] {
  const optionMap = new Map<string, CourseworkCourseOption>();
  const addOption = (courseCode?: string, courseName?: string, semester?: string) => {
    const value = courseCode?.trim();

    if (!value || optionMap.has(value)) {
      return;
    }

    const normalizedSemester = normalizeSemesterName(semester, fallbackSemester);

    optionMap.set(value, {
      semester: normalizedSemester,
      value,
      label: courseName ? `${value} - ${courseName}` : value,
    });
  };

  canvasCourses?.forEach((course) => {
    const semester = getCanvasCourseSemester(course, canvasPreferences, fallbackSemester);
    const preferences = canvasPreferences[course.id] ?? {};

    if (preferences.hidden || preferences.deleted || !semesterMatches(semester, selectedSemester, fallbackSemester)) {
      return;
    }

    addOption(
      preferences.friendlyCourseCode || course.courseCode || course.id,
      preferences.friendlyName || course.name,
      semester,
    );
  });
  manualLectures.forEach((lecture) => {
    const semester = normalizeSemesterName((lecture as ManualLecture & { semester?: string }).semester, fallbackSemester);

    if (lecture.hidden || lecture.deleted || !semesterMatches(semester, selectedSemester, fallbackSemester)) {
      return;
    }

    addOption(
      lecture.friendlyCourseCode || lecture.code,
      lecture.friendlyName || lecture.name,
      semester,
    );
  });
  addOption(currentCourseCode, undefined, selectedSemester);

  return Array.from(optionMap.values()).sort((firstOption, secondOption) => (
    firstOption.value.localeCompare(secondOption.value)
  ));
}

function getCourseworkDueChipClass(state?: CourseworkDueState) {
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
    return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:border-emerald-300/45 dark:bg-emerald-300/10 dark:text-emerald-100';
  }

  return 'border-neutral-200 bg-neutral-100 text-neutral-600 dark:border-white/10 dark:bg-white/10 dark:text-muted-foreground';
}

type DashboardRefreshAge = 'unknown' | 'fresh' | 'recent' | 'stale';

const dashboardRefreshAgeClasses: Record<DashboardRefreshAge, string> = {
  unknown: 'border-border bg-background/90 text-muted-foreground hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
  fresh: 'border-border bg-background/90 text-muted-foreground hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
  recent: 'border-orange-500/60 bg-orange-500 text-white hover:bg-orange-400 dark:border-orange-300 dark:bg-orange-400 dark:text-orange-950',
  stale: 'border-red-500/60 bg-red-600 text-white hover:bg-red-500 dark:border-red-300 dark:bg-red-500',
};

function getDashboardRefreshAge(lastSuccessfulRefreshAt: number | null, now: number): DashboardRefreshAge {
  if (lastSuccessfulRefreshAt === null) {
    return 'unknown';
  }

  const ageMs = Math.max(0, now - lastSuccessfulRefreshAt);

  if (ageMs < dashboardRefreshFreshThresholdMs) {
    return 'fresh';
  }

  if (ageMs < dashboardRefreshRecentThresholdMs) {
    return 'recent';
  }

  return 'stale';
}

function getCurrentTimestamp() {
  return Date.now();
}

interface DashboardRowsProps {
  isPhone?: boolean;
  card: RenderableDashboardCard;
  compactCourseRows?: boolean;
  compactCourseworkRows?: boolean;
  focusedCourseworkKey?: string | null;
  onHideLecture: (row: RenderableDashboardRow) => void;
  onFinishCourseworkRename: () => void;
  onOpenAssessment: (row: RenderableDashboardRow) => void;
  onOpenCoursework: (row: RenderableDashboardRow) => void;
  onOpenCourseworkLink: (row: RenderableDashboardRow) => void;
  onOpenLecture: (row: RenderableDashboardRow) => void;
  onOpenLectureDetails: (row: RenderableDashboardRow) => void;
  onOpenLectureFriendlyName: (row: RenderableDashboardRow) => void;
  onRequestDeleteLecture: (row: RenderableDashboardRow) => void;
  onRenameCoursework: (row: RenderableDashboardRow, title: string) => void;
  onRemoveAssessment: (row: RenderableDashboardRow) => void;
  onRemoveCoursework: (row: RenderableDashboardRow) => void;
  onSetLectureChipColor: (row: RenderableDashboardRow, color: ColorToken) => void;
  onStartCourseworkRename: (row: RenderableDashboardRow) => void;
  onMoveAssessmentDueDate: (row: RenderableDashboardRow, target: 'today' | 'tomorrow') => void;
  onMoveCourseworkDueDate: (row: RenderableDashboardRow, target: 'today' | 'tomorrow') => void;
  onToggleAssessmentDone: (row: RenderableDashboardRow) => void;
  onToggleAssessmentStar: (row: RenderableDashboardRow) => void;
  onToggleCourseworkDone: (row: RenderableDashboardRow) => void;
  onToggleCourseworkStar: (row: RenderableDashboardRow) => void;
  onToggleLectureStar: (row: RenderableDashboardRow) => void;
}

function DashboardRows({
  isPhone = false,
  card,
  compactCourseRows = false,
  compactCourseworkRows = false,
  focusedCourseworkKey,
  onHideLecture,
  onFinishCourseworkRename,
  onOpenAssessment,
  onOpenCoursework,
  onOpenCourseworkLink,
  onOpenLecture,
  onOpenLectureDetails,
  onOpenLectureFriendlyName,
  onRequestDeleteLecture,
  onRenameCoursework,
  onRemoveAssessment,
  onRemoveCoursework,
  onSetLectureChipColor,
  onStartCourseworkRename,
  onMoveAssessmentDueDate,
  onMoveCourseworkDueDate,
  onToggleAssessmentDone,
  onToggleAssessmentStar,
  onToggleCourseworkDone,
  onToggleCourseworkStar,
  onToggleLectureStar,
}: DashboardRowsProps) {
  const { dictionary } = useLanguage();
  const courseworkLongPressTimeoutRef = useRef<number | null>(null);
  const courseworkLongPressTriggeredRef = useRef(false);
  const courseworkScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const resetCourseworkScrollAfterMoveRef = useRef(false);
  const suppressLectureOpenRef = useRef(false);
  const suppressLectureOpenTimeoutRef = useRef<number | null>(null);
  const [dropdownColorVariantPage, setDropdownColorVariantPage] = useState(0);
  const [contextColorVariantPage, setContextColorVariantPage] = useState(0);
  const rows = card.id === 'upcoming-coursework'
    ? card.rows
    : card.rows.slice(0, card.maxRows ?? card.rows.length);
  const rowOrderKey = rows.map((row) => row.courseworkKey ?? row.assessmentKey ?? row.id).join('|');
  const compactRowsMaxHeightClassName = 'max-h-64';
  const chipColorLabels: Partial<Record<ColorToken, string>> = {
    blue: dictionary.manualLectureChipColorBlue,
    sky: dictionary.manualLectureChipColorSky,
    cyan: dictionary.manualLectureChipColorCyan,
    green: dictionary.manualLectureChipColorGreen,
    indigo: dictionary.manualLectureChipColorIndigo,
    orange: dictionary.manualLectureChipColorOrange,
    red: dictionary.manualLectureChipColorRed,
    purple: dictionary.manualLectureChipColorPurple,
    violet: dictionary.manualLectureChipColorViolet,
    fuchsia: dictionary.manualLectureChipColorFuchsia,
    pink: dictionary.manualLectureChipColorPink,
    teal: dictionary.manualLectureChipColorTeal,
    gold: dictionary.manualLectureChipColorGold,
    slate: dictionary.manualLectureChipColorSlate,
    gray: dictionary.manualLectureChipColorGray,
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
  const touchMenuButtonClassName =
    'size-8 shrink-0 rounded-md border-border bg-background/80 text-muted-foreground hover:bg-muted hover:text-foreground';
  const stopTouchMenuPropagation = (event: MouseEvent | PointerEvent | TouchEvent) => {
    event.stopPropagation();
  };
  const suppressLectureOpenAfterColorSelect = () => {
    suppressLectureOpenRef.current = true;

    if (suppressLectureOpenTimeoutRef.current) {
      window.clearTimeout(suppressLectureOpenTimeoutRef.current);
    }

    suppressLectureOpenTimeoutRef.current = window.setTimeout(() => {
      suppressLectureOpenRef.current = false;
      suppressLectureOpenTimeoutRef.current = null;
    }, 700);
  };
  const isLectureOpenSuppressed = () => suppressLectureOpenRef.current;
  const runLectureAction = (action: () => void) => {
    suppressLectureOpenAfterColorSelect();
    action();
  };
  const selectLectureChipColor = (row: RenderableDashboardRow, color: ColorToken) => {
    suppressLectureOpenAfterColorSelect();
    onSetLectureChipColor(row, color);
  };
  const getCourseworkMoveTarget = (row: RenderableDashboardRow) => {
    if (row.isCanvasSubmitted || row.isCompleted || !row.dueAt) {
      return null;
    }

    if (isLiveCanvasDashboardRow(row)) {
      return null;
    }

    const dueDate = new Date(row.dueAt);

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
  };
  const confirmArchivedCanvasMove = (row: RenderableDashboardRow) => (
    !row.isArchivedCanvasItem ||
    window.confirm(dictionary.courseworkMoveArchivedCanvasConfirm)
  );
  const forceCourseworkListToTop = () => {
    if (courseworkScrollContainerRef.current) {
      courseworkScrollContainerRef.current.scrollTop = 0;
    }
  };
  const scheduleCourseworkListToTop = () => {
    resetCourseworkScrollAfterMoveRef.current = true;
    forceCourseworkListToTop();
    window.setTimeout(() => {
      forceCourseworkListToTop();
      window.requestAnimationFrame(() => {
        forceCourseworkListToTop();
        window.setTimeout(() => {
          forceCourseworkListToTop();
          resetCourseworkScrollAfterMoveRef.current = false;
        }, 80);
      });
    }, 0);
  };
  const scheduleCourseworkListToTopEvent = useEffectEvent(scheduleCourseworkListToTop);
  const handleCourseworkMenuCloseAutoFocus = (event: Event) => {
    if (!resetCourseworkScrollAfterMoveRef.current) {
      return;
    }

    event.preventDefault();
    window.requestAnimationFrame(forceCourseworkListToTop);
  };
  const moveCourseworkDueDate = (row: RenderableDashboardRow, target: 'today' | 'tomorrow') => {
    if (!confirmArchivedCanvasMove(row)) {
      return;
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    resetCourseworkScrollAfterMoveRef.current = true;
    onMoveCourseworkDueDate(row, target);
    scheduleCourseworkListToTop();
  };
  const moveAssessmentDueDate = (row: RenderableDashboardRow, target: 'today' | 'tomorrow') => {
    if (!confirmArchivedCanvasMove(row)) {
      return;
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    resetCourseworkScrollAfterMoveRef.current = true;
    onMoveAssessmentDueDate(row, target);
    scheduleCourseworkListToTop();
  };
  const clearCourseworkLongPress = () => {
    if (courseworkLongPressTimeoutRef.current) {
      window.clearTimeout(courseworkLongPressTimeoutRef.current);
      courseworkLongPressTimeoutRef.current = null;
    }
  };
  const isDashboardRowActionTarget = (target: EventTarget | null) => (
    target instanceof Element &&
      Boolean(target.closest('button,a,input,textarea,select,[role="menuitem"],[data-dashboard-row-action]'))
  );
  const renderColorVariantGrid = (
    row: RenderableDashboardRow,
    pageIndex: number,
    onPageChange: (pageIndex: number) => void,
  ) => {
    const colorPage = lectureChipColorVariantPages[pageIndex] ?? lectureChipColorVariantPages[0];
    const lastPageIndex = lectureChipColorVariantPages.length - 1;

    return (
      <div
        className="w-40"
        data-dashboard-row-action
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1 pb-1">
          <button
            aria-label={dictionary.manualLectureChipColorPrevious}
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-35"
            disabled={pageIndex === 0}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPageChange(Math.max(0, pageIndex - 1));
            }}
            type="button"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-[11px] font-black text-muted-foreground">
            {pageIndex + 1}/{lectureChipColorVariantPages.length}
          </span>
          <button
            aria-label={dictionary.manualLectureChipColorNext}
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-35"
            disabled={pageIndex === lastPageIndex}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPageChange(Math.min(lastPageIndex, pageIndex + 1));
            }}
            type="button"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1 p-1">
          {colorPage.map((color) => (
            <button
              aria-label={chipColorLabels[color] ?? color}
              className={cn(
                'grid size-8 place-items-center rounded-md transition-colors hover:bg-accent',
                row.chipColor === color && 'bg-accent',
              )}
              disabled={row.chipColor === color}
              key={color}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                selectLectureChipColor(row, color);
              }}
              type="button"
            >
              <span aria-hidden="true" className={cn('size-4 rounded-full', dotColorClasses[color])} />
            </button>
          ))}
        </div>
      </div>
    );
  };
  const startCourseworkRename = (row: RenderableDashboardRow) => {
    if (!row.courseworkKey && !row.assessmentKey) {
      return;
    }

    if (row.isCanvasSubmitted) {
      return;
    }

    onStartCourseworkRename(row);
  };
  const handleCourseworkPointerDown = (event: PointerEvent, row: RenderableDashboardRow) => {
    if (row.isCanvasSubmitted || isDashboardRowActionTarget(event.target)) {
      return;
    }

    clearCourseworkLongPress();
    courseworkLongPressTriggeredRef.current = false;
    courseworkLongPressTimeoutRef.current = window.setTimeout(() => {
      courseworkLongPressTriggeredRef.current = true;
      startCourseworkRename(row);
    }, 520);
  };

  useEffect(() => () => {
    clearCourseworkLongPress();

    if (suppressLectureOpenTimeoutRef.current) {
      window.clearTimeout(suppressLectureOpenTimeoutRef.current);
    }
  }, []);
  useEffect(() => {
    if (card.id !== 'upcoming-coursework' || !resetCourseworkScrollAfterMoveRef.current) {
      return;
    }

    scheduleCourseworkListToTopEvent();
  }, [card.id, rowOrderKey]);
  const renderTouchMenuTrigger = () => (
    <DropdownMenuTrigger asChild>
      <Button
        aria-label={dictionary.moreActions}
        className={cn(touchMenuButtonClassName, isPhone && 'size-9 rounded-lg')}
        data-dashboard-row-action
        onClick={stopTouchMenuPropagation}
        onMouseDown={stopTouchMenuPropagation}
        onPointerDown={stopTouchMenuPropagation}
        onPointerUp={stopTouchMenuPropagation}
        onTouchEnd={stopTouchMenuPropagation}
        onTouchStart={stopTouchMenuPropagation}
        size="icon-sm"
        title={dictionary.moreActions}
        type="button"
        variant="outline"
      >
        <MoreHorizontal className="size-4" />
      </Button>
    </DropdownMenuTrigger>
  );
  const renderLectureTouchMenu = (row: RenderableDashboardRow) => {
    if (!row.lectureKey) {
      return null;
    }

    return (
      <DropdownMenu>
        {renderTouchMenuTrigger()}
        <DropdownMenuContent
          align="end"
          className="w-56"
          data-dashboard-row-action
          onClick={(event) => event.stopPropagation()}
          onCloseAutoFocus={handleCourseworkMenuCloseAutoFocus}
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
        >
          <DropdownMenuItem onSelect={() => runLectureAction(() => onOpenLectureDetails(row))}>
            <BookOpen className="size-4" />
            <span>{dictionary.manualLectureOpenDetails}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => runLectureAction(() => onOpenLectureFriendlyName(row))}>
            <Pencil className="size-4" />
            <span>{dictionary.courseFriendlyNameSet}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => runLectureAction(() => onToggleLectureStar(row))}>
            <Star className={cn('size-4', row.isStarred && 'fill-amber-400 text-amber-500')} />
            <span>{row.isStarred ? dictionary.manualLectureUnstar : dictionary.manualLectureStar}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => runLectureAction(() => onHideLecture(row))}>
            <EyeOff className="size-4" />
            <span>{dictionary.manualLectureHide}</span>
          </DropdownMenuItem>
          {normalizeSemesterName(row.semester) === noTermSemester ? (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => runLectureAction(() => onRequestDeleteLecture(row))}
            >
              <Trash2 className="size-4" />
              <span>{dictionary.manualLectureDelete}</span>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-dashboard-row-action>
              <Palette className="size-4" />
              <span>{dictionary.manualLectureChipColor}</span>
              <ChevronRight className="ml-auto size-4 text-muted-foreground" />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent alignOffset={-4} className="w-56">
              {lectureChipColors.map((color) => (
                <DropdownMenuItem
                  data-dashboard-row-action
                  disabled={row.chipColor === color}
                  key={color}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onSelect={(event) => {
                    event.stopPropagation();
                    selectLectureChipColor(row, color);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={cn('size-3 rounded-full border border-foreground/10', dotColorClasses[color])}
                  />
                  <span>{chipColorLabels[color] ?? color}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-dashboard-row-action>
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-full"
                    style={{
                      background:
                        'conic-gradient(from 90deg, #ef4444, #f97316, #facc15, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)',
                    }}
                  />
                  <span>{dictionary.manualLectureChipColorOther}</span>
                  <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent alignOffset={-4} className="w-40">
                  {renderColorVariantGrid(row, dropdownColorVariantPage, setDropdownColorVariantPage)}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  const renderCourseworkTouchMenu = (row: RenderableDashboardRow) => {
    if (!row.courseworkKey) {
      return null;
    }

    const moveTarget = getCourseworkMoveTarget(row);

    return (
      <DropdownMenu>
        {renderTouchMenuTrigger()}
        <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={handleCourseworkMenuCloseAutoFocus}>
          <DropdownMenuItem onSelect={() => onOpenCourseworkLink(row)}>
            <ExternalLink className="size-4" />
            <span>{dictionary.courseOverviewOpenCanvas}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpenCoursework(row)}>
            <Pencil className="size-4" />
            <span>{dictionary.courseworkOpenDetails}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onToggleCourseworkStar(row)}>
            <Star className={cn('size-4', row.isStarred && 'fill-amber-400 text-amber-500')} />
            <span>{row.isStarred ? dictionary.courseworkUnstar : dictionary.courseworkStar}</span>
          </DropdownMenuItem>
          {moveTarget ? (
            <DropdownMenuItem onSelect={() => moveCourseworkDueDate(row, moveTarget)}>
              <CalendarPlus className="size-4" />
              <span>
                {moveTarget === 'today'
                  ? dictionary.courseworkDoToday
                  : dictionary.courseworkDoTomorrow}
              </span>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem disabled={row.isCanvasSubmitted} onSelect={() => onToggleCourseworkDone(row)}>
            <span
              aria-hidden="true"
              className={cn(
                'grid size-4 place-items-center rounded-[6px] border text-[9px] font-black',
                row.isCompleted ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
              )}
            >
              {row.isCompleted ? '✓' : ''}
            </span>
            <span>
              {row.isCanvasSubmitted
                ? dictionary.courseworkSubmittedInCanvas
                : row.isCompleted
                  ? dictionary.courseworkMarkNotDone
                  : dictionary.courseworkMarkDone}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onRemoveCoursework(row)}>
            {row.courseworkSource === 'manual' ? (
              <Trash2 className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
            <span>
              {row.courseworkSource === 'manual'
                ? dictionary.courseworkDelete
                : dictionary.courseworkHideCanvas}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  const renderAssessmentTouchMenu = (row: RenderableDashboardRow) => {
    if (!row.assessmentKey) {
      return null;
    }

    const moveTarget = getCourseworkMoveTarget(row);

    return (
      <DropdownMenu>
        {renderTouchMenuTrigger()}
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => onOpenCourseworkLink(row)}>
            <ExternalLink className="size-4" />
            <span>{dictionary.courseOverviewOpenCanvas}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpenAssessment(row)}>
            <Pencil className="size-4" />
            <span>{dictionary.assessmentOpenDetails}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onToggleAssessmentStar(row)}>
            <Star className={cn('size-4', row.isStarred && 'fill-amber-400 text-amber-500')} />
            <span>{row.isStarred ? dictionary.assessmentUnstar : dictionary.assessmentStar}</span>
          </DropdownMenuItem>
          {moveTarget ? (
            <DropdownMenuItem onSelect={() => moveAssessmentDueDate(row, moveTarget)}>
              <CalendarPlus className="size-4" />
              <span>
                {moveTarget === 'today'
                  ? dictionary.courseworkDoToday
                  : dictionary.courseworkDoTomorrow}
              </span>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem disabled={row.isCanvasSubmitted} onSelect={() => onToggleAssessmentDone(row)}>
            <span
              aria-hidden="true"
              className={cn(
                'grid size-4 place-items-center rounded-[6px] border text-[9px] font-black',
                row.isCompleted ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
              )}
            >
              {row.isCompleted ? '✓' : ''}
            </span>
            <span>
              {row.isCanvasSubmitted
                ? dictionary.courseworkSubmittedInCanvas
                : row.isCompleted
                  ? dictionary.courseworkMarkNotDone
                  : dictionary.courseworkMarkDone}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onRemoveAssessment(row)}>
            {row.assessmentSource === 'manual' ? (
              <Trash2 className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
            <span>
              {row.assessmentSource === 'manual'
                ? dictionary.assessmentDelete
                : dictionary.assessmentHideCanvas}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  const renderLectureContextMenu = (row: RenderableDashboardRow, trigger: ReactElement) => {
    if (!row.lectureKey) {
      return trigger;
    }

    return (
      <ContextMenu key={`${card.id}-${row.lectureKey}`}>
        <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
        <ContextMenuContent className="w-56" onCloseAutoFocus={handleCourseworkMenuCloseAutoFocus}>
          <ContextMenuLabel>{row.label}</ContextMenuLabel>
          <ContextMenuItem onSelect={() => onOpenLectureDetails(row)}>
            <BookOpen className="size-4" />
            <span>{dictionary.manualLectureOpenDetails}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onOpenLectureFriendlyName(row)}>
            <Pencil className="size-4" />
            <span>{dictionary.courseFriendlyNameSet}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onToggleLectureStar(row)}>
            <Star className={cn('size-4', row.isStarred && 'fill-amber-400 text-amber-500')} />
            <span>{row.isStarred ? dictionary.manualLectureUnstar : dictionary.manualLectureStar}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onHideLecture(row)}>
            <EyeOff className="size-4" />
            <span>{dictionary.manualLectureHide}</span>
          </ContextMenuItem>
          {normalizeSemesterName(row.semester) === noTermSemester ? (
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onRequestDeleteLecture(row)}
            >
              <Trash2 className="size-4" />
              <span>{dictionary.manualLectureDelete}</span>
            </ContextMenuItem>
          ) : null}
          <ContextMenuSeparator />
          <ContextMenuLabel>{dictionary.manualLectureChipColor}</ContextMenuLabel>
          {lectureChipColors.map((color) => (
            <ContextMenuItem
              data-dashboard-row-action
              disabled={row.chipColor === color}
              key={color}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onSelect={(event) => {
                event.stopPropagation();
                selectLectureChipColor(row, color);
              }}
            >
              <span
                aria-hidden="true"
                className={cn('size-3 rounded-full border border-foreground/10', dotColorClasses[color])}
              />
              <span>{chipColorLabels[color] ?? color}</span>
            </ContextMenuItem>
          ))}
          <ContextMenuSub>
            <ContextMenuSubTrigger data-dashboard-row-action>
              <span
                aria-hidden="true"
                className="size-3 rounded-full"
                style={{
                  background:
                    'conic-gradient(from 90deg, #ef4444, #f97316, #facc15, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)',
                }}
              />
              <span>{dictionary.manualLectureChipColorOther}</span>
              <ChevronRight className="ml-auto size-4 text-muted-foreground" />
            </ContextMenuSubTrigger>
            <ContextMenuSubContent alignOffset={-4} className="w-40">
              {renderColorVariantGrid(row, contextColorVariantPage, setContextColorVariantPage)}
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>
    );
  };
  const renderCourseworkContextMenu = (row: RenderableDashboardRow, trigger: ReactElement) => {
    if (!row.courseworkKey) {
      return trigger;
    }

    const moveTarget = getCourseworkMoveTarget(row);

    return (
      <ContextMenu key={`${card.id}-${row.courseworkKey}`}>
        <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
        <ContextMenuContent className="w-56" onCloseAutoFocus={handleCourseworkMenuCloseAutoFocus}>
          <ContextMenuLabel>{row.label}</ContextMenuLabel>
          <ContextMenuItem onSelect={() => onOpenCourseworkLink(row)}>
            <ExternalLink className="size-4" />
            <span>{dictionary.courseOverviewOpenCanvas}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onOpenCoursework(row)}>
            <Pencil className="size-4" />
            <span>{dictionary.courseworkOpenDetails}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onToggleCourseworkStar(row)}>
            <Star className={cn('size-4', row.isStarred && 'fill-amber-400 text-amber-500')} />
            <span>{row.isStarred ? dictionary.courseworkUnstar : dictionary.courseworkStar}</span>
          </ContextMenuItem>
          {moveTarget ? (
            <ContextMenuItem onSelect={() => moveCourseworkDueDate(row, moveTarget)}>
              <CalendarPlus className="size-4" />
              <span>
                {moveTarget === 'today'
                  ? dictionary.courseworkDoToday
                  : dictionary.courseworkDoTomorrow}
              </span>
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem disabled={row.isCanvasSubmitted} onSelect={() => onToggleCourseworkDone(row)}>
            <span
              aria-hidden="true"
              className={cn(
                'grid size-4 place-items-center rounded-[6px] border text-[9px] font-black',
                row.isCompleted ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
              )}
            >
              {row.isCompleted ? '✓' : ''}
            </span>
            <span>
              {row.isCanvasSubmitted
                ? dictionary.courseworkSubmittedInCanvas
                : row.isCompleted
                  ? dictionary.courseworkMarkNotDone
                  : dictionary.courseworkMarkDone}
            </span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onRemoveCoursework(row)}>
            {row.courseworkSource === 'manual' ? (
              <Trash2 className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
            <span>
              {row.courseworkSource === 'manual'
                ? dictionary.courseworkDelete
                : dictionary.courseworkHideCanvas}
            </span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };
  const renderAssessmentContextMenu = (row: RenderableDashboardRow, trigger: ReactElement) => {
    if (!row.assessmentKey) {
      return trigger;
    }

    const moveTarget = getCourseworkMoveTarget(row);

    return (
      <ContextMenu key={`${card.id}-${row.assessmentKey}`}>
        <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel>{row.label}</ContextMenuLabel>
          <ContextMenuItem onSelect={() => onOpenCourseworkLink(row)}>
            <ExternalLink className="size-4" />
            <span>{dictionary.courseOverviewOpenCanvas}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onOpenAssessment(row)}>
            <Pencil className="size-4" />
            <span>{dictionary.assessmentOpenDetails}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onToggleAssessmentStar(row)}>
            <Star className={cn('size-4', row.isStarred && 'fill-amber-400 text-amber-500')} />
            <span>{row.isStarred ? dictionary.assessmentUnstar : dictionary.assessmentStar}</span>
          </ContextMenuItem>
          {moveTarget ? (
            <ContextMenuItem onSelect={() => moveAssessmentDueDate(row, moveTarget)}>
              <CalendarPlus className="size-4" />
              <span>
                {moveTarget === 'today'
                  ? dictionary.courseworkDoToday
                  : dictionary.courseworkDoTomorrow}
              </span>
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem disabled={row.isCanvasSubmitted} onSelect={() => onToggleAssessmentDone(row)}>
            <span
              aria-hidden="true"
              className={cn(
                'grid size-4 place-items-center rounded-[6px] border text-[9px] font-black',
                row.isCompleted ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
              )}
            >
              {row.isCompleted ? '✓' : ''}
            </span>
            <span>
              {row.isCanvasSubmitted
                ? dictionary.courseworkSubmittedInCanvas
                : row.isCompleted
                  ? dictionary.courseworkMarkNotDone
                  : dictionary.courseworkMarkDone}
            </span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onRemoveAssessment(row)}>
            {row.assessmentSource === 'manual' ? (
              <Trash2 className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
            <span>
              {row.assessmentSource === 'manual'
                ? dictionary.assessmentDelete
                : dictionary.assessmentHideCanvas}
            </span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  if (card.id === 'upcoming-coursework' || card.id === 'upcoming-assessments') {
    const renderedRows = rows.map((row) => {
      const isCheckableRow = Boolean(row.courseworkKey || row.assessmentKey);
      const renameKey = row.courseworkKey ?? row.assessmentKey;
      const isRenamingRow = Boolean(
        renameKey &&
        focusedCourseworkKey === renameKey &&
        !row.isCanvasSubmitted &&
        !isLiveCanvasDashboardRow(row),
      );
      const touchActionMenu = row.assessmentKey && !row.courseworkKey
        ? renderAssessmentTouchMenu(row)
        : renderCourseworkTouchMenu(row);
      const courseBadge = row.id === 'loading'
        ? <RefreshCw className="size-4 shrink-0 animate-spin text-muted-foreground" />
        : row.id === 'message' ? (isPhone ? null : <span aria-hidden="true" className="h-6 w-0 shrink-0" />)
        : <EventPill className="h-6 min-w-0 max-w-full px-2 text-xs" color={row.chipColor ?? card.color} compact label={row.label} />;
      const typeBadges = <>
        {row.courseworkType ? <EventPill className="h-5 max-w-24 px-1.5 text-[10px]" color={row.chipColor ?? card.color} compact label={row.courseworkType} /> : null}
        {row.assessmentType ? <EventPill className="h-5 max-w-24 px-1.5 text-[10px]" color={row.chipColor ?? card.color} compact label={row.assessmentType} /> : null}
      </>;
      const titleContent = isRenamingRow ? (
        <input
          aria-label={dictionary.boardAddTodoItem}
          autoFocus
          className="block min-w-0 max-w-full rounded-md border bg-background px-2 py-1 text-sm font-black text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring/45"
          onBlur={onFinishCourseworkRename}
          onChange={(event) => onRenameCoursework(row, event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.currentTarget.blur();
            }
          }}
          placeholder={dictionary.boardAddTodoItem}
          value={row.value}
        />
      ) : isPhone && isCheckableRow ? (
        <button type="button" className="block w-full min-w-0 rounded-md text-left text-sm font-bold leading-snug [overflow-wrap:anywhere] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={row.value || dictionary.boardAddTodoItem}
          onClick={() => row.assessmentKey && !row.courseworkKey ? onOpenAssessment(row) : onOpenCoursework(row)}>
          {row.value || dictionary.boardAddTodoItem}
        </button>
      ) : (
        <strong title={row.value || dictionary.boardAddTodoItem} className="block min-w-0 max-w-full truncate" onClick={(event) => {
          if (!isCheckableRow || row.isCanvasSubmitted) return;
          event.preventDefault();
          event.stopPropagation();
          startCourseworkRename(row);
        }}>{row.value || dictionary.boardAddTodoItem}</strong>
      );
      const completionButton = isCheckableRow ? (
        <button
          aria-label={row.isCanvasSubmitted
            ? dictionary.courseworkSubmittedInCanvas
            : row.isCompleted
              ? dictionary.courseworkMarkNotDone
              : dictionary.courseworkMarkDone}
          className={cn(
            'grid size-5 shrink-0 place-items-center rounded-[7px] border text-[11px] font-black leading-none transition-colors',
            isPhone && 'size-9 rounded-lg',
            row.isCompleted
              ? 'border-emerald-400/40 bg-emerald-500 text-white'
              : 'border-muted-foreground/30 bg-muted/70 text-muted-foreground hover:bg-muted',
            row.isCanvasSubmitted && 'cursor-default opacity-90',
          )}
          aria-pressed={Boolean(row.isCompleted)}
          disabled={row.isCanvasSubmitted}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (row.assessmentKey && !row.courseworkKey) {
              onToggleAssessmentDone(row);
              return;
            }

            onToggleCourseworkDone(row);
          }}
          title={row.isCanvasSubmitted
            ? dictionary.courseworkSubmittedInCanvas
            : row.isCompleted
              ? dictionary.courseworkMarkNotDone
              : dictionary.courseworkMarkDone}
          type="button"
        >
          {row.isCompleted ? '✓' : ''}
        </button>
      ) : null;
      const star = row.isStarred ? <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" /> : null;
      const dueBadge = row.description ? (
        <span className={cn(
          'inline-flex items-center rounded-md border px-2 text-xs font-semibold',
          isPhone ? 'min-h-7 min-w-0 max-w-full py-1' : 'h-6 w-32 shrink-0 justify-center',
          getCourseworkDueChipClass(row.dueState),
        )}>
          <span className={isPhone ? '[overflow-wrap:anywhere]' : 'truncate'}>{row.description}</span>
        </span>
      ) : null;
      const rowElement = (
        <div
          className={cn(
            'min-w-0 border-t text-sm first:border-t-0',
            isPhone ? 'flex flex-col gap-1 py-2' : 'grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]',
            isCheckableRow && 'rounded-md px-1 transition-colors hover:bg-muted/45',
            isPhone && isCheckableRow && row.isCompleted &&
              'border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/15 dark:border-emerald-300/25 dark:bg-emerald-300/10 dark:hover:bg-emerald-300/15',
          )}
          role={isPhone && isCheckableRow ? 'article' : undefined}
          aria-label={isPhone && isCheckableRow ? row.value : undefined}
          key={`${card.id}-${row.label}-${row.value}`}
          onDoubleClick={(event) => {
            if (!isCheckableRow) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            startCourseworkRename(row);
          }}
          onPointerCancel={clearCourseworkLongPress}
          onPointerDown={(event) => {
            if (isCheckableRow) {
              handleCourseworkPointerDown(event, row);
            }
          }}
          onPointerLeave={clearCourseworkLongPress}
          onPointerUp={clearCourseworkLongPress}
        >
          {isPhone && isCheckableRow ? <>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">{courseBadge}{typeBadges}{star}</div>
            {titleContent}
            <div className="flex min-w-0 items-center justify-between gap-1.5">
              {dueBadge}
              <div className="ml-auto flex shrink-0 items-center gap-1">{completionButton}{touchActionMenu}</div>
            </div>
          </> : <>
            {courseBadge}
            <div className="min-w-0">{titleContent}</div>
            <div className="col-start-2 flex min-w-0 items-center justify-start gap-1.5 sm:col-start-auto sm:justify-end">
              {typeBadges}{completionButton}{star}{dueBadge}{touchActionMenu}
            </div>
          </>}
        </div>
      );

      if (card.id === 'upcoming-coursework' && row.assessmentKey) {
        return renderAssessmentContextMenu(row, rowElement);
      }

      return card.id === 'upcoming-coursework'
        ? renderCourseworkContextMenu(row, rowElement)
        : card.id === 'upcoming-assessments'
          ? renderAssessmentContextMenu(row, rowElement)
          : rowElement;
    });

    return card.id === 'upcoming-coursework'
      ? (
          <div
            className={cn(
              isPhone ? 'min-w-0' : cn('overflow-y-auto pr-1', compactCourseworkRows ? compactRowsMaxHeightClassName : 'max-h-64'),
            )}
            ref={courseworkScrollContainerRef}
          >
            {renderedRows}
          </div>
        )
      : renderedRows;
  }

  if (card.layout === 'agenda') {
    const renderedRows = rows.map((row) => {
      const isLectureRow = Boolean(row.lectureKey);
      const rowElement = (
        <div
          aria-label={isLectureRow ? dictionary.manualLectureOpenDetails : undefined}
          className={cn(
            'flex min-w-0 items-center border-t py-2 text-sm first:border-t-0',
            compactCourseRows ? 'justify-between gap-2' : 'gap-3',
            isLectureRow && 'cursor-pointer rounded-md px-1 transition-colors hover:bg-muted/45',
          )}
          key={`${card.id}-${row.label}-${row.value}`}
          onClick={(event) => {
            if (!isLectureRow) {
              return;
            }

            if (isDashboardRowActionTarget(event.target) || isLectureOpenSuppressed()) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }

            event.stopPropagation();
            onOpenLecture(row);
          }}
          onKeyDown={(event) => {
            if (!isLectureRow || (event.key !== 'Enter' && event.key !== ' ')) {
              return;
            }

            if (isDashboardRowActionTarget(event.target) || isLectureOpenSuppressed()) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            onOpenLecture(row);
          }}
          role={isLectureRow ? 'button' : undefined}
          tabIndex={isLectureRow ? 0 : undefined}
        >
          {row.label ? (
            <EventPill
              className={cn(
                'h-6 px-2 text-xs',
                compactCourseRows && 'max-w-[calc(100%-2.25rem)]',
              )}
              color={row.chipColor ?? card.color}
              compact
              label={row.label}
            />
          ) : (
            <RefreshCw className="size-4 shrink-0 animate-spin text-muted-foreground" />
          )}
          {compactCourseRows ? null : (
            <strong className="min-w-0 flex-1 truncate">{row.value}</strong>
          )}
          {!compactCourseRows && row.isStarred ? (
            <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" />
          ) : null}
          {renderLectureTouchMenu(row)}
        </div>
      );

      return renderLectureContextMenu(row, rowElement);
    });

    return compactCourseRows
      ? (
          <div className={cn('overflow-y-auto pr-1', compactRowsMaxHeightClassName)}>
            {renderedRows}
          </div>
        )
      : renderedRows;
  }

  return rows.map((row) => (
    <div
      className="flex items-center justify-between gap-3 border-t py-2 text-sm first:border-t-0"
      key={`${card.id}-${row.label}`}
    >
      <span className="text-muted-foreground">{row.label}</span>
      <strong className="text-right">{row.value}</strong>
    </div>
  ));
}

interface CourseFriendlyNameDialogProps {
  friendlyCourseCode: string;
  friendlyName: string;
  onFriendlyCourseCodeChange: (value: string) => void;
  onFriendlyNameChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  open: boolean;
  row?: RenderableDashboardRow | null;
}

function CourseFriendlyNameDialog({
  friendlyCourseCode,
  friendlyName,
  onFriendlyCourseCodeChange,
  onFriendlyNameChange,
  onOpenChange,
  onSave,
  open,
  row,
}: CourseFriendlyNameDialogProps) {
  const { dictionary } = useLanguage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl p-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black">{dictionary.courseFriendlyNameTitle}</DialogTitle>
          <DialogDescription>{dictionary.courseFriendlyNameDescription}</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase text-muted-foreground">
              {dictionary.courseFriendlyNameOriginalCourseCode}
            </Label>
            <div className="rounded-md border bg-muted/45 px-3 py-2 text-sm font-black">
              {row?.originalCourseCode || dictionary.notSet}
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="course-friendly-code">
              {dictionary.courseFriendlyNameFriendlyCourseCode}
            </Label>
            <Input
              autoFocus
              id="course-friendly-code"
              onChange={(event) => onFriendlyCourseCodeChange(event.target.value)}
              placeholder="CMPT276"
              value={friendlyCourseCode}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="course-friendly-name">
              {dictionary.courseFriendlyNameFriendlyName}
            </Label>
            <Input
              id="course-friendly-name"
              onChange={(event) => onFriendlyNameChange(event.target.value)}
              placeholder={row?.courseName || 'Software Engineering'}
              value={friendlyName}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              {dictionary.cancel}
            </Button>
            <Button type="submit">{dictionary.courseFriendlyNameSave}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface CourseworkDialogProps {
  courseOptions: CourseworkCourseOption[];
  selectedSemester: string;
  initialCoursework?: ManualCourseworkItem;
  isCanvasCoursework?: boolean;
  isPhone?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (coursework: ManualCourseworkItem) => void;
  open: boolean;
  submitLabel?: string;
  title?: string;
}

function createEmptyCoursework(selectedSemester = defaultAcademySemester): ManualCourseworkItem {
  return {
    id: createManualCourseworkId(),
    title: '',
    courseCode: '',
    dueAt: '',
    startAt: '',
    endAt: '',
    courseworkType: 'study',
    submissionType: '',
    completed: false,
    chipColor: 'green',
    semester: selectedSemester,
  };
}

function createManualCourseworkId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `manual-coursework-${crypto.randomUUID()}`;
  }

  return `manual-coursework-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function CourseworkDialog({
  courseOptions,
  initialCoursework,
  isCanvasCoursework = false,
  isPhone = false,
  onOpenChange,
  onSave,
  open,
  selectedSemester,
  submitLabel,
  title,
}: CourseworkDialogProps) {
  const { dictionary } = useLanguage();
  const [draft, setDraft] = useState<ManualCourseworkItem>(() => (
    initialCoursework ?? {
      ...createEmptyCoursework(selectedSemester),
      ...(isPhone ? { dueAt: getDefaultCourseworkDueAt() } : {}),
    }
  ));
  const lockedCanvasFieldClassName = isCanvasCoursework ? 'opacity-70' : '';
  const selectedCourseValue = courseOptions.some((option) => option.value === draft.courseCode)
    ? draft.courseCode
    : draft.courseCode
      ? `current:${draft.courseCode}`
      : undefined;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    onSave({
      ...draft,
      courseCode: draft.courseCode.trim(),
      courseworkType: draft.courseworkType || 'study',
      dueAt: toIsoFromDateInput(draft.dueAt) || draft.dueAt,
      endAt: draft.endAt ? toIsoFromDateInput(draft.endAt) || draft.endAt : '',
      semester: normalizeSemesterName(draft.semester, selectedSemester),
      startAt: draft.startAt ? toIsoFromDateInput(draft.startAt) || draft.startAt : '',
      submissionType: draft.submissionType.trim(),
      title: draft.title.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {isPhone ? (open ? (
        <PhoneCourseworkForm
          courseOptions={courseOptions}
          disabled={isCanvasCoursework}
          draft={{ ...draft, dueAt: formatDateInputValue(draft.dueAt), startAt: formatDateInputValue(draft.startAt), endAt: formatDateInputValue(draft.endAt) }}
          onChange={(changes) => setDraft((current) => ({ ...current, ...changes }))}
          onClose={() => onOpenChange(false)}
          onSubmit={handleSubmit}
          submissionOptions={submissionTypes.map((value) => ({ value, label: formatSubmissionType(value) }))}
          submitLabel={submitLabel ?? dictionary.courseworkSave}
          title={title ?? dictionary.courseworkDialogTitle}
          typeOptions={courseworkTypes.map((value) => ({ value, label: formatCourseworkType(value) }))}
        />
      ) : null) : (
      <DialogContent className="rounded-xl p-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black">
            {title ?? dictionary.courseworkDialogTitle}
          </DialogTitle>
          <DialogDescription>{dictionary.courseworkDialogDescription}</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={handleSubmit}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {isCanvasCoursework ? (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm font-bold text-muted-foreground sm:col-span-2">
                {dictionary.courseworkCanvasManagedLocked}
              </div>
            ) : null}
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="coursework-title">
                {dictionary.courseworkName}
              </Label>
              <Input
                autoFocus={!isCanvasCoursework}
                disabled={isCanvasCoursework}
                id="coursework-title"
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="Assignment 1"
                required
                value={draft.title}
              />
            </div>
            <div className={cn('space-y-2', lockedCanvasFieldClassName)}>
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="coursework-course-code">
                {dictionary.courseworkCourseCode}
              </Label>
              <Select
                disabled={isCanvasCoursework}
                onValueChange={(value) => {
                  const option = courseOptions.find((courseOption) => courseOption.value === value);
                  setDraft((current) => ({
                    ...current,
                    courseCode: value.startsWith('current:') ? value.replace(/^current:/, '') : value,
                    semester: option?.semester ?? current.semester,
                  }));
                }}
                value={selectedCourseValue}
              >
                <SelectTrigger id="coursework-course-code">
                  <SelectValue placeholder={dictionary.courseworkSelectCourse} />
                </SelectTrigger>
                <SelectContent>
                  {draft.courseCode && !courseOptions.some((option) => option.value === draft.courseCode) ? (
                    <SelectItem value={`current:${draft.courseCode}`}>{draft.courseCode}</SelectItem>
                  ) : null}
                  {courseOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label={dictionary.courseworkCustomCourseCode}
                className="h-9"
                disabled={isCanvasCoursework}
                onChange={(event) => setDraft((current) => ({ ...current, courseCode: event.target.value }))}
                placeholder={dictionary.courseworkCustomCourseCode}
                value={draft.courseCode}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="coursework-type">
                {dictionary.courseworkType}
              </Label>
              <Select
                disabled={isCanvasCoursework}
                onValueChange={(value) => setDraft((current) => ({ ...current, courseworkType: value }))}
                value={draft.courseworkType || 'study'}
              >
                <SelectTrigger id="coursework-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {courseworkTypes.map((courseworkType) => (
                    <SelectItem key={courseworkType} value={courseworkType}>
                      {formatCourseworkType(courseworkType)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="coursework-submission">
                {dictionary.courseworkSubmissionType}
              </Label>
              <Select
                disabled={isCanvasCoursework}
                onValueChange={(value) => setDraft((current) => ({ ...current, submissionType: value }))}
                value={draft.submissionType || undefined}
              >
                <SelectTrigger id="coursework-submission">
                  <SelectValue placeholder={dictionary.courseworkSelectSubmissionType} />
                </SelectTrigger>
                <SelectContent>
                  {submissionTypes.map((submissionType) => (
                    <SelectItem key={submissionType} value={submissionType}>
                      {formatSubmissionType(submissionType)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className={cn('space-y-2', lockedCanvasFieldClassName)}>
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="coursework-start">
                {dictionary.calendarTodoStartAt}
              </Label>
              <DateTimeField
                defaultTime="09:00"
                disabled={isCanvasCoursework}
                id="coursework-start"
                onChange={(value) => setDraft((current) => ({ ...current, startAt: value }))}
                value={formatDateInputValue(draft.startAt)}
              />
            </div>
            <div className={cn('space-y-2', lockedCanvasFieldClassName)}>
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="coursework-due">
                {dictionary.courseworkDueAt}
              </Label>
              <DateTimeField
                defaultTime="23:59"
                disabled={isCanvasCoursework}
                id="coursework-due"
                onChange={(value) => setDraft((current) => ({ ...current, dueAt: value }))}
                value={formatDateInputValue(draft.dueAt)}
              />
            </div>
            <details className={cn('rounded-lg border bg-muted/20 p-3 sm:col-span-2', lockedCanvasFieldClassName)}>
              <summary className="cursor-pointer text-xs font-black uppercase text-muted-foreground">
                {dictionary.courseworkActualEndAt}
              </summary>
              <div className="mt-3 space-y-2">
                <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="coursework-end">
                  {dictionary.courseworkActualEndAt}
                </Label>
                <DateTimeField
                  defaultTime="23:59"
                  disabled={isCanvasCoursework}
                  id="coursework-end"
                  onChange={(value) => setDraft((current) => ({ ...current, endAt: value }))}
                  value={formatDateInputValue(draft.endAt)}
                />
              </div>
            </details>
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              {dictionary.cancel}
            </Button>
            <Button disabled={isCanvasCoursework} type="submit">{submitLabel ?? dictionary.courseworkSave}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      )}
    </Dialog>
  );
}

interface AssessmentDialogProps {
  courseOptions: CourseworkCourseOption[];
  selectedSemester: string;
  initialAssessment?: ManualAssessmentItem;
  isCanvasAssessment?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (assessment: ManualAssessmentItem) => void;
  open: boolean;
  submitLabel?: string;
  title?: string;
}

function createEmptyAssessment(selectedSemester = defaultAcademySemester): ManualAssessmentItem {
  return {
    id: createManualAssessmentId(),
    title: '',
    courseCode: '',
    dueAt: '',
    startAt: '',
    endAt: '',
    assessmentType: 'quiz',
    completed: false,
    semester: selectedSemester,
  };
}

function createManualAssessmentId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `manual-assessment-${crypto.randomUUID()}`;
  }

  return `manual-assessment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function AssessmentDialog({
  courseOptions,
  initialAssessment,
  isCanvasAssessment = false,
  onOpenChange,
  onSave,
  open,
  selectedSemester,
  submitLabel,
  title,
}: AssessmentDialogProps) {
  const { dictionary } = useLanguage();
  const [draft, setDraft] = useState<ManualAssessmentItem>(() => (
    initialAssessment ?? createEmptyAssessment(selectedSemester)
  ));
  const selectedCourseValue = courseOptions.some((option) => option.value === draft.courseCode)
    ? draft.courseCode
    : draft.courseCode
      ? `current:${draft.courseCode}`
      : undefined;
  const lockedCanvasFieldClassName = isCanvasAssessment ? 'opacity-70' : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl p-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black">
            {title ?? dictionary.assessmentDialogTitle}
          </DialogTitle>
          <DialogDescription>{dictionary.assessmentDialogDescription}</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({
              ...draft,
              assessmentType: draft.assessmentType || 'quiz',
              courseCode: draft.courseCode.trim(),
              dueAt: toIsoFromDateInput(draft.dueAt) || draft.dueAt,
              endAt: draft.endAt ? toIsoFromDateInput(draft.endAt) || draft.endAt : '',
              semester: normalizeSemesterName(draft.semester, selectedSemester),
              startAt: draft.startAt ? toIsoFromDateInput(draft.startAt) || draft.startAt : '',
              title: draft.title.trim(),
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {isCanvasAssessment ? (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm font-bold text-muted-foreground sm:col-span-2">
                {dictionary.courseworkCanvasManagedLocked}
              </div>
            ) : null}
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="assessment-title">
                {dictionary.assessmentName}
              </Label>
              <Input
                autoFocus={!isCanvasAssessment}
                disabled={isCanvasAssessment}
                id="assessment-title"
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="Quiz 1"
                required
                value={draft.title}
              />
            </div>
            <div className={cn('space-y-2', lockedCanvasFieldClassName)}>
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="assessment-course-code">
                {dictionary.courseworkCourseCode}
              </Label>
              <Select
                disabled={isCanvasAssessment}
                onValueChange={(value) => {
                  const option = courseOptions.find((courseOption) => courseOption.value === value);
                  setDraft((current) => ({
                    ...current,
                    courseCode: value.startsWith('current:') ? value.replace(/^current:/, '') : value,
                    semester: option?.semester ?? current.semester,
                  }));
                }}
                value={selectedCourseValue}
              >
                <SelectTrigger id="assessment-course-code">
                  <SelectValue placeholder={dictionary.courseworkSelectCourse} />
                </SelectTrigger>
                <SelectContent>
                  {draft.courseCode && !courseOptions.some((option) => option.value === draft.courseCode) ? (
                    <SelectItem value={`current:${draft.courseCode}`}>{draft.courseCode}</SelectItem>
                  ) : null}
                  {courseOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label={dictionary.courseworkCustomCourseCode}
                className="h-9"
                disabled={isCanvasAssessment}
                onChange={(event) => setDraft((current) => ({ ...current, courseCode: event.target.value }))}
                placeholder={dictionary.courseworkCustomCourseCode}
                value={draft.courseCode}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="assessment-type">
                {dictionary.assessmentType}
              </Label>
              <Select
                disabled={isCanvasAssessment}
                onValueChange={(value) => setDraft((current) => ({ ...current, assessmentType: value }))}
                value={draft.assessmentType || 'quiz'}
              >
                <SelectTrigger id="assessment-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assessmentTypes.map((assessmentType) => (
                    <SelectItem key={assessmentType} value={assessmentType}>
                      {formatCourseworkType(assessmentType)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className={cn('space-y-2', lockedCanvasFieldClassName)}>
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="assessment-start">
                {dictionary.calendarTodoStartAt}
              </Label>
              <DateTimeField
                defaultTime="09:00"
                disabled={isCanvasAssessment}
                id="assessment-start"
                onChange={(value) => setDraft((current) => ({ ...current, startAt: value }))}
                value={formatDateInputValue(draft.startAt)}
              />
            </div>
            <div className={cn('space-y-2', lockedCanvasFieldClassName)}>
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="assessment-due">
                {dictionary.courseworkDueAt}
              </Label>
              <DateTimeField
                defaultTime="23:59"
                disabled={isCanvasAssessment}
                id="assessment-due"
                onChange={(value) => setDraft((current) => ({ ...current, dueAt: value }))}
                value={formatDateInputValue(draft.dueAt)}
              />
            </div>
            <details className={cn('rounded-lg border bg-muted/20 p-3 sm:col-span-2', lockedCanvasFieldClassName)}>
              <summary className="cursor-pointer text-xs font-black uppercase text-muted-foreground">
                {dictionary.courseworkActualEndAt}
              </summary>
              <div className="mt-3 space-y-2">
                <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="assessment-end">
                  {dictionary.courseworkActualEndAt}
                </Label>
                <DateTimeField
                  defaultTime="23:59"
                  disabled={isCanvasAssessment}
                  id="assessment-end"
                  onChange={(value) => setDraft((current) => ({ ...current, endAt: value }))}
                  value={formatDateInputValue(draft.endAt)}
                />
              </div>
            </details>
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              {dictionary.cancel}
            </Button>
            <Button disabled={isCanvasAssessment} type="submit">{submitLabel ?? dictionary.assessmentSave}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DashboardCardsProps {
  courseworkOnly?: boolean;
  isPhone?: boolean;
  academyAutoRefreshIntervalMs?: number;
  compactAcademySummary?: boolean;
  courseworkHideSettings?: CourseworkHideSettings;
  courseworkShowStudyItems?: boolean;
  effectiveWideSummaryCards?: boolean;
  hideSummaryCards?: boolean;
  onOpenAddItem?: () => void;
  onOpenCourse?: (courseRowId?: string | null, resourceUrl?: string | null) => void;
  onToggleCourseworkStudyItems?: () => void;
  selectedSemester?: string;
}

export function DashboardCards({
  courseworkOnly = false,
  isPhone = false,
  academyAutoRefreshIntervalMs = defaultAcademyAutoRefreshIntervalMs,
  compactAcademySummary = false,
  courseworkHideSettings = defaultCourseworkHideSettings,
  courseworkShowStudyItems = true,
  effectiveWideSummaryCards,
  hideSummaryCards = false,
  onOpenAddItem,
  onOpenCourse,
  onToggleCourseworkStudyItems,
  selectedSemester,
}: DashboardCardsProps) {
  const { activeMode } = useWorkspaceMode();
  const { dictionary, language, translateDashboardCard, translateModeName } = useLanguage();
  const [dashboardSnackbar, setDashboardSnackbar] = useState<DashboardSnackbar | null>(null);
  const [canvasCourses, setCanvasCourses] = useState<CanvasCourse[] | null>(null);
  const [canvasCourseListIsComplete, setCanvasCourseListIsComplete] = useState(false);
  const [canvasCourseLoadStatus, setCanvasCourseLoadStatus] = useState<CanvasCourseLoadStatus>('loading');
  const [canvasCourseworkItems, setCanvasCourseworkItems] = useState<CanvasCalendarItem[]>([]);
  const [canvasCourseworkLoadStatus, setCanvasCourseworkLoadStatus] = useState<CanvasCourseLoadStatus>('loading');
  const [isAcademyDashboardRefreshInProgress, setIsAcademyDashboardRefreshInProgress] = useState(false);
  const [lastSuccessfulDashboardRefreshAt, setLastSuccessfulDashboardRefreshAt] = useState<number | null>(null);
  const [dashboardRefreshClock, setDashboardRefreshClock] = useState(() => Date.now());
  const isAcademyDashboardRefreshing =
    isAcademyDashboardRefreshInProgress ||
    canvasCourseLoadStatus === 'loading' ||
    canvasCourseworkLoadStatus === 'loading';
  const [isSyncingCanvasCoursework, setIsSyncingCanvasCoursework] = useState(false);
  const [canvasTermName, setCanvasTermName] = useState<string | undefined>();
  const [selectedCourseSemester, setSelectedCourseSemester] = useState<string | undefined>();
  const [isManualLectureDialogOpen, setIsManualLectureDialogOpen] = useState(false);
  const [isCourseworkDialogOpen, setIsCourseworkDialogOpen] = useState(false);
  const [initialManualCourseworkDraft, setInitialManualCourseworkDraft] = useState<ManualCourseworkItem | undefined>();
  const [manualLectures, setManualLectures] = useState<ManualLecture[]>([]);
  const [canvasLecturePreferences, setCanvasLecturePreferences] = useState<CanvasLecturePreferences>({});
  const [hasLoadedAcademyPreferences, setHasLoadedAcademyPreferences] = useState(false);
  const [academyPreferencesLoadStatus, setAcademyPreferencesLoadStatus] =
    useState<AcademyPreferenceLoadStatus>('loading');
  const [manualCoursework, setManualCoursework] = useState<ManualCourseworkItem[]>([]);
  const [canvasCourseworkPreferences, setCanvasCourseworkPreferences] = useState<CanvasCourseworkPreferences>({});
  const [manualAssessments, setManualAssessments] = useState<ManualAssessmentItem[]>([]);
  const [canvasAssessmentPreferences, setCanvasAssessmentPreferences] = useState<CanvasAssessmentPreferences>({});
  const manualLecturesRef = useRef(manualLectures);
  const canvasLecturePreferencesRef = useRef(canvasLecturePreferences);
  const manualCourseworkRef = useRef(manualCoursework);
  const canvasCourseworkPreferencesRef = useRef(canvasCourseworkPreferences);
  const manualAssessmentsRef = useRef(manualAssessments);
  const canvasAssessmentPreferencesRef = useRef(canvasAssessmentPreferences);
  const [isAssessmentDialogOpen, setIsAssessmentDialogOpen] = useState(false);
  const [selectedManualAssessmentId, setSelectedManualAssessmentId] = useState<string | null>(null);
  const [selectedCanvasAssessmentId, setSelectedCanvasAssessmentId] = useState<string | null>(null);
  const [selectedManualCourseworkId, setSelectedManualCourseworkId] = useState<string | null>(null);
  const [selectedCanvasCourseworkId, setSelectedCanvasCourseworkId] = useState<string | null>(null);
  const [selectedManualLectureId, setSelectedManualLectureId] = useState<string | null>(null);
  const [selectedCanvasCourseId, setSelectedCanvasCourseId] = useState<string | null>(null);
  const [focusedCourseworkKey, setFocusedCourseworkKey] = useState<string | null>(null);
  const [lecturePendingDelete, setLecturePendingDelete] = useState<ManualLecture | null>(null);
  const [friendlyNameRow, setFriendlyNameRow] = useState<RenderableDashboardRow | null>(null);
  const [friendlyCourseCodeInput, setFriendlyCourseCodeInput] = useState('');
  const [friendlyNameInput, setFriendlyNameInput] = useState('');
  const refreshTimeoutRef = useRef<number | null>(null);
  const dashboardSnackbarTimeoutRef = useRef<number | null>(null);
  const academyRefreshLongPressTimeoutRef = useRef<number | null>(null);
  const academyRefreshLongPressTriggeredRef = useRef(false);
  const canvasCourseworkRequestSequenceRef = useRef(0);
  const isAcademyDashboardRefreshingRef = useRef(false);
  const protectedCanvasSubmissionStatusesRef = useRef(new Map<string, ProtectedCanvasSubmissionStatus>());
  const refreshAcademyDashboardDataEvent = useEffectEvent(refreshAcademyDashboardData);
  const dateLocale = getDateLocale(language);
  const dashboardRefreshAge = getDashboardRefreshAge(lastSuccessfulDashboardRefreshAt, dashboardRefreshClock);
  const dashboardRefreshAgeLabel = dashboardRefreshAge === 'unknown'
    ? dictionary.academyDashboardRefreshUnknown
    : dashboardRefreshAge === 'fresh'
      ? dictionary.academyDashboardRefreshFresh
      : dashboardRefreshAge === 'recent'
        ? dictionary.academyDashboardRefreshRecent
        : dictionary.academyDashboardRefreshStale;

  useEffect(() => {
    isAcademyDashboardRefreshingRef.current = isAcademyDashboardRefreshing;
  }, [isAcademyDashboardRefreshing]);

  useEffect(() => {
    const refreshClockInterval = window.setInterval(() => {
      setDashboardRefreshClock(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(refreshClockInterval);
    };
  }, [activeMode.id]);
  const selectedManualLecture = selectedManualLectureId
    ? manualLectures.find((lecture) => lecture.id === selectedManualLectureId)
    : undefined;
  const recoverableCanvasCourseworkKeys = new Set<string>();
  canvasCourseworkItems.forEach((item) => {
    if (isCourseworkCanvasItem(item)) {
      addRecoverableCanvasAssignmentReferenceKey(
        recoverableCanvasCourseworkKeys,
        item.id,
        canvasCourseworkPreferences[item.id] ?? {},
        item,
      );
      return;
    }

    if (isAssessmentCanvasItem(item)) {
      addRecoverableCanvasAssignmentReferenceKey(
        recoverableCanvasCourseworkKeys,
        item.id,
        canvasAssessmentPreferences[item.id] ?? {},
        item,
      );
    }
  });
  Object.entries(canvasCourseworkPreferences).forEach(([itemId, preference]) => {
    addRecoverableCanvasAssignmentReferenceKey(recoverableCanvasCourseworkKeys, itemId, preference);
  });
  Object.entries(canvasAssessmentPreferences).forEach(([itemId, preference]) => {
    addRecoverableCanvasAssignmentReferenceKey(recoverableCanvasCourseworkKeys, itemId, preference);
  });
  const recoverableCanvasCourseworkCount = recoverableCanvasCourseworkKeys.size;
  const selectedCanvasCourse = selectedCanvasCourseId
    ? canvasCourses?.find((course) => course.id === selectedCanvasCourseId)
    : undefined;
  const selectedManualCoursework = selectedManualCourseworkId
    ? manualCoursework.find((item) => item.id === selectedManualCourseworkId)
    : undefined;
  const selectedCanvasCoursework = selectedCanvasCourseworkId
    ? canvasCourseworkItems.find((item) => item.id === selectedCanvasCourseworkId)
    : undefined;
  const selectedManualAssessment = selectedManualAssessmentId
    ? manualAssessments.find((item) => item.id === selectedManualAssessmentId)
    : undefined;
  const selectedCanvasAssessment = selectedCanvasAssessmentId
    ? canvasCourseworkItems.find((item) => item.id === selectedCanvasAssessmentId)
    : undefined;
  const selectedCanvasAssessmentPreference = selectedCanvasAssessmentId
    ? canvasAssessmentPreferences[selectedCanvasAssessmentId]
    : undefined;
  const reportedCanvasSemester = canvasTermName?.trim()
    ? normalizeCanvasSemesterName(canvasTermName)
    : getCommonReportedCanvasSemester(canvasCourses);
  const fallbackCourseSemester = reportedCanvasSemester ?? defaultAcademySemester;
  const selectedSemesterFromProps = selectedSemester
    ? normalizeSemesterName(selectedSemester, fallbackCourseSemester)
    : undefined;
  const activeCourseSemester = normalizeSemesterName(
    selectedSemesterFromProps ?? selectedCourseSemester ?? reportedCanvasSemester,
    fallbackCourseSemester,
  );
  const selectedCanvasAssessmentEditable = selectedCanvasAssessmentId
    ? {
        id: selectedCanvasAssessmentId,
        title:
          selectedCanvasAssessmentPreference?.title ??
          selectedCanvasAssessment?.title ??
          '',
        courseCode:
          selectedCanvasAssessmentPreference?.courseCode ??
          selectedCanvasAssessment?.courseCode ??
          '',
        dueAt:
          selectedCanvasAssessment?.dueAt ??
          selectedCanvasAssessment?.startAt ??
          selectedCanvasAssessmentPreference?.dueAt ??
          '',
        startAt:
          selectedCanvasAssessment?.startAt ??
          selectedCanvasAssessmentPreference?.startAt ??
          '',
        endAt:
          selectedCanvasAssessment?.endAt ??
          selectedCanvasAssessmentPreference?.endAt ??
          '',
        assessmentType:
          selectedCanvasAssessmentPreference?.assessmentType ??
          selectedCanvasAssessment?.type ??
          'quiz',
        completed:
          (typeof selectedCanvasAssessmentPreference?.isSubmitted === 'boolean'
            ? selectedCanvasAssessmentPreference.isSubmitted
            : Boolean(selectedCanvasAssessment?.isSubmitted)) ||
          Boolean(selectedCanvasAssessmentPreference?.completed),
        hidden: selectedCanvasAssessmentPreference?.hidden,
        semester: selectedCanvasAssessmentPreference?.semester ?? activeCourseSemester,
        starred: selectedCanvasAssessmentPreference?.starred,
      }
    : undefined;
  const selectedCanvasCourseworkPreference = selectedCanvasCourseworkId
    ? canvasCourseworkPreferences[selectedCanvasCourseworkId]
    : undefined;
  const selectedCanvasCourseworkEditable = selectedCanvasCourseworkId
    ? {
        id: selectedCanvasCourseworkId,
        title:
          selectedCanvasCourseworkPreference?.title ??
          selectedCanvasCoursework?.title ??
          '',
        courseCode:
          selectedCanvasCourseworkPreference?.courseCode ??
          selectedCanvasCoursework?.courseCode ??
          '',
        dueAt:
          selectedCanvasCoursework?.dueAt ??
          selectedCanvasCoursework?.startAt ??
          selectedCanvasCourseworkPreference?.dueAt ??
          '',
        startAt:
          selectedCanvasCoursework?.startAt ??
          selectedCanvasCourseworkPreference?.startAt ??
          '',
        endAt:
          selectedCanvasCoursework?.endAt ??
          selectedCanvasCourseworkPreference?.endAt ??
          '',
        courseworkType:
          selectedCanvasCourseworkPreference?.courseworkType ??
          selectedCanvasCoursework?.type ??
          'assignment',
        submissionType:
          selectedCanvasCourseworkPreference?.submissionType ??
          selectedCanvasCoursework?.submissionTypes?.[0] ??
          formatSubmissionType(selectedCanvasCoursework?.type),
        completed:
          (typeof selectedCanvasCourseworkPreference?.isSubmitted === 'boolean'
            ? selectedCanvasCourseworkPreference.isSubmitted
            : Boolean(selectedCanvasCoursework?.isSubmitted)) ||
          Boolean(selectedCanvasCourseworkPreference?.completed),
        chipColor: selectedCanvasCourseworkPreference?.chipColor ?? 'green',
        hidden: selectedCanvasCourseworkPreference?.hidden,
        semester: selectedCanvasCourseworkPreference?.semester ?? activeCourseSemester,
        starred: selectedCanvasCourseworkPreference?.starred,
      }
    : undefined;
  const selectedCanvasLecture = useMemo(() => (
    selectedCanvasCourse
      ? createCanvasEditableLecture(
          selectedCanvasCourse,
          canvasLecturePreferences[selectedCanvasCourse.id],
        )
      : undefined
  ), [canvasLecturePreferences, selectedCanvasCourse]);
  const courseworkCourseOptions = useMemo(() => (
    getCourseworkCourseOptions(
      canvasCourses,
      canvasLecturePreferences,
      manualLectures,
      activeCourseSemester,
      fallbackCourseSemester,
      selectedManualCoursework?.courseCode ||
        selectedManualAssessment?.courseCode ||
        selectedCanvasCourseworkEditable?.courseCode ||
        selectedCanvasAssessmentEditable?.courseCode,
    )
  ), [
    activeCourseSemester,
    canvasCourses,
    canvasLecturePreferences,
    fallbackCourseSemester,
    manualLectures,
    selectedCanvasAssessmentEditable?.courseCode,
    selectedCanvasCourseworkEditable?.courseCode,
    selectedManualAssessment?.courseCode,
    selectedManualCoursework?.courseCode,
  ]);
  const courseSemesterOptions = useMemo(() => {
    const semesterSet = new Set<string>();
    const addSemester = (semester?: string) => {
      semesterSet.add(normalizeSemesterName(semester, fallbackCourseSemester));
    };

    canvasCourses?.forEach((course) => {
      addSemester(getCanvasCourseSemester(course, canvasLecturePreferences, fallbackCourseSemester));
    });
    Object.values(canvasLecturePreferences).forEach((preference) => {
      addSemester(preference.semester ?? preference.termName);
    });
    manualLectures.forEach((lecture) => {
      addSemester(lecture.semester);
    });
    manualCoursework.forEach((coursework) => {
      addSemester(coursework.semester);
    });
    manualAssessments.forEach((assessment) => {
      addSemester(assessment.semester);
    });
    Object.values(canvasCourseworkPreferences).forEach((preference) => {
      addSemester(preference.semester);
    });
    Object.values(canvasAssessmentPreferences).forEach((preference) => {
      addSemester(preference.semester);
    });
    addSemester(selectedCourseSemester);
    addSemester(selectedSemesterFromProps);
    if (reportedCanvasSemester) {
      addSemester(reportedCanvasSemester);
    }
    addSemester(defaultAcademySemester);

    return Array.from(semesterSet.values()).sort(compareSemestersNewestFirst);
  }, [
    canvasAssessmentPreferences,
    canvasCourses,
    canvasCourseworkPreferences,
    canvasLecturePreferences,
    fallbackCourseSemester,
    manualAssessments,
    manualCoursework,
    manualLectures,
    reportedCanvasSemester,
    selectedCourseSemester,
    selectedSemesterFromProps,
  ]);

  useEffect(() => {
    manualAssessmentsRef.current = manualAssessments;
  }, [manualAssessments]);

  useEffect(() => {
    canvasAssessmentPreferencesRef.current = canvasAssessmentPreferences;
  }, [canvasAssessmentPreferences]);

  useEffect(() => {
    manualLecturesRef.current = manualLectures;
  }, [manualLectures]);

  useEffect(() => {
    canvasLecturePreferencesRef.current = canvasLecturePreferences;
  }, [canvasLecturePreferences]);

  useEffect(() => {
    manualCourseworkRef.current = manualCoursework;
  }, [manualCoursework]);

  useEffect(() => {
    canvasCourseworkPreferencesRef.current = canvasCourseworkPreferences;
  }, [canvasCourseworkPreferences]);

  const applyAcademyPreferenceValues = (values: AcademyPreferenceValues) => {
    manualLecturesRef.current = values.manualLectures;
    canvasLecturePreferencesRef.current = values.canvasLecturePreferences;
    manualCourseworkRef.current = values.manualCoursework;
    canvasCourseworkPreferencesRef.current = values.canvasCourseworkPreferences;
    manualAssessmentsRef.current = values.manualAssessments;
    canvasAssessmentPreferencesRef.current = values.canvasAssessmentPreferences;
    setManualLectures(values.manualLectures);
    setCanvasLecturePreferences(values.canvasLecturePreferences);
    setManualCoursework(values.manualCoursework);
    setCanvasCourseworkPreferences(values.canvasCourseworkPreferences);
    setManualAssessments(values.manualAssessments);
    setCanvasAssessmentPreferences(values.canvasAssessmentPreferences);
  };

  const applyAcademyPreferencePatch = (detail: unknown) => {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
      return;
    }

    const patch = detail as Partial<AcademyPreferenceValues> & { calendarSettings?: unknown };

    if (Array.isArray(patch.manualLectures)) {
      manualLecturesRef.current = patch.manualLectures;
      setManualLectures(patch.manualLectures);
    }

    if (isCanvasLecturePreferences(patch.canvasLecturePreferences)) {
      canvasLecturePreferencesRef.current = patch.canvasLecturePreferences;
      setCanvasLecturePreferences(patch.canvasLecturePreferences);
    }

    if (Array.isArray(patch.manualCoursework)) {
      manualCourseworkRef.current = patch.manualCoursework;
      setManualCoursework(patch.manualCoursework);
    }

    if (isCanvasCourseworkPreferences(patch.canvasCourseworkPreferences)) {
      canvasCourseworkPreferencesRef.current = patch.canvasCourseworkPreferences;
      setCanvasCourseworkPreferences(patch.canvasCourseworkPreferences);
    }

    if (Array.isArray(patch.manualAssessments)) {
      manualAssessmentsRef.current = patch.manualAssessments;
      setManualAssessments(patch.manualAssessments);
    }

    if (isCanvasAssessmentPreferences(patch.canvasAssessmentPreferences)) {
      canvasAssessmentPreferencesRef.current = patch.canvasAssessmentPreferences;
      setCanvasAssessmentPreferences(patch.canvasAssessmentPreferences);
    }

    if (patch.calendarSettings && typeof patch.calendarSettings === 'object' && !Array.isArray(patch.calendarSettings)) {
      cacheAcademyCalendarSettings(patch.calendarSettings, { protect: true });
      const selectedSemesterFromPatch = getSelectedSemesterFromSettings(patch.calendarSettings);

      if (selectedSemesterFromPatch) {
        setSelectedCourseSemester(selectedSemesterFromPatch);
      }
    }
  };

  const dashboardCards: RenderableDashboardCard[] = activeMode.dashboardCards.map((card) => {
    const translatedCard = translateDashboardCard(activeMode.id, card);
    const maxRows = translatedCard.maxRows ?? 5;
    const isWaitingForAcademyPreferences = !hasLoadedAcademyPreferences;

    if (isWaitingForAcademyPreferences) {
      if (translatedCard.id === 'semester-lectures') {
        return {
          ...translatedCard,
          pill: activeCourseSemester ?? translatedCard.pill,
          rows: academyPreferencesLoadStatus === 'failed'
            ? createMessageRows(dictionary.canvasCoursesUnavailable)
            : createLoadingRows(dictionary.canvasCoursesLoading),
        };
      }

      if (translatedCard.id === 'upcoming-coursework') {
        return {
          ...translatedCard,
          rows: academyPreferencesLoadStatus === 'failed'
            ? createMessageRows(dictionary.canvasCourseworkUnavailable)
            : createLoadingRows(dictionary.canvasCourseworkLoading),
        };
      }

      if (translatedCard.id === 'upcoming-assessments') {
        return {
          ...translatedCard,
          rows: academyPreferencesLoadStatus === 'failed'
            ? createMessageRows(dictionary.canvasAssessmentsUnavailable)
            : createLoadingRows(dictionary.canvasAssessmentsLoading),
        };
      }
    }

    if (
      translatedCard.id === 'semester-lectures' &&
      (canvasCourseLoadStatus === 'idle' || canvasCourseLoadStatus === 'loading')
    ) {
      return {
        ...translatedCard,
        rows: createLoadingRows(dictionary.canvasCoursesLoading),
      };
    }

    if (translatedCard.id === 'semester-lectures') {
      const visibleManualLectures = getVisibleManualLectures(manualLectures).filter((lecture) => (
        semesterMatches(lecture.semester, activeCourseSemester, fallbackCourseSemester) &&
        !isGeneratedArchivedCanvasLectureForAccessibleCourse(
          lecture,
          canvasLecturePreferences,
          canvasCourses,
        ) &&
        !isGeneratedConvertedCanvasLectureForAccessibleCourse(lecture, canvasCourses)
      ));
      const starredManualRows = createManualLectureRows(
        visibleManualLectures.filter((lecture) => lecture.starred),
      );
      const regularManualRows = createManualLectureRows(
        visibleManualLectures.filter((lecture) => !lecture.starred),
      );
      const visibleCanvasCourses = canvasCourses?.filter((course) => (
        getCanvasCourseSemester(course, canvasLecturePreferences, fallbackCourseSemester) === activeCourseSemester
      ));
      const canvasLectureRows = visibleCanvasCourses
        ? createCanvasLectureRows(visibleCanvasCourses, canvasLecturePreferences, fallbackCourseSemester)
        : [];
      const storedCanvasLectureRows = createStoredCanvasLectureRows(
        canvasLecturePreferences,
        canvasCourses,
        fallbackCourseSemester,
      ).filter((row) => semesterMatches(row.semester, activeCourseSemester, fallbackCourseSemester));
      const starredCanvasRows = canvasLectureRows.filter((row) => row.isStarred);
      const regularCanvasRows = canvasLectureRows.filter((row) => !row.isStarred);
      const starredStoredCanvasRows = storedCanvasLectureRows.filter((row) => row.isStarred);
      const regularStoredCanvasRows = storedCanvasLectureRows.filter((row) => !row.isStarred);
      const persistedRows = [
        ...starredManualRows,
        ...starredStoredCanvasRows,
        ...regularStoredCanvasRows,
        ...regularManualRows,
      ];

      if (canvasCourseLoadStatus === 'failed') {
        return {
          ...translatedCard,
          pill: activeCourseSemester ?? translatedCard.pill,
          rows: persistedRows.length > 0
            ? persistedRows.slice(0, maxRows)
            : createMessageRows(dictionary.canvasCoursesUnavailable),
        };
      }

      if (!canvasCourses || canvasCourses.length === 0) {
        return {
          ...translatedCard,
          pill: activeCourseSemester ?? translatedCard.pill,
          rows: persistedRows.length > 0
            ? persistedRows.slice(0, maxRows)
            : createMessageRows(dictionary.canvasCoursesEmpty),
        };
      }

      return {
        ...translatedCard,
        pill: activeCourseSemester ?? translatedCard.pill,
        rows: [
          ...starredManualRows,
          ...starredCanvasRows,
          ...starredStoredCanvasRows,
          ...regularCanvasRows,
          ...regularStoredCanvasRows,
          ...regularManualRows,
        ].slice(0, maxRows),
      };
    }

    if (translatedCard.id === 'upcoming-coursework') {
      if (canvasCourseworkLoadStatus === 'idle' || canvasCourseworkLoadStatus === 'loading') {
        return {
          ...translatedCard,
          rows: createLoadingRows(dictionary.canvasCourseworkLoading),
        };
      }

      const currentCanvasCourseworkItemIds = new Set(canvasCourseworkItems.filter(isCourseworkCanvasItem).map((item) => item.id));
      const currentCanvasAssessmentItemIds = new Set(canvasCourseworkItems.filter(isAssessmentCanvasItem).map((item) => item.id));
      const manualRows = createManualCourseworkRows(
        manualCoursework.filter((item) => !isRetainedFromAccessibleCanvasCourse(item, canvasCourses)),
        manualLectures,
        canvasLecturePreferences,
        dateLocale,
        activeCourseSemester,
        fallbackCourseSemester,
        courseworkHideSettings,
      );
      const canvasRows = createCanvasCourseworkRows(
        canvasCourseworkItems,
        canvasCourseworkPreferences,
        canvasLecturePreferences,
        manualLectures,
        dateLocale,
        canvasCourses,
        activeCourseSemester,
        fallbackCourseSemester,
        courseworkHideSettings,
      );
      const storedCanvasRows = createStoredCanvasCourseworkRows(
        canvasCourseworkPreferences,
        currentCanvasCourseworkItemIds,
        canvasLecturePreferences,
        manualLectures,
        dateLocale,
        activeCourseSemester,
        fallbackCourseSemester,
        courseworkHideSettings,
      );
      const manualAssessmentRows = createManualAssessmentRows(
        manualAssessments.filter((item) => !isRetainedFromAccessibleCanvasCourse(item, canvasCourses)),
        manualLectures,
        canvasLecturePreferences,
        dateLocale,
        activeCourseSemester,
        fallbackCourseSemester,
        courseworkHideSettings,
      );
      const canvasAssessmentRows = createCanvasAssessmentRows(
        canvasCourseworkItems,
        canvasAssessmentPreferences,
        canvasLecturePreferences,
        manualLectures,
        dateLocale,
        canvasCourses,
        activeCourseSemester,
        fallbackCourseSemester,
        courseworkHideSettings,
      );
      const storedCanvasAssessmentRows = createStoredCanvasAssessmentRows(
        canvasAssessmentPreferences,
        currentCanvasAssessmentItemIds,
        canvasLecturePreferences,
        manualLectures,
        dateLocale,
        activeCourseSemester,
        fallbackCourseSemester,
        courseworkHideSettings,
      );
      const rows = [
        ...canvasRows,
        ...storedCanvasRows,
        ...canvasAssessmentRows,
        ...storedCanvasAssessmentRows,
        ...manualRows,
        ...manualAssessmentRows,
      ]
        .filter((row) => courseworkShowStudyItems || row.courseworkType?.toLowerCase() !== 'study')
        .sort(compareCourseworkCompletionThenDue);
      if (rows.length === 0 && canvasCourseworkLoadStatus === 'failed') {
        return {
          ...translatedCard,
          rows: createMessageRows(dictionary.canvasCourseworkUnavailable),
        };
      }

      return {
        ...translatedCard,
        rows: rows.length > 0
          ? rows
          : createMessageRows(dictionary.canvasCourseworkEmpty),
      };
    }

    if (translatedCard.id === 'upcoming-assessments') {
      const currentCanvasAssessmentItemIds = new Set(canvasCourseworkItems.filter(isAssessmentCanvasItem).map((item) => item.id));
      const manualRows = createManualAssessmentRows(
        manualAssessments.filter((item) => !isRetainedFromAccessibleCanvasCourse(item, canvasCourses)),
        manualLectures,
        canvasLecturePreferences,
        dateLocale,
        activeCourseSemester,
        fallbackCourseSemester,
        courseworkHideSettings,
      );
      const canvasRows = createCanvasAssessmentRows(
        canvasCourseworkItems,
        canvasAssessmentPreferences,
        canvasLecturePreferences,
        manualLectures,
        dateLocale,
        canvasCourses,
        activeCourseSemester,
        fallbackCourseSemester,
        courseworkHideSettings,
      );
      const storedCanvasRows = createStoredCanvasAssessmentRows(
        canvasAssessmentPreferences,
        currentCanvasAssessmentItemIds,
        canvasLecturePreferences,
        manualLectures,
        dateLocale,
        activeCourseSemester,
        fallbackCourseSemester,
        courseworkHideSettings,
      );
      const rows = [...canvasRows, ...storedCanvasRows, ...manualRows].sort(compareCourseworkDueDates);

      if (
        rows.length === 0 &&
        (canvasCourseworkLoadStatus === 'idle' || canvasCourseworkLoadStatus === 'loading')
      ) {
        return {
          ...translatedCard,
          rows: createLoadingRows(dictionary.canvasAssessmentsLoading),
        };
      }

      if (rows.length === 0 && canvasCourseworkLoadStatus === 'failed') {
        return {
          ...translatedCard,
          rows: createMessageRows(dictionary.canvasAssessmentsUnavailable),
        };
      }

      return {
        ...translatedCard,
        rows: rows.length > 0 ? rows : createMessageRows(dictionary.canvasAssessmentsEmpty),
      };
    }

    return translatedCard;
  });

  useEffect(
    () => () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }

      if (dashboardSnackbarTimeoutRef.current) {
        window.clearTimeout(dashboardSnackbarTimeoutRef.current);
      }

      if (academyRefreshLongPressTimeoutRef.current) {
        window.clearTimeout(academyRefreshLongPressTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const handleAcademyPreferencesUpdated = (event: Event) => {
      if (!(event instanceof CustomEvent) || !event.detail) {
        return;
      }

      applyAcademyPreferencePatch(event.detail);
      if (isCompleteAcademyPreferencePayload(event.detail)) {
        setHasLoadedAcademyPreferences(true);
        setAcademyPreferencesLoadStatus('loaded');
      }
    };

    const handleOpenCourseworkDialog = (event: Event) => {
      const detail = event instanceof CustomEvent
        ? event.detail as AcademyOpenCourseworkDialogDetail | undefined
        : undefined;
      const hasPrefilledDetail = Boolean(
        detail?.courseCode ||
        detail?.dueAt ||
        detail?.startAt ||
        detail?.title ||
        detail?.semester,
      );

      setSelectedManualCourseworkId(null);
      setSelectedCanvasCourseworkId(null);
      setInitialManualCourseworkDraft(hasPrefilledDetail
        ? {
            ...createEmptyCoursework(activeCourseSemester),
            courseCode: typeof detail?.courseCode === 'string' ? detail.courseCode : '',
            dueAt: typeof detail?.dueAt === 'string' ? detail.dueAt : '',
            startAt: typeof detail?.startAt === 'string' ? detail.startAt : '',
            title: typeof detail?.title === 'string' ? detail.title : '',
            semester: normalizeSemesterName(detail?.semester, activeCourseSemester),
          }
        : undefined);
      setIsCourseworkDialogOpen(true);
    };

    window.addEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);
    window.addEventListener(academyOpenCourseworkDialogEvent, handleOpenCourseworkDialog);

    return () => {
      window.removeEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);
      window.removeEventListener(academyOpenCourseworkDialogEvent, handleOpenCourseworkDialog);
    };
  }, [activeCourseSemester, activeMode.id]);

  useEffect(() => {
    let isCancelled = false;

    const preferenceReadSequence = academyPreferencesSaveSequence;

    canvasToDoApi
      .getAcademyPreferences()
      .then((preferences) => {
        if (isCancelled || preferenceReadSequence !== academyPreferencesSaveSequence) {
          return;
        }

        const values = getAcademyPreferenceValues(preferences);
        const serverSelectedSemester = getSelectedSemesterFromSettings(preferences.calendarSettings);
        cacheAcademyCalendarSettings(preferences.calendarSettings, { source: 'server' });
        clearLegacyAcademyPreferenceStorage();
        applyAcademyPreferenceValues(values);
        if (serverSelectedSemester) {
          setSelectedCourseSemester(serverSelectedSemester);
        }
        setHasLoadedAcademyPreferences(true);
        setAcademyPreferencesLoadStatus('loaded');
      })
      .catch(() => {
        if (!isCancelled) {
          setHasLoadedAcademyPreferences(false);
          setAcademyPreferencesLoadStatus('failed');
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [activeMode.id]);

  useEffect(() => {
    let isSyncing = false;
    const refreshAcademyData = () => {
      if (isSyncing || isAcademyDashboardRefreshingRef.current || document.visibilityState === 'hidden') {
        return;
      }

      isSyncing = true;
      // Timer refreshes should honor the short server cache. Manual and resume
      // refreshes can still bypass it when the user explicitly needs fresh data.
      void refreshAcademyDashboardDataEvent({ forceCanvasRefresh: false })
        .catch(() => undefined)
        .finally(() => {
          isSyncing = false;
        });
    };
    const refreshInterval = window.setInterval(refreshAcademyData, academyAutoRefreshIntervalMs);

    return () => {
      window.clearInterval(refreshInterval);
    };
  }, [
    academyAutoRefreshIntervalMs,
    activeMode.id,
  ]);

  useEffect(() => {
    let isCancelled = false;

    canvasToDoApi
      .getCanvasCourses(100)
      .then(({ courses, isComplete, termName }) => {
        if (isCancelled) {
          return;
        }

        setCanvasCourses(courses);
        setCanvasCourseListIsComplete(isComplete === true);
        setCanvasTermName(termName);
        setCanvasCourseLoadStatus('loaded');
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setCanvasCourses(null);
        setCanvasCourseListIsComplete(false);
        setCanvasTermName(undefined);
        setCanvasCourseLoadStatus('failed');
      });

    return () => {
      isCancelled = true;
    };
  }, [activeMode.id]);

  useEffect(() => {
    let isCancelled = false;

    const requestSequence = ++canvasCourseworkRequestSequenceRef.current;
    canvasToDoApi
      .getCanvasCalendarItems({
        endDate: getFutureDateString(120),
        pageSize: 100,
        startDate: getPastDateString(30),
      })
      .then(({ items }) => {
        if (isCancelled || canvasCourseworkRequestSequenceRef.current !== requestSequence) {
          return;
        }

        setCanvasCourseworkItems(items);
        setCanvasCourseworkLoadStatus('loaded');
      })
      .catch(() => {
        if (isCancelled || canvasCourseworkRequestSequenceRef.current !== requestSequence) {
          return;
        }

        setCanvasCourseworkItems([]);
        setCanvasCourseworkLoadStatus('failed');
      });

    return () => {
      isCancelled = true;
    };
  }, [activeMode.id]);

  const updateStoredManualLectures = (updater: (lectures: ManualLecture[]) => ManualLecture[]) => {
    setManualLectures((currentLectures) => {
      const nextLectures = updater(currentLectures);

      if (Object.is(nextLectures, currentLectures)) {
        return currentLectures;
      }

      manualLecturesRef.current = nextLectures;
      persistAcademyPreferences(
        nextLectures,
        canvasLecturePreferencesRef.current,
        manualCourseworkRef.current,
        canvasCourseworkPreferencesRef.current,
        manualAssessmentsRef.current,
        canvasAssessmentPreferencesRef.current,
      );

      return nextLectures;
    });
  };

  const updateStoredCanvasLecturePreferences = (
    updater: (preferences: CanvasLecturePreferences) => CanvasLecturePreferences,
  ) => {
    setCanvasLecturePreferences((currentPreferences) => {
      const nextPreferences = updater(currentPreferences);

      if (Object.is(nextPreferences, currentPreferences)) {
        return currentPreferences;
      }

      canvasLecturePreferencesRef.current = nextPreferences;
      persistAcademyPreferencePatch({
        canvasLecturePreferences: nextPreferences,
      });

      return nextPreferences;
    });
  };

  const updateStoredManualCoursework = (
    updater: (coursework: ManualCourseworkItem[]) => ManualCourseworkItem[],
    options: { persist?: boolean } = {},
  ) => {
    const shouldPersist = options.persist !== false;

    setManualCoursework((currentCoursework) => {
      const nextCoursework = updater(currentCoursework);

      if (Object.is(nextCoursework, currentCoursework)) {
        return currentCoursework;
      }

      manualCourseworkRef.current = nextCoursework;
      if (shouldPersist) {
        persistAcademyPreferences(
          manualLecturesRef.current,
          canvasLecturePreferencesRef.current,
          nextCoursework,
          canvasCourseworkPreferencesRef.current,
          manualAssessmentsRef.current,
          canvasAssessmentPreferencesRef.current,
        );
      }

      return nextCoursework;
    });
  };

  const updateStoredCanvasCourseworkPreferences = (
    updater: (preferences: CanvasCourseworkPreferences) => CanvasCourseworkPreferences,
    options: { persist?: boolean } = {},
  ) => {
    const shouldPersist = options.persist !== false;

    setCanvasCourseworkPreferences((currentPreferences) => {
      const nextPreferences = updater(currentPreferences);

      if (Object.is(nextPreferences, currentPreferences)) {
        return currentPreferences;
      }

      canvasCourseworkPreferencesRef.current = nextPreferences;
      if (shouldPersist) {
        persistAcademyPreferencePatch({
          canvasCourseworkPreferences: nextPreferences,
        });
      }

      return nextPreferences;
    });
  };

  const updateStoredManualAssessments = (
    updater: (assessments: ManualAssessmentItem[]) => ManualAssessmentItem[],
    options: { persist?: boolean } = {},
  ) => {
    const shouldPersist = options.persist !== false;

    setManualAssessments((currentAssessments) => {
      const nextAssessments = updater(currentAssessments);

      if (Object.is(nextAssessments, currentAssessments)) {
        return currentAssessments;
      }

      manualAssessmentsRef.current = nextAssessments;
      if (shouldPersist) {
        persistAcademyPreferences(
          manualLecturesRef.current,
          canvasLecturePreferencesRef.current,
          manualCourseworkRef.current,
          canvasCourseworkPreferencesRef.current,
          nextAssessments,
          canvasAssessmentPreferencesRef.current,
        );
      }

      return nextAssessments;
    });
  };

  const updateStoredCanvasAssessmentPreferences = (
    updater: (preferences: CanvasAssessmentPreferences) => CanvasAssessmentPreferences,
    options: { persist?: boolean } = {},
  ) => {
    const shouldPersist = options.persist !== false;

    setCanvasAssessmentPreferences((currentPreferences) => {
      const nextPreferences = updater(currentPreferences);

      if (Object.is(nextPreferences, currentPreferences)) {
        return currentPreferences;
      }

      canvasAssessmentPreferencesRef.current = nextPreferences;
      if (shouldPersist) {
        persistAcademyPreferencePatch({
          canvasAssessmentPreferences: nextPreferences,
        });
      }

      return nextPreferences;
    });
  };

  useEffect(() => {
    if (!hasLoadedAcademyPreferences || !canvasCourses || canvasCourses.length === 0) {
      return;
    }

    updateStoredCanvasLecturePreferences((currentPreferences) => {
      let changed = false;
      const nextPreferences = { ...currentPreferences };
      const seenAt = new Date().toISOString();

      canvasCourses.forEach((course) => {
        const preference = currentPreferences[course.id] ?? {};
        const originalCourseCode = course.courseCode?.trim() || course.id;
        const reportedSemester = normalizeCanvasSemesterName(course.termName);
        const reportedSemesterIsUsable = reportedSemester !== noTermSemester;
        const storedSemester = normalizeCanvasSemesterName(preference.semester ?? preference.termName);
        const shouldUseReportedSemester = reportedSemesterIsUsable && (
          !preference.semester ||
          preference.semesterSource === 'canvas' ||
          preference.semesterSource === 'fallback' ||
          storedSemester === noTermSemester
        );
        const shouldUseDefaultTermSemester = !reportedSemesterIsUsable && (
          !preference.semester ||
          preference.semesterSource === 'canvas' ||
          preference.semesterSource === 'fallback' ||
          storedSemester === noTermSemester
        );
        const semester = normalizeSemesterName(
          shouldUseReportedSemester
            ? reportedSemester
            : shouldUseDefaultTermSemester
              ? reportedSemester
            : preference.semester ?? preference.termName ?? reportedSemester,
          fallbackCourseSemester,
        );
        const { changed: preferenceChanged, nextPreference } = mergeDefinedSnapshot(preference, {
          accessClosed: course.accessClosed === true,
          accessRestrictedByDate: course.accessRestrictedByDate === true,
          courseName: course.name,
          currentGrade: course.currentGrade,
          currentScore: course.currentScore,
          htmlUrl: course.htmlUrl,
          isPublished: course.isPublished,
          lastSeenAt: preference.lastSeenAt ?? seenAt,
          originalCourseCode,
          semesterSource: shouldUseReportedSemester
            ? 'canvas'
            : shouldUseDefaultTermSemester
              ? 'fallback'
              : preference.semesterSource ?? (reportedSemesterIsUsable ? 'canvas' : 'fallback'),
          semester,
          termEndAt: course.termEndAt,
          termName: semester,
          termStartAt: course.termStartAt,
          workflowState: course.workflowState,
        });

        if (preferenceChanged) {
          nextPreferences[course.id] = nextPreference;
          changed = true;
        }
      });

      return changed ? nextPreferences : currentPreferences;
    });
  }, [activeMode.id, canvasCourses, fallbackCourseSemester, hasLoadedAcademyPreferences]);

  useEffect(() => {
    if (canvasCourseLoadStatus !== 'loaded' || !reportedCanvasSemester) {
      return;
    }

    const lastCanvasTermName = getLastCanvasTermNameFromSettings(getStoredAcademyCalendarSettings());
    const currentSelectedSemester = normalizeSemesterName(
      selectedSemesterFromProps ?? selectedCourseSemester,
      fallbackCourseSemester,
    );

    if (lastCanvasTermName === reportedCanvasSemester) {
      return;
    }

    if (
      selectedSemesterFromProps &&
      currentSelectedSemester !== normalizeSemesterName(lastCanvasTermName, fallbackCourseSemester)
    ) {
      return;
    }

    storeCanvasTermSelection(reportedCanvasSemester);
    persistAcademyPreferences(
      manualLecturesRef.current,
      canvasLecturePreferencesRef.current,
      manualCourseworkRef.current,
      canvasCourseworkPreferencesRef.current,
      manualAssessmentsRef.current,
      canvasAssessmentPreferencesRef.current,
      {
        calendarSettings: {
          lastCanvasTermName: reportedCanvasSemester,
          selectedSemester: reportedCanvasSemester,
        },
      },
    );
  }, [
    activeMode.id,
    canvasCourseLoadStatus,
    fallbackCourseSemester,
    reportedCanvasSemester,
    selectedCourseSemester,
    selectedSemesterFromProps,
  ]);

  useEffect(() => {
    if (
      canvasCourseLoadStatus !== 'loaded' ||
      !canvasCourses
    ) {
      return;
    }

    const courseById = new Map(canvasCourses.map((course) => [course.id, course]));
    const now = Date.now();
    const currentPreferences = canvasLecturePreferencesRef.current;
    const currentManualLectures = manualLecturesRef.current;
    const archivedLectures: ManualLecture[] = [];
    const nextPreferences = { ...currentPreferences };
    let changed = false;

    Object.entries(currentPreferences).forEach(([courseId, preference]) => {
      if (preference.archivedAsManualLectureId || preference.convertedToManualAt) {
        return;
      }

      const course = courseById.get(courseId);

      if (!shouldConvertCanvasCourseToManual(course, now, {
        courseListIsComplete: canvasCourseListIsComplete,
        wasPreviouslySeen: Boolean(preference.lastSeenAt),
      })) {
        return;
      }

      const archivedLecture = createArchivedManualLectureFromCanvasPreference(
        courseId,
        preference,
        fallbackCourseSemester,
      );

      if (!archivedLecture) {
        return;
      }

      const manualLectureId = `manual-canvas-${courseId}`;
      const alreadyStored = currentManualLectures.some((lecture) => lecture.id === manualLectureId);

      if (!alreadyStored) {
        archivedLectures.push({
          ...archivedLecture,
          id: manualLectureId,
          canvasGradeSummary: {
            grade: preference.currentGrade,
            score: preference.currentScore,
          },
        });
      }

      nextPreferences[courseId] = {
        ...preference,
        convertedToManualAt: new Date(now).toISOString(),
        deleted: true,
        hidden: true,
      };
      changed = true;
    });

    if (!changed && archivedLectures.length === 0) {
      return;
    }

    const nextManualLectures = archivedLectures.length > 0
      ? [...currentManualLectures, ...archivedLectures]
      : currentManualLectures;

    manualLecturesRef.current = nextManualLectures;
    canvasLecturePreferencesRef.current = nextPreferences;
    setManualLectures(nextManualLectures);
    setCanvasLecturePreferences(nextPreferences);
    persistAcademyPreferences(
      nextManualLectures,
      nextPreferences,
      manualCourseworkRef.current,
      canvasCourseworkPreferencesRef.current,
      manualAssessmentsRef.current,
      canvasAssessmentPreferencesRef.current,
    );
  }, [
    activeMode.id,
    canvasCourseListIsComplete,
    canvasCourseLoadStatus,
    canvasCourses,
    canvasLecturePreferences,
    fallbackCourseSemester,
  ]);

  useEffect(() => {
    if (canvasCourseworkItems.length === 0) {
      return;
    }

    updateStoredCanvasCourseworkPreferences((currentPreferences) => {
      let changed = false;
      const nextPreferences = { ...currentPreferences };

      canvasCourseworkItems.filter(isCourseworkCanvasItem).forEach((item) => {
        if (isManuallyManagedCanvasCourse(item.courseId, canvasLecturePreferencesRef.current)) {
          return;
        }

        const preference = currentPreferences[item.id] ?? {};
        const coursePreferences = item.courseId ? canvasLecturePreferencesRef.current[item.courseId] : undefined;
        const courseCode =
          preference.courseCode?.trim() ||
          coursePreferences?.friendlyCourseCode?.trim() ||
          item.courseCode?.trim() ||
          item.contextCode?.replace(/^course_/i, '');
        const semester = getCanvasItemSemester(
          item,
          preference,
          canvasCourses,
          canvasLecturePreferencesRef.current,
          fallbackCourseSemester,
        );
        const { changed: snapshotChanged, nextPreference: snapshotPreference } = mergeDefinedSnapshot(preference, {
          assignmentId: item.assignmentId ?? preference.assignmentId,
          courseCode,
          courseId: item.courseId,
          courseName: item.courseName,
          courseworkType: preference.courseworkType ?? item.type,
          dueAt: item.dueAt ?? preference.dueAt,
          endAt: item.endAt ?? preference.endAt,
          htmlUrl: item.htmlUrl,
          originalCourseCode: item.courseCode?.trim() || courseCode,
          semester,
          startAt: item.startAt ?? preference.startAt,
          submissionType: preference.submissionType ?? item.submissionTypes?.[0] ?? formatSubmissionType(item.type),
          title: preference.title ?? item.title,
        });
        const submissionStatus =
          getProtectedCanvasSubmissionStatus(protectedCanvasSubmissionStatusesRef.current, item.id, snapshotPreference, item) ??
          item;
        const { changed: submissionChanged, nextPreference } = syncCanvasSubmissionPreference(
          snapshotPreference,
          submissionStatus,
        );

        if (snapshotChanged || submissionChanged) {
          nextPreferences[item.id] = nextPreference;
          changed = true;
        }
      });

      return changed ? nextPreferences : currentPreferences;
    });

    updateStoredCanvasAssessmentPreferences((currentPreferences) => {
      let changed = false;
      const nextPreferences = { ...currentPreferences };

      canvasCourseworkItems.filter(isAssessmentCanvasItem).forEach((item) => {
        if (isManuallyManagedCanvasCourse(item.courseId, canvasLecturePreferencesRef.current)) {
          return;
        }

        const preference = currentPreferences[item.id] ?? {};
        const coursePreferences = item.courseId ? canvasLecturePreferencesRef.current[item.courseId] : undefined;
        const courseCode =
          preference.courseCode?.trim() ||
          coursePreferences?.friendlyCourseCode?.trim() ||
          item.courseCode?.trim() ||
          item.contextCode?.replace(/^course_/i, '');
        const semester = getCanvasItemSemester(
          item,
          preference,
          canvasCourses,
          canvasLecturePreferencesRef.current,
          fallbackCourseSemester,
        );
        const { changed: snapshotChanged, nextPreference: snapshotPreference } = mergeDefinedSnapshot(preference, {
          assignmentId: item.assignmentId ?? preference.assignmentId,
          assessmentType: preference.assessmentType ?? item.type,
          courseCode,
          courseId: item.courseId,
          courseName: item.courseName,
          dueAt: item.dueAt ?? preference.dueAt,
          endAt: item.endAt ?? preference.endAt,
          htmlUrl: item.htmlUrl,
          originalCourseCode: item.courseCode?.trim() || courseCode,
          semester,
          startAt: item.startAt ?? preference.startAt,
          title: preference.title ?? item.title,
        });
        const submissionStatus =
          getProtectedCanvasSubmissionStatus(protectedCanvasSubmissionStatusesRef.current, item.id, snapshotPreference, item) ??
          item;
        const { changed: submissionChanged, nextPreference } = syncCanvasSubmissionPreference(
          snapshotPreference,
          submissionStatus,
        );

        if (snapshotChanged || submissionChanged) {
          nextPreferences[item.id] = nextPreference;
          changed = true;
        }
      });

      return changed ? nextPreferences : currentPreferences;
    });
  }, [activeMode.id, canvasCourses, canvasCourseworkItems, fallbackCourseSemester]);

  const handleAddManualLecture = (lecture: ManualLecture) => {
    updateStoredManualLectures((currentLectures) => [
      ...currentLectures,
      { ...lecture, semester: normalizeSemesterName(lecture.semester, activeCourseSemester) },
    ]);
  };

  const handleUpdateManualLecture = (updatedLecture: ManualLecture) => {
    const previousLecture = manualLecturesRef.current.find((lecture) => lecture.id === updatedLecture.id);
    const nextSemester = normalizeSemesterName(updatedLecture.semester, activeCourseSemester);

    updateStoredManualLectures((currentLectures) => currentLectures.map((lecture) => (
      lecture.id === updatedLecture.id
        ? { ...updatedLecture, semester: nextSemester }
        : lecture
    )));

    if (!previousLecture || lectureSemesterMatches(previousLecture, nextSemester, fallbackCourseSemester)) {
      return;
    }

    updateStoredManualCoursework((currentCoursework) => {
      let changed = false;
      const nextCoursework = currentCoursework.map((item) => {
        if (!isManualCourseworkForLecture(item, previousLecture, fallbackCourseSemester)) {
          return item;
        }

        changed = true;
        return { ...item, semester: nextSemester };
      });

      return changed ? nextCoursework : currentCoursework;
    });
    updateStoredManualAssessments((currentAssessments) => {
      let changed = false;
      const nextAssessments = currentAssessments.map((item) => {
        if (!isManualCourseworkForLecture(item, previousLecture, fallbackCourseSemester)) {
          return item;
        }

        changed = true;
        return { ...item, semester: nextSemester };
      });

      return changed ? nextAssessments : currentAssessments;
    });

    const archivedCanvasCourseId = findArchivedCanvasCourseId(previousLecture, canvasLecturePreferencesRef.current);

    if (!archivedCanvasCourseId) {
      return;
    }

    updateStoredCanvasCourseworkPreferences((currentPreferences) => {
      let changed = false;
      const nextPreferences = Object.fromEntries(
        Object.entries(currentPreferences).map(([itemId, preference]) => {
          if (
            !isCanvasCourseworkPreferenceForLecture(
              preference,
              previousLecture,
              archivedCanvasCourseId,
              fallbackCourseSemester,
            )
          ) {
            return [itemId, preference];
          }

          changed = true;
          return [itemId, { ...preference, semester: nextSemester }];
        }),
      );

      return changed ? nextPreferences : currentPreferences;
    });
    updateStoredCanvasAssessmentPreferences((currentPreferences) => {
      let changed = false;
      const nextPreferences = Object.fromEntries(
        Object.entries(currentPreferences).map(([itemId, preference]) => {
          if (
            !isCanvasCourseworkPreferenceForLecture(
              preference,
              previousLecture,
              archivedCanvasCourseId,
              fallbackCourseSemester,
            )
          ) {
            return [itemId, preference];
          }

          changed = true;
          return [itemId, { ...preference, semester: nextSemester }];
        }),
      );

      return changed ? nextPreferences : currentPreferences;
    });
  };

  const handleDeleteManualLecture = (lecture: ManualLecture, shouldDeleteCoursework: boolean) => {
    const liveCanvasCourseId = lecture.id.startsWith('canvas:') ? lecture.id.slice('canvas:'.length) : undefined;
    const archivedCanvasCourseId = liveCanvasCourseId ?? findArchivedCanvasCourseId(lecture, canvasLecturePreferencesRef.current);
    const nextManualLectures = liveCanvasCourseId
      ? manualLecturesRef.current
      : manualLecturesRef.current.map((storedLecture) => (
          storedLecture.id === lecture.id
            ? { ...storedLecture, deleted: true, hidden: true }
            : storedLecture
        ));
    const nextCanvasLecturePreferences = { ...canvasLecturePreferencesRef.current };
    let nextManualCoursework = manualCourseworkRef.current;
    let nextCanvasCourseworkPreferences = canvasCourseworkPreferencesRef.current;
    let nextManualAssessments = manualAssessmentsRef.current;
    let nextCanvasAssessmentPreferences = canvasAssessmentPreferencesRef.current;

    if (archivedCanvasCourseId) {
      nextCanvasLecturePreferences[archivedCanvasCourseId] = {
        ...(nextCanvasLecturePreferences[archivedCanvasCourseId] ?? {}),
        archivedAsManualLectureId: liveCanvasCourseId ? undefined : lecture.id,
        deleted: true,
        hidden: true,
      };
    }

    if (shouldDeleteCoursework) {
      nextManualCoursework = manualCourseworkRef.current.map((item) => (
        isManualCourseworkForLecture(item, lecture, fallbackCourseSemester)
          ? { ...item, hidden: true }
          : item
      ));
      nextManualAssessments = manualAssessmentsRef.current.map((item) => (
        isManualCourseworkForLecture(item, lecture, fallbackCourseSemester)
          ? { ...item, hidden: true }
          : item
      ));
      nextCanvasCourseworkPreferences = Object.fromEntries(
        Object.entries(canvasCourseworkPreferencesRef.current).map(([courseworkId, preference]) => [
          courseworkId,
          isCanvasCourseworkPreferenceForLecture(preference, lecture, archivedCanvasCourseId, fallbackCourseSemester)
            ? { ...preference, hidden: true }
            : preference,
        ]),
      );
      nextCanvasAssessmentPreferences = Object.fromEntries(
        Object.entries(canvasAssessmentPreferencesRef.current).map(([assessmentId, preference]) => [
          assessmentId,
          isCanvasCourseworkPreferenceForLecture(preference, lecture, archivedCanvasCourseId, fallbackCourseSemester)
            ? { ...preference, hidden: true }
            : preference,
        ]),
      );
    }

    manualLecturesRef.current = nextManualLectures;
    canvasLecturePreferencesRef.current = nextCanvasLecturePreferences;
    manualCourseworkRef.current = nextManualCoursework;
    canvasCourseworkPreferencesRef.current = nextCanvasCourseworkPreferences;
    manualAssessmentsRef.current = nextManualAssessments;
    canvasAssessmentPreferencesRef.current = nextCanvasAssessmentPreferences;
    setManualLectures(nextManualLectures);
    setCanvasLecturePreferences(nextCanvasLecturePreferences);
    setManualCoursework(nextManualCoursework);
    setCanvasCourseworkPreferences(nextCanvasCourseworkPreferences);
    setManualAssessments(nextManualAssessments);
    setCanvasAssessmentPreferences(nextCanvasAssessmentPreferences);
    persistAcademyPreferences(
      nextManualLectures,
      nextCanvasLecturePreferences,
      nextManualCoursework,
      nextCanvasCourseworkPreferences,
      nextManualAssessments,
      nextCanvasAssessmentPreferences,
    );
    setSelectedManualLectureId(null);
    setSelectedCanvasCourseId(null);
    setLecturePendingDelete(null);
  };

  const handleUpdateCanvasLecture = (updatedLecture: ManualLecture) => {
    if (!selectedCanvasCourseId) {
      return;
    }

    const originalCourseCode =
      selectedCanvasCourse?.courseCode?.trim() ||
      selectedCanvasCourse?.id ||
      updatedLecture.code;
    const nextSemester = normalizeSemesterName(updatedLecture.semester, activeCourseSemester);

    updateStoredCanvasLecturePreferences((currentPreferences) => ({
      ...currentPreferences,
      [selectedCanvasCourseId]: {
        ...(currentPreferences[selectedCanvasCourseId] ?? {}),
        assessments: updatedLecture.assessments,
        credits: updatedLecture.credits,
        friendlyCourseCode: updatedLecture.code || undefined,
        friendlyName: updatedLecture.name || undefined,
        labSection: updatedLecture.labSection,
        lectureSection: updatedLecture.lectureSection,
        links: updatedLecture.links,
        originalCourseCode,
        schedule: updatedLecture.schedule,
        semester: nextSemester,
        semesterSource: 'manual',
        termName: nextSemester,
        tutorialSection: updatedLecture.tutorialSection,
      },
    }));
    updateStoredCanvasCourseworkPreferences((currentPreferences) => {
      let changed = false;
      const nextPreferences = Object.fromEntries(
        Object.entries(currentPreferences).map(([itemId, preference]) => {
          if (preference.courseId !== selectedCanvasCourseId || preference.semester === nextSemester) {
            return [itemId, preference];
          }

          changed = true;
          return [itemId, { ...preference, semester: nextSemester }];
        }),
      );

      return changed ? nextPreferences : currentPreferences;
    });
    updateStoredCanvasAssessmentPreferences((currentPreferences) => {
      let changed = false;
      const nextPreferences = Object.fromEntries(
        Object.entries(currentPreferences).map(([itemId, preference]) => {
          if (preference.courseId !== selectedCanvasCourseId || preference.semester === nextSemester) {
            return [itemId, preference];
          }

          changed = true;
          return [itemId, { ...preference, semester: nextSemester }];
        }),
      );

      return changed ? nextPreferences : currentPreferences;
    });
  };

  const handleAddManualCoursework = (coursework: ManualCourseworkItem) => {
    updateStoredManualCoursework((currentCoursework) => [
      ...currentCoursework,
      {
        ...coursework,
        dueAt: coursework.dueAt || getDefaultCourseworkDueAt(),
        semester: normalizeSemesterName(coursework.semester, activeCourseSemester),
      },
    ]);
    setInitialManualCourseworkDraft(undefined);
    setIsCourseworkDialogOpen(false);
  };

  const handleUpdateManualCoursework = (updatedCoursework: ManualCourseworkItem) => {
    updateStoredManualCoursework((currentCoursework) => currentCoursework.map((coursework) => (
      coursework.id === updatedCoursework.id
        ? {
            ...updatedCoursework,
            completedAt: updatedCoursework.completed
              ? coursework.completedAt ?? new Date().toISOString()
              : undefined,
            semester: normalizeSemesterName(updatedCoursework.semester, activeCourseSemester),
          }
        : coursework
    )));
    setSelectedManualCourseworkId(null);
  };

  const handleUpdateCanvasCoursework = (updatedCoursework: ManualCourseworkItem) => {
    if (!selectedCanvasCourseworkId) {
      return;
    }

    updateStoredCanvasCourseworkPreferences((currentPreferences) => {
      const currentItemPreferences = currentPreferences[selectedCanvasCourseworkId] ?? {};
      const isLiveCanvasItem = Boolean(selectedCanvasCoursework);
      const canvasDueAt = selectedCanvasCoursework?.dueAt ?? selectedCanvasCoursework?.startAt;

      return {
        ...currentPreferences,
        [selectedCanvasCourseworkId]: {
          ...currentItemPreferences,
          chipColor: updatedCoursework.chipColor,
          completed: updatedCoursework.completed,
          completedAt: updatedCoursework.completed
            ? currentItemPreferences.completedAt ?? new Date().toISOString()
            : undefined,
          courseCode: updatedCoursework.courseCode || undefined,
          courseworkType: updatedCoursework.courseworkType || undefined,
          dueAt: isLiveCanvasItem ? canvasDueAt ?? currentItemPreferences.dueAt : updatedCoursework.dueAt || undefined,
          endAt: isLiveCanvasItem ? selectedCanvasCoursework?.endAt ?? currentItemPreferences.endAt : updatedCoursework.endAt || undefined,
          semester: normalizeSemesterName(updatedCoursework.semester, activeCourseSemester),
          startAt: isLiveCanvasItem ? selectedCanvasCoursework?.startAt ?? currentItemPreferences.startAt : updatedCoursework.startAt || undefined,
          submissionType: updatedCoursework.submissionType || undefined,
          title: updatedCoursework.title || undefined,
        },
      };
    });
    setSelectedCanvasCourseworkId(null);
  };

  const handleAddManualAssessment = (assessment: ManualAssessmentItem) => {
    updateStoredManualAssessments((currentAssessments) => [
      ...currentAssessments,
      { ...assessment, semester: normalizeSemesterName(assessment.semester, activeCourseSemester) },
    ]);
    setIsAssessmentDialogOpen(false);
  };

  const handleUpdateManualAssessment = (updatedAssessment: ManualAssessmentItem) => {
    updateStoredManualAssessments((currentAssessments) => currentAssessments.map((assessment) => (
      assessment.id === updatedAssessment.id
        ? {
            ...updatedAssessment,
            completedAt: updatedAssessment.completed
              ? assessment.completedAt ?? new Date().toISOString()
              : undefined,
            semester: normalizeSemesterName(updatedAssessment.semester, activeCourseSemester),
          }
        : assessment
    )));
    setSelectedManualAssessmentId(null);
  };

  const handleUpdateCanvasAssessment = (updatedAssessment: ManualAssessmentItem) => {
    if (!selectedCanvasAssessmentId) {
      return;
    }

    updateStoredCanvasAssessmentPreferences((currentPreferences) => {
      const currentItemPreferences = currentPreferences[selectedCanvasAssessmentId] ?? {};
      const isLiveCanvasItem = Boolean(selectedCanvasAssessment);
      const canvasDueAt = selectedCanvasAssessment?.dueAt ?? selectedCanvasAssessment?.startAt;

      return {
        ...currentPreferences,
        [selectedCanvasAssessmentId]: {
          ...currentItemPreferences,
          assessmentType: updatedAssessment.assessmentType || undefined,
          completed: updatedAssessment.completed,
          completedAt: updatedAssessment.completed
            ? currentItemPreferences.completedAt ?? new Date().toISOString()
            : undefined,
          courseCode: updatedAssessment.courseCode || undefined,
          dueAt: isLiveCanvasItem ? canvasDueAt ?? currentItemPreferences.dueAt : updatedAssessment.dueAt || undefined,
          endAt: isLiveCanvasItem ? selectedCanvasAssessment?.endAt ?? currentItemPreferences.endAt : updatedAssessment.endAt || undefined,
          semester: normalizeSemesterName(updatedAssessment.semester, activeCourseSemester),
          startAt: isLiveCanvasItem ? selectedCanvasAssessment?.startAt ?? currentItemPreferences.startAt : updatedAssessment.startAt || undefined,
          title: updatedAssessment.title || undefined,
        },
      };
    });
    setSelectedCanvasAssessmentId(null);
  };

  const handleOpenAssessment = (row: RenderableDashboardRow) => {
    if (row.assessmentSource === 'canvas' && row.canvasAssessmentId) {
      setSelectedCanvasAssessmentId(row.canvasAssessmentId);
      return;
    }

    if (row.manualAssessmentId) {
      setSelectedManualAssessmentId(row.manualAssessmentId);
    }
  };

  const handleOpenCoursework = (row: RenderableDashboardRow) => {
    if (row.courseworkSource === 'canvas' && row.canvasCourseworkId) {
      setSelectedCanvasCourseworkId(row.canvasCourseworkId);
      return;
    }

    if (row.manualCourseworkId) {
      setSelectedManualCourseworkId(row.manualCourseworkId);
    }
  };

  const handleOpenCourseworkLink = (row: RenderableDashboardRow) => {
    if (row.courseworkSource === 'canvas' || row.assessmentSource === 'canvas') {
      const canvasCourseId = row.canvasCourseId ||
        Object.entries(canvasLecturePreferencesRef.current).find(([, preference]) => (
          codesMatch(row.originalCourseCode, preference.friendlyCourseCode) ||
          codesMatch(row.originalCourseCode, preference.originalCourseCode) ||
          codesMatch(row.label, preference.friendlyCourseCode)
        ))?.[0];

      if (canvasCourseId) {
        onOpenCourse?.(`canvas:${canvasCourseId}`, row.href ?? null);
      }

      return;
    }

    const manualLecture = manualLecturesRef.current.find((lecture) => (
      codesMatch(row.originalCourseCode, lecture.friendlyCourseCode) ||
      codesMatch(row.originalCourseCode, lecture.code) ||
      codesMatch(row.label, lecture.friendlyCourseCode) ||
      codesMatch(row.label, lecture.code)
    ));

    if (!manualLecture) {
      return;
    }

    const submissionUrl = getManualLectureLinkUrl(manualLecture, 'submission-link');
    const lectureWebsiteUrl = getManualLectureLinkUrl(manualLecture, 'lecture-website');
    const resourceUrl = submissionUrl ?? lectureWebsiteUrl;

    onOpenCourse?.(`manual:${manualLecture.id}`, resourceUrl ?? null);
  };

  const handleOpenLecture = (row: RenderableDashboardRow) => {
    if (row.lectureSource === 'canvas' && row.canvasCourseId) {
      onOpenCourse?.(`canvas:${row.canvasCourseId}`, row.href ?? null);
      return;
    }

    if (row.manualLectureId) {
      const manualLecture = manualLecturesRef.current.find((lecture) => lecture.id === row.manualLectureId);
      const lectureWebsiteUrl = manualLecture
        ? getManualLectureLinkUrl(manualLecture, 'lecture-website')
        : undefined;

      onOpenCourse?.(`manual:${row.manualLectureId}`, lectureWebsiteUrl ?? null);
      return;
    }

    onOpenCourse?.(null, null);
  };

  const handleOpenLectureDetails = (row: RenderableDashboardRow) => {
    if (row.lectureSource === 'canvas' && row.canvasCourseId) {
      setSelectedCanvasCourseId(row.canvasCourseId);
      return;
    }

    if (row.manualLectureId) {
      setSelectedManualLectureId(row.manualLectureId);
    }
  };

  const createDeleteLectureFromRow = (row: RenderableDashboardRow): ManualLecture | null => {
    if (row.manualLectureId) {
      return manualLecturesRef.current.find((lecture) => lecture.id === row.manualLectureId) ?? null;
    }

    if (!row.canvasCourseId) {
      return null;
    }

    const course = canvasCourses?.find((canvasCourse) => String(canvasCourse.id ?? '') === row.canvasCourseId);
    const preference = canvasLecturePreferencesRef.current[row.canvasCourseId] ?? {};

    if (course) {
      return createCanvasEditableLecture(course, preference);
    }

    return {
      id: `canvas:${row.canvasCourseId}`,
      name: preference.friendlyName?.trim() || preference.courseName?.trim() || row.friendlyName || row.courseName || row.value,
      code: preference.friendlyCourseCode?.trim() || preference.originalCourseCode?.trim() || row.friendlyCourseCode || row.originalCourseCode || row.label,
      lectureSection: preference.lectureSection ?? '',
      labSection: preference.labSection ?? '',
      tutorialSection: preference.tutorialSection ?? '',
      credits: preference.credits ?? '',
      assessments: preference.assessments ?? [],
      schedule: preference.schedule ?? {
        deliveryMode: 'inPerson',
        day: '',
        time: '',
        location: '',
        entries: [],
      },
      links: preference.links ?? [],
      chipColor: preference.chipColor ?? row.chipColor ?? defaultCourseChipColor,
      friendlyCourseCode: preference.friendlyCourseCode,
      friendlyName: preference.friendlyName,
      hidden: preference.hidden,
      semester: normalizeSemesterName(preference.semester ?? preference.termName ?? row.semester, activeCourseSemester),
      starred: preference.starred,
    };
  };

  const handleRequestDeleteLecture = (row: RenderableDashboardRow) => {
    if (normalizeSemesterName(row.semester) !== noTermSemester) {
      return;
    }

    const lecture = createDeleteLectureFromRow(row);

    if (lecture) {
      setLecturePendingDelete(lecture);
    }
  };

  const handleOpenLectureFriendlyName = (row: RenderableDashboardRow) => {
    setFriendlyNameRow(row);
    setFriendlyCourseCodeInput(row.friendlyCourseCode ?? row.originalCourseCode ?? row.label);
    setFriendlyNameInput(row.friendlyName ?? '');
  };

  const handleSaveLectureFriendlyName = () => {
    if (!friendlyNameRow) {
      return;
    }

    const friendlyName = friendlyNameInput.trim();
    const friendlyCourseCode = friendlyCourseCodeInput.trim();

    if (friendlyNameRow.lectureSource === 'canvas' && friendlyNameRow.canvasCourseId) {
      updateStoredCanvasLecturePreferences((currentPreferences) => ({
        ...currentPreferences,
        [friendlyNameRow.canvasCourseId!]: {
          ...(currentPreferences[friendlyNameRow.canvasCourseId!] ?? {}),
          friendlyCourseCode: friendlyCourseCode || undefined,
          friendlyName: friendlyName || undefined,
          originalCourseCode: friendlyNameRow.originalCourseCode,
        },
      }));
    } else if (friendlyNameRow.manualLectureId) {
      updateStoredManualLectures((currentLectures) => currentLectures.map((lecture) => (
        lecture.id === friendlyNameRow.manualLectureId
          ? {
              ...lecture,
              friendlyCourseCode: friendlyCourseCode || undefined,
              friendlyName: friendlyName || undefined,
            }
          : lecture
      )));
    }

    setFriendlyNameRow(null);
    setFriendlyCourseCodeInput('');
    setFriendlyNameInput('');
  };

  const handleToggleLectureStar = (row: RenderableDashboardRow) => {
    if (row.lectureSource === 'canvas' && row.canvasCourseId) {
      updateStoredCanvasLecturePreferences((currentPreferences) => {
        const currentCoursePreferences = currentPreferences[row.canvasCourseId!] ?? {};

        return {
          ...currentPreferences,
          [row.canvasCourseId!]: {
            ...currentCoursePreferences,
            starred: !currentCoursePreferences.starred,
          },
        };
      });
      return;
    }

    if (!row.manualLectureId) {
      return;
    }

    updateStoredManualLectures((currentLectures) => currentLectures.map((lecture) => (
      lecture.id === row.manualLectureId
        ? { ...lecture, starred: !lecture.starred }
        : lecture
    )));
  };

  const handleHideLecture = (row: RenderableDashboardRow) => {
    if (row.lectureSource === 'canvas' && row.canvasCourseId) {
      updateStoredCanvasLecturePreferences((currentPreferences) => ({
        ...currentPreferences,
        [row.canvasCourseId!]: {
          ...(currentPreferences[row.canvasCourseId!] ?? {}),
          hidden: true,
        },
      }));
      return;
    }

    if (!row.manualLectureId) {
      return;
    }

    updateStoredManualLectures((currentLectures) => currentLectures.map((lecture) => (
      lecture.id === row.manualLectureId
        ? { ...lecture, hidden: true }
        : lecture
    )));
  };

  const handleSetLectureChipColor = (row: RenderableDashboardRow, color: ColorToken) => {
    if (row.lectureSource === 'canvas' && row.canvasCourseId) {
      updateStoredCanvasLecturePreferences((currentPreferences) => ({
        ...currentPreferences,
        [row.canvasCourseId!]: {
          ...(currentPreferences[row.canvasCourseId!] ?? {}),
          chipColor: color,
          originalCourseCode: row.originalCourseCode,
        },
      }));
      return;
    }

    if (!row.manualLectureId) {
      return;
    }

    updateStoredManualLectures((currentLectures) => currentLectures.map((lecture) => (
      lecture.id === row.manualLectureId
        ? { ...lecture, chipColor: color }
        : lecture
    )));
  };

  const handleToggleCourseworkStar = (row: RenderableDashboardRow) => {
    if (row.courseworkSource === 'canvas' && row.canvasCourseworkId) {
      updateStoredCanvasCourseworkPreferences((currentPreferences) => {
        const currentItemPreferences = currentPreferences[row.canvasCourseworkId!] ?? {};

        return {
          ...currentPreferences,
          [row.canvasCourseworkId!]: {
            ...currentItemPreferences,
            starred: !currentItemPreferences.starred,
          },
        };
      });
      return;
    }

    if (!row.manualCourseworkId) {
      return;
    }

    updateStoredManualCoursework((currentCoursework) => currentCoursework.map((coursework) => (
      coursework.id === row.manualCourseworkId
        ? { ...coursework, starred: !coursework.starred }
      : coursework
    )));
  };

  const handleMoveCourseworkDueDate = (row: RenderableDashboardRow, target: 'today' | 'tomorrow') => {
    if (row.isCanvasSubmitted) {
      return;
    }

    const dueAt = getCourseworkDueAtForTargetDay(target);

    if (row.courseworkSource === 'canvas' && row.canvasCourseworkId) {
      updateStoredCanvasCourseworkPreferences((currentPreferences) => ({
        ...currentPreferences,
        [row.canvasCourseworkId!]: {
          ...(currentPreferences[row.canvasCourseworkId!] ?? {}),
          dueAt,
        },
      }));
      return;
    }

    if (!row.manualCourseworkId) {
      return;
    }

    updateStoredManualCoursework((currentCoursework) => currentCoursework.map((coursework) => (
      coursework.id === row.manualCourseworkId
        ? { ...coursework, dueAt }
        : coursework
    )));
  };

  const handleStartCourseworkRename = (row: RenderableDashboardRow) => {
    const renameKey = row.courseworkKey ?? row.assessmentKey;

    if (!renameKey || row.isCanvasSubmitted || isLiveCanvasDashboardRow(row)) {
      return;
    }

    setFocusedCourseworkKey(renameKey);
  };

  const handleRenameCoursework = (row: RenderableDashboardRow, title: string) => {
    if (isLiveCanvasDashboardRow(row)) {
      return;
    }

    if (row.courseworkSource === 'canvas' && row.canvasCourseworkId) {
      updateStoredCanvasCourseworkPreferences((currentPreferences) => ({
        ...currentPreferences,
        [row.canvasCourseworkId!]: {
          ...(currentPreferences[row.canvasCourseworkId!] ?? {}),
          title,
        },
      }), { persist: false });
      return;
    }

    if (row.assessmentSource === 'canvas' && row.canvasAssessmentId) {
      updateStoredCanvasAssessmentPreferences((currentPreferences) => ({
        ...currentPreferences,
        [row.canvasAssessmentId!]: {
          ...(currentPreferences[row.canvasAssessmentId!] ?? {}),
          title,
        },
      }), { persist: false });
      return;
    }

    if (row.manualCourseworkId) {
      updateStoredManualCoursework((currentCoursework) => currentCoursework.map((coursework) => (
        coursework.id === row.manualCourseworkId
          ? { ...coursework, title }
          : coursework
      )), { persist: false });
      return;
    }

    if (row.manualAssessmentId) {
      updateStoredManualAssessments((currentAssessments) => currentAssessments.map((assessment) => (
        assessment.id === row.manualAssessmentId
          ? { ...assessment, title }
          : assessment
      )), { persist: false });
    }
  };

  const handleFinishCourseworkRename = () => {
    setFocusedCourseworkKey(null);
    persistAcademyPreferences(
      manualLecturesRef.current,
      canvasLecturePreferencesRef.current,
      manualCourseworkRef.current,
      canvasCourseworkPreferencesRef.current,
      manualAssessmentsRef.current,
      canvasAssessmentPreferencesRef.current,
    );
  };

  const handleToggleAssessmentStar = (row: RenderableDashboardRow) => {
    if (row.assessmentSource === 'canvas' && row.canvasAssessmentId) {
      updateStoredCanvasAssessmentPreferences((currentPreferences) => {
        const currentItemPreferences = currentPreferences[row.canvasAssessmentId!] ?? {};

        return {
          ...currentPreferences,
          [row.canvasAssessmentId!]: {
            ...currentItemPreferences,
            starred: !currentItemPreferences.starred,
          },
        };
      });
      return;
    }

    if (!row.manualAssessmentId) {
      return;
    }

    updateStoredManualAssessments((currentAssessments) => currentAssessments.map((assessment) => (
      assessment.id === row.manualAssessmentId
        ? { ...assessment, starred: !assessment.starred }
      : assessment
    )));
  };

  const handleMoveAssessmentDueDate = (row: RenderableDashboardRow, target: 'today' | 'tomorrow') => {
    if (row.isCanvasSubmitted) {
      return;
    }

    const dueAt = getCourseworkDueAtForTargetDay(target);

    if (row.assessmentSource === 'canvas' && row.canvasAssessmentId) {
      updateStoredCanvasAssessmentPreferences((currentPreferences) => ({
        ...currentPreferences,
        [row.canvasAssessmentId!]: {
          ...(currentPreferences[row.canvasAssessmentId!] ?? {}),
          dueAt,
        },
      }));
      return;
    }

    if (!row.manualAssessmentId) {
      return;
    }

    updateStoredManualAssessments((currentAssessments) => currentAssessments.map((assessment) => (
      assessment.id === row.manualAssessmentId
        ? { ...assessment, dueAt }
        : assessment
    )));
  };

  const handleToggleCourseworkDone = (row: RenderableDashboardRow) => {
    if (row.isCanvasSubmitted) {
      return;
    }

    const checkedAt = new Date().toISOString();

    if (row.courseworkSource === 'canvas' && row.canvasCourseworkId) {
      updateStoredCanvasCourseworkPreferences((currentPreferences) => {
        const currentItemPreferences = currentPreferences[row.canvasCourseworkId!] ?? {};
        const liveItem = canvasCourseworkItems.find((item) => item.id === row.canvasCourseworkId);
        const nextCompleted = !currentItemPreferences.completed;

        clearProtectedCanvasSubmissionStatus(
          protectedCanvasSubmissionStatusesRef.current,
          row.canvasCourseworkId!,
          currentItemPreferences,
          liveItem,
        );

        return {
          ...currentPreferences,
          [row.canvasCourseworkId!]: {
            ...currentItemPreferences,
            completed: nextCompleted,
            completedAt: nextCompleted ? checkedAt : undefined,
            isSubmitted: false,
            submittedAt: undefined,
          },
        };
      });
      return;
    }

    if (!row.manualCourseworkId) {
      return;
    }

    updateStoredManualCoursework((currentCoursework) => currentCoursework.map((coursework) => (
      coursework.id === row.manualCourseworkId
        ? {
            ...coursework,
            completed: !coursework.completed,
            completedAt: coursework.completed ? undefined : checkedAt,
          }
        : coursework
    )));
  };

  const handleToggleAssessmentDone = (row: RenderableDashboardRow) => {
    if (row.isCanvasSubmitted) {
      return;
    }

    const checkedAt = new Date().toISOString();

    if (row.assessmentSource === 'canvas' && row.canvasAssessmentId) {
      updateStoredCanvasAssessmentPreferences((currentPreferences) => {
        const currentItemPreferences = currentPreferences[row.canvasAssessmentId!] ?? {};
        const liveItem = canvasCourseworkItems.find((item) => item.id === row.canvasAssessmentId);
        const nextCompleted = !currentItemPreferences.completed;

        clearProtectedCanvasSubmissionStatus(
          protectedCanvasSubmissionStatusesRef.current,
          row.canvasAssessmentId!,
          currentItemPreferences,
          liveItem,
        );

        return {
          ...currentPreferences,
          [row.canvasAssessmentId!]: {
            ...currentItemPreferences,
            completed: nextCompleted,
            completedAt: nextCompleted ? checkedAt : undefined,
            isSubmitted: false,
            submittedAt: undefined,
          },
        };
      });
      return;
    }

    if (!row.manualAssessmentId) {
      return;
    }

    updateStoredManualAssessments((currentAssessments) => currentAssessments.map((assessment) => (
      assessment.id === row.manualAssessmentId
        ? {
            ...assessment,
            completed: !assessment.completed,
            completedAt: assessment.completed ? undefined : checkedAt,
          }
        : assessment
    )));
  };

  const handleRemoveCoursework = (row: RenderableDashboardRow) => {
    if (row.courseworkSource === 'canvas' && row.canvasCourseworkId) {
      updateStoredCanvasCourseworkPreferences((currentPreferences) => ({
        ...currentPreferences,
        [row.canvasCourseworkId!]: {
          ...(currentPreferences[row.canvasCourseworkId!] ?? {}),
          hidden: true,
        },
      }));
      return;
    }

    if (!row.manualCourseworkId) {
      return;
    }

    updateStoredManualCoursework((currentCoursework) => currentCoursework.map((coursework) => (
      coursework.id === row.manualCourseworkId
        ? { ...coursework, hidden: true }
        : coursework
    )));
  };

  const handleRemoveAssessment = (row: RenderableDashboardRow) => {
    if (row.assessmentSource === 'canvas' && row.canvasAssessmentId) {
      updateStoredCanvasAssessmentPreferences((currentPreferences) => ({
        ...currentPreferences,
        [row.canvasAssessmentId!]: {
          ...(currentPreferences[row.canvasAssessmentId!] ?? {}),
          hidden: true,
        },
      }));
      return;
    }

    if (!row.manualAssessmentId) {
      return;
    }

    updateStoredManualAssessments((currentAssessments) => currentAssessments.map((assessment) => (
      assessment.id === row.manualAssessmentId
        ? { ...assessment, hidden: true }
        : assessment
    )));
  };

  const handleSyncCanvasCoursework = async () => {
    if (isSyncingCanvasCoursework) {
      return;
    }

    const courseworkPreferencesSnapshot = canvasCourseworkPreferencesRef.current;
    const assessmentPreferencesSnapshot = canvasAssessmentPreferencesRef.current;
    const courseworkIdsToSync = new Set<string>();
    const assessmentIdsToSync = new Set<string>();

    canvasCourseworkItems.forEach((item) => {
      const courseworkPreference = courseworkPreferencesSnapshot[item.id] ?? {};
      const assessmentPreference = assessmentPreferencesSnapshot[item.id] ?? {};

      if (
        isCourseworkCanvasItem(item) &&
        isRecoverableCanvasSubmissionPreference(courseworkPreference) &&
        getCanvasAssignmentReference(item.id, courseworkPreference, item)
      ) {
        courseworkIdsToSync.add(item.id);
        return;
      }

      if (
        isAssessmentCanvasItem(item) &&
        isRecoverableCanvasSubmissionPreference(assessmentPreference) &&
        getCanvasAssignmentReference(item.id, assessmentPreference, item)
      ) {
        assessmentIdsToSync.add(item.id);
      }
    });
    Object.entries(courseworkPreferencesSnapshot).forEach(([courseworkId, preference]) => {
      if (isRecoverableCanvasSubmissionPreference(preference) && getCanvasAssignmentReference(courseworkId, preference)) {
        courseworkIdsToSync.add(courseworkId);
      }
    });
    Object.entries(assessmentPreferencesSnapshot).forEach(([assessmentId, preference]) => {
      if (isRecoverableCanvasSubmissionPreference(preference) && getCanvasAssignmentReference(assessmentId, preference)) {
        assessmentIdsToSync.add(assessmentId);
      }
    });

    if (courseworkIdsToSync.size === 0 && assessmentIdsToSync.size === 0) {
      return;
    }

    academyPreferencesSaveSequence += 1;
    canvasCourseworkRequestSequenceRef.current += 1;
    setIsSyncingCanvasCoursework(true);

    const liveItemsById = new Map(
      canvasCourseworkItems.map((item) => [item.id, item]),
    );
    const statusByItemId = new Map<string, Pick<CanvasCalendarItem, 'isSubmitted' | 'submittedAt'>>();
    const metadataByItemId = new Map<string, { assignmentId?: string; courseId?: string }>();
    let unresolvedCheckedItems = 0;

    const syncStatusRequests = [
      ...Array.from(courseworkIdsToSync).map((itemId) => ({
        itemId,
        preference: courseworkPreferencesSnapshot[itemId] ?? {},
      })),
      ...Array.from(assessmentIdsToSync).map((itemId) => ({
        itemId,
        preference: assessmentPreferencesSnapshot[itemId] ?? {},
      })),
    ];

    try {
      await Promise.all(syncStatusRequests.map(async ({ itemId, preference }) => {
        if (!preference) {
          return;
        }

        const liveItem = liveItemsById.get(itemId);
        const assignmentReference = getCanvasAssignmentReference(itemId, preference, liveItem);

        if (assignmentReference && liveItem) {
          metadataByItemId.set(itemId, assignmentReference);

          const status = {
            isSubmitted: liveItem.isSubmitted,
            submittedAt: liveItem.submittedAt,
          };
          statusByItemId.set(itemId, status);
          protectCanvasSubmissionStatus(
            protectedCanvasSubmissionStatusesRef.current,
            itemId,
            {
              ...preference,
              assignmentId: assignmentReference.assignmentId,
              courseId: assignmentReference.courseId,
            },
            liveItem,
            status,
          );
          return;
        }

        if (preference.completed) {
          unresolvedCheckedItems += 1;
        }
      }));

    if (statusByItemId.size > 0) {
      setCanvasCourseworkItems((currentItems) => currentItems.map((item) => {
        const status = statusByItemId.get(item.id);

        if (!status) {
          return item;
        }

        return {
          ...item,
          isSubmitted: status.isSubmitted,
          submittedAt: status.submittedAt,
        };
      }));
    }

    updateStoredCanvasCourseworkPreferences((currentPreferences) => {
      let changed = false;
      const nextPreferences = { ...currentPreferences };

      courseworkIdsToSync.forEach((courseworkId) => {
        const preference = currentPreferences[courseworkId] ?? courseworkPreferencesSnapshot[courseworkId] ?? {};

        if (!preference) {
          return;
        }

        const status = statusByItemId.get(courseworkId);
        const metadata = metadataByItemId.get(courseworkId);
        const visiblePreference = {
          ...preference,
          assignmentId: metadata?.assignmentId ?? preference.assignmentId,
          courseId: metadata?.courseId ?? preference.courseId,
          hidden: false,
        };
        const { changed: submissionChanged, nextPreference } = status
          ? syncCanvasSubmissionPreference(visiblePreference, status)
          : { changed: false, nextPreference: visiblePreference };

        if (preference.hidden || submissionChanged) {
          nextPreferences[courseworkId] = nextPreference;
          changed = true;
        }
      });

      return changed ? nextPreferences : currentPreferences;
    });
    updateStoredCanvasAssessmentPreferences((currentPreferences) => {
      let changed = false;
      const nextPreferences = { ...currentPreferences };

      assessmentIdsToSync.forEach((assessmentId) => {
        const preference = currentPreferences[assessmentId] ?? assessmentPreferencesSnapshot[assessmentId] ?? {};

        if (!preference) {
          return;
        }

        const status = statusByItemId.get(assessmentId);
        const metadata = metadataByItemId.get(assessmentId);
        const visiblePreference = {
          ...preference,
          assignmentId: metadata?.assignmentId ?? preference.assignmentId,
          courseId: metadata?.courseId ?? preference.courseId,
          hidden: false,
        };
        const { changed: submissionChanged, nextPreference } = status
          ? syncCanvasSubmissionPreference(visiblePreference, status)
          : { changed: false, nextPreference: visiblePreference };

        if (preference.hidden || submissionChanged) {
          nextPreferences[assessmentId] = nextPreference;
          changed = true;
        }
      });

      return changed ? nextPreferences : currentPreferences;
    });

    if (unresolvedCheckedItems > 0) {
      showDashboardSnackbar({ message: dictionary.academyDashboardRefreshFailed, tone: 'error' });
    }
    } finally {
      setIsSyncingCanvasCoursework(false);
    }
  };

  const showDashboardSnackbar = (snackbar: DashboardSnackbar) => {
    if (dashboardSnackbarTimeoutRef.current) {
      window.clearTimeout(dashboardSnackbarTimeoutRef.current);
    }

    setDashboardSnackbar(snackbar);
    dashboardSnackbarTimeoutRef.current = window.setTimeout(() => {
      setDashboardSnackbar(null);
      dashboardSnackbarTimeoutRef.current = null;
    }, 2800);
  };

  const handleRefreshAcademyDashboard = async () => {
    if (academyRefreshLongPressTriggeredRef.current) {
      academyRefreshLongPressTriggeredRef.current = false;
      return;
    }

    await refreshAcademyDashboardData({ forceCanvasRefresh: true });
  };

  async function refreshAcademyDashboardData(options: { forceCanvasRefresh?: boolean } = {}) {
    setIsAcademyDashboardRefreshInProgress(true);
    setCanvasCourseLoadStatus('loading');
    setCanvasCourseworkLoadStatus('loading');
    if (!hasLoadedAcademyPreferences) {
      setAcademyPreferencesLoadStatus('loading');
    }
    const courseworkRequestSequence = ++canvasCourseworkRequestSequenceRef.current;

    const externalRefreshTasks: Promise<unknown>[] = [];

    window.dispatchEvent(new CustomEvent<AcademyRefreshRequestedDetail>(academyRefreshRequestedEvent, {
      detail: {
        // This view performs the forced 150-day Canvas refresh itself. Let the
        // calendar shell reuse its cache instead of forcing a second large read.
        forceRefresh: false,
        registerTask: (task) => {
          externalRefreshTasks.push(task);
        },
      },
    }));

    const preferenceReadSequence = academyPreferencesSaveSequence;
    const preferencesTask = canvasToDoApi.getAcademyPreferences();
    const coursesTask = canvasToDoApi.getCanvasCourses(100);
    const externalResultsTask = Promise.allSettled(externalRefreshTasks);

    const [preferencesResult, coursesResult] = await Promise.allSettled([
      preferencesTask,
      coursesTask,
    ]);
    const [courseworkResult, externalResults] = await Promise.all([
      canvasToDoApi.getCanvasCalendarItems({
        endDate: getFutureDateString(120),
        forceRefresh: Boolean(options.forceCanvasRefresh),
        pageSize: 100,
        startDate: getPastDateString(30),
      }).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      ),
      externalResultsTask,
    ]);

    if (
      preferencesResult.status === 'fulfilled' &&
      preferenceReadSequence === academyPreferencesSaveSequence
    ) {
      const values = getAcademyPreferenceValues(preferencesResult.value);
      const serverSelectedSemester = getSelectedSemesterFromSettings(preferencesResult.value.calendarSettings);

      cacheAcademyCalendarSettings(preferencesResult.value.calendarSettings, { source: 'server' });
      clearLegacyAcademyPreferenceStorage();
      applyAcademyPreferenceValues(values);
      if (serverSelectedSemester) {
        setSelectedCourseSemester(serverSelectedSemester);
      }
      setHasLoadedAcademyPreferences(true);
      setAcademyPreferencesLoadStatus('loaded');
    } else if (preferencesResult.status === 'rejected') {
      if (!hasLoadedAcademyPreferences) {
        setHasLoadedAcademyPreferences(false);
        setAcademyPreferencesLoadStatus('failed');
      }
    }

    if (coursesResult.status === 'fulfilled') {
      setCanvasCourses(coursesResult.value.courses);
      setCanvasCourseListIsComplete(coursesResult.value.isComplete === true);
      setCanvasTermName(coursesResult.value.termName);
      setCanvasCourseLoadStatus('loaded');
    } else {
      setCanvasCourses(null);
      setCanvasCourseListIsComplete(false);
      setCanvasTermName(undefined);
      setCanvasCourseLoadStatus('failed');
    }

    let syncedCanvasCourseworkItems: CanvasCalendarItem[] | null = null;

    if (
      courseworkResult.status === 'fulfilled' &&
      canvasCourseworkRequestSequenceRef.current === courseworkRequestSequence
    ) {
      syncedCanvasCourseworkItems = courseworkResult.value.items;
      setCanvasCourseworkItems(syncedCanvasCourseworkItems);
      setCanvasCourseworkLoadStatus('loaded');
    } else if (canvasCourseworkRequestSequenceRef.current === courseworkRequestSequence) {
      setCanvasCourseworkItems([]);
      setCanvasCourseworkLoadStatus('failed');
    }

    setIsAcademyDashboardRefreshInProgress(false);

    if (
      preferencesResult.status === 'fulfilled' &&
      coursesResult.status === 'fulfilled' &&
      courseworkResult.status === 'fulfilled' &&
      externalResults.every((result) => result.status === 'fulfilled')
    ) {
      const refreshedAt = getCurrentTimestamp();
      setLastSuccessfulDashboardRefreshAt(refreshedAt);
      setDashboardRefreshClock(refreshedAt);
      showDashboardSnackbar({ message: dictionary.academyDashboardRefreshSuccess, tone: 'success' });
    } else {
      const failureMessage = preferencesResult.status === 'rejected'
        ? dictionary.academyDashboardPreferencesRefreshFailed
        : coursesResult.status === 'rejected'
          ? dictionary.academyDashboardCanvasCoursesRefreshFailed
          : courseworkResult.status === 'rejected'
            ? dictionary.academyDashboardCanvasCalendarRefreshFailed
            : dictionary.academyDashboardRefreshFailed;

      showDashboardSnackbar({ message: failureMessage, tone: 'error' });
    }

    return syncedCanvasCourseworkItems;
  }

  const startAcademyRefreshLongPress = () => {
    if (isAcademyDashboardRefreshing) {
      return;
    }

    academyRefreshLongPressTriggeredRef.current = false;

    if (academyRefreshLongPressTimeoutRef.current) {
      window.clearTimeout(academyRefreshLongPressTimeoutRef.current);
    }

    academyRefreshLongPressTimeoutRef.current = window.setTimeout(() => {
      academyRefreshLongPressTriggeredRef.current = true;
      academyRefreshLongPressTimeoutRef.current = null;
      window.location.reload();
    }, 900);
  };

  const cancelAcademyRefreshLongPress = () => {
    if (academyRefreshLongPressTimeoutRef.current) {
      window.clearTimeout(academyRefreshLongPressTimeoutRef.current);
      academyRefreshLongPressTimeoutRef.current = null;
    }
  };

  const renderCardAction = (card: DashboardCardConfig) => {
    if (card.id === 'agenda') {
      return (
        <Button
          aria-label={dictionary.dashboardAddAgenda}
          className="size-7 border-border bg-background/70 text-muted-foreground hover:text-foreground"
          onClick={onOpenAddItem}
          size="icon-sm"
          title={dictionary.dashboardAddAgenda}
          type="button"
          variant="outline"
        >
          <Plus className="size-3.5" />
        </Button>
      );
    }

    if (card.id === 'semester-lectures') {
      return (
        <Button
          aria-label={dictionary.manualLectureAdd}
          className="size-7 border-border bg-background/70 text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            setIsManualLectureDialogOpen(true);
          }}
          size="icon-sm"
          title={dictionary.manualLectureAdd}
          type="button"
          variant="outline"
        >
          <Plus className="size-3.5" />
        </Button>
      );
    }

    if (card.id === 'upcoming-coursework') {
      const studyToggleButton = (
        <Button
          aria-label={courseworkShowStudyItems ? dictionary.courseworkHideStudyItems : dictionary.courseworkShowStudyItems}
          className={cn(
            'size-7 border-border bg-background/70 text-muted-foreground hover:text-foreground',
            !courseworkShowStudyItems && 'border-primary/45 bg-primary/10 text-primary',
          )}
          disabled={!onToggleCourseworkStudyItems}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCourseworkStudyItems?.();
          }}
          size="icon-sm"
          title={courseworkShowStudyItems ? dictionary.courseworkHideStudyItems : dictionary.courseworkShowStudyItems}
          type="button"
          variant="outline"
        >
          {courseworkShowStudyItems ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </Button>
      );

      if (recoverableCanvasCourseworkCount === 0) {
        return (
          <>
            {studyToggleButton}
            <Button
              aria-label={dictionary.courseworkAdd}
              className="size-7 border-border bg-background/70 text-muted-foreground hover:text-foreground"
              onClick={() => setIsCourseworkDialogOpen(true)}
              size="icon-sm"
              title={dictionary.courseworkAdd}
              type="button"
              variant="outline"
            >
              <Plus className="size-3.5" />
            </Button>
          </>
        );
      }

      return (
        <>
          {studyToggleButton}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={dictionary.courseworkActions}
                className="h-7 gap-1 rounded-md border-border bg-background/70 px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                size="sm"
                title={dictionary.courseworkActions}
                type="button"
                variant="outline"
              >
                <Plus className="size-3.5" />
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuItem onSelect={() => setIsCourseworkDialogOpen(true)}>
                <Plus className="size-4" />
                <span>{dictionary.courseworkAdd}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isSyncingCanvasCoursework}
                onSelect={() => { void handleSyncCanvasCoursework(); }}
              >
                <RefreshCw className={cn('size-4', isSyncingCanvasCoursework && 'animate-spin')} />
                <span>{dictionary.courseworkRestoreCanvas}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      );
    }

    return null;
  };

  const renderCardPill = (card: RenderableDashboardCard) => {
    if (!card.pill) {
      return null;
    }

    const handleSelectCourseSemester = (semester: string) => {
      const normalizedSemester = normalizeSemesterName(semester, fallbackCourseSemester);

      setSelectedCourseSemester(normalizedSemester);
      storeSelectedAcademySemester(normalizedSemester);
      void persistAcademyPreferences(
        manualLecturesRef.current,
        canvasLecturePreferencesRef.current,
        manualCourseworkRef.current,
        canvasCourseworkPreferencesRef.current,
        manualAssessmentsRef.current,
        canvasAssessmentPreferencesRef.current,
        {
          calendarSettings: { selectedSemester: normalizedSemester },
        },
      ).then(() => {
        void refreshAcademyDashboardData();
      });
    };

    if (card.id === 'semester-lectures') {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={card.pill}
              className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={(event) => {
                event.stopPropagation();
              }}
              type="button"
            >
              <EventPill color={card.color} label={card.pill} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-44"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            {courseSemesterOptions.map((semester) => (
              <DropdownMenuItem
                key={semester}
                onSelect={() => {
                  handleSelectCourseSemester(semester);
                }}
              >
                <span className="truncate">{semester}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    return <EventPill color={card.color} label={card.pill} />;
  };

  return (
    <>
      <section
        className={cn(
          'dashboard-summary-cards grid min-w-0 gap-3',
          isPhone && 'grid-cols-[minmax(0,1fr)]',
          compactAcademySummary
            ? 'grid-cols-[minmax(132px,0.28fr)_minmax(0,1fr)] items-start gap-2'
            : effectiveWideSummaryCards === undefined
              ? 'xl:grid-cols-3'
              : effectiveWideSummaryCards && 'grid-cols-3',
          hideSummaryCards && 'hidden',
        )}
        aria-label={`${translateModeName(activeMode.id, activeMode.displayName)} dashboard summary`}
      >
        {dashboardCards.filter((card) => !courseworkOnly || card.id === 'upcoming-coursework').map((card) => {
          const cardAction = renderCardAction(card);
          const isCompactCourseCard = compactAcademySummary && card.id === 'semester-lectures';
          const isCompactCourseworkCard = compactAcademySummary && card.id === 'upcoming-coursework';
          const isCompactHeaderHidden =
            compactAcademySummary &&
            (card.id === 'semester-lectures' || card.id === 'upcoming-coursework');

	          return (
	            <Card
	              className={cn(
	                'min-w-0 rounded-xl bg-card shadow-none',
                    isPhone && 'gap-1 py-2',
		                (isCompactCourseCard || isCompactCourseworkCard) && 'h-54 overflow-hidden',
	                card.id === 'upcoming-coursework' &&
	                  !compactAcademySummary &&
	                  (effectiveWideSummaryCards === undefined
	                    ? 'xl:col-span-2'
	                    : effectiveWideSummaryCards && 'col-span-2'),
	              )}
	              key={card.id}
	              size={isCompactCourseCard || isCompactCourseworkCard ? 'sm' : 'default'}
	            >
              {isCompactHeaderHidden ? null : (
                <CardHeader className={cn('gap-2 pb-3', isPhone && 'px-3 pb-0')}>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    {card.kicker ? (
                      <div className="text-[11px] font-black uppercase text-muted-foreground">
                        {card.kicker}
                      </div>
                    ) : null}
                    <div
                      className={cn(
                        'flex min-w-0 items-center gap-2',
                        card.kicker ? 'justify-end' : 'w-full justify-between',
                      )}
                    >
                      <CardTitle
                        className={cn(
                          'min-w-0 truncate text-base font-black leading-tight',
                          card.kicker ? 'text-right' : 'text-left',
                        )}
                      >
                        {card.title}
                      </CardTitle>
                      {!card.kicker && (card.pill || cardAction) ? (
                        <div className="flex shrink-0 items-center gap-1.5">
                          {renderCardPill(card)}
                          {cardAction}
                        </div>
                      ) : null}
                      {card.kicker ? cardAction : null}
                    </div>
                  </div>
                  {card.kicker && card.pill ? (
                    <div>
                      {renderCardPill(card)}
                    </div>
                  ) : null}
                </CardHeader>
              )}
              <CardContent className={cn(isPhone && 'min-w-0 px-3')}>
                <DashboardRows
                  isPhone={isPhone}
                  card={card}
                  compactCourseRows={isCompactCourseCard}
                  compactCourseworkRows={isCompactCourseworkCard}
                  focusedCourseworkKey={focusedCourseworkKey}
                  onHideLecture={handleHideLecture}
                  onFinishCourseworkRename={handleFinishCourseworkRename}
                  onOpenAssessment={handleOpenAssessment}
                  onOpenCoursework={handleOpenCoursework}
                  onOpenCourseworkLink={handleOpenCourseworkLink}
                  onOpenLecture={handleOpenLecture}
                  onOpenLectureDetails={handleOpenLectureDetails}
                  onOpenLectureFriendlyName={handleOpenLectureFriendlyName}
                  onRequestDeleteLecture={handleRequestDeleteLecture}
                  onMoveAssessmentDueDate={handleMoveAssessmentDueDate}
                  onMoveCourseworkDueDate={handleMoveCourseworkDueDate}
                  onRenameCoursework={handleRenameCoursework}
                  onRemoveAssessment={handleRemoveAssessment}
                  onRemoveCoursework={handleRemoveCoursework}
                  onSetLectureChipColor={handleSetLectureChipColor}
                  onStartCourseworkRename={handleStartCourseworkRename}
                  onToggleAssessmentDone={handleToggleAssessmentDone}
                  onToggleAssessmentStar={handleToggleAssessmentStar}
                  onToggleCourseworkDone={handleToggleCourseworkDone}
                  onToggleCourseworkStar={handleToggleCourseworkStar}
                  onToggleLectureStar={handleToggleLectureStar}
                />
              </CardContent>
            </Card>
          );
        })}
      </section>
      {dashboardSnackbar ? (
        <div
              aria-live="polite"
              className={cn(
                'fixed bottom-20 right-5 z-50 flex max-w-[min(360px,calc(100vw-2.5rem))] items-center gap-2 rounded-lg border px-3 py-2 text-sm font-black shadow-lg max-[520px]:bottom-36',
                dashboardSnackbar.tone === 'success'
                  ? 'border-emerald-500/35 bg-emerald-600 text-white'
                  : 'border-red-500/35 bg-red-600 text-white',
              )}
              role="status"
            >
              {dashboardSnackbar.tone === 'success' ? (
                <CheckCircle2 className="size-4 shrink-0" />
              ) : (
                <CircleAlert className="size-4 shrink-0" />
              )}
              <span className="min-w-0 truncate">{dashboardSnackbar.message}</span>
            </div>
      ) : null}
      <Button
        aria-label={`${dictionary.academyDashboardRefresh} · ${dashboardRefreshAgeLabel}`}
        className={cn(
          'fixed bottom-5 right-5 z-40 size-12 rounded-full shadow-lg backdrop-blur max-lg:bottom-24 max-[520px]:bottom-[calc(5rem+env(safe-area-inset-bottom))]',
          dashboardRefreshAgeClasses[dashboardRefreshAge],
        )}
        disabled={isAcademyDashboardRefreshing}
        onClick={handleRefreshAcademyDashboard}
        onPointerCancel={cancelAcademyRefreshLongPress}
        onPointerDown={startAcademyRefreshLongPress}
        onPointerLeave={cancelAcademyRefreshLongPress}
        onPointerUp={cancelAcademyRefreshLongPress}
        size="icon"
        title={`${dictionary.academyDashboardRefresh} · ${dashboardRefreshAgeLabel} · Hold to reload page`}
        type="button"
        variant="outline"
      >
        <RefreshCw className={cn('size-5', isAcademyDashboardRefreshing && 'animate-spin')} />
      </Button>
      <ManualLectureDialog
        key={isManualLectureDialogOpen ? 'add-lecture-open' : 'add-lecture-closed'}
        onAddLecture={handleAddManualLecture}
        onOpenChange={setIsManualLectureDialogOpen}
        open={isManualLectureDialogOpen}
        selectedSemester={activeCourseSemester}
        semesterOptions={courseSemesterOptions}
      />
      <CourseworkDialog
        isPhone={isPhone}
        courseOptions={courseworkCourseOptions}
        initialCoursework={initialManualCourseworkDraft}
        key={
          isCourseworkDialogOpen
            ? `add-coursework-open:${initialManualCourseworkDraft?.id ?? 'new'}`
            : 'add-coursework-closed'
        }
        onOpenChange={(isOpen) => {
          setIsCourseworkDialogOpen(isOpen);
          if (!isOpen) {
            setInitialManualCourseworkDraft(undefined);
          }
        }}
        onSave={handleAddManualCoursework}
        open={isCourseworkDialogOpen}
        selectedSemester={activeCourseSemester}
      />
      <CourseworkDialog
        isPhone={isPhone}
        courseOptions={courseworkCourseOptions}
        initialCoursework={selectedManualCoursework}
        key={selectedManualCoursework?.id ?? 'manual-coursework-closed'}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedManualCourseworkId(null);
          }
        }}
        onSave={handleUpdateManualCoursework}
        open={Boolean(selectedManualCoursework)}
        selectedSemester={activeCourseSemester}
        submitLabel={dictionary.courseworkUpdate}
        title={dictionary.courseworkEditTitle}
      />
      <CourseworkDialog
        isPhone={isPhone}
        courseOptions={courseworkCourseOptions}
        initialCoursework={selectedCanvasCourseworkEditable}
        isCanvasCoursework={Boolean(selectedCanvasCoursework)}
        key={selectedCanvasCourseworkEditable?.id ?? 'canvas-coursework-closed'}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedCanvasCourseworkId(null);
          }
        }}
        onSave={handleUpdateCanvasCoursework}
        open={Boolean(selectedCanvasCourseworkEditable)}
        selectedSemester={activeCourseSemester}
        submitLabel={dictionary.courseworkUpdate}
        title={dictionary.courseworkEditTitle}
      />
      <AssessmentDialog
        courseOptions={courseworkCourseOptions}
        key={isAssessmentDialogOpen ? 'add-assessment-open' : 'add-assessment-closed'}
        onOpenChange={setIsAssessmentDialogOpen}
        onSave={handleAddManualAssessment}
        open={isAssessmentDialogOpen}
        selectedSemester={activeCourseSemester}
      />
      <AssessmentDialog
        courseOptions={courseworkCourseOptions}
        initialAssessment={selectedManualAssessment}
        key={selectedManualAssessment?.id ?? 'manual-assessment-closed'}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedManualAssessmentId(null);
          }
        }}
        onSave={handleUpdateManualAssessment}
        open={Boolean(selectedManualAssessment)}
        selectedSemester={activeCourseSemester}
        submitLabel={dictionary.assessmentUpdate}
        title={dictionary.assessmentEditTitle}
      />
      <AssessmentDialog
        courseOptions={courseworkCourseOptions}
        initialAssessment={selectedCanvasAssessmentEditable}
        isCanvasAssessment={Boolean(selectedCanvasAssessment)}
        key={selectedCanvasAssessmentEditable?.id ?? 'canvas-assessment-closed'}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedCanvasAssessmentId(null);
          }
        }}
        onSave={handleUpdateCanvasAssessment}
        open={Boolean(selectedCanvasAssessmentEditable)}
        selectedSemester={activeCourseSemester}
        submitLabel={dictionary.assessmentUpdate}
        title={dictionary.assessmentEditTitle}
      />
      <ManualLectureDialog
        initialLecture={selectedManualLecture}
        key={selectedManualLecture?.id ?? 'manual-lecture-closed'}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedManualLectureId(null);
            setLecturePendingDelete(null);
          }
        }}
        onRequestDeleteLecture={setLecturePendingDelete}
        onSaveLecture={handleUpdateManualLecture}
        open={Boolean(selectedManualLecture)}
        selectedSemester={activeCourseSemester}
        semesterOptions={courseSemesterOptions}
      />
      <ManualLectureDialog
        description={dictionary.canvasLectureEditDescription}
        initialLecture={selectedCanvasLecture}
        key={selectedCanvasLecture?.id ?? 'canvas-lecture-closed'}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedCanvasCourseId(null);
            setLecturePendingDelete(null);
          }
        }}
        onRequestDeleteLecture={selectedCanvasLecture?.semester === noTermSemester ? setLecturePendingDelete : undefined}
        onSaveLecture={handleUpdateCanvasLecture}
        open={Boolean(selectedCanvasLecture)}
        selectedSemester={activeCourseSemester}
        semesterOptions={courseSemesterOptions}
        submitLabel={dictionary.manualLectureUpdate}
        title={dictionary.canvasLectureEditTitle}
      />
      <Dialog
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setLecturePendingDelete(null);
          }
        }}
        open={Boolean(lecturePendingDelete)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dictionary.manualLectureDeleteTitle}</DialogTitle>
            <DialogDescription>
              {dictionary.manualLectureDeleteDescription}
            </DialogDescription>
          </DialogHeader>
          {lecturePendingDelete ? (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <p className="font-semibold text-foreground">
                {lecturePendingDelete.friendlyCourseCode || lecturePendingDelete.code || dictionary.itemLabels.courses}
              </p>
              <p className="text-muted-foreground">
                {lecturePendingDelete.friendlyName || lecturePendingDelete.name}
              </p>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button onClick={() => setLecturePendingDelete(null)} type="button" variant="outline">
              {dictionary.cancel}
            </Button>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={() => {
                  if (lecturePendingDelete) {
                    handleDeleteManualLecture(lecturePendingDelete, false);
                  }
                }}
                type="button"
                variant="secondary"
              >
                {dictionary.manualLectureDeleteKeepCoursework}
              </Button>
              <Button
                onClick={() => {
                  if (lecturePendingDelete) {
                    handleDeleteManualLecture(lecturePendingDelete, true);
                  }
                }}
                type="button"
                variant="destructive"
              >
                <Trash2 className="size-4" />
                {dictionary.manualLectureDeleteWithCoursework}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CourseFriendlyNameDialog
        friendlyCourseCode={friendlyCourseCodeInput}
        friendlyName={friendlyNameInput}
        onFriendlyCourseCodeChange={setFriendlyCourseCodeInput}
        onFriendlyNameChange={setFriendlyNameInput}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setFriendlyNameRow(null);
            setFriendlyCourseCodeInput('');
            setFriendlyNameInput('');
          }
        }}
        onSave={handleSaveLectureFriendlyName}
        open={Boolean(friendlyNameRow)}
        row={friendlyNameRow}
      />
    </>
  );
}
