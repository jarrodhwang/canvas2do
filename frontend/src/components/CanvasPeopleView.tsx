/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- This restored integration view reloads and groups roster state by selected term. */
import { ChevronDown, ChevronRight, ExternalLink, LoaderCircle, Mail, RefreshCw, Search, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { canvasToDoApi } from '../api/canvasToDoApi';
import type { AcademyPreferences, CanvasCourse, CanvasCourseUser } from '../api/canvasToDoApi';
import { useLanguage } from '../context/LanguageContext';
import { isColorToken } from '../lib/colorStyles';
import { cn } from '../lib/utils';
import type { ColorToken } from '../modes/types';
import { EventPill } from './EventPill';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';
const academyPreferencesUpdatedEvent = 'canvas-to-do-preferences-updated';
const defaultCanvasTermSemester = 'Default Term';

function getDateBasedAcademySemester(date = new Date()) {
  const month = date.getMonth();
  const term = month <= 3 ? 'Spring' : month <= 7 ? 'Summer' : 'Fall';

  return `${term} ${date.getFullYear()}`;
}

const defaultAcademySemester = getDateBasedAcademySemester();

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

function normalizeCanvasSemesterName(value?: string) {
  const trimmedValue = value?.trim();

  if (!trimmedValue || /^default term$/i.test(trimmedValue)) {
    return defaultCanvasTermSemester;
  }

  return trimmedValue;
}

interface CanvasLecturePreference {
  chipColor?: ColorToken;
  convertedToManualAt?: string;
  courseId?: string;
  courseCode?: string;
  courseName?: string;
  deleted?: boolean;
  friendlyCourseCode?: string;
  friendlyName?: string;
  hidden?: boolean;
  originalCourseCode?: string;
  semester?: string;
  termName?: string;
}

type CanvasLecturePreferences = Record<string, CanvasLecturePreference>;

interface CanvasPeopleViewProps {
  onOpenCoursePeople?: (courseRowId?: string | null, resourceUrl?: string | null) => void;
  selectedSemester?: string;
}

interface CoursePeopleState {
  people: CanvasCourseUser[];
  status: LoadStatus;
  error?: string;
}

function formatCanvasPersonRole(value?: string) {
  if (!value) {
    return '';
  }

  return value
    .replace(/Enrollment$/i, '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function getCanvasPersonInitials(person: CanvasCourseUser) {
  const source = person.shortName || person.name;
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}

function sortCanvasPeople(firstPerson: CanvasCourseUser, secondPerson: CanvasCourseUser) {
  return (firstPerson.sortableName ?? firstPerson.name)
    .localeCompare(secondPerson.sortableName ?? secondPerson.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
}

function getCoursePeopleUrl(course: CanvasCourse) {
  return course.htmlUrl ? `${course.htmlUrl.replace(/\/+$/, '')}/users` : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCanvasLecturePreferences(value: unknown): value is CanvasLecturePreferences {
  return isRecord(value);
}

function getCanvasLecturePreferencesFromAcademyPreferences(
  preferences: Pick<AcademyPreferences, 'canvasLecturePreferences'>,
) {
  return isCanvasLecturePreferences(preferences.canvasLecturePreferences)
    ? preferences.canvasLecturePreferences
    : {};
}

function getSelectedSemesterFromAcademyPreferences(preferences: { calendarSettings?: unknown }) {
  const settings = preferences.calendarSettings;

  if (!isRecord(settings)) {
    return undefined;
  }

  return typeof settings.selectedSemester === 'string'
    ? normalizeSemesterName(settings.selectedSemester)
    : undefined;
}

function normalizeCourseMatchValue(value?: string) {
  return value?.replace(/\s+/g, '').trim().toLowerCase() || '';
}

function getCanvasCourseIdFromUrl(value?: string) {
  return value?.match(/\/courses\/([^/?#]+)/i)?.[1]?.trim() || '';
}

function getCoursePreference(course: CanvasCourse, preferences: CanvasLecturePreferences) {
  const courseId = String(course.id ?? '').trim() || getCanvasCourseIdFromUrl(course.htmlUrl);
  const directPreference = preferences[courseId];

  if (directPreference) {
    return directPreference;
  }

  const normalizedCourseId = normalizeCourseMatchValue(courseId);
  const normalizedCourseCode = normalizeCourseMatchValue(course.courseCode);
  const normalizedCourseName = normalizeCourseMatchValue(course.name);

  return Object.entries(preferences).find(([preferenceKey, preference]) => {
    const preferenceValues = [
      preferenceKey.replace(/^canvas:/i, ''),
      preference.courseId,
      preference.courseCode,
      preference.originalCourseCode,
      preference.friendlyCourseCode,
      preference.courseName,
      preference.friendlyName,
    ].map(normalizeCourseMatchValue);

    return Boolean(
      normalizedCourseId && preferenceValues.includes(normalizedCourseId) ||
      normalizedCourseCode && preferenceValues.includes(normalizedCourseCode) ||
      normalizedCourseName && preferenceValues.includes(normalizedCourseName),
    );
  })?.[1];
}

function getCourseColor(course: CanvasCourse, preferences: CanvasLecturePreferences): ColorToken {
  const storedColor = getCoursePreference(course, preferences)?.chipColor;

  return isColorToken(storedColor)
    ? storedColor
    : 'blue';
}

function getCourseLabel(course: CanvasCourse, preferences: CanvasLecturePreferences) {
  const preference = getCoursePreference(course, preferences);

  return preference?.friendlyCourseCode?.trim() ||
    course.courseCode?.trim() ||
    preference?.friendlyName?.trim() ||
    course.name;
}

function getCourseName(course: CanvasCourse, preferences: CanvasLecturePreferences) {
  return getCoursePreference(course, preferences)?.friendlyName?.trim() || course.name;
}

function isCourseHidden(course: CanvasCourse, preferences: CanvasLecturePreferences) {
  const preference = getCoursePreference(course, preferences);
  const restoreAccessibleConversion = Boolean(
    preference?.convertedToManualAt && course.accessClosed !== true,
  );

  return !restoreAccessibleConversion && Boolean(preference?.hidden || preference?.deleted);
}

function getCanvasCourseSemester(course: CanvasCourse, preferences: CanvasLecturePreferences) {
  const preference = getCoursePreference(course, preferences);

  if (preference?.semester || preference?.termName) {
    return normalizeSemesterName(preference.semester ?? preference.termName);
  }

  return normalizeCanvasSemesterName(course.termName);
}

function courseMatchesSemester(course: CanvasCourse, preferences: CanvasLecturePreferences, semester: string) {
  return getCanvasCourseSemester(course, preferences) === normalizeSemesterName(semester);
}

function personMatchesQuery(person: CanvasCourseUser, course: CanvasCourse, query: string) {
  if (!query) {
    return true;
  }

  const searchable = [
    course.courseCode,
    course.name,
    person.name,
    person.shortName,
    person.sortableName,
    person.loginId,
    person.email,
    person.bio,
    ...(person.roles ?? []),
    ...(person.enrollmentStates ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return searchable.includes(query);
}

export function CanvasPeopleView({ onOpenCoursePeople, selectedSemester }: CanvasPeopleViewProps) {
  const { dictionary } = useLanguage();
  const isMountedRef = useRef(true);
  const [courses, setCourses] = useState<CanvasCourse[]>([]);
  const [coursePeople, setCoursePeople] = useState<Record<string, CoursePeopleState>>({});
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCourseIds, setExpandedCourseIds] = useState<Set<string>>(() => new Set());
  const [canvasLecturePreferences, setCanvasLecturePreferences] = useState<CanvasLecturePreferences>({});
  const [academyPreferencesLoadStatus, setAcademyPreferencesLoadStatus] = useState<LoadStatus>('idle');
  const [hasLoadedAcademyPreferences, setHasLoadedAcademyPreferences] = useState(false);
  const [storedSelectedSemester, setStoredSelectedSemester] = useState(defaultAcademySemester);
  const effectiveSelectedSemester = normalizeSemesterName(selectedSemester ?? storedSelectedSemester);
  const visibleCourseIds = useMemo(() => new Set(
    hasLoadedAcademyPreferences
      ? courses
          .filter((course) => !course.accessClosed && !isCourseHidden(course, canvasLecturePreferences) &&
            courseMatchesSemester(course, canvasLecturePreferences, effectiveSelectedSemester))
          .map((course) => course.id)
      : [],
  ), [canvasLecturePreferences, courses, effectiveSelectedSemester, hasLoadedAcademyPreferences]);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const totalPeopleCount = useMemo(() => (
    Object.entries(coursePeople)
      .filter(([courseId]) => visibleCourseIds.has(courseId))
      .reduce((count, [, courseState]) => count + courseState.people.length, 0)
  ), [coursePeople, visibleCourseIds]);
  const visibleCourseGroups = useMemo(() => (
    courses
      .filter((course) => visibleCourseIds.has(course.id))
      .map((course) => {
        const state = coursePeople[course.id] ?? { people: [], status: 'idle' as LoadStatus };
        const people = [...state.people]
          .filter((person) => personMatchesQuery(person, course, normalizedSearchQuery))
          .sort(sortCanvasPeople);
        const courseMatchesQuery = [
          course.courseCode,
          course.name,
          getCourseLabel(course, canvasLecturePreferences),
          getCourseName(course, canvasLecturePreferences),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearchQuery);

        return {
          courseMatchesQuery,
          course,
          people,
          state,
        };
      })
      .filter((group) => (
        !normalizedSearchQuery ||
        group.courseMatchesQuery ||
        group.people.length > 0 ||
        group.state.status === 'failed' ||
        group.state.status === 'loading'
      ))
      .sort((firstGroup, secondGroup) => (
        getCourseLabel(firstGroup.course, canvasLecturePreferences)
          .localeCompare(getCourseLabel(secondGroup.course, canvasLecturePreferences), undefined, {
            numeric: true,
            sensitivity: 'base',
          })
      ))
  ), [canvasLecturePreferences, coursePeople, courses, loadStatus, normalizedSearchQuery, visibleCourseIds]);
  const isLoading =
    loadStatus === 'loading' ||
    (academyPreferencesLoadStatus !== 'failed' && !hasLoadedAcademyPreferences);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadCoursePeople = (courseId: string, options?: { force?: boolean }) => {
    const currentState = coursePeople[courseId];

    if (!options?.force && (currentState?.status === 'loading' || currentState?.status === 'loaded')) {
      return;
    }

    setCoursePeople((currentPeople) => ({
      ...currentPeople,
      [courseId]: {
        people: options?.force ? [] : currentPeople[courseId]?.people ?? [],
        status: 'loading',
      },
    }));

    canvasToDoApi
      .getCanvasCoursePeople(courseId)
      .then(({ people }) => {
        if (!isMountedRef.current) {
          return;
        }

        setCoursePeople((currentPeople) => ({
          ...currentPeople,
          [courseId]: {
            people,
            status: 'loaded',
          },
        }));
      })
      .catch((error) => {
        if (!isMountedRef.current) {
          return;
        }

        setCoursePeople((currentPeople) => ({
          ...currentPeople,
          [courseId]: {
            error: error instanceof Error ? error.message : undefined,
            people: [],
            status: 'failed',
          },
        }));
      });
  };
  const toggleCourseGroup = (courseId: string) => {
    setExpandedCourseIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (nextIds.has(courseId)) {
        nextIds.delete(courseId);
      } else {
        nextIds.add(courseId);
        loadCoursePeople(courseId);
      }

      return nextIds;
    });
  };

  const loadPeople = () => {
    setLoadStatus('loading');
    setErrorMessage('');
    setCoursePeople({});
    setExpandedCourseIds(new Set());

    canvasToDoApi
      .getCanvasCourses(100)
      .then(({ courses: nextCourses }) => {
        if (!isMountedRef.current) {
          return;
        }

        setCourses(nextCourses);
        setLoadStatus('loaded');
      })
      .catch((error) => {
        if (!isMountedRef.current) {
          return;
        }

        setCourses([]);
        setCoursePeople({});
        setErrorMessage(error instanceof Error ? error.message : '');
        setLoadStatus('failed');
      });
  };

  useEffect(() => {
    loadPeople();
  }, [effectiveSelectedSemester]);

  useEffect(() => {
    const applyAcademyPreferences = (preferences: AcademyPreferences) => {
      if (!isMountedRef.current) {
        return;
      }

      setCanvasLecturePreferences(getCanvasLecturePreferencesFromAcademyPreferences(preferences));
      setStoredSelectedSemester(getSelectedSemesterFromAcademyPreferences(preferences) ?? defaultAcademySemester);
      setHasLoadedAcademyPreferences(true);
      setAcademyPreferencesLoadStatus('loaded');
    };

    const reloadAcademyPreferences = () => {
      if (!hasLoadedAcademyPreferences) {
        setAcademyPreferencesLoadStatus('loading');
      }
      canvasToDoApi
        .getAcademyPreferences()
        .then(applyAcademyPreferences)
        .catch(() => {
          if (isMountedRef.current && !hasLoadedAcademyPreferences) {
            setAcademyPreferencesLoadStatus('failed');
          }
        });
    };

    const handleAcademyPreferencesUpdated = (event: Event) => {
      if (event instanceof CustomEvent && isRecord(event.detail)) {
        let shouldReloadPreferences = false;

        if (isCanvasLecturePreferences(event.detail.canvasLecturePreferences)) {
          setCanvasLecturePreferences(event.detail.canvasLecturePreferences);
          setHasLoadedAcademyPreferences(true);
          setAcademyPreferencesLoadStatus('loaded');
        } else {
          shouldReloadPreferences = true;
        }

        const nextSemester = getSelectedSemesterFromAcademyPreferences(event.detail);

        if (nextSemester) {
          setStoredSelectedSemester(nextSemester);
        }

        if (shouldReloadPreferences) {
          reloadAcademyPreferences();
        }

        return;
      }

      reloadAcademyPreferences();
    };

    reloadAcademyPreferences();
    window.addEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);

    return () => {
      window.removeEventListener(academyPreferencesUpdatedEvent, handleAcademyPreferencesUpdated);
    };
  }, [hasLoadedAcademyPreferences]);

  return (
    <Card className="min-h-[620px] rounded-xl bg-card p-0 shadow-none max-[520px]:min-h-0 max-[520px]:gap-0 xl:h-[calc(100vh_-_var(--top-bar-height)_-_1.5rem)] xl:min-h-0">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b p-4 max-[520px]:p-2">
          <div className="flex items-start justify-between gap-3 max-[520px]:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-black uppercase text-muted-foreground max-[520px]:size-11 max-[520px]:justify-center max-[520px]:[&>svg]:size-5">
                <Users aria-hidden="true" size={15} strokeWidth={2.4} />
                <span className="max-[520px]:sr-only">{dictionary.academyPeopleEyebrow}</span>
              </div>
              <h2 className="mt-1 text-2xl font-black leading-tight text-foreground max-[520px]:sr-only">
                {dictionary.academyPeopleTitle}
              </h2>
              <p className="mt-1 max-w-2xl text-sm font-semibold text-muted-foreground max-[520px]:hidden">
                {dictionary.academyPeopleSubtitle}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <EventPill color="blue" label={<><span>{totalPeopleCount}</span><span className="max-[520px]:sr-only"> {dictionary.academyPeopleCountLabel}</span></>} />
              <Button
                aria-label={dictionary.canvasInboxRefresh}
                className="size-9 max-[520px]:size-11"
                disabled={isLoading}
                onClick={loadPeople}
                title={dictionary.canvasInboxRefresh}
                type="button"
                variant="outline"
              >
                <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,360px)_1fr] max-[520px]:mt-1">
            <label className="relative block min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={dictionary.academyPeopleSearch}
                className="pl-9"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={dictionary.academyPeopleSearch}
                value={searchQuery}
              />
            </label>
            {isLoading ? (
              <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/55 px-3 py-2 text-xs font-black text-muted-foreground">
                <LoaderCircle aria-hidden="true" className="shrink-0 animate-spin text-primary" size={15} strokeWidth={2.4} />
                <span className="truncate">{dictionary.academyPeopleLoading}</span>
              </div>
            ) : null}
          </div>
        </div>

        {loadStatus === 'failed' ? (
          <div className="m-4 rounded-lg border border-dashed bg-muted/35 p-6 text-sm font-bold text-muted-foreground">
            {errorMessage || dictionary.academyPeopleUnavailable}
          </div>
        ) : null}

        {loadStatus !== 'failed' && !isLoading && visibleCourseGroups.length === 0 ? (
          <div className="m-4 rounded-lg border border-dashed bg-muted/35 p-6 text-sm font-bold text-muted-foreground">
            {dictionary.academyPeopleEmpty}
          </div>
        ) : null}

        {visibleCourseGroups.length > 0 ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid gap-4">
              {visibleCourseGroups.map(({ course, people, state }) => {
                const coursePeopleUrl = getCoursePeopleUrl(course);
                const courseColor = getCourseColor(course, canvasLecturePreferences);
                const isCollapsed = !expandedCourseIds.has(course.id);
                const courseCountLabel = state.status === 'loaded'
                  ? `${state.people.length} ${dictionary.academyPeopleCountLabel}`
                  : state.status === 'loading'
                    ? dictionary.academyPeopleLoading
                    : state.status === 'failed'
                      ? dictionary.academyPeopleUnavailable
                      : dictionary.academyPeopleCountLabel;

                return (
                  <section className="overflow-hidden rounded-xl border bg-background" key={course.id}>
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b bg-muted/25 px-4 py-3">
                      <button
                        className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-left transition hover:bg-muted/45"
                        onClick={() => toggleCourseGroup(course.id)}
                        type="button"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0">
                          <span className="mb-1 flex min-w-0 flex-wrap items-center gap-2">
                            <EventPill color={courseColor} compact label={getCourseLabel(course, canvasLecturePreferences)} />
                            <span className="text-xs font-black text-muted-foreground">
                              {courseCountLabel}
                            </span>
                          </span>
                          <span className="block truncate text-sm font-black text-foreground">
                            {getCourseName(course, canvasLecturePreferences)}
                          </span>
                        </span>
                      </button>
                      {onOpenCoursePeople ? (
                        <Button
                          className="rounded-md"
                          onClick={() => onOpenCoursePeople(`canvas:${course.id}`, coursePeopleUrl)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <ExternalLink className="size-4" />
                          {dictionary.academyPeopleOpenCourse}
                        </Button>
                      ) : null}
                    </div>

                    {isCollapsed ? null : (loadStatus === 'loading' && people.length === 0) || state.status === 'loading' ? (
                      <div className="flex items-center gap-2 p-4 text-sm font-bold text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin text-primary" />
                        {dictionary.academyPeopleLoading}
                      </div>
                    ) : state.status === 'failed' && people.length === 0 ? (
                      <div className="p-4 text-sm font-bold text-muted-foreground">
                        {state.error || dictionary.academyPeopleUnavailable}
                      </div>
                    ) : state.status === 'loaded' && people.length === 0 ? (
                      <div className="p-4 text-sm font-bold text-muted-foreground">
                        {dictionary.academyPeopleEmpty}
                      </div>
                    ) : (
                      <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
                        {people.map((person) => {
                          const visibleRoles = (person.roles?.length ? person.roles : ['StudentEnrollment']).slice(0, 3);
                          const visibleContact = person.email || person.loginId;

                          return (
                            <article className="min-w-0 bg-card p-3" key={`${course.id}-${person.id}`}>
                              <div className="flex min-w-0 items-start gap-3">
                                {person.avatarUrl ? (
                                  <img
                                    alt=""
                                    className="size-11 shrink-0 rounded-full border object-cover"
                                    src={person.avatarUrl}
                                  />
                                ) : (
                                  <span className="grid size-11 shrink-0 place-items-center rounded-full border bg-muted text-sm font-black text-muted-foreground">
                                    {getCanvasPersonInitials(person)}
                                  </span>
                                )}
                                <div className="min-w-0 flex-1">
                                  <h4 className="truncate text-sm font-black text-foreground">{person.name}</h4>
                                  {visibleContact ? (
                                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                                      <Mail className="size-3.5 shrink-0" />
                                      <span className="truncate">{visibleContact}</span>
                                    </div>
                                  ) : null}
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {visibleRoles.map((role) => (
                                      <Badge className="rounded-md" key={`${person.id}-${role}`} variant="outline">
                                        {formatCanvasPersonRole(role)}
                                      </Badge>
                                    ))}
                                    {(person.enrollmentStates ?? []).slice(0, 1).map((stateName) => (
                                      <Badge className="rounded-md" key={`${person.id}-${stateName}`} variant="secondary">
                                        {formatCanvasPersonRole(stateName)}
                                      </Badge>
                                    ))}
                                  </div>
                                  {person.bio ? (
                                    <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-muted-foreground">
                                      {person.bio}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
