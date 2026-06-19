import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ExternalLink,
  FileText,
  GraduationCap,
  Home,
  Image,
  Layers,
  Link2,
  ListChecks,
  LoaderCircle,
  Megaphone,
  Users,
  Video,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';

import { workspaceApi } from '../api/workspaceApi';
import type {
  AcademyPreferences,
  CanvasCalendarItem,
  CanvasCourse,
  CanvasCourseContent,
  CanvasCourseAssignment,
  CanvasCourseDiscussion,
  CanvasCourseFile,
  CanvasCourseModuleItem,
  CanvasCoursePage,
  CanvasCourseQuiz,
  CanvasCourseTab,
  CanvasCourseUser,
  CanvasRubricCriterion,
  CanvasRubricSettings,
} from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { badgeColorClasses, dotColorClasses } from '../lib/colorStyles';
import {
  defaultGradeProgressColorThresholds,
  normalizeGradeProgressColorThresholds,
  type GradeProgressColorThresholds,
} from '../lib/gradeProgress';
import { cn } from '../lib/utils';
import type { ColorToken } from '../modes/types';
import { ManualGradeEditor } from './ManualGradeEditor';
import type { ManualLecture, ManualLectureSchedule, ManualLectureScheduleEntry } from './ManualLectureDialog';
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
  archivedAsManualLectureId?: string;
  assessments?: ManualLecture['assessments'];
  chipColor?: ColorToken;
  courseName?: string;
  credits?: string;
  friendlyCourseCode?: string;
  friendlyName?: string;
  hidden?: boolean;
  htmlUrl?: string;
  labSection?: string;
  lectureSection?: string;
  links?: ManualLecture['links'];
  originalCourseCode?: string;
  schedule?: ManualLectureSchedule;
  semester?: string;
  starred?: boolean;
  termName?: string;
  tutorialSection?: string;
}

type CanvasLecturePreferences = Record<string, CanvasLecturePreference>;

interface CourseOverviewRow {
  id: string;
  canvasCourseId?: string;
  name: string;
  courseCode: string;
  lectureSection: string;
  labSection: string;
  tutorialSection: string;
  credits: string;
  grade: string;
  notificationCount: number;
  color: ColorToken;
  hidden: boolean;
  semester: string;
  source: 'canvas' | 'manual';
  status: string;
  htmlUrl?: string;
  manualLecture?: ManualLecture;
}

type CourseDetailSection = 'home' | 'modules' | 'announcements' | 'syllabus' | 'assignments' | 'pages' | 'people' | 'grades' | 'links' | 'external';

interface CourseNavigationItem {
  id: string;
  label: string;
  section: CourseDetailSection;
  htmlUrl?: string;
}

type IntegratedCourseResource =
  | {
      kind: 'canvas-page';
      pageUrl: string;
      title: string;
      url: string;
    }
  | {
      assignmentId: string;
      kind: 'canvas-assignment';
      title: string;
      url: string;
    }
  | {
      kind: 'canvas-quiz';
      quizId: string;
      title: string;
      url: string;
    }
  | {
      kind: 'canvas-discussion';
      topicId: string;
      title: string;
      url: string;
    }
  | {
      fileId: string;
      kind: 'canvas-file';
      title: string;
      url: string;
    }
  | {
      kind: 'canvas-module-item';
      moduleItemId: string;
      title: string;
      url: string;
    }
  | {
      kind: 'external';
      title: string;
      url: string;
    }
  | {
      kind: 'canvas-assignments-index' | 'canvas-grades-index' | 'canvas-pages-index' | 'canvas-people-index';
      title: string;
      url: string;
    };

const manualLecturesStorageKey = 'incos-academy-manual-lectures';
const canvasLecturePreferencesStorageKey = 'incos-academy-canvas-lecture-preferences';
const academyCalendarSettingsStorageKey = 'incos-academy-calendar-settings';
const academyPreferencesUpdatedEvent = 'incos-academy-preferences-updated';
const defaultAcademySemester = getDateBasedAcademySemester();
const noTermSemester = 'No Term';

function getDateBasedAcademySemester(date = new Date()) {
  const month = date.getMonth();
  const term = month <= 3 ? 'Spring' : month <= 7 ? 'Summer' : 'Fall';

  return `${term} ${date.getFullYear()}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getStoredManualLectures() {
  const storedManualLectures = readStoredJson<unknown>(manualLecturesStorageKey, []);

  return Array.isArray(storedManualLectures)
    ? storedManualLectures as ManualLecture[]
    : [];
}

function getStoredCanvasLecturePreferences() {
  const storedCanvasPreferences = readStoredJson<unknown>(canvasLecturePreferencesStorageKey, {});

  return storedCanvasPreferences &&
    typeof storedCanvasPreferences === 'object' &&
    !Array.isArray(storedCanvasPreferences)
    ? storedCanvasPreferences as CanvasLecturePreferences
    : {};
}

function isCanvasLecturePreferences(value: unknown): value is CanvasLecturePreferences {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getManualLecturesFromAcademyPreferences(preferences: Pick<AcademyPreferences, 'manualLectures'>) {
  return Array.isArray(preferences.manualLectures)
    ? preferences.manualLectures as ManualLecture[]
    : [];
}

function getCanvasLecturePreferencesFromAcademyPreferences(
  preferences: Pick<AcademyPreferences, 'canvasLecturePreferences'>,
) {
  return isCanvasLecturePreferences(preferences.canvasLecturePreferences)
    ? preferences.canvasLecturePreferences
    : {};
}

function getSelectedSemesterFromCalendarSettings(settings: unknown) {
  if (!isRecord(settings)) {
    return undefined;
  }

  return typeof settings.selectedSemester === 'string'
    ? normalizeSemesterName(settings.selectedSemester)
    : undefined;
}

function getSelectedSemesterFromAcademyPreferences(preferences: Pick<AcademyPreferences, 'calendarSettings'>) {
  return getSelectedSemesterFromCalendarSettings(preferences.calendarSettings);
}

function getGradeProgressThresholdsFromAcademyPreferences(
  preferences: Pick<AcademyPreferences, 'calendarSettings'>,
  fallback: GradeProgressColorThresholds = defaultGradeProgressColorThresholds,
) {
  return normalizeGradeProgressColorThresholds(preferences.calendarSettings, fallback);
}

function normalizeSemesterName(value?: string, fallback = defaultAcademySemester) {
  const trimmedValue = value?.trim();

  if (!trimmedValue || /^default term$/i.test(trimmedValue)) {
    return fallback;
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

function getStoredSelectedAcademySemester() {
  const settings = readStoredJson<unknown>(academyCalendarSettingsStorageKey, {});

  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return defaultAcademySemester;
  }

  const selectedSemester = (settings as { selectedSemester?: unknown }).selectedSemester;

  return typeof selectedSemester === 'string'
    ? normalizeSemesterName(selectedSemester)
    : defaultAcademySemester;
}

function storeSelectedAcademySemester(semester: string) {
  if (typeof window === 'undefined') {
    return;
  }

  const settings = readStoredJson<Record<string, unknown>>(academyCalendarSettingsStorageKey, {});

  window.localStorage.setItem(
    academyCalendarSettingsStorageKey,
    JSON.stringify({
      ...settings,
      selectedSemester: normalizeSemesterName(semester),
    }),
  );
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

function getManualSection(lecture: ManualLecture, classType: ManualLectureScheduleEntry['classType']) {
  return getScheduleEntriesFromSchedule(lecture.schedule)
    .filter((entry) => entry.classType === classType)
    .map((entry) => [entry.day, entry.time, entry.location].filter(Boolean).join(' '))
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ');
}

function formatSection(value?: string) {
  return value?.trim() || '';
}

function formatCanvasGrade(course: CanvasCourse) {
  const score = typeof course.currentScore === 'number'
    ? `${Math.round(course.currentScore * 10) / 10}%`
    : '';

  return [course.currentGrade, score].filter(Boolean).join(' · ') || '--';
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

function getTodayIsoDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, '0');
  const day = `${today.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getFutureIsoDate(daysFromToday: number) {
  const date = new Date();

  date.setDate(date.getDate() + daysFromToday);

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function countNotificationsByCourse(items: CanvasCalendarItem[]) {
  return items.reduce<Record<string, number>>((nextCounts, item) => {
    if (!item.courseId) {
      return nextCounts;
    }

    nextCounts[item.courseId] = (nextCounts[item.courseId] ?? 0) + 1;

    return nextCounts;
  }, {});
}

function normalizeCourseMatchValue(value?: string) {
  return value?.replace(/\s+/g, '').trim().toLowerCase() || '';
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

function createCanvasRows(
  courses: CanvasCourse[],
  preferences: CanvasLecturePreferences,
  notificationCounts: Record<string, number>,
): CourseOverviewRow[] {
  return courses.map((course) => {
    const courseId = String(course.id ?? '');
    const preference = getCanvasPreferenceForCourse(course, preferences);
    const courseCode = preference.friendlyCourseCode?.trim() || course.courseCode?.trim() || course.id;
    const semester = preference.semester || preference.termName
      ? normalizeSemesterName(preference.semester ?? preference.termName)
      : normalizeCanvasSemesterName(course.termName);

    return {
      id: `canvas:${courseId}`,
      canvasCourseId: courseId,
      name: preference.friendlyName?.trim() || course.name,
      courseCode,
      credits: preference.credits?.trim() || '',
      lectureSection: formatSection(preference.lectureSection),
      labSection: formatSection(preference.labSection),
      tutorialSection: formatSection(preference.tutorialSection),
      grade: formatCanvasGrade(course),
      notificationCount: notificationCounts[courseId] ?? 0,
      color: preference.chipColor ?? 'blue',
      hidden: Boolean(preference.hidden),
      semester,
      source: 'canvas',
      status: formatStatus(course.workflowState),
      htmlUrl: course.htmlUrl,
    };
  });
}

function createManualRows(lectures: ManualLecture[]): CourseOverviewRow[] {
  return lectures.map((lecture) => ({
    id: `manual:${lecture.id}`,
    name: lecture.friendlyName?.trim() || lecture.name,
    courseCode: lecture.friendlyCourseCode?.trim() || lecture.code,
    credits: lecture.credits?.trim() || '',
    lectureSection: formatSection(lecture.lectureSection || getManualSection(lecture, 'lecture')),
    labSection: formatSection(lecture.labSection || getManualSection(lecture, 'lab')),
    tutorialSection: formatSection(lecture.tutorialSection || getManualSection(lecture, 'tutorial')),
    grade: '--',
    notificationCount: 0,
    color: lecture.chipColor ?? 'blue',
    hidden: Boolean(lecture.hidden),
    semester: normalizeSemesterName(lecture.semester),
    source: 'manual',
    status: '',
    manualLecture: lecture,
  }));
}

function getArchivedCanvasLectureId(courseId: string) {
  const safeCourseId = courseId.replace(/[^A-Za-z0-9_-]+/g, '-');

  return `archived-canvas-${safeCourseId}`;
}

function createManualLectureFromStoredCanvasPreference(
  courseId: string,
  preference: CanvasLecturePreference,
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
    chipColor: preference.chipColor ?? 'blue',
    friendlyCourseCode: preference.friendlyCourseCode,
    friendlyName: preference.friendlyName,
    hidden: preference.hidden,
    semester: normalizeSemesterName(preference.semester ?? preference.termName),
    starred: preference.starred,
  };
}

function createStoredCanvasManualRows(
  preferences: CanvasLecturePreferences,
  liveCourses: CanvasCourse[],
  manualLectures: ManualLecture[],
): CourseOverviewRow[] {
  const liveCourseIds = new Set(liveCourses.map((course) => String(course.id ?? '')));

  return Object.entries(preferences)
    .filter(([courseId, preference]) => (
      !liveCourseIds.has(courseId) &&
      Boolean(
        preference.friendlyCourseCode?.trim() ||
        preference.originalCourseCode?.trim() ||
        preference.friendlyName?.trim() ||
        preference.courseName?.trim()
      )
    ))
    .map(([courseId, preference]) => createManualLectureFromStoredCanvasPreference(courseId, preference))
    .filter((lecture): lecture is ManualLecture => Boolean(lecture))
    .filter((lecture) => !manualLectures.some((manualLecture) => (
      manualLecture.id === lecture.id ||
      (
        normalizeSemesterName(manualLecture.semester) === normalizeSemesterName(lecture.semester) &&
        manualLecture.code.replace(/\s+/g, '').toLowerCase() === lecture.code.replace(/\s+/g, '').toLowerCase()
      )
    )))
    .map((lecture) => ({
      ...createManualRows([lecture])[0]!,
      id: `manual:${lecture.id}`,
    }));
}

function sortRows(firstRow: CourseOverviewRow, secondRow: CourseOverviewRow) {
  return Number(secondRow.notificationCount > 0) - Number(firstRow.notificationCount > 0) ||
    Number(firstRow.hidden) - Number(secondRow.hidden) ||
    firstRow.courseCode.localeCompare(secondRow.courseCode);
}

function CourseSkeletonRow() {
  return (
    <div className="grid animate-pulse gap-3 rounded-lg border bg-background p-3 md:grid-cols-[minmax(0,1fr)_320px_120px]">
      <div className="min-w-0 space-y-3">
        <div className="h-5 w-28 rounded-md bg-muted" />
        <div className="h-4 w-3/4 rounded-md bg-muted" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="h-12 rounded-md bg-muted" />
        <div className="h-12 rounded-md bg-muted" />
        <div className="h-12 rounded-md bg-muted" />
      </div>
      <div className="h-12 rounded-md bg-muted" />
    </div>
  );
}

function CanvasLoadingBanner({
  className,
  label,
  size = 'default',
}: {
  className?: string;
  label: string;
  size?: 'compact' | 'default';
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-lg border bg-primary/5 font-semibold text-muted-foreground',
        size === 'compact' ? 'px-2.5 py-2 text-xs' : 'px-3 py-3 text-sm',
        className,
      )}
    >
      <LoaderCircle
        aria-hidden="true"
        className={cn('shrink-0 animate-spin text-primary', size === 'compact' ? 'size-3.5' : 'size-4')}
        strokeWidth={2.4}
      />
      <span className="truncate">{label}</span>
    </div>
  );
}

function getCourseDetailItems(
  row: CourseOverviewRow,
  dictionary: ReturnType<typeof useLanguage>['dictionary'],
) {
  const detailItems = [
    row.lectureSection ? [dictionary.courseOverviewLecture, row.lectureSection] : null,
    row.labSection ? [dictionary.courseOverviewLab, row.labSection] : null,
    row.tutorialSection ? [dictionary.courseOverviewTutorial, row.tutorialSection] : null,
    row.credits ? [dictionary.courseOverviewCredits, row.credits] : null,
    row.grade !== '--' ? [dictionary.courseOverviewGrade, row.grade] : null,
    row.status ? [dictionary.courseOverviewStatus, row.status] : null,
  ].filter(Boolean) as string[][];

  if (detailItems.length > 0) {
    return detailItems.slice(0, 4);
  }

  return [
    [dictionary.courseOverviewSemester, row.semester],
    [
      dictionary.courseOverviewNotifications,
      `${row.notificationCount}`,
    ],
  ];
}

function getCanvasTabSection(tab: CanvasCourseTab): CourseDetailSection {
  const searchable = `${tab.id} ${tab.label} ${tab.type ?? ''}`.toLowerCase();

  if (searchable.includes('people') || searchable.includes('user')) {
    return 'people';
  }

  if (searchable.includes('page') || searchable.includes('wiki')) {
    return 'pages';
  }

  if (searchable.includes('module')) {
    return 'modules';
  }

  if (searchable.includes('announcement')) {
    return 'announcements';
  }

  if (searchable.includes('syllabus')) {
    return 'syllabus';
  }

  if (searchable.includes('assignment') || searchable.includes('quiz')) {
    return 'assignments';
  }

  if (searchable.includes('grade')) {
    return 'grades';
  }

  if (searchable.includes('home') || searchable.includes('course-home')) {
    return 'home';
  }

  return 'external';
}

function getSectionIcon(section: CourseDetailSection) {
  if (section === 'modules') {
    return Layers;
  }

  if (section === 'announcements') {
    return Megaphone;
  }

  if (section === 'syllabus') {
    return FileText;
  }

  if (section === 'assignments') {
    return ListChecks;
  }

  if (section === 'grades') {
    return GraduationCap;
  }

  if (section === 'people') {
    return Users;
  }

  if (section === 'pages') {
    return FileText;
  }

  if (section === 'links' || section === 'external') {
    return Link2;
  }

  return Home;
}

function stripHtml(value?: string) {
  if (!value) {
    return '';
  }

  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeBasicEntities(value: string) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function hasHtmlMarkup(value?: string) {
  return Boolean(value && /<\/?[a-z][\s\S]*>/i.test(value));
}

function sanitizeCanvasHtml(value?: string) {
  if (!value) {
    return '';
  }

  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return escapeHtml(stripHtml(value));
  }

  const document = new DOMParser().parseFromString(value, 'text/html');

  document
    .querySelectorAll('script, style, iframe, object, embed, link, meta')
    .forEach((element) => element.remove());
  document.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const attributeName = attribute.name.toLowerCase();
      const attributeValue = attribute.value.trim().toLowerCase();

      if (attributeName.startsWith('on') || attributeValue.startsWith('javascript:')) {
        element.removeAttribute(attribute.name);
      }
    });

    if (element.tagName.toLowerCase() === 'a') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noreferrer');
    }
  });

  return document.body.innerHTML;
}

function createIntegratedLinkUrl(value: string, baseUrl?: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue || /^(mailto|tel|javascript):/i.test(trimmedValue)) {
    return null;
  }

  try {
    if (/^https?:\/\//i.test(trimmedValue)) {
      return new URL(trimmedValue);
    }

    if (trimmedValue.startsWith('/') && baseUrl) {
      return new URL(trimmedValue, baseUrl);
    }

    if (trimmedValue.startsWith('/')) {
      const fallbackBase = typeof window === 'undefined'
        ? 'https://canvas.local'
        : window.location.origin;

      return new URL(trimmedValue, fallbackBase);
    }

    if (/^[\w.-]+\.[a-z]{2,}/i.test(trimmedValue)) {
      return new URL(`https://${trimmedValue}`);
    }

    return new URL(trimmedValue, baseUrl ?? (typeof window === 'undefined' ? 'https://canvas.local' : window.location.origin));
  } catch {
    return null;
  }
}

function getIntegratedCourseResourceFromLink(
  value?: string | null,
  options: {
    baseUrl?: string;
    courseId?: string;
    label?: string;
  } = {},
): IntegratedCourseResource | null {
  if (!value) {
    return null;
  }

  const url = createIntegratedLinkUrl(value, options.baseUrl);

  if (!url) {
    return null;
  }

  const moduleItemMatch = url.pathname.match(/\/courses\/([^/]+)\/modules\/items\/([^/?#]+)/i);
  const resourceMatch = url.pathname.match(/\/courses\/([^/]+)\/(pages|assignments|files|quizzes|discussion_topics|announcements)\/([^/?#]+)/i);
  const courseSectionMatch = url.pathname.match(/\/courses\/([^/]+)\/(wiki|pages|assignments|grades|users|people)(?:\/)?$/i);
  const title = options.label?.trim() || decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? url.hostname);

  if (!resourceMatch && !courseSectionMatch && !moduleItemMatch) {
    return {
      kind: 'external',
      title,
      url: url.href,
    };
  }

  const linkedCourseId = decodeURIComponent((resourceMatch ?? courseSectionMatch ?? moduleItemMatch)![1]);

  if (options.courseId && linkedCourseId !== options.courseId) {
    return {
      kind: 'external',
      title,
      url: url.href,
    };
  }

  if (courseSectionMatch && !resourceMatch) {
    const section = courseSectionMatch[2].toLowerCase();

    if (section === 'assignments') {
      return { kind: 'canvas-assignments-index', title, url: url.href };
    }

    if (section === 'grades') {
      return { kind: 'canvas-grades-index', title, url: url.href };
    }

    if (section === 'users' || section === 'people') {
      return { kind: 'canvas-people-index', title, url: url.href };
    }

    return { kind: 'canvas-pages-index', title, url: url.href };
  }

  if (moduleItemMatch && !resourceMatch) {
    return {
      kind: 'canvas-module-item',
      moduleItemId: decodeURIComponent(moduleItemMatch[2]),
      title,
      url: url.href,
    };
  }

  if (!resourceMatch) {
    return null;
  }

  const resourceId = decodeURIComponent(resourceMatch[3]);

  if (resourceMatch[2].toLowerCase() === 'pages') {
    return {
      kind: 'canvas-page',
      pageUrl: resourceId,
      title,
      url: url.href,
    };
  }

  if (resourceMatch[2].toLowerCase() === 'assignments') {
    return {
      assignmentId: resourceId,
      kind: 'canvas-assignment',
      title,
      url: url.href,
    };
  }

  if (resourceMatch[2].toLowerCase() === 'quizzes') {
    return {
      kind: 'canvas-quiz',
      quizId: resourceId,
      title,
      url: url.href,
    };
  }

  if (resourceMatch[2].toLowerCase() === 'discussion_topics' || resourceMatch[2].toLowerCase() === 'announcements') {
    return {
      kind: 'canvas-discussion',
      topicId: resourceId,
      title,
      url: url.href,
    };
  }

  return {
    fileId: resourceId,
    kind: 'canvas-file',
    title,
    url: url.href,
  };
}

function getManualLectureLinkUrl(links: ManualLecture['links'], linkId: string) {
  return links.find((link) => link.id === linkId)?.url.trim() || '';
}

function normalizeEmbedUrl(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return '';
  }

  return /^https?:\/\//i.test(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`;
}

function clampManualEmbedHeight(value: number) {
  return Math.min(Math.max(value, 320), 1400);
}

function splitPlainCourseSections(value: string) {
  const normalized = decodeBasicEntities(value)
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*-{6,}\s*/g, '\n---\n')
    .trim();
  const coarseSections = normalized
    .split(/\n---\n/g)
    .map((section) => section.trim())
    .filter(Boolean);
  const sectionHeadings = [
    'Course Outline',
    'Questions & Discussion Forum',
    'Evaluation Scheme',
    'Late Policy',
    'Exam Dates',
    'Missed Exams',
    'Final Grading',
    'Important Dates for Assignments',
    'Important Dates for Project',
    'Academic Integrity',
    'Prerequisite',
    'Textbook',
  ];
  const expandedSections = coarseSections.flatMap((section) => {
    let nextSection = section;

    sectionHeadings.forEach((heading) => {
      nextSection = nextSection.replace(new RegExp(`\\s+(${heading}:?)`, 'gi'), '\n---\n$1');
    });

    return nextSection
      .split(/\n---\n/g)
      .map((part) => part.trim())
      .filter(Boolean);
  });

  return expandedSections.map((section, index) => {
    const headingMatch = section.match(/^([^:]{3,90}):\s+([\s\S]+)$/);
    const welcomeMatch = section.match(/^(Welcome to [\s\S]+?)(?=\s+Instructor:|\s+Contact:|$)([\s\S]*)$/i);
    const title = welcomeMatch?.[1] ?? headingMatch?.[1] ?? (index === 0 ? 'Overview' : 'Details');
    const body = (welcomeMatch?.[2] ?? headingMatch?.[2] ?? section).trim();

    return { title: title.trim(), body };
  });
}

function splitPlainCourseLines(value: string) {
  return value
    .replace(/\s+(Instructor|Contact|Email|Lectures|Office Hours|Course Website|TAs & Office Hours|Canvas|Piazza|Release Date|Due Date|Midterm|Final Exam|Makeup exams|Health care statement|Average|Students must|Review|Guidelines on collaborations):/g, '\n$1:')
    .replace(/\s+(Assignment\s+\d+)\s+/g, '\n$1 ')
    .replace(/\s+(Milestone\s+\d+)\s+/g, '\n$1 ')
    .replace(/\s+(Weekly Online Activities|Quizzes|Assignments|Project|Midterm Exam|Final Exam)\s+(\d+%)/g, '\n$1 $2')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function linkifyPlainText(
  value: string,
  options: {
    baseUrl?: string;
    canvasCourseId?: string;
    onIntegratedLink?: (resource: IntegratedCourseResource) => void;
  } = {},
) {
  const parts = value.split(/(https?:\/\/[^\s)]+)/g);

  return parts.map((part, index) => {
    if (!/^https?:\/\//.test(part)) {
      return <span key={`${part}-${index}`}>{part}</span>;
    }

    const integratedResource = getIntegratedCourseResourceFromLink(part, {
      baseUrl: options.baseUrl,
      courseId: options.canvasCourseId,
      label: part,
    });

    return (
      <a
        className="font-semibold text-primary underline-offset-4 hover:underline"
        href={part}
        key={`${part}-${index}`}
        onClick={integratedResource && options.onIntegratedLink
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              options.onIntegratedLink?.(integratedResource);
            }
          : undefined}
        rel="noreferrer"
        target={integratedResource ? undefined : '_blank'}
      >
        {part}
      </a>
    );
  });
}

function RichCourseContent({
  baseUrl,
  canvasCourseId,
  className,
  compact = false,
  html,
  onIntegratedLink,
}: {
  baseUrl?: string;
  canvasCourseId?: string;
  className?: string;
  compact?: boolean;
  html?: string;
  onIntegratedLink?: (resource: IntegratedCourseResource) => void;
}) {
  const plainText = stripHtml(html);
  const handleRichContentClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onIntegratedLink) {
      return;
    }

    const target = event.target;

    const targetElement = target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;

    if (!targetElement) {
      return;
    }

    const anchor = targetElement.closest('a');
    const integratedResource = getIntegratedCourseResourceFromLink(anchor?.getAttribute('href') ?? anchor?.href, {
      baseUrl,
      courseId: canvasCourseId,
      label: anchor?.textContent?.trim() || undefined,
    });

    if (!integratedResource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onIntegratedLink(integratedResource);
  };

  if (!plainText) {
    return null;
  }

  if (hasHtmlMarkup(html)) {
    return (
      <div
        className={cn(
          'course-rich-content rounded-lg border bg-background p-4 text-sm leading-6 text-foreground',
          '[&_a]:font-semibold [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline',
          '[&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold',
          '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_p]:my-2',
          '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5',
          '[&_table]:my-3 [&_table]:w-full [&_table]:overflow-hidden [&_table]:rounded-lg [&_table]:border [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:bg-muted/50 [&_th]:p-2 [&_th]:text-left',
          compact && 'max-h-28 overflow-hidden p-3 [mask-image:linear-gradient(180deg,#000_70%,transparent)]',
          className,
        )}
        dangerouslySetInnerHTML={{ __html: sanitizeCanvasHtml(html) }}
        onClick={handleRichContentClick}
      />
    );
  }

  const sections = splitPlainCourseSections(plainText);
  const visibleSections = compact ? sections.slice(0, 1) : sections;

  return (
    <div className={cn('space-y-3', compact && 'max-h-32 overflow-hidden [mask-image:linear-gradient(180deg,#000_72%,transparent)]', className)}>
      {visibleSections.map((section, sectionIndex) => {
        const lines = splitPlainCourseLines(section.body);

        return (
          <section className="rounded-lg border bg-background p-4" key={`${section.title}-${sectionIndex}`}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge className="rounded-md" variant={sectionIndex === 0 ? 'default' : 'secondary'}>
                {section.title}
              </Badge>
            </div>
            <div className="space-y-2">
              {lines.length > 0 ? lines.map((line, lineIndex) => {
                const [label, ...rest] = line.split(':');
                const hasLabel = rest.length > 0 && label.length < 42;
                const content = hasLabel ? rest.join(':').trim() : line;

                return (
                  <div className="rounded-md bg-muted/25 px-3 py-2 text-sm leading-6" key={`${section.title}-${lineIndex}`}>
                    {hasLabel ? (
                      <span className="mr-2 font-semibold text-foreground">{label}:</span>
                    ) : null}
                    <span className="text-muted-foreground">
                      {linkifyPlainText(content, { baseUrl, canvasCourseId, onIntegratedLink })}
                    </span>
                  </div>
                );
              }) : (
                <p className="text-sm leading-6 text-muted-foreground">
                  {linkifyPlainText(section.body, { baseUrl, canvasCourseId, onIntegratedLink })}
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function formatCourseDate(value?: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  });
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

function getFileExtension(fileName?: string) {
  const extensionMatch = fileName?.toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/);

  return extensionMatch?.[1] ?? '';
}

function getFilePreviewKind(file: CanvasCourseFile) {
  const contentType = file.contentType?.toLowerCase() ?? '';
  const extension = getFileExtension(file.fileName ?? file.displayName);

  if (contentType.startsWith('image/') || ['apng', 'avif', 'gif', 'jpg', 'jpeg', 'png', 'svg', 'webp'].includes(extension)) {
    return 'image';
  }

  if (contentType.startsWith('video/') || ['m4v', 'mov', 'mp4', 'ogg', 'webm'].includes(extension)) {
    return 'video';
  }

  if (contentType.startsWith('audio/') || ['aac', 'm4a', 'mp3', 'oga', 'wav'].includes(extension)) {
    return 'audio';
  }

  if (contentType.includes('pdf') || extension === 'pdf') {
    return 'pdf';
  }

  if (contentType.startsWith('text/') || ['csv', 'json', 'md', 'rtf', 'txt', 'xml'].includes(extension)) {
    return 'text';
  }

  if (['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(extension)) {
    return 'office';
  }

  return 'embed';
}

function getPreviewKindFromUrl(url: string) {
  return getFilePreviewKind({
    displayName: url,
    fileName: url,
    id: url,
  });
}

function getOfficePreviewUrl(url: string) {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
}

function getIntegratedResourceFromModuleItem(
  item: CanvasCourseModuleItem,
  options: {
    baseUrl?: string;
    courseId?: string;
  },
): IntegratedCourseResource | null {
  const itemType = item.type?.toLowerCase() ?? '';
  const title = item.title;

  if (itemType === 'page' && item.pageUrl) {
    return {
      kind: 'canvas-page',
      pageUrl: item.pageUrl,
      title,
      url: item.htmlUrl ?? item.url ?? '',
    };
  }

  if (itemType === 'assignment' && item.contentId) {
    return {
      assignmentId: item.contentId,
      kind: 'canvas-assignment',
      title,
      url: item.htmlUrl ?? item.url ?? '',
    };
  }

  if (itemType === 'quiz' && item.contentId) {
    return {
      kind: 'canvas-quiz',
      quizId: item.contentId,
      title,
      url: item.htmlUrl ?? item.url ?? '',
    };
  }

  if ((itemType === 'discussion' || itemType === 'discussion_topic' || itemType === 'announcement') && item.contentId) {
    return {
      kind: 'canvas-discussion',
      topicId: item.contentId,
      title,
      url: item.htmlUrl ?? item.url ?? '',
    };
  }

  if (itemType === 'file' && item.contentId) {
    return {
      fileId: item.contentId,
      kind: 'canvas-file',
      title,
      url: item.htmlUrl ?? item.url ?? '',
    };
  }

  return getIntegratedCourseResourceFromLink(item.url ?? item.htmlUrl ?? item.externalUrl, {
    baseUrl: options.baseUrl,
    courseId: options.courseId,
    label: title,
  });
}

function getCanvasNavigationItems(
  content: CanvasCourseContent | null,
  dictionary: ReturnType<typeof useLanguage>['dictionary'],
): CourseNavigationItem[] {
  const fallbackItems: CourseNavigationItem[] = [
    { id: 'home', label: dictionary.courseDetailHome, section: 'home' },
    { id: 'modules', label: dictionary.courseDetailModules, section: 'modules' },
    { id: 'announcements', label: dictionary.courseDetailAnnouncements, section: 'announcements' },
    { id: 'syllabus', label: dictionary.courseDetailSyllabus, section: 'syllabus' },
    { id: 'assignments', label: dictionary.courseDetailAssignments, section: 'assignments' },
    { id: 'pages', label: dictionary.courseDetailPages, section: 'pages' },
    { id: 'people', label: dictionary.courseDetailPeople, section: 'people' },
    { id: 'grades', label: dictionary.courseDetailGrades, section: 'grades' },
  ];

  if (!content || content.tabs.length === 0) {
    return fallbackItems;
  }

  const items = content.tabs
    .filter((tab) => !tab.hidden)
    .map((tab) => ({
      id: tab.id,
      label: tab.label,
      section: getCanvasTabSection(tab),
      htmlUrl: tab.htmlUrl,
    }));
  const hasHome = items.some((item) => item.section === 'home');
  const hasPages = items.some((item) => item.section === 'pages');
  const hasPeople = items.some((item) => item.section === 'people');
  const enrichedItems = [
    ...items,
    !hasPages && content.pages.length > 0
      ? { id: 'pages', label: dictionary.courseDetailPages, section: 'pages' as const }
      : null,
    !hasPeople && content.people.length > 0
      ? { id: 'people', label: dictionary.courseDetailPeople, section: 'people' as const }
      : null,
  ].filter(Boolean) as CourseNavigationItem[];

  return hasHome
    ? enrichedItems
    : [{ id: 'home', label: dictionary.courseDetailHome, section: 'home' }, ...enrichedItems];
}

function getManualNavigationItems(dictionary: ReturnType<typeof useLanguage>['dictionary']): CourseNavigationItem[] {
  return [
    { id: 'home', label: dictionary.courseDetailHome, section: 'home' },
    { id: 'assignments', label: dictionary.courseDetailAssignments, section: 'assignments' },
    { id: 'grades', label: dictionary.courseDetailGrades, section: 'grades' },
    { id: 'links', label: dictionary.courseDetailLinks, section: 'links' },
  ];
}

function CourseDetailView({
  activeItem,
  content,
  contentLoadStatus,
  dictionary,
  gradeProgressThresholds,
  initialResourceUrl,
  onBack,
  onSelectItem,
  onUpdateManualLectureAssessments,
  row,
}: {
  activeItem: CourseNavigationItem;
  content: CanvasCourseContent | null;
  contentLoadStatus: LoadStatus;
  dictionary: ReturnType<typeof useLanguage>['dictionary'];
  gradeProgressThresholds: GradeProgressColorThresholds;
  initialResourceUrl?: string | null;
  onBack: () => void;
  onSelectItem: (item: CourseNavigationItem) => void;
  onUpdateManualLectureAssessments?: (lectureId: string, assessments: ManualLecture['assessments']) => void;
  row: CourseOverviewRow;
}) {
  const navigationItems = row.source === 'canvas'
    ? getCanvasNavigationItems(content, dictionary)
    : getManualNavigationItems(dictionary);
  const activeSection = activeItem.section;
  const detailItems = getCourseDetailItems(row, dictionary);
  const enabledAssessments = row.manualLecture?.assessments.filter((assessment) => assessment.enabled) ?? [];
  const scheduleEntries = getScheduleEntriesFromSchedule(row.manualLecture?.schedule);
  const links = row.manualLecture?.links ?? [];
  const manualLectureWebsiteUrl = normalizeEmbedUrl(getManualLectureLinkUrl(links, 'lecture-website'));
  const manualSubmissionUrl = normalizeEmbedUrl(getManualLectureLinkUrl(links, 'submission-link'));
  const isCanvasLoading = row.source === 'canvas' && contentLoadStatus === 'loading';
  const isCanvasFailed = row.source === 'canvas' && contentLoadStatus === 'failed';
  const canvasBaseUrl = content?.course.htmlUrl ?? row.htmlUrl;
  const [activeIntegratedResource, setActiveIntegratedResource] = useState<IntegratedCourseResource | null>(null);
  const [integratedCanvasPage, setIntegratedCanvasPage] = useState<CanvasCoursePage | null>(null);
  const [integratedAssignment, setIntegratedAssignment] = useState<CanvasCourseAssignment | null>(null);
  const [linkedRubricAssignment, setLinkedRubricAssignment] = useState<CanvasCourseAssignment | null>(null);
  const [linkedRubricStatus, setLinkedRubricStatus] = useState<LoadStatus>('idle');
  const [integratedQuiz, setIntegratedQuiz] = useState<CanvasCourseQuiz | null>(null);
  const [integratedDiscussion, setIntegratedDiscussion] = useState<CanvasCourseDiscussion | null>(null);
  const [integratedFile, setIntegratedFile] = useState<CanvasCourseFile | null>(null);
  const [integratedModuleItem, setIntegratedModuleItem] = useState<CanvasCourseModuleItem | null>(null);
  const [integratedResourceStatus, setIntegratedResourceStatus] = useState<LoadStatus>('idle');
  const [coursePeople, setCoursePeople] = useState<CanvasCourseUser[]>(content?.people ?? []);
  const [coursePeopleStatus, setCoursePeopleStatus] = useState<LoadStatus>(content?.people?.length ? 'loaded' : 'idle');
  const [integratedHistory, setIntegratedHistory] = useState<IntegratedCourseResource[]>([]);
  const [integratedHistoryIndex, setIntegratedHistoryIndex] = useState(-1);
  const [assignmentSubmissionType, setAssignmentSubmissionType] = useState('online_text_entry');
  const [assignmentSubmissionBody, setAssignmentSubmissionBody] = useState('');
  const [assignmentSubmissionUrl, setAssignmentSubmissionUrl] = useState('');
  const [assignmentSubmissionComment, setAssignmentSubmissionComment] = useState('');
  const [assignmentSubmissionStatus, setAssignmentSubmissionStatus] = useState('');
  const [assignmentSubmissionError, setAssignmentSubmissionError] = useState('');
  const [isAssignmentSubmitting, setIsAssignmentSubmitting] = useState(false);
  const [discussionMessage, setDiscussionMessage] = useState('');
  const [discussionSubmitStatus, setDiscussionSubmitStatus] = useState('');
  const [discussionSubmitError, setDiscussionSubmitError] = useState('');
  const [isDiscussionSubmitting, setIsDiscussionSubmitting] = useState(false);
  const [quizAccessCode, setQuizAccessCode] = useState('');
  const [quizSubmissionStatus, setQuizSubmissionStatus] = useState('');
  const [quizSubmissionError, setQuizSubmissionError] = useState('');
  const [isQuizStarting, setIsQuizStarting] = useState(false);
  const [manualEmbedHeight, setManualEmbedHeight] = useState(640);
  const manualEmbedResizeRef = useRef({ startHeight: 640, startY: 0 });
  const integratedRequestRef = useRef(0);
  const initialResourceKeyRef = useRef('');
  const coursePeopleRequestKeyRef = useRef('');

  const resetIntegratedResource = () => {
    integratedRequestRef.current += 1;
    setActiveIntegratedResource(null);
    setIntegratedCanvasPage(null);
    setIntegratedAssignment(null);
    setLinkedRubricAssignment(null);
    setLinkedRubricStatus('idle');
    setIntegratedQuiz(null);
    setIntegratedDiscussion(null);
    setIntegratedFile(null);
    setIntegratedModuleItem(null);
    setIntegratedResourceStatus('idle');
    setIntegratedHistory([]);
    setIntegratedHistoryIndex(-1);
  };
  const loadIntegratedResource = (resource: IntegratedCourseResource, historyIndex?: number) => {
    const requestId = integratedRequestRef.current + 1;

    integratedRequestRef.current = requestId;
    setActiveIntegratedResource(resource);
    setIntegratedCanvasPage(null);
    setIntegratedAssignment(null);
    setLinkedRubricAssignment(null);
    setLinkedRubricStatus('idle');
    setIntegratedQuiz(null);
    setIntegratedDiscussion(null);
    setIntegratedFile(null);
    setIntegratedModuleItem(null);
    setIntegratedResourceStatus(
      resource.kind === 'external' ||
      resource.kind === 'canvas-assignments-index' ||
      resource.kind === 'canvas-grades-index' ||
      resource.kind === 'canvas-pages-index' ||
      resource.kind === 'canvas-people-index'
        ? 'loaded'
        : 'loading',
    );

    if (
      resource.kind === 'external' ||
      resource.kind === 'canvas-assignments-index' ||
      resource.kind === 'canvas-grades-index' ||
      resource.kind === 'canvas-pages-index' ||
      resource.kind === 'canvas-people-index'
    ) {
      return;
    }

    if (!row.canvasCourseId) {
      setIntegratedResourceStatus('failed');
      return;
    }

    let request: Promise<void>;

    if (resource.kind === 'canvas-page') {
      request = workspaceApi.getCanvasCoursePage(row.canvasCourseId, resource.pageUrl).then((page) => {
        if (integratedRequestRef.current === requestId) {
          setIntegratedCanvasPage(page);
        }
      });
    } else if (resource.kind === 'canvas-assignment') {
      request = workspaceApi.getCanvasCourseAssignment(row.canvasCourseId, resource.assignmentId).then((assignment) => {
        if (integratedRequestRef.current === requestId) {
          setIntegratedAssignment(assignment);
        }
      });
    } else if (resource.kind === 'canvas-quiz') {
      request = workspaceApi.getCanvasCourseQuiz(row.canvasCourseId, resource.quizId).then((quiz) => {
        if (integratedRequestRef.current === requestId) {
          setIntegratedQuiz(quiz);
        }
      });
    } else if (resource.kind === 'canvas-discussion') {
      request = workspaceApi.getCanvasCourseDiscussion(row.canvasCourseId, resource.topicId).then((discussion) => {
        if (integratedRequestRef.current === requestId) {
          setIntegratedDiscussion(discussion);
        }
      });
    } else if (resource.kind === 'canvas-file') {
      request = workspaceApi.getCanvasCourseFile(row.canvasCourseId, resource.fileId).then((file) => {
        if (integratedRequestRef.current === requestId) {
          setIntegratedFile(file);
        }
      });
    } else if (resource.kind === 'canvas-module-item') {
      request = workspaceApi.getCanvasCourseModuleItem(row.canvasCourseId, resource.moduleItemId).then((item) => {
        if (integratedRequestRef.current === requestId) {
          const resolvedResource = getIntegratedResourceFromModuleItem(item, {
            baseUrl: canvasBaseUrl,
            courseId: row.canvasCourseId,
          });

          if (resolvedResource && resolvedResource.kind !== 'canvas-module-item') {
            if (typeof historyIndex === 'number') {
              setIntegratedHistory((currentHistory) => {
                if (!currentHistory[historyIndex]) {
                  return currentHistory;
                }

                const nextHistory = [...currentHistory];
                nextHistory[historyIndex] = resolvedResource;

                return nextHistory;
              });
            }

            loadIntegratedResource(resolvedResource, historyIndex);
            return;
          }

          setIntegratedModuleItem(item);
        }
      });
    } else {
      setIntegratedResourceStatus('failed');
      return;
    }

    request
      .then(() => {
        if (integratedRequestRef.current === requestId) {
          setIntegratedResourceStatus('loaded');
        }
      })
      .catch(() => {
        if (integratedRequestRef.current === requestId) {
          setIntegratedResourceStatus('failed');
        }
      });
  };
  const openIntegratedResource = (resource: IntegratedCourseResource) => {
    const nextIndex = integratedHistoryIndex + 1;

    setIntegratedHistory((currentHistory) => {
      const nextHistory = currentHistory.slice(0, nextIndex);

      nextHistory.push(resource);
      setIntegratedHistoryIndex(nextHistory.length - 1);

      return nextHistory;
    });
    loadIntegratedResource(resource, nextIndex);
  };
  const navigateIntegratedHistory = (nextIndex: number) => {
    const nextResource = integratedHistory[nextIndex];

    if (!nextResource) {
      return;
    }

    setIntegratedHistoryIndex(nextIndex);
    loadIntegratedResource(nextResource, nextIndex);
  };
  const richCanvasPageProps = row.source === 'canvas'
    ? {
        baseUrl: canvasBaseUrl,
        canvasCourseId: row.canvasCourseId,
        onIntegratedLink: openIntegratedResource,
      }
    : {};
  const shouldLoadCoursePeople = row.source === 'canvas' &&
    Boolean(row.canvasCourseId) &&
    (activeSection === 'people' || activeIntegratedResource?.kind === 'canvas-people-index');

  useEffect(() => {
    resetIntegratedResource();
  }, [row.id]);

  useEffect(() => {
    setCoursePeople([]);
    setCoursePeopleStatus('idle');
    coursePeopleRequestKeyRef.current = '';
  }, [row.id]);

  useEffect(() => {
    if (coursePeople.length > 0 || !content?.people?.length) {
      return;
    }

    setCoursePeople(content.people);
    setCoursePeopleStatus('loaded');
  }, [content?.people, coursePeople.length]);

  useEffect(() => {
    if (!shouldLoadCoursePeople || !row.canvasCourseId) {
      return;
    }

    const requestKey = `${row.id}:${row.canvasCourseId}`;

    if (coursePeopleRequestKeyRef.current === requestKey) {
      return;
    }

    coursePeopleRequestKeyRef.current = requestKey;
    setCoursePeopleStatus('loading');

    workspaceApi
      .getCanvasCoursePeople(row.canvasCourseId)
      .then(({ people }) => {
        setCoursePeople(people);
        setCoursePeopleStatus('loaded');
      })
      .catch(() => {
        setCoursePeopleStatus('failed');
      });
  }, [row.canvasCourseId, row.id, shouldLoadCoursePeople]);

  useEffect(() => {
    const supportedType = integratedAssignment?.submissionTypes.find((submissionType) => (
      submissionType === 'online_text_entry' || submissionType === 'online_url'
    ));

    setAssignmentSubmissionType(supportedType ?? 'online_text_entry');
    setAssignmentSubmissionBody('');
    setAssignmentSubmissionUrl('');
    setAssignmentSubmissionComment('');
    setAssignmentSubmissionStatus('');
    setAssignmentSubmissionError('');
  }, [integratedAssignment?.id]);

  useEffect(() => {
    setDiscussionMessage('');
    setDiscussionSubmitStatus('');
    setDiscussionSubmitError('');
  }, [integratedDiscussion?.id]);

  useEffect(() => {
    setQuizAccessCode('');
    setQuizSubmissionStatus('');
    setQuizSubmissionError('');
  }, [integratedQuiz?.id]);

  useEffect(() => {
    const assignmentId = integratedQuiz?.assignmentId ?? integratedDiscussion?.assignmentId;
    let isCancelled = false;

    setLinkedRubricAssignment(null);

    if (!assignmentId || !row.canvasCourseId) {
      setLinkedRubricStatus('idle');
      return undefined;
    }

    setLinkedRubricStatus('loading');

    workspaceApi
      .getCanvasCourseAssignment(row.canvasCourseId, assignmentId)
      .then((assignment) => {
        if (isCancelled) {
          return;
        }

        setLinkedRubricAssignment(assignment);
        setLinkedRubricStatus('loaded');
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setLinkedRubricStatus('failed');
      });

    return () => {
      isCancelled = true;
    };
  }, [integratedDiscussion?.assignmentId, integratedQuiz?.assignmentId, row.canvasCourseId]);

  useEffect(() => {
    if (!initialResourceUrl) {
      return;
    }

    const initialResourceKey = `${row.id}:${initialResourceUrl}`;

    if (initialResourceKeyRef.current === initialResourceKey) {
      return;
    }

    initialResourceKeyRef.current = initialResourceKey;

    const resource = getIntegratedCourseResourceFromLink(initialResourceUrl, {
      baseUrl: canvasBaseUrl,
      courseId: row.canvasCourseId,
      label: activeItem.label,
    });

    if (resource) {
      openIntegratedResource(resource);
    }
  }, [activeItem.label, canvasBaseUrl, initialResourceUrl, row.canvasCourseId, row.id]);

  const handleManualEmbedResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    manualEmbedResizeRef.current = {
      startHeight: manualEmbedHeight,
      startY: event.clientY,
    };

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const nextHeight = manualEmbedResizeRef.current.startHeight +
        moveEvent.clientY -
        manualEmbedResizeRef.current.startY;

      setManualEmbedHeight(clampManualEmbedHeight(nextHeight));
    };
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };
  const handleManualEmbedResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }

    event.preventDefault();
    setManualEmbedHeight((currentHeight) => clampManualEmbedHeight(
      currentHeight + (event.key === 'ArrowDown' ? 40 : -40),
    ));
  };

  const renderEmpty = (message: string = dictionary.courseDetailEmpty) => (
    <div className="rounded-lg border border-dashed bg-muted/25 p-5 text-sm font-medium text-muted-foreground">
      {message}
    </div>
  );

  const renderEmbeddedManualLink = (url: string, label: string, forcedPreviewKind?: ReturnType<typeof getFilePreviewKind>) => {
    const previewKind = forcedPreviewKind ?? getPreviewKindFromUrl(url);
    const previewUrl = previewKind === 'office' ? getOfficePreviewUrl(url) : url;
    const PreviewIcon = previewKind === 'image'
      ? Image
      : previewKind === 'video' || previewKind === 'audio'
        ? Video
        : previewKind === 'pdf' || previewKind === 'office' || previewKind === 'text'
          ? FileText
          : ExternalLink;

    return (
      <div className="flex flex-col overflow-hidden rounded-lg border bg-background">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              <PreviewIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{label}</div>
              <div className="truncate text-xs font-medium text-muted-foreground">{url}</div>
            </div>
          </div>
          <Button asChild className="h-8 shrink-0 rounded-md" size="sm" variant="outline">
            <a href={url} rel="noreferrer" target="_blank">
              <ExternalLink className="size-4" />
              {dictionary.courseOverviewOpenCanvas}
            </a>
          </Button>
        </div>
        <div className="min-h-[320px] bg-background" style={{ height: manualEmbedHeight }}>
          {previewKind === 'image' ? (
            <div className="grid h-full place-items-center overflow-auto bg-muted/15 p-3">
              <img alt={label} className="max-h-full max-w-full rounded-md object-contain" src={url} />
            </div>
          ) : previewKind === 'video' ? (
            <video className="h-full w-full bg-black" controls src={url} />
          ) : previewKind === 'audio' ? (
            <div className="grid h-full place-items-center bg-muted/20 p-6">
              <audio className="w-full max-w-2xl" controls src={url} />
            </div>
          ) : (
            <iframe
              className="h-full w-full bg-background"
              referrerPolicy="no-referrer"
              sandbox="allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
              src={previewUrl}
              title={label}
            />
          )}
        </div>
        <div
          aria-label="Resize website window"
          aria-orientation="horizontal"
          className="group flex h-5 shrink-0 cursor-row-resize touch-none items-center justify-center border-t bg-muted/35 transition-colors hover:bg-muted/60"
          onKeyDown={handleManualEmbedResizeKeyDown}
          onPointerDown={handleManualEmbedResizePointerDown}
          role="separator"
          tabIndex={0}
          title="Resize website window"
        >
          <span className="h-1 w-16 rounded-full bg-muted-foreground/35 transition-colors group-hover:bg-primary/55" />
        </div>
      </div>
    );
  };

  const renderHome = () => (
    <div className="space-y-3">
      {row.source === 'canvas' && content?.frontPage && stripHtml(content.frontPage.body) ? (
        <RichCourseContent html={content.frontPage.body} {...richCanvasPageProps} />
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {detailItems.map(([label, value]) => (
          <div className="rounded-lg border bg-background p-3" key={`${row.id}-home-${label}`}>
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
            <div className="mt-1 truncate text-sm font-semibold text-foreground">{value}</div>
          </div>
        ))}
      </div>
      {scheduleEntries.length > 0 ? (
        <div className="rounded-lg border bg-background p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            {dictionary.manualLectureSchedule}
          </div>
          <div className="space-y-2">
            {scheduleEntries.map((entry) => (
              <div className="flex flex-wrap items-center gap-2 text-sm" key={entry.id}>
                <Badge className="rounded-md" variant="outline">{formatStatus(entry.classType)}</Badge>
                <span className="font-medium text-foreground">
                  {[entry.day, entry.time, entry.location || (entry.deliveryMode === 'online' ? 'Online' : '')]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {row.source === 'canvas' && content?.announcements?.[0] ? (
        <div className="rounded-lg border bg-background p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            {dictionary.courseDetailLatestAnnouncement}
          </div>
          <div className="text-sm font-semibold text-foreground">{content.announcements[0].title}</div>
          <RichCourseContent className="mt-2" compact html={content.announcements[0].message} {...richCanvasPageProps} />
        </div>
      ) : null}
    </div>
  );

  const renderModules = () => {
    if (!content || content.modules.length === 0) {
      return renderEmpty(dictionary.courseDetailNoModules);
    }

    return (
      <div className="space-y-2">
        {content.modules.map((module) => (
          <div className="rounded-lg border bg-background p-3" key={module.id}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground">{module.name}</h3>
              <Badge className="rounded-md" variant="outline">
                {module.items.length || module.itemCount || 0}
              </Badge>
            </div>
            {module.items.length > 0 ? (
              <div className="mt-3 divide-y rounded-md border">
                {module.items.map((item) => {
                  const itemUrl = item.htmlUrl ?? item.url ?? item.externalUrl ?? '#';
                  const integratedResource = getIntegratedResourceFromModuleItem(item, {
                    baseUrl: canvasBaseUrl,
                    courseId: row.canvasCourseId,
                  }) ?? getIntegratedCourseResourceFromLink(itemUrl, {
                    baseUrl: canvasBaseUrl,
                    courseId: row.canvasCourseId,
                    label: item.title,
                  });

                  return (
                    <a
                      className="flex min-w-0 items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/35"
                      href={itemUrl}
                      key={item.id}
                      onClick={integratedResource
                        ? (event) => {
                            event.preventDefault();
                            openIntegratedResource(integratedResource);
                          }
                        : undefined}
                      rel="noreferrer"
                      target={integratedResource ? undefined : '_blank'}
                    >
                      <span className="truncate font-medium text-foreground">{item.title}</span>
                      <Badge className="rounded-md" variant="secondary">{item.type ?? 'Item'}</Badge>
                    </a>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    );
  };

  const renderPages = () => {
    if (!content || content.pages.length === 0) {
      return renderEmpty(dictionary.courseDetailNoPages);
    }

    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {content.pages.map((page) => (
          <button
            className="flex min-w-0 items-center justify-between gap-3 rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted/35"
            key={page.id}
            onClick={() => openIntegratedResource({
              kind: 'canvas-page',
              pageUrl: page.pageUrl ?? page.id,
              title: page.title,
              url: page.htmlUrl ?? '',
            })}
            type="button"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">{page.title}</span>
              {page.updatedAt ? (
                <span className="mt-1 block truncate text-xs font-medium text-muted-foreground">
                  {formatCourseDate(page.updatedAt)}
                </span>
              ) : null}
            </span>
            <FileText className="size-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    );
  };

  const renderPeople = () => {
    const people = coursePeople.length > 0 ? coursePeople : content?.people ?? [];

    if (coursePeopleStatus === 'loading' && people.length === 0) {
      return <CanvasLoadingBanner label={dictionary.courseDetailLoading} />;
    }

    if (coursePeopleStatus === 'failed' && people.length === 0) {
      return renderEmpty(dictionary.courseDetailUnavailable);
    }

    if (people.length === 0) {
      return renderEmpty(dictionary.courseDetailNoPeople);
    }

    const sortedPeople = [...people].sort((firstPerson: CanvasCourseUser, secondPerson: CanvasCourseUser) => (
      (firstPerson.sortableName ?? firstPerson.name).localeCompare(
        secondPerson.sortableName ?? secondPerson.name,
        undefined,
        { numeric: true, sensitivity: 'base' },
      )
    ));

    return (
      <div className="grid gap-3">
        {coursePeopleStatus === 'loading' ? (
          <CanvasLoadingBanner label={dictionary.courseDetailLoading} size="compact" />
        ) : null}
        <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 xl:grid-cols-3">
          {sortedPeople.map((person) => {
            const visibleRoles = (person.roles?.length ? person.roles : ['StudentEnrollment']).slice(0, 3);
            const visibleContact = person.email || person.loginId;

            return (
              <article className="min-w-0 bg-background p-3" key={person.id}>
                <div className="flex min-w-0 items-start gap-3">
                  {person.avatarUrl ? (
                    <img
                      alt=""
                      className="size-11 shrink-0 rounded-full border object-cover"
                      src={person.avatarUrl}
                    />
                  ) : (
                    <span className="grid size-11 shrink-0 place-items-center rounded-full border bg-muted text-sm font-black text-muted-foreground">
                      {(person.shortName ?? person.name).slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">{person.name}</div>
                    {visibleContact ? (
                      <div className="mt-1 truncate text-xs font-semibold text-muted-foreground">
                        {visibleContact}
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {visibleRoles.map((role) => (
                        <Badge className="rounded-md" key={`${person.id}-${role}`} variant="outline">
                          {formatStatus(role.replace(/Enrollment$/i, ''))}
                        </Badge>
                      ))}
                      {(person.enrollmentStates ?? []).slice(0, 1).map((state) => (
                        <Badge className="rounded-md" key={`${person.id}-${state}`} variant="secondary">
                          {formatStatus(state)}
                        </Badge>
                      ))}
                      {(person.sectionIds ?? []).slice(0, 1).map((sectionId) => (
                        <Badge className="rounded-md" key={`${person.id}-${sectionId}`} variant="outline">
                          {`Section ${sectionId}`}
                        </Badge>
                      ))}
                    </div>
                    {person.bio ? (
                      <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-muted-foreground">
                        {stripHtml(person.bio)}
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    );
  };

  const renderAnnouncements = () => {
    if (!content || content.announcements.length === 0) {
      return renderEmpty(dictionary.courseDetailNoAnnouncements);
    }

    return (
      <div className="space-y-2">
        {content.announcements.map((announcement) => (
          <div
            className="rounded-lg border bg-background p-3 transition-colors hover:bg-muted/35"
            key={announcement.id}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{announcement.title}</h3>
              {announcement.postedAt ? (
                <Badge className="rounded-md" variant="outline">{formatCourseDate(announcement.postedAt)}</Badge>
              ) : null}
            </div>
            <RichCourseContent className="mt-2" compact html={announcement.message} {...richCanvasPageProps} />
            {announcement.htmlUrl ? (() => {
              const integratedResource = getIntegratedCourseResourceFromLink(announcement.htmlUrl, {
                baseUrl: canvasBaseUrl,
                courseId: row.canvasCourseId,
                label: announcement.title,
              });

              return integratedResource ? (
                <Button
                  className="mt-3 h-8 rounded-md"
                  onClick={() => openIntegratedResource(integratedResource)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ExternalLink className="size-4" />
                  {dictionary.courseOverviewOpenCanvas}
                </Button>
              ) : (
                <Button asChild className="mt-3 h-8 rounded-md" size="sm" variant="outline">
                  <a href={announcement.htmlUrl} rel="noreferrer" target="_blank">
                    <ExternalLink className="size-4" />
                    {dictionary.courseOverviewOpenCanvas}
                  </a>
                </Button>
              );
            })() : null}
          </div>
        ))}
      </div>
    );
  };

  const renderAssignments = () => {
    if (row.source === 'manual') {
      return enabledAssessments.length > 0 ? (
        <div className="space-y-2">
          {enabledAssessments.map((assessment) => (
            <div className="rounded-lg border bg-background p-3" key={assessment.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{assessment.label}</h3>
                  {assessment.details ? (
                    <p className="mt-1 text-sm text-muted-foreground">{assessment.details}</p>
                  ) : null}
                </div>
                <Badge className="rounded-md" variant="outline">
                  {[assessment.count, assessment.gradePortion ? `${assessment.gradePortion}%` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      ) : renderEmpty(dictionary.courseDetailNoAssignments);
    }

    if (!content || (content.assignments.length === 0 && content.quizzes.length === 0)) {
      return renderEmpty(dictionary.courseDetailNoAssignments);
    }

    return (
      <div className="space-y-2">
        {content.quizzes.map((quiz) => (
          <div
            className="rounded-lg border bg-background p-3 transition-colors hover:bg-muted/35"
            key={`quiz-${quiz.id}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-foreground">{quiz.title}</h3>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge className="rounded-md" variant="secondary">{formatSubmissionType(quiz.quizType ?? 'quiz')}</Badge>
                  {quiz.dueAt ? (
                    <Badge className="rounded-md" variant="outline">
                      {dictionary.courseDetailDue}: {formatCourseDate(quiz.dueAt)}
                    </Badge>
                  ) : null}
                  {quiz.pointsPossible !== undefined && quiz.pointsPossible !== null ? (
                    <Badge className="rounded-md" variant="secondary">
                      {quiz.pointsPossible} {dictionary.courseDetailPoints}
                    </Badge>
                  ) : null}
                  {quiz.questionCount !== undefined && quiz.questionCount !== null ? (
                    <Badge className="rounded-md" variant="outline">{quiz.questionCount} questions</Badge>
                  ) : null}
                </div>
              </div>
            </div>
            {quiz.description ? (
              <RichCourseContent className="mt-2" compact html={quiz.description} {...richCanvasPageProps} />
            ) : null}
            <Button
              className="mt-3 h-8 rounded-md"
              onClick={() => openIntegratedResource({
                kind: 'canvas-quiz',
                quizId: quiz.id,
                title: quiz.title,
                url: quiz.htmlUrl ?? '',
              })}
              size="sm"
              type="button"
              variant="outline"
            >
              <ExternalLink className="size-4" />
              {dictionary.courseOverviewOpenCanvas}
            </Button>
          </div>
        ))}
        {content.assignments.map((assignment) => (
          <div
            className="rounded-lg border bg-background p-3 transition-colors hover:bg-muted/35"
            key={assignment.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-foreground">{assignment.name}</h3>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {assignment.dueAt ? (
                    <Badge className="rounded-md" variant="outline">
                      {dictionary.courseDetailDue}: {formatCourseDate(assignment.dueAt)}
                    </Badge>
                  ) : null}
                  {assignment.pointsPossible !== undefined && assignment.pointsPossible !== null ? (
                    <Badge className="rounded-md" variant="secondary">
                      {assignment.pointsPossible} {dictionary.courseDetailPoints}
                    </Badge>
                  ) : null}
                  <Badge className="rounded-md" variant={assignment.isSubmitted ? 'default' : 'outline'}>
                    {assignment.isSubmitted ? dictionary.courseDetailSubmitted : dictionary.courseDetailNotSubmitted}
                  </Badge>
                  {assignment.submissionTypes.slice(0, 2).map((submissionType) => (
                    <Badge className="rounded-md" key={`${assignment.id}-${submissionType}`} variant="outline">
                      {formatSubmissionType(submissionType)}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            {assignment.description ? (
              <RichCourseContent className="mt-2" compact html={assignment.description} {...richCanvasPageProps} />
            ) : null}
            {assignment.htmlUrl ? (
              <Button
                className="mt-3 h-8 rounded-md"
                onClick={() => openIntegratedResource({
                  assignmentId: assignment.id,
                  kind: 'canvas-assignment',
                  title: assignment.name,
                  url: assignment.htmlUrl ?? '',
                })}
                size="sm"
                type="button"
                variant="outline"
              >
                <ExternalLink className="size-4" />
                {dictionary.courseOverviewOpenCanvas}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    );
  };

  const renderGrades = () => {
    if (row.source === 'manual') {
      return row.manualLecture && enabledAssessments.length > 0 ? (
        <ManualGradeEditor
          assessments={row.manualLecture.assessments}
          gradeProgressThresholds={gradeProgressThresholds}
          onChange={(assessments) => {
            if (row.manualLecture) {
              onUpdateManualLectureAssessments?.(row.manualLecture.id, assessments);
            }
          }}
        />
      ) : renderEmpty(dictionary.academyGradesNoBreakdown);
    }

    return (
      <div className="space-y-3">
        <div className="rounded-lg border bg-background p-3">
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">{dictionary.courseOverviewGrade}</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{row.grade}</div>
        </div>
        {row.source === 'canvas' && content?.assignments?.length ? (
        <div className="rounded-lg border bg-background">
          <div className="border-b px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">Assignment grades</div>
          <div className="divide-y">
            {content.assignments.map((assignment) => (
              <button
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/35"
                key={`grade-${assignment.id}`}
                onClick={() => openIntegratedResource({
                  assignmentId: assignment.id,
                  kind: 'canvas-assignment',
                  title: assignment.name,
                  url: assignment.htmlUrl ?? '',
                })}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-foreground">{assignment.name}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {[assignment.dueAt ? formatCourseDate(assignment.dueAt) : '', assignment.workflowState ? formatStatus(assignment.workflowState) : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Badge className="rounded-md" variant={assignment.score !== undefined && assignment.score !== null ? 'secondary' : 'outline'}>
                  {assignment.score !== undefined && assignment.score !== null
                    ? `${assignment.score}${assignment.pointsPossible ? ` / ${assignment.pointsPossible}` : ''}`
                    : assignment.grade || '--'}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      </div>
    );
  };

  const renderLinks = () => (
    links.length > 0 ? (
      <div className="space-y-2">
        {links.map((link) => (
          <a
            className="flex items-center justify-between gap-2 rounded-lg border bg-background p-3 text-sm font-semibold text-foreground hover:bg-muted/35"
            href={link.url}
            key={link.id}
            rel="noreferrer"
            target="_blank"
          >
            <span className="truncate">{link.label}</span>
            <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
          </a>
        ))}
      </div>
    ) : renderEmpty(dictionary.courseDetailNoLinks)
  );

  const handleSubmitIntegratedAssignment = async (
    event: FormEvent<HTMLFormElement>,
    assignment: CanvasCourseAssignment,
  ) => {
    event.preventDefault();

    if (!row.canvasCourseId || isAssignmentSubmitting) {
      return;
    }

    setIsAssignmentSubmitting(true);
    setAssignmentSubmissionStatus('');
    setAssignmentSubmissionError('');

    try {
      await workspaceApi.submitCanvasCourseAssignment(row.canvasCourseId, assignment.id, {
        body: assignmentSubmissionBody,
        comment: assignmentSubmissionComment,
        submissionType: assignmentSubmissionType,
        url: assignmentSubmissionUrl,
      });
      const refreshedAssignment = await workspaceApi.getCanvasCourseAssignment(row.canvasCourseId, assignment.id);

      setIntegratedAssignment(refreshedAssignment);
      setAssignmentSubmissionBody('');
      setAssignmentSubmissionUrl('');
      setAssignmentSubmissionComment('');
      setAssignmentSubmissionStatus('Submission sent to Canvas.');
    } catch (error) {
      setAssignmentSubmissionError(error instanceof Error ? error.message : 'Unable to submit to Canvas.');
    } finally {
      setIsAssignmentSubmitting(false);
    }
  };

  const handleSubmitIntegratedDiscussion = async (
    event: FormEvent<HTMLFormElement>,
    discussion: CanvasCourseDiscussion,
  ) => {
    event.preventDefault();

    if (!row.canvasCourseId || isDiscussionSubmitting) {
      return;
    }

    setIsDiscussionSubmitting(true);
    setDiscussionSubmitStatus('');
    setDiscussionSubmitError('');

    try {
      await workspaceApi.submitCanvasCourseDiscussionEntry(row.canvasCourseId, discussion.id, {
        message: discussionMessage,
      });
      const refreshedDiscussion = await workspaceApi.getCanvasCourseDiscussion(row.canvasCourseId, discussion.id);

      setIntegratedDiscussion(refreshedDiscussion);
      setDiscussionMessage('');
      setDiscussionSubmitStatus('Discussion post sent to Canvas.');
    } catch (error) {
      setDiscussionSubmitError(error instanceof Error ? error.message : 'Unable to post to Canvas.');
    } finally {
      setIsDiscussionSubmitting(false);
    }
  };

  const handleStartIntegratedQuiz = async (
    event: FormEvent<HTMLFormElement>,
    quiz: CanvasCourseQuiz,
  ) => {
    event.preventDefault();

    if (!row.canvasCourseId || isQuizStarting) {
      return;
    }

    setIsQuizStarting(true);
    setQuizSubmissionStatus('');
    setQuizSubmissionError('');

    try {
      const quizSubmission = await workspaceApi.startCanvasCourseQuiz(row.canvasCourseId, quiz.id, {
        accessCode: quizAccessCode,
      });

      setQuizSubmissionStatus(
        quizSubmission.attempt
          ? `Classic quiz attempt ${quizSubmission.attempt} is ready in Canvas.`
          : 'Classic quiz attempt is ready in Canvas.',
      );
    } catch (error) {
      setQuizSubmissionError(error instanceof Error ? error.message : 'Unable to start Canvas quiz.');
    } finally {
      setIsQuizStarting(false);
    }
  };

  const renderAssignmentSubmissionPanel = (assignment: CanvasCourseAssignment) => {
    const supportedSubmissionTypes = assignment.submissionTypes.filter((submissionType) => (
      submissionType === 'online_text_entry' || submissionType === 'online_url'
    ));

    if (supportedSubmissionTypes.length === 0) {
      return (
        <div className="rounded-lg border border-dashed bg-muted/25 p-4 text-sm font-semibold text-muted-foreground">
          This assignment uses Canvas-only submission types. Open Canvas for uploads, media, annotations, or external tools.
        </div>
      );
    }

    return (
      <form className="grid gap-3 rounded-lg border bg-background p-4" onSubmit={(event) => handleSubmitIntegratedAssignment(event, assignment)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Submit to Canvas</h3>
          <div className="flex rounded-lg border bg-muted/35 p-1">
            {supportedSubmissionTypes.map((submissionType) => (
              <button
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-semibold transition-colors',
                  assignmentSubmissionType === submissionType
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                key={submissionType}
                onClick={() => setAssignmentSubmissionType(submissionType)}
                type="button"
              >
                {formatSubmissionType(submissionType)}
              </button>
            ))}
          </div>
        </div>
        {assignmentSubmissionType === 'online_url' ? (
          <input
            className="h-10 rounded-lg border bg-background px-3 text-sm font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onChange={(event) => setAssignmentSubmissionUrl(event.target.value)}
            placeholder="https://..."
            type="url"
            value={assignmentSubmissionUrl}
          />
        ) : (
          <textarea
            className="min-h-32 rounded-lg border bg-background p-3 text-sm font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onChange={(event) => setAssignmentSubmissionBody(event.target.value)}
            placeholder="Write your submission text..."
            value={assignmentSubmissionBody}
          />
        )}
        <textarea
          className="min-h-20 rounded-lg border bg-background p-3 text-sm font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onChange={(event) => setAssignmentSubmissionComment(event.target.value)}
          placeholder="Optional comment to instructor"
          value={assignmentSubmissionComment}
        />
        {assignmentSubmissionError ? (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600 dark:text-red-200">
            {assignmentSubmissionError}
          </p>
        ) : null}
        {assignmentSubmissionStatus ? (
          <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-100">
            {assignmentSubmissionStatus}
          </p>
        ) : null}
        <Button disabled={isAssignmentSubmitting} type="submit">
          {isAssignmentSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Submit
        </Button>
      </form>
    );
  };

  const renderRubric = ({
    criteria,
    isLoading = false,
    isUnavailable = false,
    settings,
    useForGrading,
  }: {
    criteria?: CanvasRubricCriterion[];
    isLoading?: boolean;
    isUnavailable?: boolean;
    settings?: CanvasRubricSettings;
    useForGrading?: boolean;
  }) => {
    const visibleCriteria = criteria ?? [];

    if (isLoading && visibleCriteria.length === 0) {
      return (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm font-semibold text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin text-primary" />
          {dictionary.courseDetailRubricLoading}
        </div>
      );
    }

    if (isUnavailable && visibleCriteria.length === 0) {
      return (
        <div className="rounded-lg border border-dashed bg-muted/35 p-4 text-sm font-bold text-muted-foreground">
          {dictionary.courseDetailRubricUnavailable}
        </div>
      );
    }

    if (visibleCriteria.length === 0 && !settings) {
      return null;
    }

    return (
      <section className="overflow-hidden rounded-lg border bg-background">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b bg-muted/25 p-4">
          <div className="min-w-0">
            <h3 className="text-sm font-black uppercase text-foreground">{dictionary.courseDetailRubric}</h3>
            {settings?.title ? (
              <p className="mt-1 truncate text-sm font-semibold text-muted-foreground">{settings.title}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {typeof useForGrading === 'boolean' ? (
              <Badge className="rounded-md" variant={useForGrading ? 'default' : 'outline'}>
                {useForGrading ? dictionary.courseDetailRubricUsedForGrading : dictionary.courseDetailRubricAdvisory}
              </Badge>
            ) : null}
            {settings?.pointsPossible !== undefined && settings.pointsPossible !== null ? (
              <Badge className="rounded-md" variant="secondary">
                {settings.pointsPossible} {dictionary.courseDetailPoints}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="divide-y">
          {visibleCriteria.map((criterion, criterionIndex) => {
            const description = stripHtml(criterion.description || `Criterion ${criterionIndex + 1}`);
            const longDescription = stripHtml(criterion.longDescription);

            return (
              <article className="grid gap-3 p-4" key={criterion.id}>
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-black text-foreground">{description}</h4>
                    {longDescription ? (
                      <p className="mt-1 text-sm font-semibold leading-6 text-muted-foreground">{longDescription}</p>
                    ) : null}
                  </div>
                  {criterion.points !== undefined && criterion.points !== null ? (
                    <Badge className="rounded-md" variant="secondary">
                      {criterion.points} {dictionary.courseDetailPoints}
                    </Badge>
                  ) : null}
                </div>
                {criterion.ratings.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {criterion.ratings.map((rating) => {
                      const ratingDescription = stripHtml(rating.description) || rating.id;
                      const ratingLongDescription = stripHtml(rating.longDescription);

                      return (
                        <div className="rounded-lg border bg-card p-3" key={rating.id}>
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <p className="min-w-0 text-sm font-bold text-foreground">{ratingDescription}</p>
                            {rating.points !== undefined && rating.points !== null ? (
                              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-black text-muted-foreground">
                                {rating.points}
                              </span>
                            ) : null}
                          </div>
                          {ratingLongDescription ? (
                            <p className="mt-1 text-xs font-semibold leading-5 text-muted-foreground">
                              {ratingLongDescription}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    );
  };

  const renderIntegratedAssignment = (assignment: CanvasCourseAssignment) => (
    <div className="space-y-3">
      <div className="rounded-lg border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{assignment.name}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {assignment.dueAt ? (
                <Badge className="rounded-md" variant="outline">
                  {dictionary.courseDetailDue}: {formatCourseDate(assignment.dueAt)}
                </Badge>
              ) : null}
              {assignment.pointsPossible !== undefined && assignment.pointsPossible !== null ? (
                <Badge className="rounded-md" variant="secondary">
                  {assignment.pointsPossible} {dictionary.courseDetailPoints}
                </Badge>
              ) : null}
              <Badge className="rounded-md" variant={assignment.isSubmitted ? 'default' : 'outline'}>
                {assignment.isSubmitted ? dictionary.courseDetailSubmitted : dictionary.courseDetailNotSubmitted}
              </Badge>
              {assignment.submissionTypes.map((submissionType) => (
                <Badge className="rounded-md" key={`${assignment.id}-${submissionType}`} variant="outline">
                  {formatSubmissionType(submissionType)}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>
      {assignment.description && stripHtml(assignment.description) ? (
        <RichCourseContent html={assignment.description} {...richCanvasPageProps} />
      ) : renderEmpty(dictionary.courseDetailEmpty)}
      {renderRubric({
        criteria: assignment.rubric,
        settings: assignment.rubricSettings,
        useForGrading: assignment.useRubricForGrading,
      })}
      {renderAssignmentSubmissionPanel(assignment)}
    </div>
  );

  const renderIntegratedQuiz = (quiz: CanvasCourseQuiz) => (
    <div className="space-y-3">
      <div className="rounded-lg border bg-background p-4">
        <h2 className="text-lg font-semibold text-foreground">{quiz.title}</h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge className="rounded-md" variant="secondary">{formatSubmissionType(quiz.quizType ?? 'quiz')}</Badge>
          {quiz.dueAt ? (
            <Badge className="rounded-md" variant="outline">
              {dictionary.courseDetailDue}: {formatCourseDate(quiz.dueAt)}
            </Badge>
          ) : null}
          {quiz.pointsPossible !== undefined && quiz.pointsPossible !== null ? (
            <Badge className="rounded-md" variant="secondary">
              {quiz.pointsPossible} {dictionary.courseDetailPoints}
            </Badge>
          ) : null}
          {quiz.questionCount !== undefined && quiz.questionCount !== null ? (
            <Badge className="rounded-md" variant="outline">{quiz.questionCount} questions</Badge>
          ) : null}
          {quiz.allowedAttempts !== undefined && quiz.allowedAttempts !== null ? (
            <Badge className="rounded-md" variant="outline">{quiz.allowedAttempts === -1 ? 'Unlimited attempts' : `${quiz.allowedAttempts} attempts`}</Badge>
          ) : null}
        </div>
      </div>
      {quiz.description && stripHtml(quiz.description) ? (
        <RichCourseContent html={quiz.description} {...richCanvasPageProps} />
      ) : renderEmpty(dictionary.courseDetailEmpty)}
      {quiz.assignmentId ? renderRubric({
        criteria: linkedRubricAssignment?.rubric,
        isLoading: linkedRubricStatus === 'loading',
        isUnavailable: linkedRubricStatus === 'failed',
        settings: linkedRubricAssignment?.rubricSettings,
        useForGrading: linkedRubricAssignment?.useRubricForGrading,
      }) : null}
      <form className="grid gap-3 rounded-lg border bg-background p-4" onSubmit={(event) => handleStartIntegratedQuiz(event, quiz)}>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Start or resume quiz</h3>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            Classic Canvas quizzes can be started from here. Answer and final-submit the quiz in Canvas so timed quiz behavior, access rules, and question types stay intact.
          </p>
        </div>
        <input
          className="h-10 rounded-lg border bg-background px-3 text-sm font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onChange={(event) => setQuizAccessCode(event.target.value)}
          placeholder="Access code, if required"
          type="text"
          value={quizAccessCode}
        />
        {quizSubmissionError ? (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600 dark:text-red-200">
            {quizSubmissionError}
          </p>
        ) : null}
        {quizSubmissionStatus ? (
          <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-100">
            {quizSubmissionStatus}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={isQuizStarting} type="submit">
            {isQuizStarting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Start / resume
          </Button>
          {quiz.htmlUrl ? (
            <Button asChild type="button" variant="outline">
              <a href={quiz.htmlUrl} rel="noreferrer" target="_blank">
                <ExternalLink className="size-4" />
                Open quiz
              </a>
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );

  const renderIntegratedDiscussion = (discussion: CanvasCourseDiscussion) => (
    <div className="space-y-3">
      <div className="rounded-lg border bg-background p-4">
        <h2 className="text-lg font-semibold text-foreground">{discussion.title}</h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge className="rounded-md" variant={discussion.isAnnouncement ? 'default' : 'secondary'}>
            {discussion.isAnnouncement ? dictionary.courseDetailAnnouncements : 'Discussion'}
          </Badge>
          {discussion.authorName ? (
            <Badge className="rounded-md" variant="outline">{discussion.authorName}</Badge>
          ) : null}
          {discussion.postedAt ? (
            <Badge className="rounded-md" variant="outline">{formatCourseDate(discussion.postedAt)}</Badge>
          ) : null}
        </div>
      </div>
      {discussion.message && stripHtml(discussion.message) ? (
        <RichCourseContent html={discussion.message} {...richCanvasPageProps} />
      ) : renderEmpty(dictionary.courseDetailEmpty)}
      {discussion.assignmentId ? renderRubric({
        criteria: linkedRubricAssignment?.rubric,
        isLoading: linkedRubricStatus === 'loading',
        isUnavailable: linkedRubricStatus === 'failed',
        settings: linkedRubricAssignment?.rubricSettings,
        useForGrading: linkedRubricAssignment?.useRubricForGrading,
      }) : null}
      {!discussion.isAnnouncement ? (
        <form className="grid gap-3 rounded-lg border bg-background p-4" onSubmit={(event) => handleSubmitIntegratedDiscussion(event, discussion)}>
          <h3 className="text-sm font-semibold text-foreground">Post to discussion</h3>
          <textarea
            className="min-h-32 rounded-lg border bg-background p-3 text-sm font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onChange={(event) => setDiscussionMessage(event.target.value)}
            placeholder="Write your discussion post..."
            value={discussionMessage}
          />
          {discussionSubmitError ? (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-600 dark:text-red-200">
              {discussionSubmitError}
            </p>
          ) : null}
          {discussionSubmitStatus ? (
            <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-100">
              {discussionSubmitStatus}
            </p>
          ) : null}
          <Button disabled={isDiscussionSubmitting} type="submit">
            {isDiscussionSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Post
          </Button>
        </form>
      ) : null}
    </div>
  );

  const renderIntegratedFile = (file: CanvasCourseFile) => {
    const fileUrl = file.previewUrl ?? file.url ?? file.htmlUrl ?? activeIntegratedResource?.url ?? '';

    return fileUrl
      ? renderEmbeddedManualLink(fileUrl, file.displayName, getFilePreviewKind(file))
      : renderEmpty(dictionary.courseDetailUnavailable);
  };

  const renderIntegratedModuleItem = (item: CanvasCourseModuleItem) => {
    const resolvedResource = getIntegratedResourceFromModuleItem(item, {
      baseUrl: canvasBaseUrl,
      courseId: row.canvasCourseId,
    });

    return (
      <div className="space-y-3">
        <div className="rounded-lg border bg-background p-4">
          <div className="text-sm font-semibold text-foreground">{item.title}</div>
          <div className="mt-1 text-xs font-medium text-muted-foreground">{item.type ?? 'Module item'}</div>
        </div>
        {resolvedResource ? (
          <Button
            className="rounded-md"
            onClick={() => openIntegratedResource(resolvedResource)}
            type="button"
            variant="outline"
          >
            <ExternalLink className="size-4" />
            {dictionary.courseOverviewOpenCanvas}
          </Button>
        ) : renderEmpty(dictionary.courseDetailUnavailable)}
      </div>
    );
  };

  const renderActiveSection = () => {
    if (integratedResourceStatus === 'loading') {
      return <CanvasLoadingBanner label={dictionary.courseDetailLoading} />;
    }

    if (integratedResourceStatus === 'failed') {
      return renderEmpty(dictionary.courseDetailUnavailable);
    }

    if (activeIntegratedResource?.kind === 'external') {
      return renderEmbeddedManualLink(activeIntegratedResource.url, activeIntegratedResource.title);
    }

    if (activeIntegratedResource?.kind === 'canvas-pages-index') {
      return renderPages();
    }

    if (activeIntegratedResource?.kind === 'canvas-people-index') {
      return renderPeople();
    }

    if (activeIntegratedResource?.kind === 'canvas-assignments-index') {
      return renderAssignments();
    }

    if (activeIntegratedResource?.kind === 'canvas-grades-index') {
      return renderGrades();
    }

    if (activeIntegratedResource?.kind === 'canvas-page' && integratedCanvasPage) {
      return stripHtml(integratedCanvasPage.body)
        ? (
            <RichCourseContent
              html={integratedCanvasPage.body}
              {...richCanvasPageProps}
            />
          )
        : renderEmpty(dictionary.courseDetailEmpty);
    }

    if (activeIntegratedResource?.kind === 'canvas-assignment' && integratedAssignment) {
      return renderIntegratedAssignment(integratedAssignment);
    }

    if (activeIntegratedResource?.kind === 'canvas-quiz' && integratedQuiz) {
      return renderIntegratedQuiz(integratedQuiz);
    }

    if (activeIntegratedResource?.kind === 'canvas-discussion' && integratedDiscussion) {
      return renderIntegratedDiscussion(integratedDiscussion);
    }

    if (activeIntegratedResource?.kind === 'canvas-file' && integratedFile) {
      return renderIntegratedFile(integratedFile);
    }

    if (activeIntegratedResource?.kind === 'canvas-module-item' && integratedModuleItem) {
      return renderIntegratedModuleItem(integratedModuleItem);
    }

    if (isCanvasLoading) {
      return <CanvasLoadingBanner label={dictionary.courseDetailLoading} />;
    }

    if (isCanvasFailed) {
      return renderEmpty(dictionary.courseDetailUnavailable);
    }

    if (row.source === 'manual' && activeSection === 'home' && manualLectureWebsiteUrl) {
      return renderEmbeddedManualLink(manualLectureWebsiteUrl, dictionary.manualLectureWebsiteLink);
    }

    if (row.source === 'manual' && activeSection === 'assignments' && manualSubmissionUrl) {
      return renderEmbeddedManualLink(manualSubmissionUrl, dictionary.manualLectureSubmissionLink);
    }

    if (activeSection === 'modules') {
      return renderModules();
    }

    if (activeSection === 'announcements') {
      return renderAnnouncements();
    }

    if (activeSection === 'syllabus') {
      return stripHtml(content?.syllabusBody)
        ? <RichCourseContent html={content?.syllabusBody} {...richCanvasPageProps} />
        : renderEmpty(dictionary.courseDetailEmpty);
    }

    if (activeSection === 'assignments') {
      return renderAssignments();
    }

    if (activeSection === 'pages') {
      return renderPages();
    }

    if (activeSection === 'people') {
      return renderPeople();
    }

    if (activeSection === 'grades') {
      return renderGrades();
    }

    if (activeSection === 'links') {
      return renderLinks();
    }

    if (activeSection === 'external') {
      return activeItem.htmlUrl ? (
        <div className="rounded-lg border bg-background p-4">
          <p className="text-sm font-medium text-muted-foreground">{dictionary.courseDetailExternalDescription}</p>
          <Button asChild className="mt-3" variant="outline">
            <a href={activeItem.htmlUrl} rel="noreferrer" target="_blank">
              <ExternalLink className="size-4" />
              {dictionary.courseOverviewOpenCanvas}
            </a>
          </Button>
        </div>
      ) : renderEmpty();
    }

    return renderHome();
  };

  const activeTitle = integratedCanvasPage?.title ||
    integratedAssignment?.name ||
    integratedQuiz?.title ||
    integratedDiscussion?.title ||
    integratedFile?.displayName ||
    activeIntegratedResource?.title ||
    activeItem.label;
  const activeManualUrl = row.source === 'manual' && activeSection === 'home'
    ? manualLectureWebsiteUrl
    : row.source === 'manual' && activeSection === 'assignments'
      ? manualSubmissionUrl
      : '';
  const activeCanvasUrl = integratedCanvasPage?.htmlUrl ??
    integratedAssignment?.htmlUrl ??
    integratedQuiz?.htmlUrl ??
    integratedDiscussion?.htmlUrl ??
    integratedFile?.htmlUrl ??
    activeIntegratedResource?.url ??
    (activeManualUrl || row.htmlUrl);
  const canGoBackInIntegratedContent = integratedHistoryIndex > 0;
  const canGoForwardInIntegratedContent = integratedHistoryIndex >= 0 && integratedHistoryIndex < integratedHistory.length - 1;
  const handleIntegratedContentAuxClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button === 3 && canGoBackInIntegratedContent) {
      event.preventDefault();
      navigateIntegratedHistory(integratedHistoryIndex - 1);
    }

    if (event.button === 4 && canGoForwardInIntegratedContent) {
      event.preventDefault();
      navigateIntegratedHistory(integratedHistoryIndex + 1);
    }
  };

  return (
    <div className="grid min-h-[520px] gap-3 lg:h-full lg:min-h-0 lg:grid-cols-[220px_minmax(0,1fr)] lg:overflow-hidden">
      <aside className="rounded-xl border bg-card p-3 lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <Button className="mb-3 h-8 w-full justify-start rounded-md" onClick={onBack} size="sm" variant="ghost">
          <ArrowLeft className="size-4" />
          {dictionary.courseDetailBack}
        </Button>
        <div className="mb-3 min-w-0 px-1">
          <div
            className={cn(
              'mb-2 inline-flex max-w-full items-center rounded-md border px-2 py-1 text-xs font-semibold',
              badgeColorClasses[row.color],
            )}
          >
            <span className="truncate">{row.courseCode}</span>
          </div>
          <h2 className="line-clamp-2 text-sm font-semibold text-foreground">{row.name}</h2>
        </div>
        {isCanvasLoading ? (
          <CanvasLoadingBanner className="mb-3" label={dictionary.courseDetailLoading} size="compact" />
        ) : null}
        <nav className="space-y-1">
          {navigationItems.map((item) => {
            const Icon = getSectionIcon(item.section);
            const isActive = item.id === activeItem.id;

            return (
              <button
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  isActive && 'bg-muted text-foreground',
                )}
                key={item.id}
                onClick={() => {
                  resetIntegratedResource();
                  onSelectItem(item);
                  if (item.section === 'external' && item.htmlUrl) {
                    const integratedResource = getIntegratedCourseResourceFromLink(item.htmlUrl, {
                      baseUrl: canvasBaseUrl,
                      courseId: row.canvasCourseId,
                      label: item.label,
                    });

                    if (integratedResource) {
                      setIntegratedHistory([integratedResource]);
                      setIntegratedHistoryIndex(0);
                      loadIntegratedResource(integratedResource);
                    }
                  }
                }}
                type="button"
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section
        className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card"
        onAuxClick={handleIntegratedContentAuxClick}
      >
        <div className="shrink-0 flex min-w-0 items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className="rounded-md" variant="outline">
                {row.source === 'canvas' ? dictionary.courseOverviewCanvas : dictionary.courseOverviewManual}
              </Badge>
              <Badge className="rounded-md" variant="secondary">{row.semester}</Badge>
            </div>
            <h1 className="truncate text-xl font-semibold text-foreground">{activeTitle}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {isCanvasLoading || integratedResourceStatus === 'loading' ? (
              <Badge className="hidden gap-1.5 rounded-md lg:inline-flex" variant="outline">
                <LoaderCircle aria-hidden="true" className="animate-spin text-primary" size={13} strokeWidth={2.4} />
                {dictionary.courseDetailLoading}
              </Badge>
            ) : null}
            <Button
              aria-label={dictionary.courseDetailPrevious}
              className="h-9 rounded-md px-3"
              disabled={!canGoBackInIntegratedContent}
              onClick={() => navigateIntegratedHistory(integratedHistoryIndex - 1)}
              size="sm"
              title={dictionary.courseDetailPrevious}
              type="button"
              variant="outline"
            >
              <ArrowLeft className="size-4" />
              <span className="hidden sm:inline">{dictionary.courseDetailPrevious}</span>
            </Button>
            <Button
              aria-label={dictionary.courseDetailNext}
              className="h-9 rounded-md px-3"
              disabled={!canGoForwardInIntegratedContent}
              onClick={() => navigateIntegratedHistory(integratedHistoryIndex + 1)}
              size="sm"
              title={dictionary.courseDetailNext}
              type="button"
              variant="outline"
            >
              <span className="hidden sm:inline">{dictionary.courseDetailNext}</span>
              <ArrowRight className="size-4" />
            </Button>
            {activeCanvasUrl ? (
              <Button asChild className="rounded-md" size="sm" variant="outline">
                <a href={activeCanvasUrl} rel="noreferrer" target="_blank">
                  <ExternalLink className="size-4" />
                  {dictionary.courseOverviewOpenCanvas}
                </a>
              </Button>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isCanvasLoading || integratedResourceStatus === 'loading' ? (
            <CanvasLoadingBanner className="mb-3 lg:hidden" label={dictionary.courseDetailLoading} size="compact" />
          ) : null}
          {renderActiveSection()}
        </div>
      </section>
    </div>
  );
}

export function CourseOverviewView({
  initialResourceUrl,
  initialSelectedCourseRowId,
}: {
  initialResourceUrl?: string | null;
  initialSelectedCourseRowId?: string | null;
} = {}) {
  const { dictionary } = useLanguage();
  const [canvasCourses, setCanvasCourses] = useState<CanvasCourse[]>([]);
  const [canvasLecturePreferences, setCanvasLecturePreferences] = useState<CanvasLecturePreferences>(() => getStoredCanvasLecturePreferences());
  const [courseLoadStatus, setCourseLoadStatus] = useState<LoadStatus>('idle');
  const [manualLectures, setManualLectures] = useState<ManualLecture[]>(() => getStoredManualLectures());
  const [notificationCounts, setNotificationCounts] = useState<Record<string, number>>({});
  const [selectedSemester, setSelectedSemester] = useState(getStoredSelectedAcademySemester);
  const [gradeProgressThresholds, setGradeProgressThresholds] =
    useState<GradeProgressColorThresholds>(defaultGradeProgressColorThresholds);
  const [selectedCourseRowId, setSelectedCourseRowId] = useState<string | null>(initialSelectedCourseRowId ?? null);
  const [activeCourseItem, setActiveCourseItem] = useState<CourseNavigationItem | null>(null);
  const [canvasCourseContent, setCanvasCourseContent] = useState<CanvasCourseContent | null>(null);
  const [canvasCourseContentStatus, setCanvasCourseContentStatus] = useState<LoadStatus>('idle');
  const manualGradeSaveSequenceRef = useRef(0);

  useEffect(() => {
    const applyAcademyPreferences = (preferences: AcademyPreferences) => {
      setManualLectures(getManualLecturesFromAcademyPreferences(preferences));
      setCanvasLecturePreferences(getCanvasLecturePreferencesFromAcademyPreferences(preferences));
      setGradeProgressThresholds(getGradeProgressThresholdsFromAcademyPreferences(preferences));

      const preferenceSemester = getSelectedSemesterFromAcademyPreferences(preferences);

      if (preferenceSemester) {
        setSelectedSemester(preferenceSemester);
      }
    };

    const reloadAcademyPreferences = () => {
      workspaceApi
        .getAcademyPreferences()
        .then(applyAcademyPreferences)
        .catch(() => undefined);
    };

    const handleAcademyPreferencesUpdated = (event: Event) => {
      if (event instanceof CustomEvent && isRecord(event.detail)) {
        if (Array.isArray(event.detail.manualLectures)) {
          setManualLectures(event.detail.manualLectures as ManualLecture[]);
        }

        if (isCanvasLecturePreferences(event.detail.canvasLecturePreferences)) {
          setCanvasLecturePreferences(event.detail.canvasLecturePreferences);
        }

        if (isRecord(event.detail.calendarSettings)) {
          setGradeProgressThresholds((currentThresholds) => (
            normalizeGradeProgressColorThresholds(event.detail.calendarSettings, currentThresholds)
          ));
        }

        const selectedSemesterFromEvent = getSelectedSemesterFromCalendarSettings(event.detail.calendarSettings);

        if (selectedSemesterFromEvent) {
          setSelectedSemester(selectedSemesterFromEvent);
        }

        return;
      }

      reloadAcademyPreferences();
    };

    window.addEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);

    return () => {
      window.removeEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);
    };
  }, []);

  useEffect(() => {
    if (initialSelectedCourseRowId !== undefined) {
      setSelectedCourseRowId(initialSelectedCourseRowId);
    }
  }, [initialSelectedCourseRowId]);

  useEffect(() => {
    let isCancelled = false;

    setCourseLoadStatus('loading');

    workspaceApi
      .getAcademyPreferences()
      .then((preferences) => {
        if (isCancelled) {
          return;
        }

        setManualLectures(getManualLecturesFromAcademyPreferences(preferences));
        setCanvasLecturePreferences(getCanvasLecturePreferencesFromAcademyPreferences(preferences));
        setGradeProgressThresholds(getGradeProgressThresholdsFromAcademyPreferences(preferences));

        const preferenceSemester = getSelectedSemesterFromAcademyPreferences(preferences);

        if (preferenceSemester) {
          setSelectedSemester(preferenceSemester);
        }
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setManualLectures(getStoredManualLectures());
        setCanvasLecturePreferences(getStoredCanvasLecturePreferences());
      });

    workspaceApi
      .getCanvasCourses(20)
      .then(({ courses }) => {
        if (isCancelled) {
          return;
        }

        setCanvasCourses(courses);
        setCourseLoadStatus('loaded');
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setCanvasCourses([]);
        setCourseLoadStatus('failed');
      });

    workspaceApi
      .getCanvasCalendarItems({
        endDate: getFutureIsoDate(45),
        pageSize: 100,
        startDate: getTodayIsoDate(),
      })
      .then(({ items }) => {
        if (isCancelled) {
          return;
        }

        setNotificationCounts(countNotificationsByCourse(items));
      })
      .catch(() => {
        if (!isCancelled) {
          setNotificationCounts({});
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const allRows = useMemo(
    () => [
      ...createCanvasRows(canvasCourses, canvasLecturePreferences, notificationCounts),
      ...createStoredCanvasManualRows(canvasLecturePreferences, canvasCourses, manualLectures),
      ...createManualRows(manualLectures),
    ].sort(sortRows),
    [canvasCourses, canvasLecturePreferences, manualLectures, notificationCounts],
  );
  const semesterOptions = useMemo(() => {
    const semesters = new Set<string>();

    allRows.forEach((row) => {
      semesters.add(normalizeSemesterName(row.semester));
    });
    semesters.add(normalizeSemesterName(selectedSemester));
    semesters.add(defaultAcademySemester);

    return Array.from(semesters.values());
  }, [allRows, selectedSemester]);
  const rows = useMemo(
    () => allRows.filter((row) => normalizeSemesterName(row.semester) === normalizeSemesterName(selectedSemester)),
    [allRows, selectedSemester],
  );
  const selectedCourseRow = selectedCourseRowId
    ? allRows.find((row) => row.id === selectedCourseRowId)
    : undefined;
  const isLoading = courseLoadStatus === 'loading' && rows.length === 0;
  const isUnavailable = courseLoadStatus === 'failed' && rows.length === 0;
  const persistSelectedSemester = (semester: string) => {
    const normalizedSemester = normalizeSemesterName(semester);

    storeSelectedAcademySemester(normalizedSemester);

    void workspaceApi
      .saveAcademyPreferences({
        manualLectures,
        canvasLecturePreferences,
        manualCoursework: [],
        canvasCourseworkPreferences: {},
        manualAssessments: [],
        canvasAssessmentPreferences: {},
        calendarSettings: { selectedSemester: normalizedSemester },
      })
      .then((preferences) => {
        const preferenceSemester = getSelectedSemesterFromAcademyPreferences(preferences);

        if (preferenceSemester) {
          setSelectedSemester(preferenceSemester);
        }

        window.dispatchEvent(new CustomEvent(academyPreferencesUpdatedEvent, {
          detail: {
            calendarSettings: preferences.calendarSettings,
            canvasLecturePreferences: preferences.canvasLecturePreferences,
            manualLectures: preferences.manualLectures,
          },
        }));
      })
      .catch(() => undefined);
  };
  const handleSelectSemester = (semester: string) => {
    const normalizedSemester = normalizeSemesterName(semester);

    setSelectedSemester(normalizedSemester);
    persistSelectedSemester(normalizedSemester);
  };
  const handleUpdateManualLectureAssessments = (
    lectureId: string,
    assessments: ManualLecture['assessments'],
  ) => {
    const nextManualLectures = manualLectures.map((lecture) => (
      lecture.id === lectureId ? { ...lecture, assessments } : lecture
    ));

    setManualLectures(nextManualLectures);
    const saveSequence = manualGradeSaveSequenceRef.current + 1;

    manualGradeSaveSequenceRef.current = saveSequence;
    window.dispatchEvent(new CustomEvent(academyPreferencesUpdatedEvent, {
      detail: {
        canvasLecturePreferences,
        manualLectures: nextManualLectures,
      },
    }));

    void workspaceApi.getAcademyPreferences()
      .then((preferences) => {
        const storedManualLectures = getManualLecturesFromAcademyPreferences(preferences);
        const manualLecturesToSave = storedManualLectures.some((lecture) => lecture.id === lectureId)
          ? storedManualLectures.map((lecture) => (
            lecture.id === lectureId ? { ...lecture, assessments } : lecture
          ))
          : nextManualLectures;

        return workspaceApi.saveAcademyPreferences({
          calendarSettings: preferences.calendarSettings,
          canvasAssessmentPreferences: preferences.canvasAssessmentPreferences,
          canvasCourseworkPreferences: preferences.canvasCourseworkPreferences,
          canvasLecturePreferences: preferences.canvasLecturePreferences,
          manualAssessments: preferences.manualAssessments,
          manualCoursework: preferences.manualCoursework,
          manualLectures: manualLecturesToSave,
        });
      })
      .then((preferences) => {
        if (manualGradeSaveSequenceRef.current !== saveSequence) {
          return;
        }

        const savedManualLectures = getManualLecturesFromAcademyPreferences(preferences);

        setManualLectures(savedManualLectures);
        window.dispatchEvent(new CustomEvent(academyPreferencesUpdatedEvent, {
          detail: {
            calendarSettings: preferences.calendarSettings,
            canvasLecturePreferences: preferences.canvasLecturePreferences,
            manualLectures: savedManualLectures,
          },
        }));
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    if (!selectedCourseRow) {
      return;
    }

    const selectedRowSemester = normalizeSemesterName(selectedCourseRow.semester);

    if (selectedRowSemester !== normalizeSemesterName(selectedSemester)) {
      setSelectedSemester(selectedRowSemester);
      persistSelectedSemester(selectedRowSemester);
    }
  }, [selectedCourseRow, selectedSemester]);

  useEffect(() => {
    let isCancelled = false;

    if (!selectedCourseRow?.canvasCourseId) {
      setCanvasCourseContent(null);
      setCanvasCourseContentStatus('idle');
      return undefined;
    }

    setCanvasCourseContent(null);
    setCanvasCourseContentStatus('loading');
    workspaceApi
      .getCanvasCourseContent(selectedCourseRow.canvasCourseId)
      .then((content) => {
        if (isCancelled) {
          return;
        }

        setCanvasCourseContent(content);
        setCanvasCourseContentStatus('loaded');
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setCanvasCourseContent(null);
        setCanvasCourseContentStatus('failed');
      });

    return () => {
      isCancelled = true;
    };
  }, [selectedCourseRow?.canvasCourseId]);

  useEffect(() => {
    if (!selectedCourseRow) {
      setActiveCourseItem(null);
      return;
    }

    const navigationItems = selectedCourseRow.source === 'canvas'
      ? getCanvasNavigationItems(canvasCourseContent, dictionary)
      : getManualNavigationItems(dictionary);
    const nextActiveItem = activeCourseItem && navigationItems.some((item) => item.id === activeCourseItem.id)
      ? activeCourseItem
      : navigationItems[0];

    setActiveCourseItem(nextActiveItem);
  }, [activeCourseItem, canvasCourseContent, dictionary, selectedCourseRow]);

  if (selectedCourseRow && activeCourseItem) {
    return (
      <CourseDetailView
        activeItem={activeCourseItem}
        content={canvasCourseContent}
        contentLoadStatus={canvasCourseContentStatus}
        dictionary={dictionary}
        gradeProgressThresholds={gradeProgressThresholds}
        initialResourceUrl={initialResourceUrl}
        onBack={() => {
          setSelectedCourseRowId(null);
          setActiveCourseItem(null);
        }}
        onSelectItem={setActiveCourseItem}
        onUpdateManualLectureAssessments={handleUpdateManualLectureAssessments}
        row={selectedCourseRow}
      />
    );
  }

  return (
    <Card className="min-h-[520px] rounded-xl shadow-none max-[520px]:min-h-0 max-[520px]:rounded-none max-[520px]:border-0 max-[520px]:bg-transparent max-[520px]:py-0" size="sm">
      <CardHeader className="border-b max-[520px]:grid-cols-[minmax(0,1fr)_auto] max-[520px]:gap-2 max-[520px]:rounded-none max-[520px]:border-b max-[520px]:px-3 max-[520px]:py-3">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
          <BookOpen aria-hidden="true" size={15} strokeWidth={2.3} />
          <span>{dictionary.courseOverviewEyebrow}</span>
        </div>
        <CardTitle className="text-2xl font-semibold tracking-normal max-[520px]:text-lg max-[520px]:font-black">
          {dictionary.courseOverviewTitle}
        </CardTitle>
        <CardDescription className="max-w-2xl font-medium max-[520px]:hidden">
          {dictionary.courseOverviewSubtitle}
        </CardDescription>
        <CardAction className="flex flex-wrap items-center justify-end gap-2 max-[520px]:col-start-2 max-[520px]:row-span-2 max-[520px]:row-start-1 max-[520px]:gap-1.5">
          <Select onValueChange={handleSelectSemester} value={normalizeSemesterName(selectedSemester)}>
            <SelectTrigger className="h-8 w-[150px] rounded-md text-xs font-semibold max-[520px]:w-[124px] max-[520px]:text-[11px]">
              <SelectValue aria-label={dictionary.courseOverviewSemester} />
            </SelectTrigger>
            <SelectContent align="end">
              {semesterOptions.map((semester) => (
                <SelectItem key={semester} value={semester}>
                  {semester}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {courseLoadStatus === 'loading' ? (
            <Badge className="gap-1.5" variant="outline">
              <LoaderCircle aria-hidden="true" className="animate-spin text-primary" size={13} strokeWidth={2.4} />
              <span>{dictionary.canvasCoursesLoading}</span>
            </Badge>
          ) : null}
          <Badge variant="secondary">
            {rows.length} {dictionary.courseOverviewCountLabel}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-2 max-[520px]:px-3 max-[520px]:py-3">
        {courseLoadStatus === 'loading' ? (
          <CanvasLoadingBanner label={dictionary.canvasCoursesLoading} size="compact" />
        ) : null}

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, index) => (
              <CourseSkeletonRow key={index} />
            ))}
          </div>
        ) : null}

        {isUnavailable ? (
          <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-sm font-medium text-muted-foreground">
            {dictionary.courseOverviewUnavailable}
          </div>
        ) : null}

        {!isLoading && !isUnavailable ? (
          <div className="space-y-2.5">
            {rows.map((row) => {
              const detailItems = getCourseDetailItems(row, dictionary);
              const summaryLabel = row.grade !== '--' ? row.grade : row.semester;
              const mobileDetailItems = detailItems
                .filter(([, value]) => value && value !== '--')
                .slice(0, 2);

              return (
                <article
                  className={cn(
                    'grid min-w-0 cursor-pointer gap-3 rounded-lg border bg-background px-3 py-3 transition-colors hover:bg-muted/35',
                    'lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)_132px]',
                    'max-[520px]:block max-[520px]:rounded-xl max-[520px]:px-3 max-[520px]:py-3',
                    row.hidden && 'border-dashed bg-muted/15 opacity-35 grayscale hover:bg-muted/20',
                  )}
                  key={row.id}
                  onClick={() => setSelectedCourseRowId(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedCourseRowId(row.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex min-w-0 gap-3 max-[520px]:gap-2">
                    <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full max-[520px]:mt-1 max-[520px]:size-2', dotColorClasses[row.color])} />
                    <div className="min-w-0 max-[520px]:flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex max-w-full items-center rounded-md border px-2 py-1 text-xs font-semibold max-[520px]:h-6 max-[520px]:px-2 max-[520px]:py-0 max-[520px]:text-[11px]',
                            badgeColorClasses[row.color],
                          )}
                        >
                          <span className="truncate">{row.courseCode}</span>
                        </span>
                        <Badge className="h-5 rounded-md px-1.5 text-[10px] uppercase max-[520px]:h-5 max-[520px]:text-[9px]" variant="outline">
                          {row.source === 'canvas' ? dictionary.courseOverviewCanvas : dictionary.courseOverviewManual}
                        </Badge>
                        <Badge className="h-5 rounded-md px-1.5 text-[10px] max-[520px]:hidden" variant="secondary">
                          {row.semester}
                        </Badge>
                        {row.hidden ? (
                          <Badge className="h-5 rounded-md px-1.5 text-[10px] uppercase" variant="secondary">
                            {dictionary.courseOverviewHidden}
                          </Badge>
                        ) : null}
                      </div>
                      <h3 className="mt-2 truncate text-base font-semibold text-foreground max-[520px]:whitespace-normal max-[520px]:text-[15px] max-[520px]:font-black max-[520px]:leading-snug">
                        {row.name}
                      </h3>
                    </div>
                  </div>

                  <div className="grid min-w-0 grid-cols-2 gap-2 text-sm max-[520px]:mt-3 max-[520px]:hidden xl:grid-cols-4">
                    {detailItems.map(([label, value]) => (
                      <div className="min-w-0 rounded-md border bg-muted/20 px-2.5 py-2" key={`${row.id}-${label}`}>
                        <div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
                        <div className="mt-1 truncate font-medium text-foreground">{value}</div>
                      </div>
                    ))}
                  </div>
                  {mobileDetailItems.length > 0 ? (
                    <div className="mt-3 hidden grid-cols-2 gap-2 max-[520px]:grid">
                      {mobileDetailItems.map(([label, value]) => (
                        <div className="min-w-0 rounded-lg border bg-muted/15 px-2.5 py-2" key={`${row.id}-mobile-${label}`}>
                          <div className="text-[9px] font-black uppercase text-muted-foreground">{label}</div>
                          <div className="mt-1 truncate text-sm font-black text-foreground">{value}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between gap-2 max-[520px]:mt-3 lg:flex-col lg:items-end">
                    <div className="min-w-0 text-left max-[520px]:hidden lg:text-right">
                      <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                        {row.grade !== '--' ? dictionary.courseOverviewGrade : dictionary.courseOverviewSemester}
                      </div>
                      <div className="mt-1 truncate text-sm font-semibold text-foreground">{summaryLabel}</div>
                    </div>
                    <div className="flex items-center gap-1.5 max-[520px]:ml-auto">
                      <Badge className="h-7 gap-1 rounded-md px-2" variant={row.notificationCount > 0 ? 'default' : 'outline'}>
                        <Megaphone aria-hidden="true" size={13} strokeWidth={2.4} />
                        <span>{row.notificationCount}</span>
                      </Badge>
                      {row.htmlUrl ? (
                        <Button
                          asChild
                          className="size-7 rounded-md"
                          size="icon-sm"
                        title={dictionary.courseOverviewOpenCanvas}
                        type="button"
                        variant="ghost"
                      >
                          <a
                            href={row.htmlUrl}
                            onClick={(event) => event.stopPropagation()}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <ExternalLink aria-hidden="true" size={14} strokeWidth={2.4} />
                          </a>
                      </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
