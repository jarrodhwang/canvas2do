import {
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Inbox,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { canvasToDoApi } from '../api/canvasToDoApi';
import type {
  AcademyPreferences,
  CanvasCourse,
  CanvasCoursePerson,
  CanvasInboxItem,
} from '../api/canvasToDoApi';
import { useLanguage } from '../context/LanguageContext';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';

interface CanvasStudentViewProps {
  onOpenCanvasSettings: () => void;
  selectedSemester?: string;
}

interface StoredAssessment {
  id: string;
  label: string;
  portion?: number;
  score?: number;
}

interface StudentCourse {
  id: string;
  canvasCourseId?: string;
  code: string;
  name: string;
  semester: string;
  source: 'canvas' | 'manual';
  isLive: boolean;
  score?: number;
  grade?: string;
  htmlUrl?: string;
  schedule: string[];
  assessments: StoredAssessment[];
}

interface StudentCourseData {
  courses: StudentCourse[];
  error: string;
  refresh: () => void;
  status: LoadStatus;
  warning: string;
}

const copy = {
  en: {
    canvasOnly: 'Live Canvas',
    connectAction: 'Canvas settings',
    connectDescription: 'Reconnect your SFU Canvas account to refresh live courses, grades, rosters, and inbox items.',
    connectTitle: 'Canvas connection required',
    coursesDescription: 'Your current courses from migrated account data and your personal Canvas connection.',
    emptyCourses: 'No courses were found for this semester.',
    gradesDescription: 'Current Canvas totals and migrated manual grade records.',
    inboxDescription: 'Recent activity returned by your personal Canvas account.',
    loadPeople: 'Load people',
    manual: 'Manual',
    noGrade: 'No grade yet',
    noInbox: 'No recent Canvas activity was found.',
    noPeople: 'No people were returned for this course.',
    openCanvas: 'Open in Canvas',
    peopleDescription: 'Course rosters are loaded only after you open a course.',
    refresh: 'Refresh',
    retry: 'Try again',
    searchPeople: 'Search people, roles, or email',
    showingPartial: 'Canvas returned a limited result set. Open Canvas for the complete list.',
    sourceMigrated: 'Migrated Canvas',
    titleCourses: 'Courses',
    titleGrades: 'Grades',
    titleInbox: 'Inbox',
    titlePeople: 'People',
  },
  ko: {
    canvasOnly: '실시간 Canvas',
    connectAction: 'Canvas 설정',
    connectDescription: 'SFU Canvas 계정을 다시 연결하면 과목, 성적, 수강자 및 받은 편지함을 새로고침할 수 있습니다.',
    connectTitle: 'Canvas 연결 필요',
    coursesDescription: '이전 계정에서 이전된 데이터와 개인 Canvas 연결의 현재 과목입니다.',
    emptyCourses: '이 학기에 표시할 과목이 없습니다.',
    gradesDescription: '현재 Canvas 성적과 이전된 수동 성적 기록입니다.',
    inboxDescription: '개인 Canvas 계정에서 가져온 최근 활동입니다.',
    loadPeople: '수강자 불러오기',
    manual: '수동',
    noGrade: '성적 없음',
    noInbox: '최근 Canvas 활동이 없습니다.',
    noPeople: '이 과목의 수강자 정보가 없습니다.',
    openCanvas: 'Canvas에서 열기',
    peopleDescription: '과목을 열 때만 수강자 명단을 불러옵니다.',
    refresh: '새로고침',
    retry: '다시 시도',
    searchPeople: '이름, 역할 또는 이메일 검색',
    showingPartial: 'Canvas가 제한된 결과만 반환했습니다. 전체 목록은 Canvas에서 확인하세요.',
    sourceMigrated: '이전된 Canvas',
    titleCourses: '과목',
    titleGrades: '성적',
    titleInbox: '받은 편지함',
    titlePeople: '수강자',
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function getNumber(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    const parsedValue = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));

    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return undefined;
}

function getDateBasedSemester(date = new Date()) {
  const month = date.getMonth();
  const term = month <= 3 ? 'Spring' : month <= 7 ? 'Summer' : 'Fall';

  return `${term} ${date.getFullYear()}`;
}

function normalizeSemester(value?: string) {
  return value?.trim() || getDateBasedSemester();
}

function parseAssessments(value: unknown): StoredAssessment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((rawAssessment, index) => {
    if (!isRecord(rawAssessment) || rawAssessment.enabled === false) {
      return [];
    }

    const gradeItems = Array.isArray(rawAssessment.gradeItems)
      ? rawAssessment.gradeItems.filter(isRecord)
      : [];
    const itemScores = gradeItems.flatMap((item) => {
      const percentage = getNumber(item, 'percentage');

      if (percentage !== undefined) {
        return [percentage];
      }

      const earned = getNumber(item, 'pointsEarned');
      const possible = getNumber(item, 'pointsPossible');

      return earned !== undefined && possible !== undefined && possible > 0
        ? [(earned / possible) * 100]
        : [];
    });
    const score = itemScores.length > 0
      ? itemScores.reduce((total, itemScore) => total + itemScore, 0) / itemScores.length
      : getNumber(rawAssessment, 'percentage', 'score');

    return [{
      id: getString(rawAssessment, 'id') ?? `assessment-${index}`,
      label: getString(rawAssessment, 'label', 'name') ?? `Assessment ${index + 1}`,
      portion: getNumber(rawAssessment, 'gradePortion', 'portion'),
      score,
    }];
  });
}

function calculateAssessmentScore(assessments: StoredAssessment[]) {
  const graded = assessments.filter((assessment) => assessment.score !== undefined);

  if (graded.length === 0) {
    return undefined;
  }

  const weighted = graded.filter((assessment) => assessment.portion !== undefined && assessment.portion > 0);
  const totalWeight = weighted.reduce((total, assessment) => total + (assessment.portion ?? 0), 0);

  if (totalWeight > 0) {
    return weighted.reduce(
      (total, assessment) => total + (assessment.score ?? 0) * (assessment.portion ?? 0),
      0,
    ) / totalWeight;
  }

  return graded.reduce((total, assessment) => total + (assessment.score ?? 0), 0) / graded.length;
}

function getScheduleLines(record: Record<string, unknown>) {
  if (!isRecord(record.schedule)) {
    return [];
  }

  const entries = Array.isArray(record.schedule.entries)
    ? record.schedule.entries.filter(isRecord)
    : [];
  const lines = entries.flatMap((entry) => {
    const days = Array.isArray(entry.days)
      ? entry.days.filter((day): day is string => typeof day === 'string')
      : [];
    const day = days.join(', ') || getString(entry, 'day');
    const time = getString(entry, 'time') || [getString(entry, 'startTime'), getString(entry, 'endTime')]
      .filter(Boolean)
      .join(' – ');
    const classType = getString(entry, 'classType');
    const line = [classType, day, time].filter(Boolean).join(' · ');

    return line ? [line] : [];
  });

  if (lines.length > 0) {
    return lines.slice(0, 4);
  }

  const summary = [
    getString(record.schedule, 'day'),
    getString(record.schedule, 'time'),
    getString(record.schedule, 'location'),
  ].filter(Boolean).join(' · ');

  return summary ? [summary] : [];
}

function getCanvasCourseId(preferenceKey: string, preference: Record<string, unknown>) {
  return getString(preference, 'courseId') ?? preferenceKey.replace(/^canvas:/i, '').trim();
}

function getSafeHttpUrl(value?: string) {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);

    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function getStoredCourseUrl(record: Record<string, unknown>) {
  const directUrl = getSafeHttpUrl(getString(record, 'htmlUrl'));

  if (directUrl || !Array.isArray(record.links)) {
    return directUrl;
  }

  return record.links
    .filter(isRecord)
    .map((link) => getSafeHttpUrl(getString(link, 'url')))
    .find((url) => url !== undefined);
}

function createStoredCourses(preferences: AcademyPreferences) {
  const courseByCanvasId = new Map<string, StudentCourse>();

  Object.entries(preferences.canvasLecturePreferences ?? {}).forEach(([preferenceKey, rawPreference]) => {
    if (!isRecord(rawPreference) || rawPreference.hidden === true || rawPreference.deleted === true) {
      return;
    }

    const canvasCourseId = getCanvasCourseId(preferenceKey, rawPreference);
    const code = getString(
      rawPreference,
      'friendlyCourseCode',
      'courseCode',
      'originalCourseCode',
      'courseName',
    ) ?? 'Canvas course';
    const name = getString(rawPreference, 'friendlyName', 'courseName') ?? code;
    const assessments = parseAssessments(rawPreference.assessments);

    courseByCanvasId.set(canvasCourseId, {
      id: `canvas:${canvasCourseId}`,
      canvasCourseId,
      code,
      name,
      semester: normalizeSemester(getString(rawPreference, 'semester', 'termName')),
      source: 'canvas',
      isLive: false,
      score: getNumber(rawPreference, 'currentScore') ?? calculateAssessmentScore(assessments),
      grade: getString(rawPreference, 'currentGrade'),
      htmlUrl: getStoredCourseUrl(rawPreference),
      schedule: getScheduleLines(rawPreference),
      assessments,
    });
  });

  const manualCourses = (preferences.manualLectures ?? []).flatMap((rawLecture, index) => {
    if (!isRecord(rawLecture) || rawLecture.hidden === true || rawLecture.deleted === true) {
      return [];
    }

    const code = getString(rawLecture, 'code', 'courseCode', 'friendlyCourseCode') ?? `Course ${index + 1}`;
    const assessments = parseAssessments(rawLecture.assessments);
    const canvasGradeSummary = isRecord(rawLecture.canvasGradeSummary)
      ? rawLecture.canvasGradeSummary
      : {};

    return [{
      id: getString(rawLecture, 'id') ?? `manual:${index}`,
      code,
      name: getString(rawLecture, 'friendlyName', 'name') ?? code,
      semester: normalizeSemester(getString(rawLecture, 'semester', 'termName')),
      source: 'manual' as const,
      isLive: false,
      score: getNumber(rawLecture, 'currentScore') ??
        getNumber(canvasGradeSummary, 'score') ??
        calculateAssessmentScore(assessments),
      grade: getString(rawLecture, 'currentGrade', 'grade') ?? getString(canvasGradeSummary, 'grade'),
      htmlUrl: getStoredCourseUrl(rawLecture),
      schedule: getScheduleLines(rawLecture),
      assessments,
    }];
  });

  return { courseByCanvasId, manualCourses };
}

function mergeLiveCourses(preferences: AcademyPreferences, liveCourses: CanvasCourse[]) {
  const { courseByCanvasId, manualCourses } = createStoredCourses(preferences);

  liveCourses.forEach((course) => {
    const storedCourse = courseByCanvasId.get(course.id);

    courseByCanvasId.set(course.id, {
      id: `canvas:${course.id}`,
      canvasCourseId: course.id,
      code: storedCourse?.code || course.courseCode || course.name,
      name: storedCourse?.name || course.name,
      semester: normalizeSemester(storedCourse?.semester || course.termName),
      source: 'canvas',
      isLive: true,
      score: course.currentScore ?? storedCourse?.score,
      grade: course.currentGrade ?? storedCourse?.grade,
      htmlUrl: course.htmlUrl ?? storedCourse?.htmlUrl,
      schedule: storedCourse?.schedule ?? [],
      assessments: storedCourse?.assessments ?? [],
    });
  });

  return [...courseByCanvasId.values(), ...manualCourses].sort((firstCourse, secondCourse) => (
    firstCourse.code.localeCompare(secondCourse.code, undefined, { numeric: true, sensitivity: 'base' })
  ));
}

function useCanvasStudentCourses(selectedSemester?: string): StudentCourseData {
  const { language } = useLanguage();
  const text = copy[language];
  const [courses, setCourses] = useState<StudentCourse[]>([]);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const loadSequenceRef = useRef(0);

  const load = useCallback(() => {
    const loadSequence = ++loadSequenceRef.current;

    setStatus('loading');
    setError('');
    setWarning('');

    void Promise.allSettled([
      canvasToDoApi.getAcademyPreferences(),
      canvasToDoApi.getCanvasCourses(50),
    ]).then(([preferencesResult, coursesResult]) => {
      if (loadSequence !== loadSequenceRef.current) {
        return;
      }

      if (preferencesResult.status === 'rejected' && coursesResult.status === 'rejected') {
        setCourses([]);
        setError(preferencesResult.reason instanceof Error
          ? preferencesResult.reason.message
          : text.emptyCourses);
        setStatus('failed');
        return;
      }

      const preferences = preferencesResult.status === 'fulfilled'
        ? preferencesResult.value
        : {
            manualLectures: [],
            canvasLecturePreferences: {},
            manualCoursework: [],
            canvasCourseworkPreferences: {},
            manualAssessments: [],
            canvasAssessmentPreferences: {},
            exists: false,
          } satisfies AcademyPreferences;
      const liveCourses = coursesResult.status === 'fulfilled' ? coursesResult.value.courses : [];

      setCourses(mergeLiveCourses(preferences, liveCourses));
      if (coursesResult.status === 'rejected') {
        setWarning(coursesResult.reason instanceof Error
          ? coursesResult.reason.message
          : text.connectDescription);
      } else if (preferencesResult.status === 'rejected') {
        setWarning(preferencesResult.reason instanceof Error
          ? preferencesResult.reason.message
          : 'Migrated course details are temporarily unavailable.');
      }
      setStatus('loaded');
    });
  }, [text.connectDescription, text.emptyCourses]);

  useEffect(() => {
    const timeoutId = window.setTimeout(load, 0);

    return () => {
      window.clearTimeout(timeoutId);
      loadSequenceRef.current += 1;
    };
  }, [load]);

  const effectiveSemester = normalizeSemester(selectedSemester);
  const filteredCourses = useMemo(() => courses.filter((course) => (
    normalizeSemester(course.semester).localeCompare(effectiveSemester, undefined, { sensitivity: 'base' }) === 0
  )), [courses, effectiveSemester]);

  return { courses: filteredCourses, error, refresh: load, status, warning };
}

function ViewHeader({
  description,
  icon: Icon,
  isLoading,
  onRefresh,
  title,
}: {
  description: string;
  icon: typeof BookOpen;
  isLoading: boolean;
  onRefresh: () => void;
  title: string;
}) {
  const { language } = useLanguage();
  const text = copy[language];

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="rounded-xl bg-primary/12 p-2.5 text-primary">
          <Icon aria-hidden="true" className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-black tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Button disabled={isLoading} onClick={onRefresh} type="button" variant="outline">
        <RefreshCw className={cn(isLoading && 'animate-spin')} />
        {text.refresh}
      </Button>
    </div>
  );
}

function ConnectionNotice({ message, onOpenCanvasSettings }: { message: string; onOpenCanvasSettings: () => void }) {
  const { language } = useLanguage();
  const text = copy[language];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm">
      <div className="min-w-0">
        <div className="font-bold text-amber-800 dark:text-amber-200">{text.connectTitle}</div>
        <div className="mt-0.5 text-muted-foreground">{message || text.connectDescription}</div>
      </div>
      <Button onClick={onOpenCanvasSettings} type="button" variant="outline">
        <Settings />
        {text.connectAction}
      </Button>
    </div>
  );
}

function LoadingOrEmpty({ emptyMessage, status }: { emptyMessage: string; status: LoadStatus }) {
  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>;
}

function formatScore(score?: number) {
  return score === undefined ? undefined : `${Math.round(score * 10) / 10}%`;
}

function CourseSourceBadge({ course }: { course: StudentCourse }) {
  const { language } = useLanguage();
  const text = copy[language];
  const label = course.source === 'manual'
    ? text.manual
    : course.isLive
      ? text.canvasOnly
      : text.sourceMigrated;

  return <Badge variant={course.isLive ? 'default' : 'outline'}>{label}</Badge>;
}

export function CanvasCoursesView({ onOpenCanvasSettings, selectedSemester }: CanvasStudentViewProps) {
  const { language } = useLanguage();
  const text = copy[language];
  const data = useCanvasStudentCourses(selectedSemester);

  return (
    <div className="grid gap-4 pb-4">
      <ViewHeader
        description={text.coursesDescription}
        icon={BookOpen}
        isLoading={data.status === 'loading'}
        onRefresh={data.refresh}
        title={text.titleCourses}
      />
      {data.warning ? <ConnectionNotice message={data.warning} onOpenCanvasSettings={onOpenCanvasSettings} /> : null}
      {data.error ? <ConnectionNotice message={data.error} onOpenCanvasSettings={onOpenCanvasSettings} /> : null}
      {data.courses.length === 0 ? (
        <LoadingOrEmpty emptyMessage={text.emptyCourses} status={data.status} />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {data.courses.map((course) => (
            <Card key={course.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-lg font-black">{course.code}</CardTitle>
                    <CardDescription className="mt-1">{course.name}</CardDescription>
                  </div>
                  <CourseSourceBadge course={course} />
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{course.semester}</span>
                  {course.grade || course.score !== undefined ? (
                    <>
                      <span aria-hidden="true">•</span>
                      <span>{[course.grade, formatScore(course.score)].filter(Boolean).join(' · ')}</span>
                    </>
                  ) : null}
                </div>
                {course.schedule.length > 0 ? (
                  <div className="grid gap-1 rounded-lg bg-muted/55 px-3 py-2 text-xs text-muted-foreground">
                    {course.schedule.map((line) => <div key={line}>{line}</div>)}
                  </div>
                ) : null}
                {course.htmlUrl ? (
                  <Button asChild className="w-fit" variant="outline">
                    <a href={course.htmlUrl} rel="noreferrer" target="_blank">
                      <ExternalLink />
                      {text.openCanvas}
                    </a>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function CanvasGradesView({ onOpenCanvasSettings, selectedSemester }: CanvasStudentViewProps) {
  const { language } = useLanguage();
  const text = copy[language];
  const data = useCanvasStudentCourses(selectedSemester);
  const gradedCourses = data.courses.filter((course) => course.score !== undefined);
  const average = gradedCourses.length > 0
    ? gradedCourses.reduce((total, course) => total + (course.score ?? 0), 0) / gradedCourses.length
    : undefined;

  return (
    <div className="grid gap-4 pb-4">
      <ViewHeader
        description={text.gradesDescription}
        icon={BarChart3}
        isLoading={data.status === 'loading'}
        onRefresh={data.refresh}
        title={text.titleGrades}
      />
      {data.warning ? <ConnectionNotice message={data.warning} onOpenCanvasSettings={onOpenCanvasSettings} /> : null}
      {average !== undefined ? (
        <Card size="sm">
          <CardContent className="flex items-center justify-between gap-4">
            <span className="font-bold">{language === 'ko' ? '표시된 과목 평균' : 'Average across graded courses'}</span>
            <span className="text-xl font-black text-primary">{formatScore(average)}</span>
          </CardContent>
        </Card>
      ) : null}
      {data.courses.length === 0 ? (
        <LoadingOrEmpty emptyMessage={text.emptyCourses} status={data.status} />
      ) : (
        <div className="grid gap-3">
          {data.courses.map((course) => {
            const safeScore = course.score === undefined ? 0 : Math.min(Math.max(course.score, 0), 100);

            return (
              <Card key={course.id} size="sm">
                <CardContent className="grid gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-black">{course.code}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{course.name}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <CourseSourceBadge course={course} />
                      <span className="min-w-16 text-right text-base font-black">
                        {[course.grade, formatScore(course.score)].filter(Boolean).join(' · ') || text.noGrade}
                      </span>
                    </div>
                  </div>
                  <div
                    aria-label={`${course.code} ${formatScore(course.score) ?? text.noGrade}`}
                    className="h-2 overflow-hidden rounded-full bg-muted"
                    role="img"
                  >
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width]',
                        safeScore >= 75 ? 'bg-emerald-500' : safeScore >= 60 ? 'bg-amber-500' : 'bg-red-500',
                      )}
                      style={{ width: `${safeScore}%` }}
                    />
                  </div>
                  {course.assessments.some((assessment) => assessment.score !== undefined) ? (
                    <div className="flex flex-wrap gap-2">
                      {course.assessments
                        .filter((assessment) => assessment.score !== undefined)
                        .map((assessment) => (
                          <Badge key={assessment.id} variant="outline">
                            {assessment.label}: {formatScore(assessment.score)}
                            {assessment.portion ? ` · ${assessment.portion}%` : ''}
                          </Badge>
                        ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface CoursePeopleState {
  error?: string;
  isComplete?: boolean;
  people: CanvasCoursePerson[];
  status: LoadStatus;
}

function formatRole(role: string) {
  return role
    .replace(/Enrollment$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}

function getInitials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);

  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)).toUpperCase();
}

export function CanvasPeopleView({ onOpenCanvasSettings, selectedSemester }: CanvasStudentViewProps) {
  const { language } = useLanguage();
  const text = copy[language];
  const data = useCanvasStudentCourses(selectedSemester);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [peopleByCourse, setPeopleByCourse] = useState<Record<string, CoursePeopleState>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const requestSequenceRef = useRef<Record<string, number>>({});
  const isMountedRef = useRef(true);
  const canvasCourses = data.courses.filter((course) => course.canvasCourseId);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const loadPeople = (courseId: string) => {
    const requestSequence = (requestSequenceRef.current[courseId] ?? 0) + 1;
    requestSequenceRef.current[courseId] = requestSequence;
    setPeopleByCourse((current) => ({
      ...current,
      [courseId]: { people: current[courseId]?.people ?? [], status: 'loading' },
    }));

    void canvasToDoApi.getCanvasCoursePeople(courseId).then((result) => {
      if (!isMountedRef.current || requestSequenceRef.current[courseId] !== requestSequence) {
        return;
      }

      setPeopleByCourse((current) => ({
        ...current,
        [courseId]: { people: result.people, status: 'loaded', isComplete: result.isComplete },
      }));
    }).catch((error: unknown) => {
      if (!isMountedRef.current || requestSequenceRef.current[courseId] !== requestSequence) {
        return;
      }

      setPeopleByCourse((current) => ({
        ...current,
        [courseId]: {
          error: error instanceof Error ? error.message : text.connectDescription,
          people: [],
          status: 'failed',
        },
      }));
    });
  };

  const toggleCourse = (courseId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);

      if (next.has(courseId)) {
        next.delete(courseId);
      } else {
        next.add(courseId);
        if (!peopleByCourse[courseId]) {
          loadPeople(courseId);
        }
      }

      return next;
    });
  };
  const normalizedSearch = searchQuery.trim().toLowerCase();

  return (
    <div className="grid gap-4 pb-4">
      <ViewHeader
        description={text.peopleDescription}
        icon={Users}
        isLoading={data.status === 'loading'}
        onRefresh={() => {
          setExpandedIds(new Set());
          setPeopleByCourse({});
          data.refresh();
        }}
        title={text.titlePeople}
      />
      {data.warning ? <ConnectionNotice message={data.warning} onOpenCanvasSettings={onOpenCanvasSettings} /> : null}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={text.searchPeople}
          className="pl-9"
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={text.searchPeople}
          type="search"
          value={searchQuery}
        />
      </div>
      {canvasCourses.length === 0 ? (
        <LoadingOrEmpty emptyMessage={text.emptyCourses} status={data.status} />
      ) : (
        <div className="grid gap-3">
          {canvasCourses.map((course) => {
            const courseId = course.canvasCourseId!;
            const state = peopleByCourse[courseId] ?? { people: [], status: 'idle' as const };
            const isExpanded = expandedIds.has(courseId);
            const visiblePeople = state.people.filter((person) => (
              !normalizedSearch || [person.name, person.email, ...person.roles]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .includes(normalizedSearch)
            ));
            const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;

            return (
              <Card key={course.id} size="sm">
                <button
                  aria-expanded={isExpanded}
                  className="flex w-full items-center justify-between gap-3 px-3 text-left"
                  onClick={() => toggleCourse(courseId)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block font-black">{course.code}</span>
                    <span className="block truncate text-xs text-muted-foreground">{course.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {state.status === 'loading' ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {state.status === 'idle' ? text.loadPeople : `${state.people.length}`}
                    <ChevronIcon className="size-4" />
                  </span>
                </button>
                {isExpanded ? (
                  <CardContent className="mt-2 grid gap-2 border-t pt-3">
                    {state.status === 'failed' ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        <span>{state.error}</span>
                        <Button onClick={() => loadPeople(courseId)} size="sm" type="button" variant="outline">
                          {text.retry}
                        </Button>
                      </div>
                    ) : null}
                    {state.status === 'loaded' && visiblePeople.length === 0 ? (
                      <div className="py-5 text-center text-sm text-muted-foreground">{text.noPeople}</div>
                    ) : null}
                    {visiblePeople.map((person) => (
                      <div className="flex items-center gap-3 rounded-lg bg-muted/45 px-3 py-2" key={person.id}>
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-black text-primary">
                          {getInitials(person.shortName || person.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-bold">{person.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[person.roles.map(formatRole).join(', '), person.email].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </div>
                    ))}
                    {state.isComplete === false ? (
                      <div className="text-xs text-muted-foreground">{text.showingPartial}</div>
                    ) : null}
                  </CardContent>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function stripHtml(value?: string) {
  if (!value) {
    return '';
  }

  if (typeof DOMParser !== 'undefined') {
    return new DOMParser().parseFromString(value, 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatInboxDate(value: string | undefined, locale: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function CanvasInboxView({ onOpenCanvasSettings, selectedSemester }: CanvasStudentViewProps) {
  const { language } = useLanguage();
  const text = copy[language];
  const courseData = useCanvasStudentCourses(selectedSemester);
  const [items, setItems] = useState<CanvasInboxItem[]>([]);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState('');
  const [isComplete, setIsComplete] = useState(true);
  const loadSequenceRef = useRef(0);
  const locale = language === 'ko' ? 'ko-KR' : 'en-CA';

  const loadInbox = useCallback(() => {
    const loadSequence = ++loadSequenceRef.current;

    setStatus('loading');
    setError('');
    void canvasToDoApi.getCanvasInboxItems(75).then((result) => {
      if (loadSequence !== loadSequenceRef.current) {
        return;
      }

      setItems(result.items);
      setIsComplete(result.isComplete);
      setStatus('loaded');
    }).catch((loadError: unknown) => {
      if (loadSequence !== loadSequenceRef.current) {
        return;
      }

      setItems([]);
      setError(loadError instanceof Error ? loadError.message : text.connectDescription);
      setStatus('failed');
    });
  }, [text.connectDescription]);

  useEffect(() => {
    const timeoutId = window.setTimeout(loadInbox, 0);

    return () => {
      window.clearTimeout(timeoutId);
      loadSequenceRef.current += 1;
    };
  }, [loadInbox]);

  const selectedCourseIds = new Set(courseData.courses.flatMap((course) => course.canvasCourseId ? [course.canvasCourseId] : []));
  const visibleItems = items.filter((item) => !item.courseId || selectedCourseIds.has(item.courseId));

  return (
    <div className="grid gap-4 pb-4">
      <ViewHeader
        description={text.inboxDescription}
        icon={Inbox}
        isLoading={status === 'loading'}
        onRefresh={() => {
          courseData.refresh();
          loadInbox();
        }}
        title={text.titleInbox}
      />
      {error ? <ConnectionNotice message={error} onOpenCanvasSettings={onOpenCanvasSettings} /> : null}
      {!isComplete ? <div className="text-xs text-muted-foreground">{text.showingPartial}</div> : null}
      {visibleItems.length === 0 ? (
        <LoadingOrEmpty emptyMessage={text.noInbox} status={status} />
      ) : (
        <div className="grid gap-3">
          {visibleItems.map((item) => {
            const message = stripHtml(item.message);

            return (
              <Card className={cn(item.readState === 'unread' && 'ring-primary/40')} key={item.id} size="sm">
                <CardContent className="grid gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-black">{item.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {[item.courseCode || item.courseName, item.type, formatInboxDate(item.updatedAt || item.createdAt, locale)]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    {item.readState ? <Badge variant="outline">{item.readState}</Badge> : null}
                  </div>
                  {message ? <p className="line-clamp-3 text-sm text-muted-foreground">{message}</p> : null}
                  {item.htmlUrl ? (
                    <Button asChild className="w-fit" size="sm" variant="outline">
                      <a href={item.htmlUrl} rel="noreferrer" target="_blank">
                        <ExternalLink />
                        {text.openCanvas}
                      </a>
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
