/* eslint-disable react-hooks/set-state-in-effect -- This restored integration view synchronizes request and selection state in effects. */
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, ExternalLink, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

import { canvasToDoApi, type AcademyPreferences, type CanvasCourse, type CanvasInboxItem } from '../api/canvasToDoApi';
import { useLanguage } from '../context/LanguageContext';
import { isCanvasCoursePublished } from '../lib/canvasCourseMigration';
import { isColorToken } from '../lib/colorStyles';
import { cn } from '../lib/utils';
import type { ColorToken } from '../modes/types';
import { EventPill } from './EventPill';
import { Button } from './ui/button';
import { Card } from './ui/card';

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

interface CanvasInboxViewProps {
  onOpenIntegration?: (courseRowId?: string | null, resourceUrl?: string | null) => void;
  selectedSemester?: string;
}

interface CourseInboxState {
  items: CanvasInboxItem[];
  status: LoadStatus;
  error?: string;
}

interface InboxSelectionHistory {
  ids: string[];
  index: number;
}

function formatCanvasInboxDate(value: string | undefined, locale: string) {
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

function formatCanvasInboxType(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s,_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function sortCanvasInboxItems(firstItem: CanvasInboxItem, secondItem: CanvasInboxItem) {
  const firstTime = new Date(firstItem.updatedAt ?? firstItem.createdAt ?? 0).getTime();
  const secondTime = new Date(secondItem.updatedAt ?? secondItem.createdAt ?? 0).getTime();

  return secondTime - firstTime;
}

function hasHtmlMarkup(value?: string) {
  return Boolean(value && /<\/?[a-z][\s\S]*>/i.test(value));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeCanvasInboxEntities(value: string) {
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');

    textarea.innerHTML = value;

    return textarea.value;
  }

  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getCanvasInboxRenderableMessage(value?: string) {
  if (!value) {
    return '';
  }

  if (hasHtmlMarkup(value)) {
    return value;
  }

  const decodedValue = decodeCanvasInboxEntities(value);

  return hasHtmlMarkup(decodedValue) ? decodedValue : value;
}

function stripCanvasInboxHtml(value?: string) {
  if (!value) {
    return '';
  }

  if (typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(value, 'text/html');

    return document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
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

function sanitizeCanvasInboxHtml(value?: string) {
  if (!value) {
    return '';
  }

  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return escapeHtml(stripCanvasInboxHtml(value));
  }

  const document = new DOMParser().parseFromString(value, 'text/html');

  document
    .querySelectorAll('script, style, iframe, object, embed, link, meta, form')
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

function getInboxCoursePreference(item: CanvasInboxItem, preferences: CanvasLecturePreferences) {
  const courseId = item.courseId?.trim() || getCanvasCourseIdFromUrl(item.htmlUrl);
  const directPreference = courseId ? preferences[courseId] : undefined;

  if (directPreference) {
    return directPreference;
  }

  const normalizedCourseId = normalizeCourseMatchValue(courseId);
  const normalizedCourseCode = normalizeCourseMatchValue(item.courseCode);
  const normalizedCourseName = normalizeCourseMatchValue(item.courseName);

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

function getInboxCourseLabel(item: CanvasInboxItem, fallback: string, preferences: CanvasLecturePreferences) {
  const preference = getInboxCoursePreference(item, preferences);

  return preference?.friendlyCourseCode?.trim() ||
    item.courseCode?.trim() ||
    preference?.friendlyName?.trim() ||
    item.courseName?.trim() ||
    fallback;
}

function getInboxCourseColor(item: CanvasInboxItem, preferences: CanvasLecturePreferences): ColorToken {
  const storedColor = getInboxCoursePreference(item, preferences)?.chipColor;

  return isColorToken(storedColor)
    ? storedColor
    : 'blue';
}

function isInboxCourseHidden(item: CanvasInboxItem, preferences: CanvasLecturePreferences) {
  const preference = getInboxCoursePreference(item, preferences);

  return Boolean(preference?.hidden || preference?.deleted);
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

function getCanvasCourseRowId(item: CanvasInboxItem) {
  if (item.courseId?.trim()) {
    return `canvas:${item.courseId.trim()}`;
  }

  const match = item.htmlUrl?.match(/\/courses\/([^/?#]+)/i);

  return match?.[1] ? `canvas:${match[1]}` : null;
}

function groupCanvasInboxItems(
  courses: CanvasCourse[],
  courseInbox: Record<string, CourseInboxState>,
  locale: string,
  preferences: CanvasLecturePreferences,
  selectedSemester: string,
) {
  return courses
    .filter((course) => !course.accessClosed && !isCourseHidden(course, preferences) && courseMatchesSemester(course, preferences, selectedSemester))
    .map((course) => {
      const state = courseInbox[course.id] ?? { items: [], status: 'idle' as LoadStatus };

      return {
        course,
        items: [...state.items]
          .filter((item) => !isInboxCourseHidden(item, preferences))
          .sort(sortCanvasInboxItems),
        state,
      };
    })
    .sort((firstGroup, secondGroup) => (
      getCourseLabel(firstGroup.course, preferences)
        .localeCompare(getCourseLabel(secondGroup.course, preferences), locale, {
          numeric: true,
          sensitivity: 'base',
        })
  ));
}

export function CanvasInboxView({ onOpenIntegration, selectedSemester }: CanvasInboxViewProps = {}) {
  const { dictionary, language } = useLanguage();
  const locale = language === 'ko' ? 'ko-KR' : 'en-CA';
  const isMountedRef = useRef(true);
  const [courses, setCourses] = useState<CanvasCourse[]>([]);
  const [courseInbox, setCourseInbox] = useState<Record<string, CourseInboxState>>({});
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [expandedCourseIds, setExpandedCourseIds] = useState<Set<string>>(() => new Set());
  const [canvasLecturePreferences, setCanvasLecturePreferences] = useState<CanvasLecturePreferences>({});
  const [academyPreferencesLoadStatus, setAcademyPreferencesLoadStatus] = useState<LoadStatus>('idle');
  const [hasLoadedAcademyPreferences, setHasLoadedAcademyPreferences] = useState(false);
  const [storedSelectedSemester, setStoredSelectedSemester] = useState(defaultAcademySemester);
  const [selectionHistory, setSelectionHistory] = useState<InboxSelectionHistory>({ ids: [], index: -1 });
  const effectiveSelectedSemester = normalizeSemesterName(selectedSemester ?? storedSelectedSemester);
  const visibleCourseIds = useMemo(() => new Set(
    hasLoadedAcademyPreferences
      ? courses
          .filter((course) => !course.accessClosed && !isCourseHidden(course, canvasLecturePreferences) &&
            courseMatchesSemester(course, canvasLecturePreferences, effectiveSelectedSemester))
          .map((course) => course.id)
      : [],
  ), [canvasLecturePreferences, courses, effectiveSelectedSemester, hasLoadedAcademyPreferences]);
  const sortedItems = useMemo(() => (
    Object.entries(courseInbox)
      .filter(([courseId]) => visibleCourseIds.has(courseId))
      .flatMap(([, state]) => state.items)
      .sort(sortCanvasInboxItems)
  ), [courseInbox, visibleCourseIds]);
  const groupedItems = useMemo(
    () => (
      hasLoadedAcademyPreferences
        ? groupCanvasInboxItems(courses, courseInbox, locale, canvasLecturePreferences, effectiveSelectedSemester)
        : []
    ),
    [canvasLecturePreferences, courseInbox, courses, effectiveSelectedSemester, hasLoadedAcademyPreferences, locale],
  );
  const selectedItem = useMemo(
    () => sortedItems.find((item) => item.id === selectedItemId) ?? null,
    [selectedItemId, sortedItems],
  );
  const selectedMessage = useMemo(
    () => getCanvasInboxRenderableMessage(selectedItem?.message),
    [selectedItem?.message],
  );
  const isLoading =
    loadStatus === 'loading' ||
    (academyPreferencesLoadStatus !== 'failed' && !hasLoadedAcademyPreferences);
  const canGoBack = selectionHistory.index > 0;
  const canGoForward = selectionHistory.index >= 0 && selectionHistory.index < selectionHistory.ids.length - 1;

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
  const loadCourseInbox = (courseId: string, options?: { force?: boolean }) => {
    const course = courses.find((candidate) => candidate.id === courseId);
    if (!course || !isCanvasCoursePublished(course)) {
      return;
    }

    const currentState = courseInbox[courseId];

    if (!options?.force && (currentState?.status === 'loading' || currentState?.status === 'loaded')) {
      return;
    }

    setCourseInbox((currentInbox) => ({
      ...currentInbox,
      [courseId]: {
        items: options?.force ? [] : currentInbox[courseId]?.items ?? [],
        status: 'loading',
      },
    }));

    canvasToDoApi
      .getCanvasInboxItems(75, { courseId })
      .then(({ items: nextItems }) => {
        if (!isMountedRef.current) {
          return;
        }

        setCourseInbox((currentInbox) => ({
          ...currentInbox,
          [courseId]: {
            items: nextItems,
            status: 'loaded',
          },
        }));

        if (nextItems.length > 0) {
          selectInboxItem([...nextItems].sort(sortCanvasInboxItems)[0].id, true);
        }
      })
      .catch((error) => {
        if (!isMountedRef.current) {
          return;
        }

        setCourseInbox((currentInbox) => ({
          ...currentInbox,
          [courseId]: {
            error: error instanceof Error ? error.message : undefined,
            items: [],
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
        loadCourseInbox(courseId);
      }

      return nextIds;
    });
  };

  const loadInboxCourses = () => {
    setLoadStatus('loading');
    setErrorMessage('');
    setCourses([]);
    setCourseInbox({});
    setExpandedCourseIds(new Set());
    setSelectedItemId(null);
    setSelectionHistory({ ids: [], index: -1 });

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
        setCourseInbox({});
        setErrorMessage(error instanceof Error ? error.message : '');
        setLoadStatus('failed');
      });
  };

  const selectInboxItem = (itemId: string, replaceHistory = false) => {
    setSelectedItemId(itemId);
    setSelectionHistory((currentHistory) => {
      const activeId = currentHistory.ids[currentHistory.index];

      if (activeId === itemId && !replaceHistory) {
        return currentHistory;
      }

      if (replaceHistory || currentHistory.index < 0) {
        return { ids: [itemId], index: 0 };
      }

      const nextIds = currentHistory.ids.slice(0, currentHistory.index + 1);

      nextIds.push(itemId);

      return { ids: nextIds, index: nextIds.length - 1 };
    });
  };

  const navigateSelectionHistory = (nextIndex: number) => {
    const nextItemId = selectionHistory.ids[nextIndex];

    if (!nextItemId || !sortedItems.some((item) => item.id === nextItemId)) {
      return;
    }

    setSelectedItemId(nextItemId);
    setSelectionHistory((currentHistory) => ({ ...currentHistory, index: nextIndex }));
  };

  const openInboxItem = (item: CanvasInboxItem) => {
    if (!item.htmlUrl) {
      return;
    }

    const courseRowId = getCanvasCourseRowId(item);

    if (courseRowId && onOpenIntegration) {
      onOpenIntegration(courseRowId, item.htmlUrl);
      return;
    }

    window.open(item.htmlUrl, '_blank', 'noopener,noreferrer');
  };

  const handleInboxMessageClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!selectedItem || !onOpenIntegration) {
      return;
    }

    const target = event.target;
    const targetElement = target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
    const anchor = targetElement?.closest('a');
    const href = anchor?.getAttribute('href') ?? anchor?.href;
    const courseRowId = getCanvasCourseRowId(selectedItem);

    if (!href || !courseRowId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onOpenIntegration(courseRowId, href);
  };

  const handleInboxAuxClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button === 3 && canGoBack) {
      event.preventDefault();
      navigateSelectionHistory(selectionHistory.index - 1);
    }

    if (event.button === 4 && canGoForward) {
      event.preventDefault();
      navigateSelectionHistory(selectionHistory.index + 1);
    }
  };

  useEffect(() => {
    loadInboxCourses();
  }, [effectiveSelectedSemester]);

  useEffect(() => {
    if (sortedItems.length === 0) {
      setSelectedItemId(null);
      setSelectionHistory({ ids: [], index: -1 });
      return;
    }

    if (selectedItemId && sortedItems.some((item) => item.id === selectedItemId)) {
      return;
    }

    selectInboxItem(sortedItems[0].id, true);
  }, [selectedItemId, sortedItems]);

  return (
    <Card
      className="min-h-[620px] rounded-xl bg-card p-0 shadow-none max-[520px]:min-h-0 max-[520px]:gap-0 xl:h-[calc(100vh_-_var(--top-bar-height)_-_1.5rem)] xl:min-h-0"
      onAuxClick={handleInboxAuxClick}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b p-4 max-[520px]:p-2">
          <div className="flex items-start justify-between gap-3 max-[520px]:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-black uppercase text-muted-foreground max-[520px]:size-11 max-[520px]:justify-center max-[520px]:[&>svg]:size-5">
                <Inbox aria-hidden="true" size={15} strokeWidth={2.4} />
                <span className="max-[520px]:sr-only">{dictionary.canvasInboxEyebrow}</span>
              </div>
              <h2 className="mt-1 text-2xl font-black leading-tight text-foreground max-[520px]:sr-only">
                {dictionary.canvasInboxTitle}
              </h2>
              <p className="mt-1 max-w-2xl text-sm font-semibold text-muted-foreground max-[520px]:hidden">
                {dictionary.canvasInboxSubtitle}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <EventPill color="blue" label={`${sortedItems.length}`} />
              <Button
                aria-label={dictionary.canvasInboxRefresh}
                className="size-9 max-[520px]:size-11"
                disabled={isLoading}
                onClick={loadInboxCourses}
                title={dictionary.canvasInboxRefresh}
                type="button"
                variant="outline"
              >
                <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="mt-3 flex min-w-0 items-center gap-2 rounded-lg border bg-muted/55 px-3 py-2 text-xs font-black text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="shrink-0 animate-spin text-primary" size={15} strokeWidth={2.4} />
              <span className="truncate">{dictionary.canvasInboxLoading}</span>
            </div>
          ) : null}
        </div>

        {loadStatus === 'failed' ? (
          <div className="m-4 rounded-lg border border-dashed bg-muted/35 p-6 text-sm font-bold text-muted-foreground">
            {errorMessage || dictionary.canvasInboxUnavailable}
          </div>
        ) : null}

        {loadStatus !== 'failed' && !isLoading && groupedItems.length === 0 ? (
          <div className="m-4 rounded-lg border border-dashed bg-muted/35 p-6 text-sm font-bold text-muted-foreground">
            {dictionary.canvasInboxEmpty}
          </div>
        ) : null}

        {groupedItems.length > 0 ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[330px_minmax(0,1fr)]">
            <aside className="min-h-0 border-b bg-muted/15 lg:border-b-0 lg:border-r">
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 border-b px-3 py-2">
                  <p className="text-xs font-black uppercase text-muted-foreground">
                    {dictionary.canvasInboxGroupByCourse}
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {groupedItems.map((group) => {
                    const courseColor = getCourseColor(group.course, canvasLecturePreferences);
                    const courseLabel = getCourseLabel(group.course, canvasLecturePreferences);
                    const isCollapsed = !expandedCourseIds.has(group.course.id);
                    const isUnpublished = !isCanvasCoursePublished(group.course);
                    const countLabel = isUnpublished
                      ? dictionary.courseOverviewNotPublished
                      : group.state.status === 'loaded'
                        ? `${group.state.items.length}`
                        : group.state.status === 'loading'
                          ? dictionary.canvasInboxLoading
                          : group.state.status === 'failed'
                            ? dictionary.canvasInboxUnavailable
                            : '0';

                    return (
                    <section className="mb-3 last:mb-0" key={group.course.id}>
                      <button
                        className="sticky top-0 z-10 mb-1 flex w-full items-center justify-between gap-2 rounded-md bg-card/95 px-2 py-1.5 text-left backdrop-blur transition hover:bg-muted/55"
                        onClick={() => toggleCourseGroup(group.course.id)}
                        type="button"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {isCollapsed ? (
                            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <EventPill color={courseColor} compact label={courseLabel} />
                        </span>
                        <span className="truncate text-[10px] font-black text-muted-foreground">{countLabel}</span>
                      </button>
                      {!isCollapsed ? (
                        isUnpublished ? (
                          <div className="rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground">
                            {dictionary.canvasCourseNotPublished}
                          </div>
                        ) : group.state.status === 'loading' ? (
                          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground">
                            <LoaderCircle className="size-4 animate-spin text-primary" />
                            {dictionary.canvasInboxLoading}
                          </div>
                        ) : group.state.status === 'failed' ? (
                          <div className="rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground">
                            {group.state.error || dictionary.canvasInboxUnavailable}
                          </div>
                        ) : group.state.status === 'loaded' && group.items.length === 0 ? (
                          <div className="rounded-lg px-3 py-2 text-xs font-bold text-muted-foreground">
                            {dictionary.canvasInboxEmpty}
                          </div>
                        ) : (
                      <div className="space-y-1">
                        {group.items.map((item) => {
                          const timestamp = formatCanvasInboxDate(item.updatedAt ?? item.createdAt, locale);
                          const preview = stripCanvasInboxHtml(getCanvasInboxRenderableMessage(item.message));
                          const isSelected = item.id === selectedItemId;

                          return (
                            <button
                              className={cn(
                                'w-full rounded-lg border px-3 py-2 text-left transition hover:bg-muted/55',
                                isSelected
                                  ? 'border-primary/35 border-l-4 border-l-primary bg-primary/10'
                                  : 'border-transparent bg-transparent',
                              )}
                              key={item.id}
                              onClick={() => selectInboxItem(item.id)}
                              type="button"
                            >
                              <div className="mb-1 flex min-w-0 items-center gap-2">
                                <span className="rounded-md border bg-card px-1.5 py-0.5 text-[10px] font-black uppercase text-muted-foreground">
                                  {formatCanvasInboxType(item.type)}
                                </span>
                                {timestamp ? (
                                  <time className="truncate text-[11px] font-black text-muted-foreground">{timestamp}</time>
                                ) : null}
                              </div>
                              <h3 className="line-clamp-2 text-sm font-black leading-snug text-foreground">
                                {item.title}
                              </h3>
                              {preview ? (
                                <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-muted-foreground">
                                  {preview}
                                </p>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                        )
                      ) : null}
                    </section>
                  );
                  })}
                </div>
              </div>
            </aside>

            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
              {selectedItem ? (
                <>
                  <div className="shrink-0 border-b p-4">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                          <EventPill
                            color={getInboxCourseColor(selectedItem, canvasLecturePreferences)}
                            compact
                            label={getInboxCourseLabel(selectedItem, dictionary.canvasInboxCourseFallback, canvasLecturePreferences)}
                          />
                          <span className="rounded-md border bg-card px-1.5 py-0.5 text-[10px] font-black uppercase text-muted-foreground">
                            {formatCanvasInboxType(selectedItem.type)}
                          </span>
                          {selectedItem.readState ? (
                            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-black uppercase text-primary">
                              {selectedItem.readState}
                            </span>
                          ) : null}
                        </div>
                        <h1 className="text-xl font-black leading-tight text-foreground">
                          {selectedItem.title}
                        </h1>
                        {formatCanvasInboxDate(selectedItem.updatedAt ?? selectedItem.createdAt, locale) ? (
                          <time className="mt-2 block text-xs font-black text-muted-foreground">
                            {formatCanvasInboxDate(selectedItem.updatedAt ?? selectedItem.createdAt, locale)}
                          </time>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          aria-label={dictionary.courseDetailPrevious}
                          className="h-9 rounded-md px-3"
                          disabled={!canGoBack}
                          onClick={() => navigateSelectionHistory(selectionHistory.index - 1)}
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
                          disabled={!canGoForward}
                          onClick={() => navigateSelectionHistory(selectionHistory.index + 1)}
                          size="sm"
                          title={dictionary.courseDetailNext}
                          type="button"
                          variant="outline"
                        >
                          <span className="hidden sm:inline">{dictionary.courseDetailNext}</span>
                          <ArrowRight className="size-4" />
                        </Button>
                        {selectedItem.htmlUrl ? (
                          <Button
                            className="rounded-md"
                            onClick={() => openInboxItem(selectedItem)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <ExternalLink className="size-4" />
                            {dictionary.canvasInboxOpen}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {selectedMessage ? (
                      hasHtmlMarkup(selectedMessage) ? (
                        <div
                          className={cn(
                            'course-rich-content rounded-lg border bg-card p-5 text-sm leading-6 text-foreground',
                            '[&_a]:font-semibold [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline',
                            '[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
                            '[&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold',
                            '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_p]:my-2',
                            '[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border',
                            '[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5',
                            '[&_table]:my-3 [&_table]:w-full [&_table]:overflow-hidden [&_table]:rounded-lg [&_table]:border [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:bg-muted/50 [&_th]:p-2 [&_th]:text-left',
                          )}
                          dangerouslySetInnerHTML={{ __html: sanitizeCanvasInboxHtml(selectedMessage) }}
                          onClick={handleInboxMessageClick}
                        />
                      ) : (
                        <div className="rounded-lg border bg-card p-5 text-sm font-semibold leading-6 text-foreground whitespace-pre-wrap">
                          {selectedMessage}
                        </div>
                      )
                    ) : (
                      <div className="rounded-lg border border-dashed bg-muted/35 p-6 text-sm font-bold text-muted-foreground">
                        {dictionary.canvasInboxNoMessage}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="grid min-h-0 flex-1 place-items-center p-6 text-center text-sm font-bold text-muted-foreground">
                  {dictionary.canvasInboxSelectNotification}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
