/* eslint-disable react-hooks/set-state-in-effect -- This restored integration view synchronizes selection and request state in effects. */
import { ArrowLeft, BarChart3, ChevronDown, ChevronRight, LoaderCircle, RefreshCw, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { canvasToDoApi } from '../api/canvasToDoApi';
import type { AcademyPreferences, CanvasCourse, CanvasCourseContent } from '../api/canvasToDoApi';
import { useLanguage } from '../context/LanguageContext';
import { badgeColorClasses, dotColorClasses } from '../lib/colorStyles';
import { shouldConvertCanvasCourseToManual } from '../lib/canvasCourseMigration';
import {
  defaultGradeProgressColorThresholds,
  getGradeProgressColor,
  normalizeGradeProgressColorThresholds,
  type GradeProgressColorThresholds,
} from '../lib/gradeProgress';
import { compareSemestersNewestFirst } from '../lib/semesterSort';
import { cn } from '../lib/utils';
import type { ColorToken } from '../modes/types';
import { calculateManualGradeSummary, ManualGradeEditor } from './ManualGradeEditor';
import type { ManualLecture } from './ManualLectureDialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { CanvasNoticeDialog } from './CanvasNoticeDialog';
import { isCanvasConnectionError } from '../lib/canvasOnboarding';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';

interface CanvasLecturePreference {
  assessments?: ManualLecture['assessments'];
  accessClosed?: boolean;
  accessRestrictedByDate?: boolean;
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
  links?: ManualLecture['links'];
  originalCourseCode?: string;
  schedule?: ManualLecture['schedule'];
  semesterSource?: 'canvas' | 'fallback' | 'manual';
  semester?: string;
  starred?: boolean;
  tutorialSection?: string;
  termName?: string;
  termEndAt?: string;
  termStartAt?: string;
  workflowState?: string;
}

type CanvasLecturePreferences = Record<string, CanvasLecturePreference>;

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

interface CanvasCourseworkPreference {
  assignmentId?: string;
  chipColor?: ColorToken;
  completed?: boolean;
  completedAt?: string;
  courseCode?: string;
  courseId?: string;
  courseworkType?: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  hidden?: boolean;
  isSubmitted?: boolean;
  semester?: string;
  starred?: boolean;
  submittedAt?: string;
  submissionType?: string;
  title?: string;
}

interface CanvasAssessmentPreference {
  assignmentId?: string;
  assessmentType?: string;
  completed?: boolean;
  completedAt?: string;
  courseCode?: string;
  courseId?: string;
  dueAt?: string;
  startAt?: string;
  endAt?: string;
  hidden?: boolean;
  isSubmitted?: boolean;
  semester?: string;
  starred?: boolean;
  submittedAt?: string;
  title?: string;
}

type CanvasCourseworkPreferences = Record<string, CanvasCourseworkPreference>;
type CanvasAssessmentPreferences = Record<string, CanvasAssessmentPreference>;

interface GradeCourseRow {
  id: string;
  canvasCourseId?: string;
  source: 'canvas' | 'manual';
  name: string;
  courseCode: string;
  semester: string;
  color: ColorToken;
  score?: number;
  grade?: string;
  status?: string;
  credits?: string;
  assessments: ManualLecture['assessments'];
  manualLectureId?: string;
  hasReadOnlyCanvasGradeSummary?: boolean;
}

interface CourseDetailState {
  status: LoadStatus;
  content?: CanvasCourseContent;
  error?: string;
}

const defaultAcademySemester = getDateBasedAcademySemester();
const noTermSemester = 'Default Term';
const academyPreferencesUpdatedEvent = 'canvas-to-do-preferences-updated';

function dispatchAcademyPreferencesSnapshot(preferences: AcademyPreferences) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(academyPreferencesUpdatedEvent, {
    detail: {
      canvasAssessmentPreferences: getCanvasAssessmentPreferencesFromAcademyPreferences(preferences),
      canvasCourseworkPreferences: getCanvasCourseworkPreferencesFromAcademyPreferences(preferences),
      canvasLecturePreferences: getCanvasLecturePreferencesFromAcademyPreferences(preferences),
      manualAssessments: getManualAssessmentsFromAcademyPreferences(preferences),
      manualCoursework: getManualCourseworkFromAcademyPreferences(preferences),
      manualLectures: getManualLecturesFromAcademyPreferences(preferences),
    },
  }));
}

function getDateBasedAcademySemester(date = new Date()) {
  const month = date.getMonth();
  const term = month <= 3 ? 'Spring' : month <= 7 ? 'Summer' : 'Fall';

  return `${term} ${date.getFullYear()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isColorToken(value: unknown): value is ColorToken {
  return typeof value === 'string' && value in dotColorClasses;
}

function getCalendarSettingsRecord(settings: unknown) {
  return isRecord(settings) ? settings : {};
}

function getSelectedSemesterFromAcademyPreferences(preferences: { calendarSettings?: unknown }) {
  const settings = getCalendarSettingsRecord(preferences.calendarSettings);
  const selectedSemester = settings.selectedSemester;

  return typeof selectedSemester === 'string'
    ? normalizeSemesterName(selectedSemester)
    : undefined;
}

function getGradeProgressThresholdsFromAcademyPreferences(
  preferences: Pick<AcademyPreferences, 'calendarSettings'>,
  fallback: GradeProgressColorThresholds = defaultGradeProgressColorThresholds,
) {
  return normalizeGradeProgressColorThresholds(getCalendarSettingsRecord(preferences.calendarSettings), fallback);
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

function normalizeCourseMatchValue(value?: string) {
  return value?.replace(/\s+/g, '').trim().toLowerCase() || '';
}

function getCanvasLecturePreferencesFromAcademyPreferences(
  preferences: Pick<AcademyPreferences, 'canvasLecturePreferences'>,
) {
  return isRecord(preferences.canvasLecturePreferences)
    ? preferences.canvasLecturePreferences as CanvasLecturePreferences
    : {};
}

function getManualLecturesFromAcademyPreferences(preferences: Pick<AcademyPreferences, 'manualLectures'>) {
  return Array.isArray(preferences.manualLectures)
    ? preferences.manualLectures as ManualLecture[]
    : [];
}

function getManualCourseworkFromAcademyPreferences(preferences: Pick<AcademyPreferences, 'manualCoursework'>) {
  return Array.isArray(preferences.manualCoursework)
    ? preferences.manualCoursework as ManualCourseworkItem[]
    : [];
}

function getManualAssessmentsFromAcademyPreferences(preferences: Pick<AcademyPreferences, 'manualAssessments'>) {
  return Array.isArray(preferences.manualAssessments)
    ? preferences.manualAssessments as ManualAssessmentItem[]
    : [];
}

function getCanvasCourseworkPreferencesFromAcademyPreferences(
  preferences: Pick<AcademyPreferences, 'canvasCourseworkPreferences'>,
) {
  return isRecord(preferences.canvasCourseworkPreferences)
    ? preferences.canvasCourseworkPreferences as CanvasCourseworkPreferences
    : {};
}

function getCanvasAssessmentPreferencesFromAcademyPreferences(
  preferences: Pick<AcademyPreferences, 'canvasAssessmentPreferences'>,
) {
  return isRecord(preferences.canvasAssessmentPreferences)
    ? preferences.canvasAssessmentPreferences as CanvasAssessmentPreferences
    : {};
}

function getCanvasPreferenceForCourse(course: CanvasCourse, preferences: CanvasLecturePreferences) {
  const courseId = String(course.id ?? '');
  const directPreference = preferences[courseId];

  if (directPreference) {
    return directPreference;
  }

  const normalizedCourseCode = normalizeCourseMatchValue(course.courseCode);
  const normalizedCourseName = normalizeCourseMatchValue(course.name);

  return Object.values(preferences).find((preference) => {
    const preferenceCodes = [
      preference.originalCourseCode,
      preference.friendlyCourseCode,
      preference.courseName,
      preference.friendlyName,
    ].map(normalizeCourseMatchValue);

    return Boolean(
      normalizedCourseCode && preferenceCodes.includes(normalizedCourseCode) ||
      normalizedCourseName && preferenceCodes.includes(normalizedCourseName),
    );
  }) ?? {};
}

function formatStatus(value?: string) {
  if (!value) {
    return '';
  }

  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function createCanvasRows(courses: CanvasCourse[], preferences: CanvasLecturePreferences): GradeCourseRow[] {
  return courses.flatMap((course) => {
    const courseId = String(course.id ?? '');
    const preference = getCanvasPreferenceForCourse(course, preferences);

    const restoreAccessibleConversion = Boolean(
      preference.convertedToManualAt && course.accessClosed !== true,
    );

    if (
      course.accessClosed ||
      (!restoreAccessibleConversion && (preference.hidden || preference.deleted))
    ) {
      return [];
    }

    const color = isColorToken(preference.chipColor) ? preference.chipColor : 'blue';
    const semester = preference.semester || preference.termName
      ? normalizeSemesterName(preference.semester ?? preference.termName)
      : normalizeCanvasSemesterName(course.termName);

    return [{
      id: `canvas:${courseId}`,
      canvasCourseId: courseId,
      source: 'canvas',
      name: preference.friendlyName?.trim() || course.name,
      courseCode: preference.friendlyCourseCode?.trim() || course.courseCode?.trim() || course.id,
      semester,
      color,
      score: typeof course.currentScore === 'number' ? course.currentScore : undefined,
      grade: course.currentGrade,
      status: formatStatus(course.workflowState),
      credits: preference.credits,
      assessments: preference.assessments ?? [],
    }];
  });
}

function createStoredCanvasRows(
  preferences: CanvasLecturePreferences,
  liveCourses: CanvasCourse[],
): GradeCourseRow[] {
  const liveCourseIds = new Set(liveCourses.map((course) => String(course.id ?? '')));

  return Object.entries(preferences).flatMap(([courseId, preference]) => {
    if (
      liveCourseIds.has(courseId) ||
      preference.hidden ||
      preference.deleted ||
      !(
        preference.friendlyCourseCode?.trim() ||
        preference.originalCourseCode?.trim() ||
        preference.friendlyName?.trim() ||
        preference.courseName?.trim()
      )
    ) {
      return [];
    }

    const color = isColorToken(preference.chipColor) ? preference.chipColor : 'blue';

    return [{
      id: `stored-canvas:${courseId}`,
      canvasCourseId: courseId,
      source: 'canvas' as const,
      name: preference.friendlyName?.trim() ||
        preference.courseName?.trim() ||
        preference.originalCourseCode?.trim() ||
        courseId,
      courseCode: preference.friendlyCourseCode?.trim() ||
        preference.originalCourseCode?.trim() ||
        courseId,
      semester: normalizeSemesterName(preference.semester ?? preference.termName),
      color,
      score: typeof preference.currentScore === 'number' ? preference.currentScore : undefined,
      grade: preference.currentGrade,
      status: formatStatus(preference.workflowState),
      credits: preference.credits,
      assessments: preference.assessments ?? [],
    }];
  });
}

function isGeneratedArchivedCanvasLectureForAccessibleCourse(
  lecture: ManualLecture,
  preferences: CanvasLecturePreferences,
  courses: CanvasCourse[],
) {
  const archivedCourseId = Object.entries(preferences).find(([, preference]) => (
    preference.archivedAsManualLectureId === lecture.id
  ))?.[0];

  return Boolean(archivedCourseId && courses.some((course) => (
    String(course.id ?? '') === archivedCourseId && course.accessClosed !== true
  )));
}

function isGeneratedConvertedCanvasLectureForAccessibleCourse(
  lecture: ManualLecture,
  courses: CanvasCourse[],
) {
  return courses.some((course) => (
    course.accessClosed !== true && lecture.id === `manual-canvas-${course.id}`
  ));
}

function createManualRows(lectures: ManualLecture[]): GradeCourseRow[] {
  return lectures
    .filter((lecture) => !lecture.hidden && !lecture.deleted)
    .map((lecture) => {
      const assessments = lecture.assessments ?? [];
      const summary = calculateManualGradeSummary(assessments);

      return {
        id: `manual:${lecture.id}`,
        manualLectureId: lecture.id,
        source: 'manual',
        name: lecture.friendlyName?.trim() || lecture.name,
        courseCode: lecture.friendlyCourseCode?.trim() || lecture.code,
        semester: normalizeSemesterName(lecture.semester),
        color: isColorToken(lecture.chipColor) ? lecture.chipColor : 'blue',
        credits: lecture.credits,
        score: lecture.canvasGradeSummary?.score ?? summary.currentPercent,
        grade: lecture.canvasGradeSummary?.grade,
        assessments,
        hasReadOnlyCanvasGradeSummary: Boolean(lecture.canvasGradeSummary),
      };
    });
}

function getCanvasCourseSnapshot(
  course: CanvasCourse,
  preference: CanvasLecturePreference,
  fallbackSemester: string,
  now: string,
): CanvasLecturePreference {
  const courseCode = course.courseCode?.trim() || course.id;
  const semester = normalizeSemesterName(
    preference.semester || preference.termName || course.termName,
    fallbackSemester,
  );

  return {
    ...preference,
    accessClosed: course.accessClosed === true,
    accessRestrictedByDate: course.accessRestrictedByDate === true,
    canvasAccessLostAt: preference.canvasAccessLostAt ?? null,
    courseName: course.name,
    currentGrade: course.currentGrade,
    currentScore: course.currentScore,
    htmlUrl: course.htmlUrl,
    isPublished: course.isPublished,
    lastSeenAt: now,
    originalCourseCode: preference.originalCourseCode || courseCode,
    semester,
    semesterSource: preference.semesterSource || (course.termName ? 'canvas' : 'fallback'),
    termName: semester,
    termEndAt: course.termEndAt,
    termStartAt: course.termStartAt,
    workflowState: course.workflowState,
  };
}

function createManualLectureFromCanvasPreference(
  courseId: string,
  preference: CanvasLecturePreference,
  fallbackSemester: string,
): ManualLecture {
  const code = preference.friendlyCourseCode?.trim() || preference.originalCourseCode?.trim() || courseId;
  const name = preference.friendlyName?.trim() || preference.courseName?.trim() || code;

  return {
    id: `manual-canvas-${courseId}`,
    name,
    code,
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
    links: preference.links ?? (preference.htmlUrl
      ? [{ id: `${courseId}-canvas-link`, label: 'Canvas course', url: preference.htmlUrl }]
      : []),
    friendlyCourseCode: preference.friendlyCourseCode,
    friendlyName: preference.friendlyName,
    starred: preference.starred,
    chipColor: preference.chipColor,
    canvasGradeSummary: {
      grade: preference.currentGrade,
      score: preference.currentScore,
    },
    semester: normalizeSemesterName(preference.semester ?? preference.termName, fallbackSemester),
  };
}

function createManualCourseworkFromCanvasPreference(
  courseId: string,
  itemId: string,
  preference: CanvasCourseworkPreference,
  course: CanvasLecturePreference,
  fallbackSemester: string,
): ManualCourseworkItem {
  return {
    id: `manual-canvas-coursework-${courseId}-${itemId}`,
    title: preference.title?.trim() || 'Coursework',
    courseCode: preference.courseCode?.trim() || course.friendlyCourseCode?.trim() || course.originalCourseCode?.trim() || courseId,
    dueAt: preference.dueAt ?? preference.startAt ?? preference.endAt ?? '',
    startAt: preference.startAt,
    endAt: preference.endAt,
    courseworkType: preference.courseworkType ?? 'assignment',
    submissionType: preference.submissionType ?? 'assignment',
    completed: Boolean(preference.isSubmitted) || Boolean(preference.completed),
    completedAt: preference.submittedAt ?? preference.completedAt,
    chipColor: course.chipColor,
    hidden: preference.hidden,
    retainedFromCanvasCourseId: courseId,
    semester: normalizeSemesterName(preference.semester ?? course.semester ?? course.termName, fallbackSemester),
    starred: preference.starred,
  };
}

function createManualAssessmentFromCanvasPreference(
  courseId: string,
  itemId: string,
  preference: CanvasAssessmentPreference,
  course: CanvasLecturePreference,
  fallbackSemester: string,
): ManualAssessmentItem {
  return {
    id: `manual-canvas-assessment-${courseId}-${itemId}`,
    title: preference.title?.trim() || 'Assessment',
    courseCode: preference.courseCode?.trim() || course.friendlyCourseCode?.trim() || course.originalCourseCode?.trim() || courseId,
    dueAt: preference.dueAt ?? preference.startAt ?? preference.endAt ?? '',
    startAt: preference.startAt,
    endAt: preference.endAt,
    assessmentType: preference.assessmentType ?? 'quiz',
    completed: Boolean(preference.isSubmitted) || Boolean(preference.completed),
    completedAt: preference.submittedAt ?? preference.completedAt,
    hidden: preference.hidden,
    retainedFromCanvasCourseId: courseId,
    semester: normalizeSemesterName(preference.semester ?? course.semester ?? course.termName, fallbackSemester),
    starred: preference.starred,
  };
}

function isCanvasAccessDeniedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /unauthori[sz]ed|not authorized|forbidden|permission|access/i.test(message);
}

function migrateClosedCanvasCourses(
  preferences: AcademyPreferences,
  liveCourses: CanvasCourse[],
  fallbackSemester: string,
  courseListIsComplete: boolean,
  now = Date.now(),
) {
  const courseById = new Map(liveCourses.map((course) => [String(course.id ?? ''), course]));
  const nowIso = new Date(now).toISOString();
  const nextCanvasLecturePreferences = {
    ...getCanvasLecturePreferencesFromAcademyPreferences(preferences),
  } as CanvasLecturePreferences;
  const nextManualLectures = [...getManualLecturesFromAcademyPreferences(preferences)];
  const nextManualCoursework = [...getManualCourseworkFromAcademyPreferences(preferences)];
  const nextCanvasCourseworkPreferences = {
    ...getCanvasCourseworkPreferencesFromAcademyPreferences(preferences),
  };
  const nextManualAssessments = [...getManualAssessmentsFromAcademyPreferences(preferences)];
  const nextCanvasAssessmentPreferences = {
    ...getCanvasAssessmentPreferencesFromAcademyPreferences(preferences),
  };
  let changed = false;
  let migratedCount = 0;

  liveCourses.forEach((course) => {
    const courseId = String(course.id ?? '');
    const currentPreference = nextCanvasLecturePreferences[courseId] ?? {};

    const nextPreference = getCanvasCourseSnapshot(course, currentPreference, fallbackSemester, nowIso);

    if (JSON.stringify(currentPreference) !== JSON.stringify(nextPreference)) {
      nextCanvasLecturePreferences[courseId] = nextPreference;
      changed = true;
    }
  });

  Object.entries(nextCanvasLecturePreferences).forEach(([courseId, preference]) => {
    if (preference.archivedAsManualLectureId || (preference.deleted && !preference.convertedToManualAt)) {
      return;
    }

    const isAlreadyConverted = Boolean(preference.convertedToManualAt);

    if (!shouldConvertCanvasCourseToManual(courseById.get(courseId), now, {
      courseListIsComplete,
      wasPreviouslySeen: Boolean(preference.lastSeenAt),
    })) {
      return;
    }

    const manualLectureId = `manual-canvas-${courseId}`;
    let courseChanged = false;
    const manualLectureIndex = nextManualLectures.findIndex((lecture) => lecture.id === manualLectureId);

    if (manualLectureIndex === -1) {
      nextManualLectures.push(createManualLectureFromCanvasPreference(courseId, preference, fallbackSemester));
      courseChanged = true;
    } else if (!nextManualLectures[manualLectureIndex].canvasGradeSummary) {
      nextManualLectures[manualLectureIndex] = {
        ...nextManualLectures[manualLectureIndex],
        canvasGradeSummary: {
          grade: preference.currentGrade,
          score: preference.currentScore,
        },
      };
      courseChanged = true;
    }

    Object.entries(nextCanvasCourseworkPreferences).forEach(([itemId, courseworkPreference]) => {
      if (courseworkPreference.courseId !== courseId) {
        return;
      }

      const manualCourseworkId = `manual-canvas-coursework-${courseId}-${itemId}`;
      const manualCourseworkIndex = nextManualCoursework.findIndex((item) => item.id === manualCourseworkId);

      if (manualCourseworkIndex === -1) {
        nextManualCoursework.push(createManualCourseworkFromCanvasPreference(
          courseId,
          itemId,
          courseworkPreference,
          preference,
          fallbackSemester,
        ));
        courseChanged = true;
      } else if (!nextManualCoursework[manualCourseworkIndex].retainedFromCanvasCourseId) {
        nextManualCoursework[manualCourseworkIndex] = {
          ...nextManualCoursework[manualCourseworkIndex],
          retainedFromCanvasCourseId: courseId,
        };
        courseChanged = true;
      }

      if (!courseworkPreference.hidden) {
        nextCanvasCourseworkPreferences[itemId] = { ...courseworkPreference, hidden: true };
        courseChanged = true;
      }
    });

    Object.entries(nextCanvasAssessmentPreferences).forEach(([itemId, assessmentPreference]) => {
      if (assessmentPreference.courseId !== courseId) {
        return;
      }

      const manualAssessmentId = `manual-canvas-assessment-${courseId}-${itemId}`;
      const manualAssessmentIndex = nextManualAssessments.findIndex((item) => item.id === manualAssessmentId);

      if (manualAssessmentIndex === -1) {
        nextManualAssessments.push(createManualAssessmentFromCanvasPreference(
          courseId,
          itemId,
          assessmentPreference,
          preference,
          fallbackSemester,
        ));
        courseChanged = true;
      } else if (!nextManualAssessments[manualAssessmentIndex].retainedFromCanvasCourseId) {
        nextManualAssessments[manualAssessmentIndex] = {
          ...nextManualAssessments[manualAssessmentIndex],
          retainedFromCanvasCourseId: courseId,
        };
        courseChanged = true;
      }

      if (!assessmentPreference.hidden) {
        nextCanvasAssessmentPreferences[itemId] = { ...assessmentPreference, hidden: true };
        courseChanged = true;
      }
    });

    if (!isAlreadyConverted) {
      nextCanvasLecturePreferences[courseId] = {
        ...preference,
        convertedToManualAt: nowIso,
        deleted: true,
        hidden: true,
      };
      courseChanged = true;
      migratedCount += 1;
    }

    changed ||= courseChanged;
  });

  return {
    changed,
    migratedCount,
    nextCanvasLecturePreferences,
    nextManualLectures,
    nextCanvasCourseworkPreferences,
    nextManualCoursework,
    nextCanvasAssessmentPreferences,
    nextManualAssessments,
  };
}

function getGradeVisual(
  score?: number,
  thresholds: GradeProgressColorThresholds = defaultGradeProgressColorThresholds,
) {
  if (typeof score !== 'number') {
    return {
      color: '#737373',
      label: '--',
      normalizedScore: 0,
    };
  }

  const normalizedScore = Math.max(0, Math.min(100, score));

  return {
    color: getGradeProgressColor(normalizedScore, thresholds),
    label: `${Math.round(normalizedScore * 10) / 10}%`,
    normalizedScore,
  };
}

function getExpectedLetterGrade(score?: number) {
  if (typeof score !== 'number') {
    return '--';
  }

  const normalizedScore = Math.max(0, Math.min(100, score));

  if (normalizedScore >= 95) return 'A+';
  if (normalizedScore >= 90) return 'A';
  if (normalizedScore >= 85) return 'A-';
  if (normalizedScore >= 80) return 'B+';
  if (normalizedScore >= 75) return 'B';
  if (normalizedScore >= 70) return 'B-';
  if (normalizedScore >= 65) return 'C+';
  if (normalizedScore >= 60) return 'C';
  if (normalizedScore >= 55) return 'C-';
  if (normalizedScore >= 50) return 'D';

  return 'F';
}

function getScorePercentage(score?: number, pointsPossible?: number) {
  if (typeof score !== 'number' || typeof pointsPossible !== 'number' || pointsPossible <= 0) {
    return undefined;
  }

  return Math.max(0, Math.min(100, (score / pointsPossible) * 100));
}

function formatPercent(value?: number) {
  return typeof value === 'number' ? `${Math.round(value * 10) / 10}%` : '--';
}

function formatRawScore(score?: number, pointsPossible?: number) {
  if (typeof score !== 'number') {
    return '';
  }

  return typeof pointsPossible === 'number' && pointsPossible > 0
    ? `${score} / ${pointsPossible}`
    : String(score);
}

function formatDueDate(value: string | undefined, locale: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(date);
}

function formatScore(row: GradeCourseRow) {
  const expectedLetterGrade = getExpectedLetterGrade(row.score);

  if (expectedLetterGrade !== '--' && typeof row.score === 'number') {
    return `${expectedLetterGrade} · ${Math.round(row.score * 10) / 10}%`;
  }

  if (row.grade) {
    return row.grade;
  }

  if (typeof row.score === 'number') {
    return `${Math.round(row.score * 10) / 10}%`;
  }

  return '--';
}

export function AcademyGradesView({ selectedSemester: selectedSemesterProp, isPhone = false, canvasTokenRemindersEnabled = true }: { selectedSemester?: string; isPhone?: boolean; canvasTokenRemindersEnabled?: boolean } = {}) {
  const { dictionary, language } = useLanguage();
  const academyGradesCanvasCoursesMovedToManual = dictionary.academyGradesCanvasCoursesMovedToManual;
  const locale = language === 'ko' ? 'ko-KR' : 'en-CA';
  const [rows, setRows] = useState<GradeCourseRow[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [loadError, setLoadError] = useState('');
  const [canvasWarning, setCanvasWarning] = useState('');
  const [isConnectionWarning, setIsConnectionWarning] = useState(false);
  const [dismissedCanvasWarning, setDismissedCanvasWarning] = useState('');
  const [academyPreferences, setAcademyPreferences] = useState<AcademyPreferences | null>(null);
  const [selectedSemester, setSelectedSemester] = useState(defaultAcademySemester);
  const [gradeProgressThresholds, setGradeProgressThresholds] =
    useState<GradeProgressColorThresholds>(defaultGradeProgressColorThresholds);
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(() => new Set());
  const [phoneSelectedRowId, setPhoneSelectedRowId] = useState<string | null>(null);
  const phoneScreenRef = useRef<HTMLDivElement>(null);
  const [courseDetails, setCourseDetails] = useState<Record<string, CourseDetailState>>({});
  const isMountedRef = useRef(true);
  const courseDetailsRef = useRef(courseDetails);
  const loadGradesSequenceRef = useRef(0);
  const manualGradeSaveSequenceRef = useRef(0);
  const selectedSemesterFromProp = selectedSemesterProp
    ? normalizeSemesterName(selectedSemesterProp)
    : undefined;

  useEffect(() => {
    if (isPhone) {
      phoneScreenRef.current?.focus({ preventScroll: true });
      phoneScreenRef.current?.scrollIntoView({ block: 'start' });
    }
  }, [isPhone, phoneSelectedRowId]);

  const loadGrades = useCallback(async () => {
    const loadSequence = ++loadGradesSequenceRef.current;

    setLoadStatus('loading');
    setLoadError('');
    setCanvasWarning('');
    setIsConnectionWarning(false);

    const [preferencesResult, coursesResult] = await Promise.allSettled([
      canvasToDoApi.getAcademyPreferences(),
      canvasToDoApi.getCanvasCourses(100),
    ]);

    if (!isMountedRef.current || loadSequence !== loadGradesSequenceRef.current) {
      return;
    }

    if (preferencesResult.status === 'rejected') {
      setRows([]);
      setLoadError(preferencesResult.reason instanceof Error
        ? preferencesResult.reason.message
        : dictionary.academyGradesUnavailable);
      setLoadStatus('failed');

      return;
    }

    const preferences = preferencesResult.value;
    const liveCanvasCourses = coursesResult.status === 'fulfilled'
      ? coursesResult.value.courses
      : [];
    const migration = coursesResult.status === 'fulfilled'
      ? migrateClosedCanvasCourses(
          preferences,
          liveCanvasCourses,
          selectedSemesterFromProp ?? defaultAcademySemester,
          coursesResult.value.isComplete === true,
        )
      : {
        changed: false,
        migratedCount: 0,
        nextCanvasAssessmentPreferences: getCanvasAssessmentPreferencesFromAcademyPreferences(preferences),
        nextCanvasCourseworkPreferences: getCanvasCourseworkPreferencesFromAcademyPreferences(preferences),
        nextCanvasLecturePreferences: getCanvasLecturePreferencesFromAcademyPreferences(preferences),
        nextManualAssessments: getManualAssessmentsFromAcademyPreferences(preferences),
        nextManualCoursework: getManualCourseworkFromAcademyPreferences(preferences),
        nextManualLectures: getManualLecturesFromAcademyPreferences(preferences),
      };
    const effectivePreferences = migration.changed
      ? {
        ...preferences,
        canvasAssessmentPreferences: migration.nextCanvasAssessmentPreferences,
        canvasCourseworkPreferences: migration.nextCanvasCourseworkPreferences,
        canvasLecturePreferences: migration.nextCanvasLecturePreferences,
        manualAssessments: migration.nextManualAssessments,
        manualCoursework: migration.nextManualCoursework,
        manualLectures: migration.nextManualLectures,
      }
      : preferences;
    const canvasLecturePreferences = getCanvasLecturePreferencesFromAcademyPreferences(effectivePreferences);
    const selectedSemesterFromPreferences = getSelectedSemesterFromAcademyPreferences(preferences);
    const canvasRows = createCanvasRows(liveCanvasCourses, canvasLecturePreferences);
    const storedCanvasRows = createStoredCanvasRows(canvasLecturePreferences, liveCanvasCourses);
    const manualRows = createManualRows(getManualLecturesFromAcademyPreferences(effectivePreferences).filter((lecture) => (
      !isGeneratedArchivedCanvasLectureForAccessibleCourse(
        lecture,
        canvasLecturePreferences,
        liveCanvasCourses,
      ) &&
      !isGeneratedConvertedCanvasLectureForAccessibleCourse(lecture, liveCanvasCourses)
    )));

    if (coursesResult.status === 'rejected') {
      setIsConnectionWarning(isCanvasConnectionError(coursesResult.reason));
      setCanvasWarning(coursesResult.reason instanceof Error
        ? coursesResult.reason.message
        : dictionary.academyGradesCanvasUnavailable);
    } else if (migration.migratedCount > 0) {
      setCanvasWarning(academyGradesCanvasCoursesMovedToManual(migration.migratedCount));
    }

    if (migration.changed) {
      void canvasToDoApi.saveAcademyPreferences({
        canvasAssessmentPreferences: migration.nextCanvasAssessmentPreferences,
        canvasCourseworkPreferences: migration.nextCanvasCourseworkPreferences,
        canvasLecturePreferences: migration.nextCanvasLecturePreferences,
        manualAssessments: migration.nextManualAssessments,
        manualCoursework: migration.nextManualCoursework,
        manualLectures: migration.nextManualLectures,
      }).catch(() => undefined);
    }

    dispatchAcademyPreferencesSnapshot(effectivePreferences);
    setAcademyPreferences(effectivePreferences);
    setGradeProgressThresholds(getGradeProgressThresholdsFromAcademyPreferences(effectivePreferences));
    if (selectedSemesterFromProp) {
      setSelectedSemester(selectedSemesterFromProp);
    } else if (selectedSemesterFromPreferences) {
      setSelectedSemester(selectedSemesterFromPreferences);
    }
    setRows([...canvasRows, ...storedCanvasRows, ...manualRows].sort((a, b) => {
      const gradeSort = Number(b.score ?? -1) - Number(a.score ?? -1);

      if (gradeSort !== 0) {
        return gradeSort;
      }

      return a.courseCode.localeCompare(b.courseCode);
    }));
    setLoadStatus('loaded');
  }, [
    dictionary.academyGradesCanvasUnavailable,
    dictionary.academyGradesUnavailable,
    academyGradesCanvasCoursesMovedToManual,
    selectedSemesterFromProp,
  ]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      loadGradesSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    courseDetailsRef.current = courseDetails;
  }, [courseDetails]);

  useEffect(() => {
    void loadGrades();
  }, [loadGrades]);

  useEffect(() => {
    const handleAcademyPreferencesUpdated = (event: Event) => {
      if (!(event instanceof CustomEvent) || !isRecord(event.detail)) {
        return;
      }

      if (isRecord(event.detail.calendarSettings)) {
        setGradeProgressThresholds((currentThresholds) => (
          normalizeGradeProgressColorThresholds(event.detail.calendarSettings, currentThresholds)
        ));
        const nextSemester = selectedSemesterFromProp ?? getSelectedSemesterFromAcademyPreferences(event.detail);

        if (nextSemester) {
          setSelectedSemester(nextSemester);
        }
      }
    };

    window.addEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);

    return () => {
      window.removeEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);
    };
  }, [selectedSemesterFromProp]);

  useEffect(() => {
    if (selectedSemesterFromProp && selectedSemesterFromProp !== normalizeSemesterName(selectedSemester)) {
      setSelectedSemester(selectedSemesterFromProp);
    }
  }, [selectedSemester, selectedSemesterFromProp]);

  useEffect(() => {
    const expandedRowsToLoad = rows.filter((row) => (
      expandedRowIds.has(row.id) &&
      row.canvasCourseId &&
      !courseDetailsRef.current[row.id]?.status
    ));

    if (expandedRowsToLoad.length === 0) {
      return;
    }

    setCourseDetails((currentDetails) => {
      const nextDetails = { ...currentDetails };

      expandedRowsToLoad.forEach((row) => {
        nextDetails[row.id] = { status: 'loading' };
      });

      return nextDetails;
    });

    expandedRowsToLoad.forEach((row) => {
      if (!row.canvasCourseId) {
        return;
      }

      canvasToDoApi.getCanvasCourseContent(row.canvasCourseId, 'grades')
        .then((content) => {
          if (!isMountedRef.current) {
            return;
          }

          if (academyPreferences && row.canvasCourseId) {
            const currentPreferences = getCanvasLecturePreferencesFromAcademyPreferences(academyPreferences);
            const currentPreference = currentPreferences[row.canvasCourseId];

            if (currentPreference?.canvasAccessLostAt) {
              const nextCanvasLecturePreferences = {
                ...currentPreferences,
                [row.canvasCourseId]: {
                  ...currentPreference,
                  canvasAccessLostAt: null,
                },
              };

              setAcademyPreferences((current) => current
                ? { ...current, canvasLecturePreferences: nextCanvasLecturePreferences }
                : current);
              void canvasToDoApi.saveAcademyPreferences({
                canvasLecturePreferences: nextCanvasLecturePreferences,
              }).catch(() => undefined);
            }
          }

          setCourseDetails((currentDetails) => ({
            ...currentDetails,
            [row.id]: { content, status: 'loaded' },
          }));
        })
        .catch((error: unknown) => {
          if (!isMountedRef.current) {
            return;
          }

          if (isCanvasAccessDeniedError(error) && academyPreferences && row.canvasCourseId) {
            const currentPreferences = getCanvasLecturePreferencesFromAcademyPreferences(academyPreferences);
            const currentPreference = currentPreferences[row.canvasCourseId] ?? {};

            if (!currentPreference.canvasAccessLostAt) {
              const nextCanvasLecturePreferences = {
                ...currentPreferences,
                [row.canvasCourseId]: {
                  ...currentPreference,
                  canvasAccessLostAt: new Date().toISOString(),
                },
              };

              setAcademyPreferences((current) => current
                ? { ...current, canvasLecturePreferences: nextCanvasLecturePreferences }
                : current);
              void canvasToDoApi.saveAcademyPreferences({
                canvasLecturePreferences: nextCanvasLecturePreferences,
              }).catch(() => undefined);
            }
          }

          setCourseDetails((currentDetails) => ({
            ...currentDetails,
            [row.id]: {
              error: error instanceof Error ? error.message : dictionary.academyGradesDetailUnavailable,
              status: 'failed',
            },
          }));
        });
    });
  }, [academyPreferences, dictionary.academyGradesDetailUnavailable, expandedRowIds, rows]);

  const semesterOptions = useMemo(() => {
    const semesters = new Set<string>();

    rows.forEach((row) => semesters.add(normalizeSemesterName(row.semester)));
    semesters.add(normalizeSemesterName(selectedSemester));
    semesters.add(defaultAcademySemester);

    return Array.from(semesters.values()).sort(compareSemestersNewestFirst);
  }, [rows, selectedSemester]);

  const hasLoadedAcademyPreferences = Boolean(academyPreferences);
  const visibleRows = useMemo(
    () => (
      hasLoadedAcademyPreferences
        ? rows.filter((row) => normalizeSemesterName(row.semester) === normalizeSemesterName(selectedSemester))
        : []
    ),
    [hasLoadedAcademyPreferences, rows, selectedSemester],
  );

  useEffect(() => {
    const visibleRowIds = new Set(visibleRows.map((row) => row.id));

    setExpandedRowIds((currentExpandedRowIds) => {
      const nextExpandedRowIds = new Set<string>();

      currentExpandedRowIds.forEach((rowId) => {
        if (visibleRowIds.has(rowId)) {
          nextExpandedRowIds.add(rowId);
        }
      });

      return nextExpandedRowIds.size === currentExpandedRowIds.size
        ? currentExpandedRowIds
        : nextExpandedRowIds;
    });
  }, [visibleRows]);

  const handleSelectSemester = (semester: string) => {
    const normalizedSemester = normalizeSemesterName(semester);

    setSelectedSemester(normalizedSemester);

    if (!academyPreferences) {
      return;
    }

    const nextPreferences: AcademyPreferences = {
      ...academyPreferences,
      calendarSettings: {
        ...getCalendarSettingsRecord(academyPreferences.calendarSettings),
        selectedSemester: normalizedSemester,
      },
    };

    setAcademyPreferences(nextPreferences);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(academyPreferencesUpdatedEvent, {
        detail: { calendarSettings: { selectedSemester: normalizedSemester } },
      }));
    }

    void canvasToDoApi.saveAcademyPreferences({
      calendarSettings: { selectedSemester: normalizedSemester },
    }).then((savedPreferences) => {
      setAcademyPreferences(savedPreferences);
      void loadGrades();
    }).catch((error: unknown) => {
      setIsConnectionWarning(false);
      setCanvasWarning(error instanceof Error ? error.message : dictionary.academyGradesUnavailable);
    });
  };

  const courseCountLabel = visibleRows.length === 1
    ? dictionary.courseOverviewCountLabel
    : dictionary.courseOverviewCountLabel;
  const isLoading = loadStatus === 'loading' || (!hasLoadedAcademyPreferences && loadStatus !== 'failed');
  const toggleExpandedRow = (rowId: string) => {
    setExpandedRowIds((currentExpandedRowIds) => {
      const nextExpandedRowIds = new Set(currentExpandedRowIds);

      if (nextExpandedRowIds.has(rowId)) {
        nextExpandedRowIds.delete(rowId);
      } else {
        nextExpandedRowIds.add(rowId);
      }

      return nextExpandedRowIds;
    });
  };

  const handleManualGradeChange = (
    row: GradeCourseRow,
    assessments: ManualLecture['assessments'],
  ) => {
    if (!row.manualLectureId || !academyPreferences) {
      return;
    }

    const summary = calculateManualGradeSummary(assessments);
    const nextManualLectures = getManualLecturesFromAcademyPreferences(academyPreferences).map((lecture) => (
      lecture.id === row.manualLectureId ? { ...lecture, assessments } : lecture
    ));
    const nextPreferences: AcademyPreferences = {
      ...academyPreferences,
      manualLectures: nextManualLectures,
    };

    setRows((currentRows) => currentRows.map((currentRow) => (
      currentRow.id === row.id
        ? { ...currentRow, assessments, score: summary.currentPercent }
        : currentRow
    )));
    setAcademyPreferences(nextPreferences);
    const saveSequence = manualGradeSaveSequenceRef.current + 1;

    manualGradeSaveSequenceRef.current = saveSequence;

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(academyPreferencesUpdatedEvent, {
        detail: {
          manualLectures: nextManualLectures,
        },
      }));
    }

    void canvasToDoApi.saveAcademyPreferences({
      canvasAssessmentPreferences: nextPreferences.canvasAssessmentPreferences,
      canvasCourseworkPreferences: nextPreferences.canvasCourseworkPreferences,
      canvasLecturePreferences: nextPreferences.canvasLecturePreferences,
      manualAssessments: nextPreferences.manualAssessments,
      manualCoursework: nextPreferences.manualCoursework,
      manualLectures: nextManualLectures,
    }).then((savedPreferences) => {
      if (manualGradeSaveSequenceRef.current !== saveSequence) {
        return;
      }

      setAcademyPreferences(savedPreferences);
    }).catch((error: unknown) => {
      setIsConnectionWarning(false);
      setCanvasWarning(error instanceof Error ? error.message : dictionary.academyGradesUnavailable);
    });
  };

  const renderCourseDetails = (row: GradeCourseRow) => {
    const enabledAssessments = row.assessments.filter((assessment) => assessment.enabled);
    const detail = courseDetails[row.id];

    if (row.source === 'canvas') {
      if (detail?.status === 'loading') {
        return (
          <div className="flex items-center gap-2 rounded-lg border bg-background/70 px-3 py-3 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            {dictionary.academyGradesDetailLoading}
          </div>
        );
      }

      if (detail?.status === 'failed') {
        return (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-3 text-sm text-destructive">
            {detail.error || dictionary.academyGradesDetailUnavailable}
          </div>
        );
      }

      const assignments = detail?.content?.assignments ?? [];

      return assignments.length ? (
        <div className="rounded-xl border bg-background/70">
          <div className="border-b px-3 py-2 text-[11px] font-semibold uppercase text-muted-foreground">
            {dictionary.academyGradesAssignmentGrades}
          </div>
          <div className="max-h-[22rem] space-y-2 overflow-y-auto p-2 max-[520px]:max-h-none max-[520px]:overflow-visible">
            {assignments.map((assignment) => {
              const percent = getScorePercentage(assignment.score, assignment.pointsPossible);
              const visual = getGradeVisual(percent, gradeProgressThresholds);
              const rawScore = formatRawScore(assignment.score, assignment.pointsPossible);
              const letterGrade = getExpectedLetterGrade(percent);

              return (
                <div className="rounded-lg border bg-card p-3 text-sm" key={assignment.id}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground max-[520px]:whitespace-normal max-[520px]:break-words">{assignment.name}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        {rawScore ? <Badge className="rounded-md" variant="secondary">{rawScore}</Badge> : null}
                        {assignment.dueAt ? (
                          <Badge className="rounded-md" variant="outline">{formatDueDate(assignment.dueAt, locale)}</Badge>
                        ) : null}
                        {assignment.isSubmitted ? (
                          <Badge className="rounded-md border-emerald-400/30 bg-emerald-400/10 text-emerald-700 dark:text-emerald-200" variant="outline">
                            {dictionary.academyGradesSubmitted}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-black text-foreground">{formatPercent(percent)}</div>
                      <div className="text-xs font-semibold text-muted-foreground">
                        {letterGrade !== '--' ? letterGrade : assignment.grade || '--'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        backgroundColor: visual.color,
                        width: `${visual.normalizedScore}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-background/70 px-3 py-3 text-sm text-muted-foreground">
          {dictionary.academyGradesNoBreakdown}
        </div>
      );
    }

    if (row.hasReadOnlyCanvasGradeSummary) {
      return (
        <div className="rounded-lg border bg-background/70 px-3 py-3 text-sm text-muted-foreground">
          {dictionary.academyGradesCanvasSummaryReadOnly}
        </div>
      );
    }

    return enabledAssessments.length ? (
      <ManualGradeEditor
        assessments={row.assessments}
        gradeProgressThresholds={gradeProgressThresholds}
        onChange={(assessments) => handleManualGradeChange(row, assessments)}
      />
    ) : (
      <div className="rounded-lg border bg-background/70 px-3 py-3 text-sm text-muted-foreground">
        {dictionary.academyGradesNoBreakdown}
      </div>
    );
  };

  const canvasWarningAlert = (
    <CanvasNoticeDialog
      message={canvasWarning}
      open={Boolean(canvasWarning && canvasWarning !== dismissedCanvasWarning && (!isConnectionWarning || canvasTokenRemindersEnabled))}
      onClose={() => setDismissedCanvasWarning(canvasWarning)}
    />
  );
  const phoneSelectedRow = isPhone ? visibleRows.find((row) => row.id === phoneSelectedRowId) : undefined;
  if (phoneSelectedRow) {
    const visual = getGradeVisual(phoneSelectedRow.score, gradeProgressThresholds);
    return (
      <div ref={phoneScreenRef} tabIndex={-1} className="grid min-w-0 gap-3 pb-6 outline-none scroll-mt-[calc(var(--top-bar-height)+0.5rem)]">
        <div className="rounded-xl border bg-background p-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button aria-label={language === 'ko' ? '성적 목록으로 돌아가기' : 'Back to grades'} className="-ml-2 size-11 shrink-0" onClick={() => setPhoneSelectedRowId(null)} type="button" variant="ghost">
              <ArrowLeft aria-hidden="true" className="size-5" />
            </Button>
            <h1 className="min-w-0 break-words text-sm font-semibold">{phoneSelectedRow.name}</h1>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{phoneSelectedRow.semester}</span>
            <span aria-label={`${dictionary.academyGradesExpectedLetter}: ${formatScore(phoneSelectedRow)}`} className="text-lg font-semibold tabular-nums">{formatScore(phoneSelectedRow)}</span>
          </div>
          <div aria-hidden="true" className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ backgroundColor: visual.color, width: `${visual.normalizedScore}%` }} />
          </div>
        </div>
        <div className="min-w-0 overflow-x-auto">{renderCourseDetails(phoneSelectedRow)}</div>
        {canvasWarningAlert}
      </div>
    );
  }

  return (
    <div ref={phoneScreenRef} tabIndex={isPhone ? -1 : undefined} className="grid min-h-0 gap-4 pb-6 outline-none max-[520px]:gap-2 max-[520px]:scroll-mt-[calc(var(--top-bar-height)+0.5rem)]">
      <div className="flex flex-wrap items-center justify-between gap-3 max-[520px]:flex-nowrap max-[520px]:gap-1.5 max-[520px]:px-1 max-[520px]:pt-1 max-[520px]:pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-3 max-[520px]:contents">
          <Select onValueChange={handleSelectSemester} value={normalizeSemesterName(selectedSemester)}>
            <SelectTrigger aria-label={dictionary.courseOverviewSemester} className="h-9 w-[164px] rounded-md text-sm font-semibold max-[520px]:order-2 max-[520px]:h-11 max-[520px]:w-[138px] max-[520px]:text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              {semesterOptions.map((semester) => (
                <SelectItem key={semester} value={semester}>
                  {semester}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex min-w-0 items-center gap-2 max-[520px]:contents">
            <BarChart3 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground max-[520px]:order-1 max-[520px]:ml-3 max-[520px]:mr-auto max-[520px]:my-3 max-[520px]:size-5" />
            <h1 className="truncate text-xl font-black text-foreground max-[520px]:sr-only">{dictionary.academyGradesTitle}</h1>
            <Badge className="rounded-md max-[520px]:order-3" variant="secondary">
              <span>{visibleRows.length}<span className="max-[520px]:sr-only"> {courseCountLabel}</span></span>
            </Badge>
          </div>
        </div>
        <Button aria-label={dictionary.academyGradesRefresh} title={dictionary.academyGradesRefresh} className="max-[520px]:order-4 max-[520px]:size-11 max-[520px]:shrink-0 max-[520px]:p-0" disabled={isLoading} onClick={() => void loadGrades()} size="sm" type="button" variant="outline">
          <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
          <span className="max-[520px]:sr-only">{dictionary.academyGradesRefresh}</span>
        </Button>
      </div>

      {isPhone ? canvasWarningAlert : canvasWarning ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm max-[520px]:px-3 max-[520px]:py-2 max-[520px]:text-xs text-amber-700 dark:text-amber-200">
          {canvasWarning}
        </div>
      ) : null}

      {loadStatus === 'failed' ? (
        <Card className="border-destructive/20 bg-destructive/10 shadow-none">
          <CardContent className="py-6 text-sm text-destructive">{loadError || dictionary.academyGradesUnavailable}</CardContent>
        </Card>
      ) : isLoading ? (
        <Card className="shadow-none max-[520px]:py-0">
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground max-[520px]:min-h-14 max-[520px]:py-3 max-[520px]:text-xs">
            <LoaderCircle className="size-4 animate-spin" />
            {dictionary.academyGradesLoading}
          </CardContent>
        </Card>
      ) : visibleRows.length ? (() => {
        const renderGradeCard = (row: GradeCourseRow) => {
            const visual = getGradeVisual(row.score, gradeProgressThresholds);
            const isExpanded = expandedRowIds.has(row.id);
            const ringStyle = {
              background: `conic-gradient(${visual.color} ${visual.normalizedScore}%, rgba(148, 163, 184, 0.22) 0)`,
            } satisfies CSSProperties;

            return (
              <Card className="self-start gap-0 overflow-hidden shadow-none max-[520px]:border max-[520px]:bg-background max-[520px]:py-0 max-[520px]:ring-0" key={row.id}>
                <button
                  aria-expanded={isPhone ? undefined : isExpanded}
                  className="w-full text-left outline-none transition hover:bg-muted/25 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-[520px]:hover:bg-muted/35"
                  onClick={() => {
                    if (isPhone) {
                      setExpandedRowIds((current) => new Set(current).add(row.id));
                      setPhoneSelectedRowId(row.id);
                    } else toggleExpandedRow(row.id);
                  }}
                  type="button"
                >
                  <div className="hidden min-w-0 grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-x-3 gap-y-2 px-3 py-2 max-[520px]:grid">
                    <div className="flex min-w-0 gap-2">
                      <span aria-hidden="true" className={cn('mt-1 size-2 shrink-0 rounded-full', dotColorClasses[row.color])} />
                      <div className="min-w-0 flex-1">
                        <span
                          className={cn('inline-flex max-w-full items-center rounded-md border-0 text-sm font-semibold max-[520px]:bg-transparent', badgeColorClasses[row.color])}
                          title={row.courseCode}
                        >
                          <span className="truncate">{row.courseCode}</span>
                        </span>
                        <div className="mt-1 truncate text-xs font-medium leading-snug text-muted-foreground" title={row.name}>{row.name}</div>
                      </div>
                    </div>
                    <span aria-label={`${dictionary.academyGradesExpectedLetter}: ${formatScore(row)}`} className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatScore(row)}</span>
                    <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                    <div aria-hidden="true" className="col-span-3 h-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ backgroundColor: visual.color, width: `${visual.normalizedScore}%` }} />
                    </div>
                  </div>
                  <CardHeader className="grid-cols-[1fr_auto] items-center gap-4 max-[520px]:hidden">
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="grid size-16 shrink-0 place-items-center rounded-full p-1" style={ringStyle}>
                        <div className="grid size-full place-items-center rounded-full bg-card">
                          <span className="text-sm font-bold text-foreground">{visual.label}</span>
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge className={cn('rounded-md border', badgeColorClasses[row.color])} variant="outline">
                            <span className={cn('size-2 rounded-full', dotColorClasses[row.color])} />
                            {row.courseCode}
                          </Badge>
                          <Badge className="rounded-md" variant="outline">
                            {row.source === 'canvas' ? dictionary.academyGradesCanvas : dictionary.academyGradesManual}
                          </Badge>
                        </div>
                        <CardTitle className="truncate">{row.name}</CardTitle>
                        <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                          <span>{row.semester}</span>
                          {row.status ? <span>{row.status}</span> : null}
                          {row.credits ? <span>{row.credits} {dictionary.courseOverviewCredits}</span> : null}
                        </CardDescription>
                      </div>
                    </div>
                    <CardAction className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-lg font-semibold text-foreground">{formatScore(row)}</div>
                        <div className="text-xs text-muted-foreground">{dictionary.academyGradesExpectedLetter}</div>
                      </div>
                      <ChevronDown className={cn('size-4 text-muted-foreground transition', isExpanded && 'rotate-180')} />
                    </CardAction>
                  </CardHeader>
                  <CardContent className="pb-4 max-[520px]:hidden">
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          backgroundColor: visual.color,
                          width: `${visual.normalizedScore}%`,
                        }}
                      />
                    </div>
                  </CardContent>
                </button>
                {isExpanded && !isPhone ? (
                  <div className="border-t bg-muted/20 px-4 py-4 max-[520px]:overflow-x-auto max-[520px]:px-3 max-[520px]:py-3">
                    <div className="mb-3 hidden flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground max-[520px]:flex">
                      <span>{row.source === 'canvas' ? dictionary.academyGradesCanvas : dictionary.academyGradesManual}</span>
                      <span>{row.semester}</span>
                      {row.status ? <span>{row.status}</span> : null}
                      {row.credits ? <span>{row.credits} {dictionary.courseOverviewCredits}</span> : null}
                    </div>
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <TrendingUp className="size-4" />
                      {dictionary.academyGradesDetails}
                    </div>
                    {renderCourseDetails(row)}
                  </div>
                ) : null}
              </Card>
            );
        };
        const columns = visibleRows.reduce<[GradeCourseRow[], GradeCourseRow[]]>((nextColumns, row, index) => {
          nextColumns[index % 2].push(row);

          return nextColumns;
        }, [[], []]);

        return (
          <>
            <div className="grid gap-3 max-[520px]:gap-2.5 xl:hidden">
              {visibleRows.map(renderGradeCard)}
            </div>
            <div className="hidden items-start gap-3 xl:grid xl:grid-cols-2">
              {columns.map((columnRows, columnIndex) => (
                <div className="grid gap-3" key={`grade-column-${columnIndex}`}>
                  {columnRows.map(renderGradeCard)}
                </div>
              ))}
            </div>
          </>
        );
      })()
      : (
        <Card className="shadow-none max-[520px]:py-0">
          <CardContent className="py-8 text-sm text-muted-foreground max-[520px]:py-3 max-[520px]:text-xs">{dictionary.academyGradesEmpty}</CardContent>
        </Card>
      )}
    </div>
  );
}
