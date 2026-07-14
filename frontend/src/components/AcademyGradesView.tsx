import { BarChart3, ChevronDown, LoaderCircle, RefreshCw, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { workspaceApi } from '../api/workspaceApi';
import type { AcademyPreferences, CanvasCourse, CanvasCourseContent } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { badgeColorClasses, dotColorClasses } from '../lib/colorStyles';
import {
  defaultGradeProgressColorThresholds,
  getGradeProgressColor,
  normalizeGradeProgressColorThresholds,
  type GradeProgressColorThresholds,
} from '../lib/gradeProgress';
import { cn } from '../lib/utils';
import type { ColorToken } from '../modes/types';
import { calculateManualGradeSummary, ManualGradeEditor } from './ManualGradeEditor';
import type { ManualLecture } from './ManualLectureDialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
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
  workflowState?: string;
}

type CanvasLecturePreferences = Record<string, CanvasLecturePreference>;

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
}

interface CourseDetailState {
  status: LoadStatus;
  content?: CanvasCourseContent;
  error?: string;
}

const defaultAcademySemester = getDateBasedAcademySemester();
const noTermSemester = 'Default Term';
const academyPreferencesUpdatedEvent = 'incos-academy-preferences-updated';
const canvasAccessGracePeriodMs = 7 * 24 * 60 * 60 * 1000;

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

    if (preference.hidden || preference.deleted) {
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

function isGeneratedArchivedCanvasLecture(lecture: ManualLecture, preferences: CanvasLecturePreferences) {
  return Object.values(preferences).some((preference) => preference.archivedAsManualLectureId === lecture.id);
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
        score: summary.currentPercent,
        assessments,
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
    canvasAccessLostAt: preference.canvasAccessLostAt ?? null,
    courseName: course.name,
    currentGrade: course.currentGrade,
    currentScore: course.currentScore,
    htmlUrl: course.htmlUrl,
    lastSeenAt: now,
    originalCourseCode: preference.originalCourseCode || courseCode,
    semester,
    semesterSource: preference.semesterSource || (course.termName ? 'canvas' : 'fallback'),
    termName: semester,
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
    semester: normalizeSemesterName(preference.semester ?? preference.termName, fallbackSemester),
  };
}

function isCanvasAccessDeniedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /unauthori[sz]ed|not authorized|forbidden|permission|access/i.test(message);
}

function migrateLostCanvasCourses(
  preferences: AcademyPreferences,
  liveCourses: CanvasCourse[],
  fallbackSemester: string,
  now = Date.now(),
) {
  const liveCourseIds = new Set(liveCourses.map((course) => String(course.id ?? '')));
  const nowIso = new Date(now).toISOString();
  const nextCanvasLecturePreferences = {
    ...getCanvasLecturePreferencesFromAcademyPreferences(preferences),
  } as CanvasLecturePreferences;
  const nextManualLectures = [...getManualLecturesFromAcademyPreferences(preferences)];
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
    if (preference.deleted || preference.convertedToManualAt) {
      return;
    }

    const lastSeenAt = preference.lastSeenAt ? Date.parse(preference.lastSeenAt) : Number.NaN;
    const canvasAccessLostAt = preference.canvasAccessLostAt
      ? Date.parse(preference.canvasAccessLostAt)
      : lastSeenAt;

    if (
      !Number.isFinite(canvasAccessLostAt) ||
      (liveCourseIds.has(courseId) && !preference.canvasAccessLostAt) ||
      now - canvasAccessLostAt < canvasAccessGracePeriodMs
    ) {
      return;
    }

    const manualLectureId = `manual-canvas-${courseId}`;

    if (!nextManualLectures.some((lecture) => lecture.id === manualLectureId)) {
      nextManualLectures.push(createManualLectureFromCanvasPreference(courseId, preference, fallbackSemester));
    }

    nextCanvasLecturePreferences[courseId] = {
      ...preference,
      convertedToManualAt: nowIso,
      deleted: true,
      hidden: true,
    };
    changed = true;
    migratedCount += 1;
  });

  return {
    changed,
    migratedCount,
    nextCanvasLecturePreferences,
    nextManualLectures,
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

export function AcademyGradesView({ selectedSemester: selectedSemesterProp }: { selectedSemester?: string } = {}) {
  const { dictionary, language } = useLanguage();
  const academyGradesCanvasCoursesMovedToManual = dictionary.academyGradesCanvasCoursesMovedToManual;
  const locale = language === 'ko' ? 'ko-KR' : 'en-CA';
  const [rows, setRows] = useState<GradeCourseRow[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [loadError, setLoadError] = useState('');
  const [canvasWarning, setCanvasWarning] = useState('');
  const [academyPreferences, setAcademyPreferences] = useState<AcademyPreferences | null>(null);
  const [selectedSemester, setSelectedSemester] = useState(defaultAcademySemester);
  const [gradeProgressThresholds, setGradeProgressThresholds] =
    useState<GradeProgressColorThresholds>(defaultGradeProgressColorThresholds);
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(() => new Set());
  const [courseDetails, setCourseDetails] = useState<Record<string, CourseDetailState>>({});
  const isMountedRef = useRef(true);
  const courseDetailsRef = useRef(courseDetails);
  const loadGradesSequenceRef = useRef(0);
  const manualGradeSaveSequenceRef = useRef(0);
  const selectedSemesterFromProp = selectedSemesterProp
    ? normalizeSemesterName(selectedSemesterProp)
    : undefined;

  const loadGrades = useCallback(async () => {
    const loadSequence = ++loadGradesSequenceRef.current;

    setLoadStatus('loading');
    setLoadError('');
    setCanvasWarning('');

    const [preferencesResult, coursesResult] = await Promise.allSettled([
      workspaceApi.getAcademyPreferences(),
      workspaceApi.getCanvasCourses(100),
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
      ? migrateLostCanvasCourses(preferences, liveCanvasCourses, selectedSemesterFromProp ?? defaultAcademySemester)
      : {
        changed: false,
        migratedCount: 0,
        nextCanvasLecturePreferences: getCanvasLecturePreferencesFromAcademyPreferences(preferences),
        nextManualLectures: getManualLecturesFromAcademyPreferences(preferences),
      };
    const effectivePreferences = migration.changed
      ? {
        ...preferences,
        canvasLecturePreferences: migration.nextCanvasLecturePreferences,
        manualLectures: migration.nextManualLectures,
      }
      : preferences;
    const canvasLecturePreferences = getCanvasLecturePreferencesFromAcademyPreferences(effectivePreferences);
    const selectedSemesterFromPreferences = getSelectedSemesterFromAcademyPreferences(preferences);
    const canvasRows = createCanvasRows(liveCanvasCourses, canvasLecturePreferences);
    const storedCanvasRows = createStoredCanvasRows(canvasLecturePreferences, liveCanvasCourses);
    const manualRows = createManualRows(getManualLecturesFromAcademyPreferences(effectivePreferences).filter((lecture) => (
      !isGeneratedArchivedCanvasLecture(lecture, canvasLecturePreferences)
    )));

    if (coursesResult.status === 'rejected') {
      setCanvasWarning(coursesResult.reason instanceof Error
        ? coursesResult.reason.message
        : dictionary.academyGradesCanvasUnavailable);
    } else if (migration.migratedCount > 0) {
      setCanvasWarning(academyGradesCanvasCoursesMovedToManual(migration.migratedCount));
    }

    if (migration.changed) {
      void workspaceApi.saveAcademyPreferences({
        canvasLecturePreferences: migration.nextCanvasLecturePreferences,
        manualLectures: migration.nextManualLectures,
      }).catch(() => undefined);
    }

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

      workspaceApi.getCanvasCourseContent(row.canvasCourseId, 'grades')
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
              void workspaceApi.saveAcademyPreferences({
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
              void workspaceApi.saveAcademyPreferences({
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

    return Array.from(semesters.values()).sort((firstSemester, secondSemester) => (
      firstSemester === defaultAcademySemester
        ? -1
        : secondSemester === defaultAcademySemester
          ? 1
          : firstSemester.localeCompare(secondSemester)
    ));
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

    void workspaceApi.saveAcademyPreferences({
      calendarSettings: { selectedSemester: normalizedSemester },
    }).then((savedPreferences) => {
      setAcademyPreferences(savedPreferences);
      void loadGrades();
    }).catch((error: unknown) => {
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

    void workspaceApi.saveAcademyPreferences({
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
          <div className="max-h-[22rem] space-y-2 overflow-y-auto p-2">
            {assignments.map((assignment) => {
              const percent = getScorePercentage(assignment.score, assignment.pointsPossible);
              const visual = getGradeVisual(percent, gradeProgressThresholds);
              const rawScore = formatRawScore(assignment.score, assignment.pointsPossible);
              const letterGrade = getExpectedLetterGrade(percent);

              return (
                <div className="rounded-lg border bg-card p-3 text-sm" key={assignment.id}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">{assignment.name}</div>
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

  return (
    <div className="grid min-h-0 gap-4 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Select onValueChange={handleSelectSemester} value={normalizeSemesterName(selectedSemester)}>
            <SelectTrigger className="h-9 w-[164px] rounded-md text-sm font-semibold">
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
          <div className="flex min-w-0 items-center gap-2">
            <BarChart3 className="size-4 shrink-0 text-muted-foreground" />
            <h1 className="truncate text-xl font-black text-foreground">{dictionary.academyGradesTitle}</h1>
            <Badge className="rounded-md" variant="secondary">
              {visibleRows.length} {courseCountLabel}
            </Badge>
          </div>
        </div>
        <Button disabled={isLoading} onClick={() => void loadGrades()} size="sm" type="button" variant="outline">
          <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
          {dictionary.academyGradesRefresh}
        </Button>
      </div>

      {canvasWarning ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">
          {canvasWarning}
        </div>
      ) : null}

      {loadStatus === 'failed' ? (
        <Card className="border-destructive/20 bg-destructive/10 shadow-none">
          <CardContent className="py-6 text-sm text-destructive">{loadError || dictionary.academyGradesUnavailable}</CardContent>
        </Card>
      ) : isLoading ? (
        <Card className="shadow-none">
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
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
              <Card className="self-start gap-0 overflow-hidden shadow-none" key={row.id}>
                <button
                  className="w-full text-left transition hover:bg-muted/25"
                  onClick={() => toggleExpandedRow(row.id)}
                  type="button"
                >
                  <CardHeader className="grid-cols-[1fr_auto] items-center gap-4">
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
                  <CardContent className="pb-4">
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
                {isExpanded ? (
                  <div className="border-t bg-muted/20 px-4 py-4">
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
            <div className="grid gap-3 xl:hidden">
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
        <Card className="shadow-none">
          <CardContent className="py-8 text-sm text-muted-foreground">{dictionary.academyGradesEmpty}</CardContent>
        </Card>
      )}
    </div>
  );
}
