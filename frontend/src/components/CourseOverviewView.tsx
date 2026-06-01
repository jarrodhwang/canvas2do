import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  FileText,
  GraduationCap,
  Home,
  Layers,
  Link2,
  ListChecks,
  LoaderCircle,
  Megaphone,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { workspaceApi } from '../api/workspaceApi';
import type {
  CanvasCalendarItem,
  CanvasCourse,
  CanvasCourseContent,
  CanvasCourseTab,
} from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { badgeColorClasses, dotColorClasses } from '../lib/colorStyles';
import { cn } from '../lib/utils';
import type { ColorToken } from '../modes/types';
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
  chipColor?: ColorToken;
  credits?: string;
  friendlyCourseCode?: string;
  friendlyName?: string;
  hidden?: boolean;
  labSection?: string;
  lectureSection?: string;
  originalCourseCode?: string;
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

type CourseDetailSection = 'home' | 'modules' | 'announcements' | 'syllabus' | 'assignments' | 'grades' | 'links' | 'external';

interface CourseNavigationItem {
  id: string;
  label: string;
  section: CourseDetailSection;
  htmlUrl?: string;
}

const manualLecturesStorageKey = 'incos-academy-manual-lectures';
const canvasLecturePreferencesStorageKey = 'incos-academy-canvas-lecture-preferences';
const academyCalendarSettingsStorageKey = 'incos-academy-calendar-settings';
const academyPreferencesUpdatedEvent = 'incos-academy-preferences-updated';
const defaultAcademySemester = 'Summer 2026';

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

function normalizeSemesterName(value?: string, fallback = defaultAcademySemester) {
  const trimmedValue = value?.trim();

  if (!trimmedValue || /^default term$/i.test(trimmedValue)) {
    return fallback;
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
  window.dispatchEvent(new Event(academyPreferencesUpdatedEvent));
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

function createCanvasRows(
  courses: CanvasCourse[],
  preferences: CanvasLecturePreferences,
  notificationCounts: Record<string, number>,
): CourseOverviewRow[] {
  return courses.map((course) => {
    const preference = preferences[course.id] ?? {};
    const courseCode = preference.friendlyCourseCode?.trim() || course.courseCode?.trim() || course.id;
    const semester = normalizeSemesterName(preference.semester ?? preference.termName ?? course.termName);

    return {
      id: `canvas:${course.id}`,
      canvasCourseId: course.id,
      name: preference.friendlyName?.trim() || course.name,
      courseCode,
      credits: preference.credits?.trim() || '',
      lectureSection: formatSection(preference.lectureSection),
      labSection: formatSection(preference.labSection),
      tutorialSection: formatSection(preference.tutorialSection),
      grade: formatCanvasGrade(course),
      notificationCount: notificationCounts[course.id] ?? 0,
      color: preference.chipColor ?? 'green',
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
    color: lecture.chipColor ?? 'green',
    hidden: Boolean(lecture.hidden),
    semester: normalizeSemesterName(lecture.semester),
    source: 'manual',
    status: '',
    manualLecture: lecture,
  }));
}

function sortRows(firstRow: CourseOverviewRow, secondRow: CourseOverviewRow) {
  return Number(secondRow.notificationCount > 0) - Number(firstRow.notificationCount > 0) ||
    Number(firstRow.hidden) - Number(secondRow.hidden) ||
    firstRow.courseCode.localeCompare(secondRow.courseCode);
}

function CourseSkeletonRow() {
  return (
    <div className="grid gap-3 rounded-lg border bg-background p-3 md:grid-cols-[minmax(0,1fr)_320px_120px]">
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

  if (searchable.includes('home') || searchable.includes('course-home') || searchable.includes('wiki')) {
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

  return hasHome
    ? items
    : [{ id: 'home', label: dictionary.courseDetailHome, section: 'home' }, ...items];
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
  onBack,
  onSelectItem,
  row,
}: {
  activeItem: CourseNavigationItem;
  content: CanvasCourseContent | null;
  contentLoadStatus: LoadStatus;
  dictionary: ReturnType<typeof useLanguage>['dictionary'];
  onBack: () => void;
  onSelectItem: (item: CourseNavigationItem) => void;
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
  const isCanvasLoading = row.source === 'canvas' && contentLoadStatus === 'loading';
  const isCanvasFailed = row.source === 'canvas' && contentLoadStatus === 'failed';

  const renderEmpty = (message: string = dictionary.courseDetailEmpty) => (
    <div className="rounded-lg border border-dashed bg-muted/25 p-5 text-sm font-medium text-muted-foreground">
      {message}
    </div>
  );

  const renderHome = () => (
    <div className="space-y-3">
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
          <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
            {stripHtml(content.announcements[0].message)}
          </p>
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
                {module.items.map((item) => (
                  <a
                    className="flex min-w-0 items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/35"
                    href={item.htmlUrl ?? item.externalUrl ?? '#'}
                    key={item.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className="truncate font-medium text-foreground">{item.title}</span>
                    <Badge className="rounded-md" variant="secondary">{item.type ?? 'Item'}</Badge>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ))}
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
          <a
            className="block rounded-lg border bg-background p-3 transition-colors hover:bg-muted/35"
            href={announcement.htmlUrl ?? '#'}
            key={announcement.id}
            rel="noreferrer"
            target="_blank"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{announcement.title}</h3>
              {announcement.postedAt ? (
                <Badge className="rounded-md" variant="outline">{formatCourseDate(announcement.postedAt)}</Badge>
              ) : null}
            </div>
            <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{stripHtml(announcement.message)}</p>
          </a>
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

    if (!content || content.assignments.length === 0) {
      return renderEmpty(dictionary.courseDetailNoAssignments);
    }

    return (
      <div className="space-y-2">
        {content.assignments.map((assignment) => (
          <a
            className="block rounded-lg border bg-background p-3 transition-colors hover:bg-muted/35"
            href={assignment.htmlUrl ?? '#'}
            key={assignment.id}
            rel="noreferrer"
            target="_blank"
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
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{stripHtml(assignment.description)}</p>
            ) : null}
          </a>
        ))}
      </div>
    );
  };

  const renderGrades = () => (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="rounded-lg border bg-background p-3">
        <div className="text-[10px] font-semibold uppercase text-muted-foreground">{dictionary.courseOverviewGrade}</div>
        <div className="mt-1 text-lg font-semibold text-foreground">{row.grade}</div>
      </div>
      {enabledAssessments.length > 0 ? (
        <div className="rounded-lg border bg-background p-3">
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">
            {dictionary.manualLectureAssessmentTotal}
          </div>
          <div className="mt-1 text-lg font-semibold text-foreground">
            {enabledAssessments.reduce((total, assessment) => total + (Number.parseFloat(assessment.gradePortion) || 0), 0)}%
          </div>
        </div>
      ) : null}
    </div>
  );

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

  const renderActiveSection = () => {
    if (isCanvasLoading) {
      return (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm font-semibold text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin text-primary" />
          {dictionary.courseDetailLoading}
        </div>
      );
    }

    if (isCanvasFailed) {
      return renderEmpty(dictionary.courseDetailUnavailable);
    }

    if (activeSection === 'modules') {
      return renderModules();
    }

    if (activeSection === 'announcements') {
      return renderAnnouncements();
    }

    if (activeSection === 'syllabus') {
      const syllabusText = stripHtml(content?.syllabusBody);

      return syllabusText ? (
        <div className="rounded-lg border bg-background p-4 text-sm leading-6 text-foreground">{syllabusText}</div>
      ) : renderEmpty(dictionary.courseDetailEmpty);
    }

    if (activeSection === 'assignments') {
      return renderAssignments();
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

  return (
    <div className="grid min-h-[520px] gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="rounded-xl border bg-card p-3">
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
                onClick={() => onSelectItem(item)}
                type="button"
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="min-w-0 rounded-xl border bg-card">
        <div className="flex min-w-0 items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className="rounded-md" variant="outline">
                {row.source === 'canvas' ? dictionary.courseOverviewCanvas : dictionary.courseOverviewManual}
              </Badge>
              <Badge className="rounded-md" variant="secondary">{row.semester}</Badge>
            </div>
            <h1 className="truncate text-xl font-semibold text-foreground">{activeItem.label}</h1>
          </div>
          {row.htmlUrl ? (
            <Button asChild className="shrink-0 rounded-md" size="sm" variant="outline">
              <a href={row.htmlUrl} rel="noreferrer" target="_blank">
                <ExternalLink className="size-4" />
                {dictionary.courseOverviewOpenCanvas}
              </a>
            </Button>
          ) : null}
        </div>
        <div className="p-4">{renderActiveSection()}</div>
      </section>
    </div>
  );
}

export function CourseOverviewView() {
  const { dictionary } = useLanguage();
  const [canvasCourses, setCanvasCourses] = useState<CanvasCourse[]>([]);
  const [canvasLecturePreferences, setCanvasLecturePreferences] = useState<CanvasLecturePreferences>(() => getStoredCanvasLecturePreferences());
  const [courseLoadStatus, setCourseLoadStatus] = useState<LoadStatus>('idle');
  const [manualLectures, setManualLectures] = useState<ManualLecture[]>(() => getStoredManualLectures());
  const [notificationCounts, setNotificationCounts] = useState<Record<string, number>>({});
  const [selectedSemester, setSelectedSemester] = useState(getStoredSelectedAcademySemester);
  const [selectedCourseRowId, setSelectedCourseRowId] = useState<string | null>(null);
  const [activeCourseItem, setActiveCourseItem] = useState<CourseNavigationItem | null>(null);
  const [canvasCourseContent, setCanvasCourseContent] = useState<CanvasCourseContent | null>(null);
  const [canvasCourseContentStatus, setCanvasCourseContentStatus] = useState<LoadStatus>('idle');

  useEffect(() => {
    const handleAcademyPreferencesUpdated = () => {
      setManualLectures(getStoredManualLectures());
      setCanvasLecturePreferences(getStoredCanvasLecturePreferences());
      setSelectedSemester(getStoredSelectedAcademySemester());
    };

    window.addEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);

    return () => {
      window.removeEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    setCourseLoadStatus('loading');

    workspaceApi
      .getAcademyPreferences()
      .then((preferences) => {
        if (isCancelled) {
          return;
        }

        setManualLectures(Array.isArray(preferences.manualLectures)
          ? preferences.manualLectures as ManualLecture[]
          : getStoredManualLectures());
        setCanvasLecturePreferences(isCanvasLecturePreferences(preferences.canvasLecturePreferences)
          ? preferences.canvasLecturePreferences
          : getStoredCanvasLecturePreferences());
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
    ? rows.find((row) => row.id === selectedCourseRowId)
    : undefined;
  const isLoading = courseLoadStatus === 'loading' && rows.length === 0;
  const isUnavailable = courseLoadStatus === 'failed' && rows.length === 0;
  const handleSelectSemester = (semester: string) => {
    const normalizedSemester = normalizeSemesterName(semester);

    setSelectedSemester(normalizedSemester);
    storeSelectedAcademySemester(normalizedSemester);
  };

  useEffect(() => {
    if (selectedCourseRowId && !rows.some((row) => row.id === selectedCourseRowId)) {
      setSelectedCourseRowId(null);
      setActiveCourseItem(null);
    }
  }, [rows, selectedCourseRowId]);

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
        onBack={() => {
          setSelectedCourseRowId(null);
          setActiveCourseItem(null);
        }}
        onSelectItem={setActiveCourseItem}
        row={selectedCourseRow}
      />
    );
  }

  return (
    <Card className="min-h-[520px] rounded-xl shadow-none" size="sm">
      <CardHeader className="border-b">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
          <BookOpen aria-hidden="true" size={15} strokeWidth={2.3} />
          <span>{dictionary.courseOverviewEyebrow}</span>
        </div>
        <CardTitle className="text-2xl font-semibold tracking-normal">
          {dictionary.courseOverviewTitle}
        </CardTitle>
        <CardDescription className="max-w-2xl font-medium">
          {dictionary.courseOverviewSubtitle}
        </CardDescription>
        <CardAction className="flex flex-wrap items-center justify-end gap-2">
          <Select onValueChange={handleSelectSemester} value={normalizeSemesterName(selectedSemester)}>
            <SelectTrigger className="h-8 w-[150px] rounded-md text-xs font-semibold">
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

      <CardContent className="space-y-2">
        {courseLoadStatus === 'loading' ? (
          <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/35 px-3 py-2 text-xs font-semibold text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="shrink-0 animate-spin text-primary" size={15} strokeWidth={2.4} />
            <span className="truncate">{dictionary.canvasCoursesLoading}</span>
          </div>
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
          <div className="space-y-2">
            {rows.map((row) => {
              const detailItems = getCourseDetailItems(row, dictionary);
              const summaryLabel = row.grade !== '--' ? row.grade : row.semester;

              return (
                <article
                  className={cn(
                    'grid min-w-0 cursor-pointer gap-3 rounded-lg border bg-background px-3 py-3 transition-colors hover:bg-muted/35',
                    'lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)_132px]',
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
                  <div className="flex min-w-0 gap-3">
                    <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', dotColorClasses[row.color])} />
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex max-w-full items-center rounded-md border px-2 py-1 text-xs font-semibold',
                            badgeColorClasses[row.color],
                          )}
                        >
                          <span className="truncate">{row.courseCode}</span>
                        </span>
                        <Badge className="h-5 rounded-md px-1.5 text-[10px] uppercase" variant="outline">
                          {row.source === 'canvas' ? dictionary.courseOverviewCanvas : dictionary.courseOverviewManual}
                        </Badge>
                        <Badge className="h-5 rounded-md px-1.5 text-[10px]" variant="secondary">
                          {row.semester}
                        </Badge>
                        {row.hidden ? (
                          <Badge className="h-5 rounded-md px-1.5 text-[10px] uppercase" variant="secondary">
                            {dictionary.courseOverviewHidden}
                          </Badge>
                        ) : null}
                      </div>
                      <h3 className="mt-2 truncate text-base font-semibold text-foreground">
                        {row.name}
                      </h3>
                    </div>
                  </div>

                  <div className="grid min-w-0 grid-cols-2 gap-2 text-sm xl:grid-cols-4">
                    {detailItems.map(([label, value]) => (
                      <div className="min-w-0 rounded-md border bg-muted/20 px-2.5 py-2" key={`${row.id}-${label}`}>
                        <div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
                        <div className="mt-1 truncate font-medium text-foreground">{value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2 lg:flex-col lg:items-end">
                    <div className="min-w-0 text-left lg:text-right">
                      <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                        {row.grade !== '--' ? dictionary.courseOverviewGrade : dictionary.courseOverviewSemester}
                      </div>
                      <div className="mt-1 truncate text-sm font-semibold text-foreground">{summaryLabel}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
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
