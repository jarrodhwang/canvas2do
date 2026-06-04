import { ChevronDown, ChevronRight, ExternalLink, LoaderCircle, Mail, RefreshCw, Search, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { workspaceApi } from '../api/workspaceApi';
import type { CanvasCourse, CanvasCourseUser } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { cn } from '../lib/utils';
import type { ColorToken } from '../modes/types';
import { EventPill } from './EventPill';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';
const canvasLecturePreferencesStorageKey = 'incos-academy-canvas-lecture-preferences';
const colorTokens = new Set<ColorToken>(['blue', 'green', 'orange', 'red', 'purple', 'teal', 'gold', 'gray']);

interface CanvasPeopleViewProps {
  onOpenCoursePeople?: (courseRowId?: string | null, resourceUrl?: string | null) => void;
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

function readCanvasCourseColorPreferences() {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const storedValue = window.localStorage.getItem(canvasLecturePreferencesStorageKey);
    const preferences = storedValue ? JSON.parse(storedValue) as Record<string, { chipColor?: unknown }> : {};

    return preferences && typeof preferences === 'object' && !Array.isArray(preferences)
      ? preferences
      : {};
  } catch {
    return {};
  }
}

function getCourseColor(courseId: string, preferences: Record<string, { chipColor?: unknown }>): ColorToken {
  const storedColor = preferences[courseId]?.chipColor;

  return typeof storedColor === 'string' && colorTokens.has(storedColor as ColorToken)
    ? storedColor as ColorToken
    : 'green';
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

export function CanvasPeopleView({ onOpenCoursePeople }: CanvasPeopleViewProps) {
  const { dictionary } = useLanguage();
  const [courses, setCourses] = useState<CanvasCourse[]>([]);
  const [coursePeople, setCoursePeople] = useState<Record<string, CoursePeopleState>>({});
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedCourseIds, setCollapsedCourseIds] = useState<Set<string>>(() => new Set());
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const colorPreferences = useMemo(readCanvasCourseColorPreferences, [courses, coursePeople]);
  const totalPeopleCount = useMemo(() => (
    Object.values(coursePeople).reduce((count, courseState) => count + courseState.people.length, 0)
  ), [coursePeople]);
  const visibleCourseGroups = useMemo(() => (
    courses
      .map((course) => {
        const state = coursePeople[course.id] ?? { people: [], status: 'idle' as LoadStatus };
        const people = [...state.people]
          .filter((person) => personMatchesQuery(person, course, normalizedSearchQuery))
          .sort(sortCanvasPeople);

        return {
          course,
          people,
          state,
        };
      })
      .filter((group) => (
        group.people.length > 0 ||
        (!normalizedSearchQuery && (group.state.status === 'failed' || loadStatus === 'loading'))
      ))
      .sort((firstGroup, secondGroup) => (
        (firstGroup.course.courseCode || firstGroup.course.name)
          .localeCompare(secondGroup.course.courseCode || secondGroup.course.name, undefined, {
            numeric: true,
            sensitivity: 'base',
          })
      ))
  ), [coursePeople, courses, loadStatus, normalizedSearchQuery]);
  const isLoading = loadStatus === 'loading';
  const toggleCourseGroup = (courseId: string) => {
    setCollapsedCourseIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (nextIds.has(courseId)) {
        nextIds.delete(courseId);
      } else {
        nextIds.add(courseId);
      }

      return nextIds;
    });
  };

  const loadPeople = () => {
    setLoadStatus('loading');
    setErrorMessage('');
    setCoursePeople({});

    workspaceApi
      .getCanvasCourses(50)
      .then(async ({ courses: nextCourses }) => {
        setCourses(nextCourses);

        const entries = await Promise.all(nextCourses.map(async (course) => {
          try {
            const { people } = await workspaceApi.getCanvasCoursePeople(course.id);

            return [
              course.id,
              {
                people,
                status: 'loaded' as LoadStatus,
              },
            ] as const;
          } catch (error) {
            return [
              course.id,
              {
                error: error instanceof Error ? error.message : undefined,
                people: [],
                status: 'failed' as LoadStatus,
              },
            ] as const;
          }
        }));

        setCoursePeople(Object.fromEntries(entries));
        setLoadStatus('loaded');
      })
      .catch((error) => {
        setCourses([]);
        setCoursePeople({});
        setErrorMessage(error instanceof Error ? error.message : '');
        setLoadStatus('failed');
      });
  };

  useEffect(() => {
    loadPeople();
  }, []);

  return (
    <Card className="min-h-[620px] rounded-xl bg-card p-0 shadow-none xl:h-[calc(100vh_-_var(--top-bar-height)_-_1.5rem)] xl:min-h-0">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-black uppercase text-muted-foreground">
                <Users aria-hidden="true" size={15} strokeWidth={2.4} />
                <span>{dictionary.academyPeopleEyebrow}</span>
              </div>
              <h2 className="mt-1 text-2xl font-black leading-tight text-foreground">
                {dictionary.academyPeopleTitle}
              </h2>
              <p className="mt-1 max-w-2xl text-sm font-semibold text-muted-foreground">
                {dictionary.academyPeopleSubtitle}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <EventPill color="blue" label={`${totalPeopleCount} ${dictionary.academyPeopleCountLabel}`} />
              <Button
                aria-label={dictionary.canvasInboxRefresh}
                className="size-9"
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

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,360px)_1fr]">
            <label className="relative block min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
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
                const courseColor = getCourseColor(course.id, colorPreferences);
                const isCollapsed = collapsedCourseIds.has(course.id);

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
                            <EventPill color={courseColor} compact label={course.courseCode || course.name} />
                            <span className="text-xs font-black text-muted-foreground">
                              {people.length} {dictionary.academyPeopleCountLabel}
                            </span>
                          </span>
                          <span className="block truncate text-sm font-black text-foreground">{course.name}</span>
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
