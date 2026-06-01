import {
  BookOpen,
  CalendarPlus,
  ChevronDown,
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactElement } from 'react';

import { workspaceApi, type CanvasCalendarItem, type CanvasCourse } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { useWorkspaceMode } from '../context/WorkspaceModeContext';
import type { ColorToken, DashboardCardConfig } from '../modes/types';
import { cn } from '../lib/utils';
import { dotColorClasses } from '../lib/colorStyles';
import { EventPill } from './EventPill';
import { GoogleProductIcon, type GoogleProduct } from './GoogleProductIcon';
import {
  ManualLectureDialog,
  type ManualLecture,
  type ManualLectureAssessment,
  type ManualLectureClassType,
  type ManualLectureLink,
  type ManualLectureSchedule,
  type ManualLectureScheduleEntry,
} from './ManualLectureDialog';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
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
type CanvasCourseLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';
type CanvasLecturePreferences = Record<string, {
  assessments?: ManualLectureAssessment[];
  chipColor?: ColorToken;
  credits?: string;
  friendlyCourseCode?: string;
  friendlyName?: string;
  hidden?: boolean;
  labSection?: string;
  lectureSection?: string;
  links?: ManualLectureLink[];
  originalCourseCode?: string;
  schedule?: ManualLectureSchedule;
  starred?: boolean;
  semester?: string;
  termName?: string;
  tutorialSection?: string;
}>;
interface ManualCourseworkItem {
  id: string;
  title: string;
  courseCode: string;
  dueAt: string;
  courseworkType: string;
  submissionType: string;
  completed?: boolean;
  chipColor?: ColorToken;
  hidden?: boolean;
  semester?: string;
  starred?: boolean;
}
interface ManualAssessmentItem {
  id: string;
  title: string;
  courseCode: string;
  dueAt: string;
  assessmentType: string;
  completed?: boolean;
  hidden?: boolean;
  semester?: string;
  starred?: boolean;
}
type CanvasCourseworkPreferences = Record<string, {
  chipColor?: ColorToken;
  completed?: boolean;
  courseCode?: string;
  courseId?: string;
  courseName?: string;
  courseworkType?: string;
  dueAt?: string;
  htmlUrl?: string;
  hidden?: boolean;
  isSubmitted?: boolean;
  originalCourseCode?: string;
  semester?: string;
  starred?: boolean;
  submissionType?: string;
  title?: string;
}>;
type CanvasAssessmentPreferences = Record<string, {
  assessmentType?: string;
  completed?: boolean;
  courseCode?: string;
  courseId?: string;
  courseName?: string;
  dueAt?: string;
  htmlUrl?: string;
  hidden?: boolean;
  isSubmitted?: boolean;
  originalCourseCode?: string;
  semester?: string;
  starred?: boolean;
  title?: string;
}>;

const manualLecturesStorageKey = 'incos-academy-manual-lectures';
const canvasLecturePreferencesStorageKey = 'incos-academy-canvas-lecture-preferences';
const manualCourseworkStorageKey = 'incos-academy-manual-coursework';
const canvasCourseworkPreferencesStorageKey = 'incos-academy-canvas-coursework-preferences';
const manualAssessmentsStorageKey = 'incos-academy-manual-assessments';
const canvasAssessmentPreferencesStorageKey = 'incos-academy-canvas-assessment-preferences';
const academyCalendarSettingsStorageKey = 'incos-academy-calendar-settings';
const academyPreferencesUpdatedEvent = 'incos-academy-preferences-updated';
const academyOpenCourseworkDialogEvent = 'incos-academy-open-coursework-dialog';
const defaultAcademySemester = 'Summer 2026';
const lectureChipColors: ColorToken[] = ['green', 'blue', 'teal', 'purple', 'orange', 'gold', 'red', 'gray'];
const courseworkTypes = [
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

function formatClassType(classType: ManualLectureClassType) {
  return classType.charAt(0).toUpperCase() + classType.slice(1);
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

  if (!trimmedValue || /^default term$/i.test(trimmedValue)) {
    return fallback;
  }

  return trimmedValue;
}

function getCanvasCourseSemester(
  course: CanvasCourse,
  preferences: CanvasLecturePreferences,
  fallbackSemester = defaultAcademySemester,
) {
  const coursePreferences = preferences[course.id] ?? {};

  return normalizeSemesterName(
    coursePreferences.semester ?? coursePreferences.termName ?? course.termName,
    fallbackSemester,
  );
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

function getCourseChipColorForCode(
  courseCode: string | undefined,
  manualLectures: ManualLecture[],
  canvasPreferences: CanvasLecturePreferences,
  fallback: ColorToken = 'green',
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

function getScheduleEntriesFromSchedule(schedule?: ManualLectureSchedule): ManualLectureScheduleEntry[] {
  if (Array.isArray(schedule?.entries) && schedule.entries.length > 0) {
    return schedule.entries;
  }

  if (schedule?.day || schedule?.time || schedule?.location) {
    return [{
      id: 'legacy-schedule',
      classType: 'lecture',
      deliveryMode: schedule.deliveryMode ?? 'inPerson',
      day: schedule.day ?? '',
      time: schedule.time ?? '',
      location: schedule.location ?? '',
    }];
  }

  return [];
}

function createScheduleSummary(schedule?: ManualLectureSchedule) {
  return getScheduleEntriesFromSchedule(schedule)
    .slice(0, 2)
    .map((entry) => [
      formatClassType(entry.classType),
      entry.deliveryMode === 'online' ? 'Online' : '',
      entry.day,
      entry.time,
      entry.location,
    ].filter(Boolean).join(' '))
    .join(' · ');
}

function createCanvasLectureRows(
  courses: CanvasCourse[],
  preferences: CanvasLecturePreferences,
  fallbackSemester = defaultAcademySemester,
): RenderableDashboardRow[] {
  return courses
    .filter((course) => !preferences[course.id]?.hidden)
    .sort((firstCourse, secondCourse) => (
      Number(Boolean(preferences[secondCourse.id]?.starred)) -
      Number(Boolean(preferences[firstCourse.id]?.starred))
    ))
    .map((course) => {
      const coursePreferences = preferences[course.id] ?? {};
      const originalCourseCode = course.courseCode?.trim() || course.id;
      const sections = createLectureSectionsSummary(coursePreferences);
      const schedule = createScheduleSummary(coursePreferences.schedule);
      const displayName = coursePreferences.friendlyName?.trim() || course.name;
      const semester = getCanvasCourseSemester(course, preferences, fallbackSemester);

      return {
        id: course.id,
        label: coursePreferences.friendlyCourseCode?.trim() || originalCourseCode,
        value: [
          sections ? `${displayName} · ${sections}` : displayName,
          schedule,
        ].filter(Boolean).join(' · '),
        canvasCourseId: course.id,
        chipColor: coursePreferences.chipColor ?? 'green',
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

function shouldShowCourseworkItem(dueAt?: string, isCompleted = false) {
  if (!dueAt) {
    return true;
  }

  const dueDate = new Date(dueAt);

  if (Number.isNaN(dueDate.getTime())) {
    return true;
  }

  const elapsedSinceDue = Date.now() - dueDate.getTime();

  if (elapsedSinceDue <= 0) {
    return true;
  }

  return elapsedSinceDue <= (isCompleted ? 86_400_000 : 259_200_000);
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

function createCanvasAssessmentRows(
  items: CanvasCalendarItem[],
  preferences: CanvasAssessmentPreferences,
  lecturePreferences: CanvasLecturePreferences,
  manualLectures: ManualLecture[],
  locale: string,
  canvasCourses: CanvasCourse[] | null,
  selectedSemester: string | undefined,
  fallbackSemester: string,
): RenderableDashboardRow[] {
  return items
    .filter(isAssessmentCanvasItem)
    .filter((item) => {
      const itemPreferences = preferences[item.id] ?? {};
      const dueAt = item.dueAt || item.startAt;
      const semester = getCanvasItemSemester(
        item,
        itemPreferences,
        canvasCourses,
        lecturePreferences,
        fallbackSemester,
      );

      return !itemPreferences.hidden &&
        semesterMatches(semester, selectedSemester, fallbackSemester) &&
        shouldShowCourseworkItem(dueAt, Boolean(item.isSubmitted) || Boolean(itemPreferences.completed));
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
      const isCanvasSubmitted = Boolean(item.isSubmitted);
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
        chipColor: coursePreferences?.chipColor ??
          getCourseChipColorForCode(courseCode, manualLectures, lecturePreferences),
        description: formatCourseworkDue(dueAt, locale),
        dueState: getCourseworkDueState(dueAt, isCompleted),
        dueAt,
        href: item.htmlUrl,
        isCanvasSubmitted,
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
): RenderableDashboardRow[] {
  return items
    .filter((item) => (
      !item.hidden &&
      semesterMatches(item.semester, selectedSemester, fallbackSemester) &&
      shouldShowCourseworkItem(item.dueAt, Boolean(item.completed))
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
): RenderableDashboardRow[] {
  return items
    .filter(isCourseworkCanvasItem)
    .filter((item) => {
      const itemPreferences = preferences[item.id] ?? {};
      const dueAt = itemPreferences.dueAt || item.dueAt || item.startAt;
      const semester = getCanvasItemSemester(
        item,
        itemPreferences,
        canvasCourses,
        lecturePreferences,
        fallbackSemester,
      );

      return !itemPreferences.hidden &&
        semesterMatches(semester, selectedSemester, fallbackSemester) &&
        shouldShowCourseworkItem(dueAt, Boolean(item.isSubmitted) || Boolean(itemPreferences.completed));
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
      const dueAt = itemPreferences.dueAt || item.dueAt || item.startAt;
      const courseworkType = itemPreferences.courseworkType || item.type;
      const isCanvasSubmitted = Boolean(item.isSubmitted);
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
): RenderableDashboardRow[] {
  return items
    .filter((item) => (
      !item.hidden &&
      semesterMatches(item.semester, selectedSemester, fallbackSemester) &&
      shouldShowCourseworkItem(item.dueAt, Boolean(item.completed))
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
): RenderableDashboardRow[] {
  return Object.entries(preferences)
    .filter(([itemId, preference]) => (
      !currentItemIds.has(itemId) &&
      !preference.hidden &&
      Boolean(preference.title?.trim()) &&
      semesterMatches(preference.semester, selectedSemester, fallbackSemester) &&
      shouldShowCourseworkItem(preference.dueAt, Boolean(preference.isSubmitted) || Boolean(preference.completed))
    ))
    .sort(([, firstPreference], [, secondPreference]) => (
      new Date(firstPreference.dueAt || 0).getTime() - new Date(secondPreference.dueAt || 0).getTime()
    ))
    .map(([itemId, preference]) => {
      const coursePreferences = preference.courseId ? lecturePreferences[preference.courseId] : undefined;
      const courseCode = preference.courseCode?.trim() || preference.originalCourseCode?.trim() || '';
      const isCompleted = Boolean(preference.isSubmitted) || Boolean(preference.completed);

      return {
        id: itemId,
        label: coursePreferences?.friendlyCourseCode?.trim() ||
          getFriendlyCourseCodeForCode(courseCode, manualLectures, lecturePreferences) ||
          courseCode,
        value: preference.title?.trim() || '',
        canvasCourseworkId: itemId,
        chipColor: coursePreferences?.chipColor ??
          getCourseChipColorForCode(courseCode, manualLectures, lecturePreferences),
        courseworkKey: `canvas:${itemId}`,
        courseworkSource: 'canvas',
        courseworkType: formatCourseworkType(preference.courseworkType),
        description: formatCourseworkDue(preference.dueAt, locale),
        dueAt: preference.dueAt,
        dueState: getCourseworkDueState(preference.dueAt, isCompleted),
        href: preference.htmlUrl,
        isCanvasSubmitted: Boolean(preference.isSubmitted),
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
): RenderableDashboardRow[] {
  return Object.entries(preferences)
    .filter(([itemId, preference]) => (
      !currentItemIds.has(itemId) &&
      !preference.hidden &&
      Boolean(preference.title?.trim()) &&
      semesterMatches(preference.semester, selectedSemester, fallbackSemester) &&
      shouldShowCourseworkItem(preference.dueAt, Boolean(preference.isSubmitted) || Boolean(preference.completed))
    ))
    .sort(([, firstPreference], [, secondPreference]) => (
      new Date(firstPreference.dueAt || 0).getTime() - new Date(secondPreference.dueAt || 0).getTime()
    ))
    .map(([itemId, preference]) => {
      const coursePreferences = preference.courseId ? lecturePreferences[preference.courseId] : undefined;
      const courseCode = preference.courseCode?.trim() || preference.originalCourseCode?.trim() || '';
      const isCompleted = Boolean(preference.isSubmitted) || Boolean(preference.completed);

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
        chipColor: coursePreferences?.chipColor ??
          getCourseChipColorForCode(courseCode, manualLectures, lecturePreferences),
        description: formatCourseworkDue(preference.dueAt, locale),
        dueAt: preference.dueAt,
        dueState: getCourseworkDueState(preference.dueAt, isCompleted),
        href: preference.htmlUrl,
        isCanvasSubmitted: Boolean(preference.isSubmitted),
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

function getVisibleManualLectures(lectures: ManualLecture[]) {
  return lectures
    .filter((lecture) => !lecture.hidden)
    .sort((firstLecture, secondLecture) => Number(Boolean(secondLecture.starred)) - Number(Boolean(firstLecture.starred)));
}

function getManualLectureScheduleEntries(lecture: ManualLecture): ManualLectureScheduleEntry[] {
  if (Array.isArray(lecture.schedule?.entries) && lecture.schedule.entries.length > 0) {
    return lecture.schedule.entries;
  }

  if (lecture.schedule?.day || lecture.schedule?.time || lecture.schedule?.location) {
    return [{
      id: `${lecture.id}-legacy-schedule`,
      classType: 'lecture',
      deliveryMode: lecture.schedule.deliveryMode ?? 'inPerson',
      day: lecture.schedule.day ?? '',
      time: lecture.schedule.time ?? '',
      location: lecture.schedule.location ?? '',
    }];
  }

  return [];
}

function createManualLectureRows(lectures: ManualLecture[]): RenderableDashboardRow[] {
  return lectures.map((lecture) => {
    const sections = createLectureSectionsSummary(lecture);
    const schedule = getManualLectureScheduleEntries(lecture)
      .slice(0, 2)
      .map((entry) => [
        formatClassType(entry.classType),
        entry.deliveryMode === 'online' ? 'Online' : '',
        entry.day,
        entry.time,
        entry.location,
      ].filter(Boolean).join(' '))
      .join(' · ');

    return {
      id: lecture.id,
      label: lecture.friendlyCourseCode || lecture.code || 'Manual',
      value: [
        sections
          ? `${lecture.friendlyName || lecture.name} · ${sections}`
          : lecture.friendlyName || lecture.name,
        schedule,
      ].filter(Boolean).join(' · '),
      chipColor: lecture.chipColor ?? 'green',
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

function getStoredManualLectures(): ManualLecture[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const storedLectures = window.localStorage.getItem(manualLecturesStorageKey);
    const parsedLectures = storedLectures ? JSON.parse(storedLectures) : [];

    return Array.isArray(parsedLectures) ? parsedLectures as ManualLecture[] : [];
  } catch {
    return [];
  }
}

function storeManualLectures(lectures: ManualLecture[]) {
  window.localStorage.setItem(manualLecturesStorageKey, JSON.stringify(lectures));
}

function getStoredCanvasLecturePreferences(): CanvasLecturePreferences {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const storedPreferences = window.localStorage.getItem(canvasLecturePreferencesStorageKey);
    const parsedPreferences = storedPreferences ? JSON.parse(storedPreferences) : {};

    return parsedPreferences && typeof parsedPreferences === 'object'
      ? parsedPreferences as CanvasLecturePreferences
      : {};
  } catch {
    return {};
  }
}

function storeCanvasLecturePreferences(preferences: CanvasLecturePreferences) {
  window.localStorage.setItem(canvasLecturePreferencesStorageKey, JSON.stringify(preferences));
}

function getStoredManualCoursework(): ManualCourseworkItem[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const storedCoursework = window.localStorage.getItem(manualCourseworkStorageKey);
    const parsedCoursework = storedCoursework ? JSON.parse(storedCoursework) : [];

    return Array.isArray(parsedCoursework) ? parsedCoursework as ManualCourseworkItem[] : [];
  } catch {
    return [];
  }
}

function storeManualCoursework(coursework: ManualCourseworkItem[]) {
  window.localStorage.setItem(manualCourseworkStorageKey, JSON.stringify(coursework));
}

function getStoredCanvasCourseworkPreferences(): CanvasCourseworkPreferences {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const storedPreferences = window.localStorage.getItem(canvasCourseworkPreferencesStorageKey);
    const parsedPreferences = storedPreferences ? JSON.parse(storedPreferences) : {};

    return parsedPreferences && typeof parsedPreferences === 'object'
      ? parsedPreferences as CanvasCourseworkPreferences
      : {};
  } catch {
    return {};
  }
}

function storeCanvasCourseworkPreferences(preferences: CanvasCourseworkPreferences) {
  window.localStorage.setItem(canvasCourseworkPreferencesStorageKey, JSON.stringify(preferences));
}

function getStoredManualAssessments(): ManualAssessmentItem[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const storedAssessments = window.localStorage.getItem(manualAssessmentsStorageKey);
    const parsedAssessments = storedAssessments ? JSON.parse(storedAssessments) : [];

    return Array.isArray(parsedAssessments) ? parsedAssessments as ManualAssessmentItem[] : [];
  } catch {
    return [];
  }
}

function storeManualAssessments(assessments: ManualAssessmentItem[]) {
  window.localStorage.setItem(manualAssessmentsStorageKey, JSON.stringify(assessments));
}

function getStoredCanvasAssessmentPreferences(): CanvasAssessmentPreferences {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const storedPreferences = window.localStorage.getItem(canvasAssessmentPreferencesStorageKey);
    const parsedPreferences = storedPreferences ? JSON.parse(storedPreferences) : {};

    return parsedPreferences && typeof parsedPreferences === 'object'
      ? parsedPreferences as CanvasAssessmentPreferences
      : {};
  } catch {
    return {};
  }
}

function storeCanvasAssessmentPreferences(preferences: CanvasAssessmentPreferences) {
  window.localStorage.setItem(canvasAssessmentPreferencesStorageKey, JSON.stringify(preferences));
}

function getStoredAcademyCalendarSettings() {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const storedSettings = window.localStorage.getItem(academyCalendarSettingsStorageKey);
    const parsedSettings = storedSettings ? JSON.parse(storedSettings) : {};

    return parsedSettings && typeof parsedSettings === 'object' && !Array.isArray(parsedSettings)
      ? parsedSettings as Record<string, unknown>
      : {};
  } catch {
    return {};
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

function getStoredSelectedAcademySemester() {
  return getSelectedSemesterFromSettings(getStoredAcademyCalendarSettings());
}

function storeSelectedAcademySemester(semester: string) {
  if (typeof window === 'undefined') {
    return;
  }

  const currentSettings = getStoredAcademyCalendarSettings();

  window.localStorage.setItem(
    academyCalendarSettingsStorageKey,
    JSON.stringify({
      ...currentSettings,
      selectedSemester: normalizeSemesterName(semester),
    }),
  );
}

function cacheAcademyPreferences(
  lectures: ManualLecture[],
  preferences: CanvasLecturePreferences,
  coursework: ManualCourseworkItem[],
  courseworkPreferences: CanvasCourseworkPreferences,
  assessments: ManualAssessmentItem[],
  assessmentPreferences: CanvasAssessmentPreferences,
) {
  if (typeof window === 'undefined') {
    return;
  }

  storeManualLectures(lectures);
  storeCanvasLecturePreferences(preferences);
  storeManualCoursework(coursework);
  storeCanvasCourseworkPreferences(courseworkPreferences);
  storeManualAssessments(assessments);
  storeCanvasAssessmentPreferences(assessmentPreferences);
  window.dispatchEvent(new Event(academyPreferencesUpdatedEvent));
}

function persistAcademyPreferences(
  lectures: ManualLecture[],
  preferences: CanvasLecturePreferences,
  coursework: ManualCourseworkItem[],
  courseworkPreferences: CanvasCourseworkPreferences,
  assessments: ManualAssessmentItem[],
  assessmentPreferences: CanvasAssessmentPreferences,
) {
  cacheAcademyPreferences(lectures, preferences, coursework, courseworkPreferences, assessments, assessmentPreferences);

  void workspaceApi.saveAcademyPreferences({
    manualLectures: lectures,
    canvasLecturePreferences: preferences,
    manualCoursework: coursework,
    canvasCourseworkPreferences: courseworkPreferences,
    manualAssessments: assessments,
    canvasAssessmentPreferences: assessmentPreferences,
    calendarSettings: getStoredAcademyCalendarSettings(),
  }).catch(() => undefined);
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
    chipColor: preference?.chipColor ?? 'green',
    friendlyCourseCode: preference?.friendlyCourseCode,
    friendlyName: preference?.friendlyName,
    hidden: preference?.hidden,
    starred: preference?.starred,
    semester: normalizeSemesterName(preference?.semester ?? preference?.termName ?? course.termName),
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

    if (!semesterMatches(semester, selectedSemester, fallbackSemester)) {
      return;
    }

    const preferences = canvasPreferences[course.id] ?? {};
    addOption(
      preferences.friendlyCourseCode || course.courseCode || course.id,
      preferences.friendlyName || course.name,
      semester,
    );
  });
  manualLectures.forEach((lecture) => {
    const semester = normalizeSemesterName((lecture as ManualLecture & { semester?: string }).semester, fallbackSemester);

    if (!semesterMatches(semester, selectedSemester, fallbackSemester)) {
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

function BrandIcon({ source }: { source: DashboardRow['source'] }) {
  if (source && ['gmail', 'chat', 'meet', 'docs', 'sheets', 'slides'].includes(source)) {
    return <GoogleProductIcon product={source as GoogleProduct} size={16} />;
  }

  const fallback =
    source === 'teams'
      ? { color: '#6264A7', label: 'T' }
      : source === 'zoom'
        ? { color: '#0B5CFF', label: 'Z' }
        : { color: '#4285F4', label: 'D' };

  return (
    <span
      aria-hidden="true"
      className="inline-grid size-4 place-items-center rounded-[4px] text-[9px] font-black leading-none text-white"
      style={{ backgroundColor: fallback.color }}
    >
      {fallback.label}
    </span>
  );
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

interface DashboardRowsProps {
  card: RenderableDashboardCard;
  onHideLecture: (row: RenderableDashboardRow) => void;
  onOpenAssessment: (row: RenderableDashboardRow) => void;
  onOpenCoursework: (row: RenderableDashboardRow) => void;
  onOpenLecture: (row: RenderableDashboardRow) => void;
  onOpenLectureFriendlyName: (row: RenderableDashboardRow) => void;
  onRemoveAssessment: (row: RenderableDashboardRow) => void;
  onRemoveCoursework: (row: RenderableDashboardRow) => void;
  onSetLectureChipColor: (row: RenderableDashboardRow, color: ColorToken) => void;
  onToggleAssessmentDone: (row: RenderableDashboardRow) => void;
  onToggleAssessmentStar: (row: RenderableDashboardRow) => void;
  onToggleCourseworkDone: (row: RenderableDashboardRow) => void;
  onToggleCourseworkStar: (row: RenderableDashboardRow) => void;
  onToggleLectureStar: (row: RenderableDashboardRow) => void;
}

function DashboardRows({
  card,
  onHideLecture,
  onOpenAssessment,
  onOpenCoursework,
  onOpenLecture,
  onOpenLectureFriendlyName,
  onRemoveAssessment,
  onRemoveCoursework,
  onSetLectureChipColor,
  onToggleAssessmentDone,
  onToggleAssessmentStar,
  onToggleCourseworkDone,
  onToggleCourseworkStar,
  onToggleLectureStar,
}: DashboardRowsProps) {
  const { dictionary } = useLanguage();
  const rows = card.id === 'upcoming-coursework'
    ? card.rows
    : card.rows.slice(0, card.maxRows ?? card.rows.length);
  const chipColorLabels: Record<ColorToken, string> = {
    blue: dictionary.manualLectureChipColorBlue,
    green: dictionary.manualLectureChipColorGreen,
    orange: dictionary.manualLectureChipColorOrange,
    red: dictionary.manualLectureChipColorRed,
    purple: dictionary.manualLectureChipColorPurple,
    teal: dictionary.manualLectureChipColorTeal,
    gold: dictionary.manualLectureChipColorGold,
    gray: dictionary.manualLectureChipColorGray,
  };
  const touchMenuButtonClassName =
    'size-8 shrink-0 rounded-md border-border bg-background/80 text-muted-foreground hover:bg-muted hover:text-foreground';
  const stopTouchMenuPropagation = (event: MouseEvent | PointerEvent) => {
    event.stopPropagation();
  };
  const renderTouchMenuTrigger = () => (
    <DropdownMenuTrigger asChild>
      <Button
        aria-label={dictionary.gmailMoreActions}
        className={touchMenuButtonClassName}
        onClick={stopTouchMenuPropagation}
        onPointerDown={stopTouchMenuPropagation}
        size="icon-sm"
        title={dictionary.gmailMoreActions}
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
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => onOpenLecture(row)}>
            <BookOpen className="size-4" />
            <span>{dictionary.manualLectureOpenDetails}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpenLectureFriendlyName(row)}>
            <Pencil className="size-4" />
            <span>{dictionary.courseFriendlyNameSet}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onToggleLectureStar(row)}>
            <Star className={cn('size-4', row.isStarred && 'fill-amber-400 text-amber-500')} />
            <span>{row.isStarred ? dictionary.manualLectureUnstar : dictionary.manualLectureStar}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onHideLecture(row)}>
            <EyeOff className="size-4" />
            <span>{dictionary.manualLectureHide}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {lectureChipColors.map((color) => (
            <DropdownMenuItem
              disabled={row.chipColor === color}
              key={color}
              onSelect={() => onSetLectureChipColor(row, color)}
            >
              <span
                aria-hidden="true"
                className={cn('size-3 rounded-full border border-foreground/10', dotColorClasses[color])}
              />
              <span>{chipColorLabels[color]}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  const renderCourseworkTouchMenu = (row: RenderableDashboardRow) => {
    if (!row.courseworkKey) {
      return null;
    }

    return (
      <DropdownMenu>
        {renderTouchMenuTrigger()}
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => onOpenCoursework(row)}>
            <Pencil className="size-4" />
            <span>{dictionary.courseworkOpenDetails}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onToggleCourseworkStar(row)}>
            <Star className={cn('size-4', row.isStarred && 'fill-amber-400 text-amber-500')} />
            <span>{row.isStarred ? dictionary.courseworkUnstar : dictionary.courseworkStar}</span>
          </DropdownMenuItem>
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

    return (
      <DropdownMenu>
        {renderTouchMenuTrigger()}
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => onOpenAssessment(row)}>
            <Pencil className="size-4" />
            <span>{dictionary.assessmentOpenDetails}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onToggleAssessmentStar(row)}>
            <Star className={cn('size-4', row.isStarred && 'fill-amber-400 text-amber-500')} />
            <span>{row.isStarred ? dictionary.assessmentUnstar : dictionary.assessmentStar}</span>
          </DropdownMenuItem>
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
        <ContextMenuContent className="w-56">
          <ContextMenuLabel>{row.label}</ContextMenuLabel>
          <ContextMenuItem onSelect={() => onOpenLecture(row)}>
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
          <ContextMenuSeparator />
          <ContextMenuLabel>{dictionary.manualLectureChipColor}</ContextMenuLabel>
          {lectureChipColors.map((color) => (
            <ContextMenuItem
              disabled={row.chipColor === color}
              key={color}
              onSelect={() => onSetLectureChipColor(row, color)}
            >
              <span
                aria-hidden="true"
                className={cn('size-3 rounded-full border border-foreground/10', dotColorClasses[color])}
              />
              <span>{chipColorLabels[color]}</span>
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
    );
  };
  const renderCourseworkContextMenu = (row: RenderableDashboardRow, trigger: ReactElement) => {
    if (!row.courseworkKey) {
      return trigger;
    }

    return (
      <ContextMenu key={`${card.id}-${row.courseworkKey}`}>
        <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel>{row.label}</ContextMenuLabel>
          <ContextMenuItem onSelect={() => onOpenCoursework(row)}>
            <Pencil className="size-4" />
            <span>{dictionary.courseworkOpenDetails}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onToggleCourseworkStar(row)}>
            <Star className={cn('size-4', row.isStarred && 'fill-amber-400 text-amber-500')} />
            <span>{row.isStarred ? dictionary.courseworkUnstar : dictionary.courseworkStar}</span>
          </ContextMenuItem>
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

    return (
      <ContextMenu key={`${card.id}-${row.assessmentKey}`}>
        <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel>{row.label}</ContextMenuLabel>
          <ContextMenuItem onSelect={() => onOpenAssessment(row)}>
            <Pencil className="size-4" />
            <span>{dictionary.assessmentOpenDetails}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onToggleAssessmentStar(row)}>
            <Star className={cn('size-4', row.isStarred && 'fill-amber-400 text-amber-500')} />
            <span>{row.isStarred ? dictionary.assessmentUnstar : dictionary.assessmentStar}</span>
          </ContextMenuItem>
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
      const touchActionMenu = row.assessmentKey && !row.courseworkKey
        ? renderAssessmentTouchMenu(row)
        : renderCourseworkTouchMenu(row);
      const rowElement = (
        <div
          className={cn(
            'grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 border-t py-2 text-sm first:border-t-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]',
            isCheckableRow && 'rounded-md px-1 transition-colors hover:bg-muted/45',
          )}
          key={`${card.id}-${row.label}-${row.value}`}
        >
          {row.id === 'loading' ? (
            <RefreshCw className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : row.id === 'message' ? (
            <span aria-hidden="true" className="h-6 w-0 shrink-0" />
          ) : (
            <EventPill className="h-6 min-w-8 px-2 text-xs" color={row.chipColor ?? card.color} compact label={row.label} />
          )}
          <div className="min-w-0">
            <strong className="block min-w-0 max-w-full truncate">{row.value}</strong>
          </div>
          <div className="col-start-2 flex min-w-0 items-center justify-start gap-1.5 sm:col-start-auto sm:justify-end">
            {row.courseworkType ? (
              <EventPill className="h-5 max-w-24 px-1.5 text-[10px]" color={row.chipColor ?? card.color} compact label={row.courseworkType} />
            ) : null}
            {row.assessmentType ? (
              <EventPill className="h-5 max-w-24 px-1.5 text-[10px]" color={row.chipColor ?? card.color} compact label={row.assessmentType} />
            ) : null}
            {isCheckableRow ? (
              <button
                aria-label={row.isCanvasSubmitted
                  ? dictionary.courseworkSubmittedInCanvas
                  : row.isCompleted
                    ? dictionary.courseworkMarkNotDone
                    : dictionary.courseworkMarkDone}
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-[7px] border text-[11px] font-black leading-none transition-colors',
                  row.isCompleted
                    ? 'border-emerald-400/40 bg-emerald-500 text-white'
                    : 'border-muted-foreground/30 bg-muted/70 text-muted-foreground hover:bg-muted',
                  row.isCanvasSubmitted && 'cursor-default opacity-90',
                )}
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
            ) : null}
            {row.isStarred ? (
              <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" />
            ) : null}
            {row.description ? (
              <span
                className={cn(
                  'inline-flex h-6 w-32 shrink-0 items-center justify-center rounded-md border px-2 text-xs font-semibold',
                  getCourseworkDueChipClass(row.dueState),
                )}
              >
                <span className="truncate">{row.description}</span>
              </span>
            ) : null}
            {touchActionMenu}
          </div>
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
      ? <div className="max-h-64 overflow-y-auto pr-1">{renderedRows}</div>
      : renderedRows;
  }

  if (card.layout === 'agenda') {
    return rows.map((row) => {
      const rowElement = (
        <div
          className={cn(
            'flex min-w-0 items-center gap-3 border-t py-2 text-sm first:border-t-0',
            row.lectureKey && 'rounded-md px-1 transition-colors hover:bg-muted/45',
          )}
          key={`${card.id}-${row.label}-${row.value}`}
        >
          {row.label ? (
            <EventPill
              className="h-6 px-2 text-xs"
              color={row.chipColor ?? card.color}
              compact
              label={row.label}
            />
          ) : (
            <RefreshCw className="size-4 shrink-0 animate-spin text-muted-foreground" />
          )}
          <strong className="min-w-0 flex-1 truncate">{row.value}</strong>
          {row.isStarred ? (
            <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" />
          ) : null}
          {renderLectureTouchMenu(row)}
        </div>
      );

      return renderLectureContextMenu(row, rowElement);
    });
  }

  if (card.layout === 'messages') {
    return rows.map((row) => (
      <div
        className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)_34px] items-center gap-2 border-t py-2 text-sm first:border-t-0"
        key={`${card.id}-${row.label}-${row.value}`}
      >
        <span className="grid size-7 place-items-center rounded-lg bg-muted">
          <BrandIcon source={row.source} />
        </span>
        <div className="min-w-0">
          <strong className="block truncate leading-tight">{row.value}</strong>
          <span className="block truncate text-xs font-bold text-muted-foreground">
            {row.description}
          </span>
        </div>
        <span className="justify-self-end text-xs font-black text-muted-foreground">{row.label}</span>
      </div>
    ));
  }

  if (card.layout === 'meetings') {
    return rows.map((row) => {
      const content = (
        <>
          <EventPill className="h-6 px-2 text-xs" color={card.color} compact label={row.label} />
          <div className="min-w-0 flex-1">
            <strong className="block truncate leading-tight">{row.value}</strong>
            <span className="block truncate text-xs font-bold text-muted-foreground">
              {row.description}
            </span>
          </div>
          <BrandIcon source={row.source} />
        </>
      );

      return row.href ? (
        <a
          className="flex min-w-0 items-center gap-3 border-t py-2 text-sm transition hover:bg-muted/45 first:border-t-0"
          href={row.href}
          key={`${card.id}-${row.label}-${row.value}`}
          rel="noreferrer"
          target="_blank"
          title={row.description ? `${row.value} - ${row.description}` : row.value}
        >
          {content}
        </a>
      ) : (
        <div
          className="flex min-w-0 items-center gap-3 border-t py-2 text-sm first:border-t-0"
          key={`${card.id}-${row.label}-${row.value}`}
          title={row.value}
        >
          {content}
        </div>
      );
    });
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
    courseworkType: 'assignment',
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
  onOpenChange,
  onSave,
  open,
  selectedSemester,
  submitLabel,
  title,
}: CourseworkDialogProps) {
  const { dictionary, language } = useLanguage();
  const dateLocale = getDateLocale(language);
  const [draft, setDraft] = useState<ManualCourseworkItem>(() => (
    initialCoursework ?? createEmptyCoursework(selectedSemester)
  ));
  const lockedCanvasFieldClassName = isCanvasCoursework ? 'opacity-70' : '';
  const selectedCourseValue = courseOptions.some((option) => option.value === draft.courseCode)
    ? draft.courseCode
    : draft.courseCode
      ? `current:${draft.courseCode}`
      : undefined;

  useEffect(() => {
    if (open) {
      setDraft(initialCoursework ?? createEmptyCoursework(selectedSemester));
    }
  }, [initialCoursework, open, selectedSemester]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl p-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black">
            {title ?? dictionary.courseworkDialogTitle}
          </DialogTitle>
          <DialogDescription>{dictionary.courseworkDialogDescription}</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();

            onSave({
              ...draft,
              courseCode: draft.courseCode.trim(),
              courseworkType: draft.courseworkType || 'assignment',
              dueAt: toIsoFromDateInput(draft.dueAt) || draft.dueAt,
              semester: normalizeSemesterName(draft.semester, selectedSemester),
              submissionType: draft.submissionType.trim(),
              title: draft.title.trim(),
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="coursework-title">
                {dictionary.courseworkName}
              </Label>
              <Input
                autoFocus
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
                onValueChange={(value) => setDraft((current) => ({ ...current, courseworkType: value }))}
                value={draft.courseworkType || 'assignment'}
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
            <div className={cn('space-y-2 sm:col-span-2', lockedCanvasFieldClassName)}>
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="coursework-due">
                {dictionary.courseworkDueAt}
              </Label>
              <Input
                disabled={isCanvasCoursework}
                id="coursework-due"
                lang={dateLocale}
                onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
                type="datetime-local"
                value={formatDateInputValue(draft.dueAt)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              {dictionary.cancel}
            </Button>
            <Button type="submit">{submitLabel ?? dictionary.courseworkSave}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
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
  const { dictionary, language } = useLanguage();
  const dateLocale = getDateLocale(language);
  const [draft, setDraft] = useState<ManualAssessmentItem>(() => (
    initialAssessment ?? createEmptyAssessment(selectedSemester)
  ));
  const selectedCourseValue = courseOptions.some((option) => option.value === draft.courseCode)
    ? draft.courseCode
    : draft.courseCode
      ? `current:${draft.courseCode}`
      : undefined;
  const lockedCanvasFieldClassName = isCanvasAssessment ? 'opacity-70' : '';

  useEffect(() => {
    if (open) {
      setDraft(initialAssessment ?? createEmptyAssessment(selectedSemester));
    }
  }, [initialAssessment, open, selectedSemester]);

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
              semester: normalizeSemesterName(draft.semester, selectedSemester),
              title: draft.title.trim(),
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="assessment-title">
                {dictionary.assessmentName}
              </Label>
              <Input
                autoFocus
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
            <div className={cn('space-y-2 sm:col-span-2', lockedCanvasFieldClassName)}>
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="assessment-due">
                {dictionary.courseworkDueAt}
              </Label>
              <Input
                disabled={isCanvasAssessment}
                id="assessment-due"
                lang={dateLocale}
                onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
                type="datetime-local"
                value={formatDateInputValue(draft.dueAt)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              {dictionary.cancel}
            </Button>
            <Button type="submit">{submitLabel ?? dictionary.assessmentSave}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DashboardCardsProps {
  onOpenAddItem?: () => void;
  onOpenCourses?: () => void;
  onPlanMeeting?: () => void;
  onStartMeetingNow?: () => void;
  onWriteInPersonMeetingReport?: () => void;
}

export function DashboardCards({
  onOpenAddItem,
  onOpenCourses,
  onPlanMeeting,
  onStartMeetingNow,
  onWriteInPersonMeetingReport,
}: DashboardCardsProps) {
  const { activeMode } = useWorkspaceMode();
  const { dictionary, language, translateDashboardCard, translateModeName } = useLanguage();
  const [isRefreshingMessages, setIsRefreshingMessages] = useState(false);
  const [canvasCourses, setCanvasCourses] = useState<CanvasCourse[] | null>(null);
  const [canvasCourseLoadStatus, setCanvasCourseLoadStatus] = useState<CanvasCourseLoadStatus>('idle');
  const [canvasCourseworkItems, setCanvasCourseworkItems] = useState<CanvasCalendarItem[]>([]);
  const [canvasCourseworkLoadStatus, setCanvasCourseworkLoadStatus] = useState<CanvasCourseLoadStatus>('idle');
  const [canvasTermName, setCanvasTermName] = useState<string | undefined>();
  const [selectedCourseSemester, setSelectedCourseSemester] = useState<string | undefined>(
    getStoredSelectedAcademySemester,
  );
  const [isManualLectureDialogOpen, setIsManualLectureDialogOpen] = useState(false);
  const [isCourseworkDialogOpen, setIsCourseworkDialogOpen] = useState(false);
  const [manualLectures, setManualLectures] = useState<ManualLecture[]>(getStoredManualLectures);
  const [canvasLecturePreferences, setCanvasLecturePreferences] = useState<CanvasLecturePreferences>(
    getStoredCanvasLecturePreferences,
  );
  const [manualCoursework, setManualCoursework] = useState<ManualCourseworkItem[]>(getStoredManualCoursework);
  const [canvasCourseworkPreferences, setCanvasCourseworkPreferences] = useState<CanvasCourseworkPreferences>(
    getStoredCanvasCourseworkPreferences,
  );
  const [manualAssessments, setManualAssessments] = useState<ManualAssessmentItem[]>(getStoredManualAssessments);
  const [canvasAssessmentPreferences, setCanvasAssessmentPreferences] = useState<CanvasAssessmentPreferences>(
    getStoredCanvasAssessmentPreferences,
  );
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
  const [friendlyNameRow, setFriendlyNameRow] = useState<RenderableDashboardRow | null>(null);
  const [friendlyCourseCodeInput, setFriendlyCourseCodeInput] = useState('');
  const [friendlyNameInput, setFriendlyNameInput] = useState('');
  const refreshTimeoutRef = useRef<number | null>(null);
  const dateLocale = getDateLocale(language);
  const selectedManualLecture = selectedManualLectureId
    ? manualLectures.find((lecture) => lecture.id === selectedManualLectureId)
    : undefined;
  const recoverableCanvasCourseworkCount = [
    ...Object.values(canvasCourseworkPreferences),
    ...Object.values(canvasAssessmentPreferences),
  ].filter((preference) => preference.hidden || ('completed' in preference && preference.completed))
    .length;
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
  const fallbackCourseSemester = normalizeSemesterName(canvasTermName);
  const activeCourseSemester = normalizeSemesterName(selectedCourseSemester ?? canvasTermName, fallbackCourseSemester);
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
          selectedCanvasAssessmentPreference?.dueAt ??
          selectedCanvasAssessment?.dueAt ??
          selectedCanvasAssessment?.startAt ??
          '',
        assessmentType:
          selectedCanvasAssessmentPreference?.assessmentType ??
          selectedCanvasAssessment?.type ??
          'quiz',
        completed:
          Boolean(selectedCanvasAssessment?.isSubmitted) ||
          Boolean(selectedCanvasAssessmentPreference?.isSubmitted) ||
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
          selectedCanvasCourseworkPreference?.dueAt ??
          selectedCanvasCoursework?.dueAt ??
          selectedCanvasCoursework?.startAt ??
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
          Boolean(selectedCanvasCoursework?.isSubmitted) ||
          Boolean(selectedCanvasCourseworkPreference?.isSubmitted) ||
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
    addSemester(canvasTermName);
    addSemester(defaultAcademySemester);

    return Array.from(semesterSet.values());
  }, [
    canvasAssessmentPreferences,
    canvasCourses,
    canvasCourseworkPreferences,
    canvasLecturePreferences,
    canvasTermName,
    fallbackCourseSemester,
    manualAssessments,
    manualCoursework,
    manualLectures,
    selectedCourseSemester,
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

  useEffect(() => {
    if (courseSemesterOptions.length === 0) {
      return;
    }

    const normalizedSelectedSemester = selectedCourseSemester
      ? normalizeSemesterName(selectedCourseSemester, fallbackCourseSemester)
      : undefined;
    const nextSemester = normalizedSelectedSemester && courseSemesterOptions.includes(normalizedSelectedSemester)
      ? normalizedSelectedSemester
      : courseSemesterOptions[0];

    if (nextSemester && nextSemester !== selectedCourseSemester) {
      setSelectedCourseSemester(nextSemester);
      storeSelectedAcademySemester(nextSemester);
    }
  }, [courseSemesterOptions, fallbackCourseSemester, selectedCourseSemester]);

  const dashboardCards: RenderableDashboardCard[] = activeMode.dashboardCards.map((card) => {
    const translatedCard = translateDashboardCard(activeMode.id, card);
    const maxRows = translatedCard.maxRows ?? 5;

    if (
      activeMode.id === 'academy' &&
      translatedCard.id === 'semester-lectures' &&
      (canvasCourseLoadStatus === 'idle' || canvasCourseLoadStatus === 'loading')
    ) {
      return {
        ...translatedCard,
        rows: createLoadingRows(dictionary.canvasCoursesLoading),
      };
    }

    if (activeMode.id === 'academy' && translatedCard.id === 'semester-lectures') {
      const visibleManualLectures = getVisibleManualLectures(manualLectures).filter((lecture) => (
        semesterMatches(lecture.semester, activeCourseSemester, fallbackCourseSemester)
      ));
      const starredManualRows = createManualLectureRows(
        visibleManualLectures.filter((lecture) => lecture.starred),
      );
      const regularManualRows = createManualLectureRows(
        visibleManualLectures.filter((lecture) => !lecture.starred),
      );
      const manualLectureRows = [...starredManualRows, ...regularManualRows];
      const visibleCanvasCourses = canvasCourses?.filter((course) => (
        getCanvasCourseSemester(course, canvasLecturePreferences, fallbackCourseSemester) === activeCourseSemester
      ));
      const canvasLectureRows = visibleCanvasCourses
        ? createCanvasLectureRows(visibleCanvasCourses, canvasLecturePreferences, fallbackCourseSemester)
        : [];
      const starredCanvasRows = canvasLectureRows.filter((row) => row.isStarred);
      const regularCanvasRows = canvasLectureRows.filter((row) => !row.isStarred);

      if (canvasCourseLoadStatus === 'failed') {
        return {
          ...translatedCard,
          rows: manualLectureRows.length > 0
            ? manualLectureRows.slice(0, maxRows)
            : createMessageRows(dictionary.canvasCoursesUnavailable),
        };
      }

      if (!canvasCourses || canvasCourses.length === 0) {
        return {
          ...translatedCard,
          rows: manualLectureRows.length > 0
            ? manualLectureRows.slice(0, maxRows)
            : createMessageRows(dictionary.canvasCoursesEmpty),
        };
      }

      return {
        ...translatedCard,
        pill: activeCourseSemester ?? translatedCard.pill,
        rows: [
          ...starredManualRows,
          ...starredCanvasRows,
          ...regularCanvasRows,
          ...regularManualRows,
        ].slice(0, maxRows),
      };
    }

    if (activeMode.id === 'academy' && translatedCard.id === 'upcoming-coursework') {
      const currentCanvasCourseworkItemIds = new Set(canvasCourseworkItems.filter(isCourseworkCanvasItem).map((item) => item.id));
      const currentCanvasAssessmentItemIds = new Set(canvasCourseworkItems.filter(isAssessmentCanvasItem).map((item) => item.id));
      const manualRows = createManualCourseworkRows(
        manualCoursework,
        manualLectures,
        canvasLecturePreferences,
        dateLocale,
        activeCourseSemester,
        fallbackCourseSemester,
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
      );
      const storedCanvasRows = createStoredCanvasCourseworkRows(
        canvasCourseworkPreferences,
        currentCanvasCourseworkItemIds,
        canvasLecturePreferences,
        manualLectures,
        dateLocale,
        activeCourseSemester,
        fallbackCourseSemester,
      );
      const manualAssessmentRows = createManualAssessmentRows(
        manualAssessments,
        manualLectures,
        canvasLecturePreferences,
        dateLocale,
        activeCourseSemester,
        fallbackCourseSemester,
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
      );
      const storedCanvasAssessmentRows = createStoredCanvasAssessmentRows(
        canvasAssessmentPreferences,
        currentCanvasAssessmentItemIds,
        canvasLecturePreferences,
        manualLectures,
        dateLocale,
        activeCourseSemester,
        fallbackCourseSemester,
      );
      const rows = [
        ...canvasRows,
        ...storedCanvasRows,
        ...canvasAssessmentRows,
        ...storedCanvasAssessmentRows,
        ...manualRows,
        ...manualAssessmentRows,
      ].sort(compareCourseworkDueDates);
      const isLoadingCoursework =
        canvasCourseworkLoadStatus === 'idle' ||
        canvasCourseworkLoadStatus === 'loading';

      if (rows.length === 0 && isLoadingCoursework) {
        return {
          ...translatedCard,
          rows: createLoadingRows(dictionary.canvasCourseworkLoading),
        };
      }

      if (rows.length === 0 && canvasCourseworkLoadStatus === 'failed') {
        return {
          ...translatedCard,
          rows: createMessageRows(dictionary.canvasCourseworkUnavailable),
        };
      }

      return {
        ...translatedCard,
        rows: rows.length > 0
          ? [
              ...rows,
              ...(isLoadingCoursework ? createLoadingRows(dictionary.canvasCourseworkLoading) : []),
            ]
          : createMessageRows(dictionary.canvasCourseworkEmpty),
      };
    }

    if (activeMode.id === 'academy' && translatedCard.id === 'upcoming-assessments') {
      const currentCanvasAssessmentItemIds = new Set(canvasCourseworkItems.filter(isAssessmentCanvasItem).map((item) => item.id));
      const manualRows = createManualAssessmentRows(
        manualAssessments,
        manualLectures,
        canvasLecturePreferences,
        dateLocale,
        activeCourseSemester,
        fallbackCourseSemester,
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
      );
      const storedCanvasRows = createStoredCanvasAssessmentRows(
        canvasAssessmentPreferences,
        currentCanvasAssessmentItemIds,
        canvasLecturePreferences,
        manualLectures,
        dateLocale,
        activeCourseSemester,
        fallbackCourseSemester,
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
    },
    [],
  );

  useEffect(() => {
    if (activeMode.id !== 'academy') {
      return undefined;
    }

    const handleAcademyPreferencesUpdated = () => {
      const nextManualLectures = getStoredManualLectures();
      const nextCanvasLecturePreferences = getStoredCanvasLecturePreferences();
      const nextManualCoursework = getStoredManualCoursework();
      const nextCanvasCourseworkPreferences = getStoredCanvasCourseworkPreferences();
      const nextManualAssessments = getStoredManualAssessments();
      const nextCanvasAssessmentPreferences = getStoredCanvasAssessmentPreferences();

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
    };

    const handleOpenCourseworkDialog = () => {
      setSelectedManualCourseworkId(null);
      setSelectedCanvasCourseworkId(null);
      setIsCourseworkDialogOpen(true);
    };

    window.addEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);
    window.addEventListener(academyOpenCourseworkDialogEvent, handleOpenCourseworkDialog);

    return () => {
      window.removeEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);
      window.removeEventListener(academyOpenCourseworkDialogEvent, handleOpenCourseworkDialog);
    };
  }, [activeMode.id]);

  useEffect(() => {
    let isCancelled = false;

    if (activeMode.id !== 'academy') {
      return undefined;
    }

    workspaceApi
      .getAcademyPreferences()
      .then((preferences) => {
        if (isCancelled) {
          return;
        }

        const storedManualLectures = getStoredManualLectures();
        const storedCanvasLecturePreferences = getStoredCanvasLecturePreferences();
        const storedManualCoursework = getStoredManualCoursework();
        const storedCanvasCourseworkPreferences = getStoredCanvasCourseworkPreferences();
        const storedManualAssessments = getStoredManualAssessments();
        const storedCanvasAssessmentPreferences = getStoredCanvasAssessmentPreferences();
        const serverManualLectures = Array.isArray(preferences.manualLectures)
          ? preferences.manualLectures as ManualLecture[]
          : [];
        const serverCanvasLecturePreferences = isCanvasLecturePreferences(preferences.canvasLecturePreferences)
          ? preferences.canvasLecturePreferences
          : {};
        const serverManualCoursework = Array.isArray(preferences.manualCoursework)
          ? preferences.manualCoursework as ManualCourseworkItem[]
          : [];
        const serverCanvasCourseworkPreferences =
          isCanvasCourseworkPreferences(preferences.canvasCourseworkPreferences)
            ? preferences.canvasCourseworkPreferences
            : {};
        const serverManualAssessments = Array.isArray(preferences.manualAssessments)
          ? preferences.manualAssessments as ManualAssessmentItem[]
          : [];
        const serverCanvasAssessmentPreferences =
          isCanvasAssessmentPreferences(preferences.canvasAssessmentPreferences)
            ? preferences.canvasAssessmentPreferences
            : {};
        const hasLocalPreferences =
          storedManualLectures.length > 0 ||
          Object.keys(storedCanvasLecturePreferences).length > 0 ||
          storedManualCoursework.length > 0 ||
          Object.keys(storedCanvasCourseworkPreferences).length > 0 ||
          storedManualAssessments.length > 0 ||
          Object.keys(storedCanvasAssessmentPreferences).length > 0;
        const shouldMigrateLocalPreferences = !preferences.exists && hasLocalPreferences;
        const nextManualLectures = shouldMigrateLocalPreferences
          ? storedManualLectures
          : serverManualLectures;
        const nextCanvasLecturePreferences = shouldMigrateLocalPreferences
          ? storedCanvasLecturePreferences
          : serverCanvasLecturePreferences;
        const nextManualCoursework = shouldMigrateLocalPreferences
          ? storedManualCoursework
          : serverManualCoursework;
        const nextCanvasCourseworkPreferences = shouldMigrateLocalPreferences
          ? storedCanvasCourseworkPreferences
          : serverCanvasCourseworkPreferences;
        const nextManualAssessments = shouldMigrateLocalPreferences
          ? storedManualAssessments
          : serverManualAssessments;
        const nextCanvasAssessmentPreferences = shouldMigrateLocalPreferences
          ? storedCanvasAssessmentPreferences
          : serverCanvasAssessmentPreferences;
        const localSelectedSemester = getStoredSelectedAcademySemester();
        const serverSelectedSemester = getSelectedSemesterFromSettings(preferences.calendarSettings);
        const nextSelectedSemester = shouldMigrateLocalPreferences
          ? localSelectedSemester
          : serverSelectedSemester ?? localSelectedSemester;

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
        if (nextSelectedSemester) {
          setSelectedCourseSemester(nextSelectedSemester);
          storeSelectedAcademySemester(nextSelectedSemester);
        }
        cacheAcademyPreferences(
          nextManualLectures,
          nextCanvasLecturePreferences,
          nextManualCoursework,
          nextCanvasCourseworkPreferences,
          nextManualAssessments,
          nextCanvasAssessmentPreferences,
        );

        if (shouldMigrateLocalPreferences) {
          persistAcademyPreferences(
            nextManualLectures,
            nextCanvasLecturePreferences,
            nextManualCoursework,
            nextCanvasCourseworkPreferences,
            nextManualAssessments,
            nextCanvasAssessmentPreferences,
          );
        }
      })
      .catch(() => undefined);

    return () => {
      isCancelled = true;
    };
  }, [activeMode.id]);

  useEffect(() => {
    let isCancelled = false;

    if (activeMode.id !== 'academy') {
      setCanvasCourses(null);
      setCanvasCourseLoadStatus('idle');
      setCanvasTermName(undefined);
      return undefined;
    }

    setCanvasCourseLoadStatus('loading');
    workspaceApi
      .getCanvasCourses(5)
      .then(({ courses, termName }) => {
        if (isCancelled) {
          return;
        }

        setCanvasCourses(courses);
        setCanvasTermName(termName);
        setCanvasCourseLoadStatus('loaded');
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setCanvasCourses(null);
        setCanvasTermName(undefined);
        setCanvasCourseLoadStatus('failed');
      });

    return () => {
      isCancelled = true;
    };
  }, [activeMode.id]);

  useEffect(() => {
    let isCancelled = false;

    if (activeMode.id !== 'academy') {
      setCanvasCourseworkItems([]);
      setCanvasCourseworkLoadStatus('idle');
      return undefined;
    }

    setCanvasCourseworkLoadStatus('loading');
    workspaceApi
      .getCanvasCalendarItems({
        endDate: getFutureDateString(120),
        pageSize: 100,
        startDate: getPastDateString(30),
      })
      .then(({ items }) => {
        if (isCancelled) {
          return;
        }

        setCanvasCourseworkItems(items);
        setCanvasCourseworkLoadStatus('loaded');
      })
      .catch(() => {
        if (isCancelled) {
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
      persistAcademyPreferences(
        manualLecturesRef.current,
        nextPreferences,
        manualCourseworkRef.current,
        canvasCourseworkPreferencesRef.current,
        manualAssessmentsRef.current,
        canvasAssessmentPreferencesRef.current,
      );

      return nextPreferences;
    });
  };

  const updateStoredManualCoursework = (
    updater: (coursework: ManualCourseworkItem[]) => ManualCourseworkItem[],
  ) => {
    setManualCoursework((currentCoursework) => {
      const nextCoursework = updater(currentCoursework);

      if (Object.is(nextCoursework, currentCoursework)) {
        return currentCoursework;
      }

      manualCourseworkRef.current = nextCoursework;
      persistAcademyPreferences(
        manualLecturesRef.current,
        canvasLecturePreferencesRef.current,
        nextCoursework,
        canvasCourseworkPreferencesRef.current,
        manualAssessmentsRef.current,
        canvasAssessmentPreferencesRef.current,
      );

      return nextCoursework;
    });
  };

  const updateStoredCanvasCourseworkPreferences = (
    updater: (preferences: CanvasCourseworkPreferences) => CanvasCourseworkPreferences,
  ) => {
    setCanvasCourseworkPreferences((currentPreferences) => {
      const nextPreferences = updater(currentPreferences);

      if (Object.is(nextPreferences, currentPreferences)) {
        return currentPreferences;
      }

      canvasCourseworkPreferencesRef.current = nextPreferences;
      persistAcademyPreferences(
        manualLecturesRef.current,
        canvasLecturePreferencesRef.current,
        manualCourseworkRef.current,
        nextPreferences,
        manualAssessmentsRef.current,
        canvasAssessmentPreferencesRef.current,
      );

      return nextPreferences;
    });
  };

  const updateStoredManualAssessments = (
    updater: (assessments: ManualAssessmentItem[]) => ManualAssessmentItem[],
  ) => {
    setManualAssessments((currentAssessments) => {
      const nextAssessments = updater(currentAssessments);

      if (Object.is(nextAssessments, currentAssessments)) {
        return currentAssessments;
      }

      manualAssessmentsRef.current = nextAssessments;
      persistAcademyPreferences(
        manualLecturesRef.current,
        canvasLecturePreferencesRef.current,
        manualCourseworkRef.current,
        canvasCourseworkPreferencesRef.current,
        nextAssessments,
        canvasAssessmentPreferencesRef.current,
      );

      return nextAssessments;
    });
  };

  const updateStoredCanvasAssessmentPreferences = (
    updater: (preferences: CanvasAssessmentPreferences) => CanvasAssessmentPreferences,
  ) => {
    setCanvasAssessmentPreferences((currentPreferences) => {
      const nextPreferences = updater(currentPreferences);

      if (Object.is(nextPreferences, currentPreferences)) {
        return currentPreferences;
      }

      canvasAssessmentPreferencesRef.current = nextPreferences;
      persistAcademyPreferences(
        manualLecturesRef.current,
        canvasLecturePreferencesRef.current,
        manualCourseworkRef.current,
        canvasCourseworkPreferencesRef.current,
        manualAssessmentsRef.current,
        nextPreferences,
      );

      return nextPreferences;
    });
  };

  useEffect(() => {
    if (activeMode.id !== 'academy' || !canvasCourses || canvasCourses.length === 0) {
      return;
    }

    updateStoredCanvasLecturePreferences((currentPreferences) => {
      let changed = false;
      const nextPreferences = { ...currentPreferences };

      canvasCourses.forEach((course) => {
        const preference = currentPreferences[course.id] ?? {};
        const originalCourseCode = course.courseCode?.trim() || course.id;
        const semester = getCanvasCourseSemester(course, currentPreferences, fallbackCourseSemester);
        const { changed: preferenceChanged, nextPreference } = mergeDefinedSnapshot(preference, {
          originalCourseCode,
          semester,
          termName: semester,
        });

        if (preferenceChanged) {
          nextPreferences[course.id] = nextPreference;
          changed = true;
        }
      });

      return changed ? nextPreferences : currentPreferences;
    });
  }, [activeMode.id, canvasCourses, fallbackCourseSemester]);

  useEffect(() => {
    if (activeMode.id !== 'academy' || canvasCourseworkItems.length === 0) {
      return;
    }

    updateStoredCanvasCourseworkPreferences((currentPreferences) => {
      let changed = false;
      const nextPreferences = { ...currentPreferences };

      canvasCourseworkItems.filter(isCourseworkCanvasItem).forEach((item) => {
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
        const { changed: preferenceChanged, nextPreference } = mergeDefinedSnapshot(preference, {
          courseCode,
          courseId: item.courseId,
          courseName: item.courseName,
          courseworkType: preference.courseworkType ?? item.type,
          dueAt: item.dueAt ?? item.startAt ?? preference.dueAt,
          htmlUrl: item.htmlUrl,
          isSubmitted: Boolean(item.isSubmitted),
          originalCourseCode: item.courseCode?.trim() || courseCode,
          semester,
          submissionType: preference.submissionType ?? item.submissionTypes?.[0] ?? formatSubmissionType(item.type),
          title: preference.title ?? item.title,
        });

        if (preferenceChanged) {
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
        const { changed: preferenceChanged, nextPreference } = mergeDefinedSnapshot(preference, {
          assessmentType: preference.assessmentType ?? item.type,
          courseCode,
          courseId: item.courseId,
          courseName: item.courseName,
          dueAt: item.dueAt ?? item.startAt ?? preference.dueAt,
          htmlUrl: item.htmlUrl,
          isSubmitted: Boolean(item.isSubmitted),
          originalCourseCode: item.courseCode?.trim() || courseCode,
          semester,
          title: preference.title ?? item.title,
        });

        if (preferenceChanged) {
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
    updateStoredManualLectures((currentLectures) => currentLectures.map((lecture) => (
      lecture.id === updatedLecture.id
        ? { ...updatedLecture, semester: normalizeSemesterName(updatedLecture.semester, activeCourseSemester) }
        : lecture
    )));
  };

  const handleUpdateCanvasLecture = (updatedLecture: ManualLecture) => {
    if (!selectedCanvasCourseId) {
      return;
    }

    const originalCourseCode =
      selectedCanvasCourse?.courseCode?.trim() ||
      selectedCanvasCourse?.id ||
      updatedLecture.code;

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
        semester: normalizeSemesterName(updatedLecture.semester, activeCourseSemester),
        termName: normalizeSemesterName(updatedLecture.semester, activeCourseSemester),
        tutorialSection: updatedLecture.tutorialSection,
      },
    }));
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
    setIsCourseworkDialogOpen(false);
  };

  const handleUpdateManualCoursework = (updatedCoursework: ManualCourseworkItem) => {
    updateStoredManualCoursework((currentCoursework) => currentCoursework.map((coursework) => (
      coursework.id === updatedCoursework.id
        ? { ...updatedCoursework, semester: normalizeSemesterName(updatedCoursework.semester, activeCourseSemester) }
        : coursework
    )));
    setSelectedManualCourseworkId(null);
  };

  const handleUpdateCanvasCoursework = (updatedCoursework: ManualCourseworkItem) => {
    if (!selectedCanvasCourseworkId) {
      return;
    }

    updateStoredCanvasCourseworkPreferences((currentPreferences) => ({
      ...currentPreferences,
      [selectedCanvasCourseworkId]: {
        ...(currentPreferences[selectedCanvasCourseworkId] ?? {}),
        chipColor: updatedCoursework.chipColor,
        completed: updatedCoursework.completed,
        courseCode: updatedCoursework.courseCode || undefined,
        courseworkType: updatedCoursework.courseworkType || undefined,
        dueAt: updatedCoursework.dueAt || undefined,
        semester: normalizeSemesterName(updatedCoursework.semester, activeCourseSemester),
        submissionType: updatedCoursework.submissionType || undefined,
        title: updatedCoursework.title || undefined,
      },
    }));
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
        ? { ...updatedAssessment, semester: normalizeSemesterName(updatedAssessment.semester, activeCourseSemester) }
        : assessment
    )));
    setSelectedManualAssessmentId(null);
  };

  const handleUpdateCanvasAssessment = (updatedAssessment: ManualAssessmentItem) => {
    if (!selectedCanvasAssessmentId) {
      return;
    }

    updateStoredCanvasAssessmentPreferences((currentPreferences) => ({
      ...currentPreferences,
      [selectedCanvasAssessmentId]: {
        ...(currentPreferences[selectedCanvasAssessmentId] ?? {}),
        assessmentType: updatedAssessment.assessmentType || undefined,
        completed: updatedAssessment.completed,
        courseCode: updatedAssessment.courseCode || undefined,
        dueAt: updatedAssessment.dueAt || undefined,
        semester: normalizeSemesterName(updatedAssessment.semester, activeCourseSemester),
        title: updatedAssessment.title || undefined,
      },
    }));
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

  const handleOpenLecture = (row: RenderableDashboardRow) => {
    if (row.lectureSource === 'canvas' && row.canvasCourseId) {
      setSelectedCanvasCourseId(row.canvasCourseId);
      return;
    }

    if (row.manualLectureId) {
      setSelectedManualLectureId(row.manualLectureId);
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

  const handleToggleCourseworkDone = (row: RenderableDashboardRow) => {
    if (row.isCanvasSubmitted) {
      return;
    }

    if (row.courseworkSource === 'canvas' && row.canvasCourseworkId) {
      updateStoredCanvasCourseworkPreferences((currentPreferences) => {
        const currentItemPreferences = currentPreferences[row.canvasCourseworkId!] ?? {};

        return {
          ...currentPreferences,
          [row.canvasCourseworkId!]: {
            ...currentItemPreferences,
            completed: !currentItemPreferences.completed,
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
        ? { ...coursework, completed: !coursework.completed }
        : coursework
    )));
  };

  const handleToggleAssessmentDone = (row: RenderableDashboardRow) => {
    if (row.isCanvasSubmitted) {
      return;
    }

    if (row.assessmentSource === 'canvas' && row.canvasAssessmentId) {
      updateStoredCanvasAssessmentPreferences((currentPreferences) => {
        const currentItemPreferences = currentPreferences[row.canvasAssessmentId!] ?? {};

        return {
          ...currentPreferences,
          [row.canvasAssessmentId!]: {
            ...currentItemPreferences,
            completed: !currentItemPreferences.completed,
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
        ? { ...assessment, completed: !assessment.completed }
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

    updateStoredManualCoursework((currentCoursework) => currentCoursework.filter((coursework) => (
      coursework.id !== row.manualCourseworkId
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

    updateStoredManualAssessments((currentAssessments) => currentAssessments.filter((assessment) => (
      assessment.id !== row.manualAssessmentId
    )));
  };

  const handleRestoreCanvasCoursework = () => {
    updateStoredCanvasCourseworkPreferences((currentPreferences) => (
      Object.fromEntries(Object.entries(currentPreferences).map(([courseworkId, preference]) => [
        courseworkId,
        {
          ...preference,
          completed: false,
          hidden: false,
        },
      ]))
    ));
    updateStoredCanvasAssessmentPreferences((currentPreferences) => (
      Object.fromEntries(Object.entries(currentPreferences).map(([assessmentId, preference]) => [
        assessmentId,
        {
          ...preference,
          completed: false,
          hidden: false,
        },
      ]))
    ));
  };

  const handleRefreshMessages = () => {
    setIsRefreshingMessages(true);

    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      setIsRefreshingMessages(false);
      refreshTimeoutRef.current = null;
    }, 700);
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
      if (recoverableCanvasCourseworkCount === 0) {
        return (
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
        );
      }

      return (
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
            <DropdownMenuItem onSelect={handleRestoreCanvasCoursework}>
              <Eye className="size-4" />
              <span>{dictionary.courseworkRestoreCanvas}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    if (card.id === 'messages') {
      return (
        <Button
          aria-label={dictionary.dashboardRefreshMessages}
          className="size-7 border-border bg-background/70 text-muted-foreground hover:text-foreground"
          onClick={handleRefreshMessages}
          size="icon-sm"
          title={dictionary.dashboardRefreshMessages}
          type="button"
          variant="outline"
        >
          <RefreshCw className={cn('size-3.5', isRefreshingMessages && 'animate-spin')} />
        </Button>
      );
    }

    if (card.id === 'meetings') {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={dictionary.dashboardAddMeeting}
              className="h-7 gap-1 rounded-md border-border bg-background/70 px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              size="sm"
              title={dictionary.dashboardAddMeeting}
              type="button"
              variant="outline"
            >
              <GoogleProductIcon decorative product="meet" size={15} />
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem
              onSelect={() => {
                onStartMeetingNow?.();
              }}
            >
              <GoogleProductIcon decorative product="meet" size={16} />
              <span>{dictionary.dashboardStartMeetingNow}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onPlanMeeting?.();
              }}
            >
              <CalendarPlus className="size-4" />
              <span>{dictionary.dashboardPlanMeeting}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onWriteInPersonMeetingReport?.();
              }}
            >
              <GoogleProductIcon decorative product="docs" size={16} />
              <span>{dictionary.dashboardWriteMeetingReport}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
      persistAcademyPreferences(
        manualLecturesRef.current,
        canvasLecturePreferencesRef.current,
        manualCourseworkRef.current,
        canvasCourseworkPreferencesRef.current,
        manualAssessmentsRef.current,
        canvasAssessmentPreferencesRef.current,
      );
    };

    if (activeMode.id === 'academy' && card.id === 'semester-lectures') {
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
        className="grid gap-3 xl:grid-cols-3"
        aria-label={`${translateModeName(activeMode.id, activeMode.displayName)} dashboard summary`}
      >
        {dashboardCards.map((card) => {
          const cardAction = renderCardAction(card);

          return (
            <Card
              className={cn(
                'rounded-xl bg-card shadow-none',
                activeMode.id === 'academy' && card.id === 'semester-lectures' && 'cursor-pointer transition hover:bg-muted/35',
                activeMode.id === 'academy' && card.id === 'upcoming-coursework' && 'xl:col-span-2',
              )}
              key={card.id}
              onClick={() => {
                if (activeMode.id === 'academy' && card.id === 'semester-lectures') {
                  onOpenCourses?.();
                }
              }}
            >
              <CardHeader className="gap-2 pb-3">
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
              <CardContent>
                <DashboardRows
                  card={card}
                  onHideLecture={handleHideLecture}
                  onOpenAssessment={handleOpenAssessment}
                  onOpenCoursework={handleOpenCoursework}
                  onOpenLecture={handleOpenLecture}
                  onOpenLectureFriendlyName={handleOpenLectureFriendlyName}
                  onRemoveAssessment={handleRemoveAssessment}
                  onRemoveCoursework={handleRemoveCoursework}
                  onSetLectureChipColor={handleSetLectureChipColor}
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
      <ManualLectureDialog
        onAddLecture={handleAddManualLecture}
        onOpenChange={setIsManualLectureDialogOpen}
        open={isManualLectureDialogOpen}
        selectedSemester={activeCourseSemester}
        semesterOptions={courseSemesterOptions}
      />
      <CourseworkDialog
        courseOptions={courseworkCourseOptions}
        onOpenChange={setIsCourseworkDialogOpen}
        onSave={handleAddManualCoursework}
        open={isCourseworkDialogOpen}
        selectedSemester={activeCourseSemester}
      />
      <CourseworkDialog
        courseOptions={courseworkCourseOptions}
        initialCoursework={selectedManualCoursework}
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
        courseOptions={courseworkCourseOptions}
        initialCoursework={selectedCanvasCourseworkEditable}
        isCanvasCoursework
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
        onOpenChange={setIsAssessmentDialogOpen}
        onSave={handleAddManualAssessment}
        open={isAssessmentDialogOpen}
        selectedSemester={activeCourseSemester}
      />
      <AssessmentDialog
        courseOptions={courseworkCourseOptions}
        initialAssessment={selectedManualAssessment}
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
        isCanvasAssessment
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
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedManualLectureId(null);
          }
        }}
        onSaveLecture={handleUpdateManualLecture}
        open={Boolean(selectedManualLecture)}
        selectedSemester={activeCourseSemester}
        semesterOptions={courseSemesterOptions}
      />
      <ManualLectureDialog
        description={dictionary.canvasLectureEditDescription}
        initialLecture={selectedCanvasLecture}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedCanvasCourseId(null);
          }
        }}
        onSaveLecture={handleUpdateCanvasLecture}
        open={Boolean(selectedCanvasLecture)}
        selectedSemester={activeCourseSemester}
        semesterOptions={courseSemesterOptions}
        submitLabel={dictionary.manualLectureUpdate}
        title={dictionary.canvasLectureEditTitle}
      />
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
