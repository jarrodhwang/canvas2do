import { useWorkspaceMode } from '../context/WorkspaceModeContext';
import { useLanguage } from '../context/LanguageContext';
import { dotColorClasses } from '@/lib/colorStyles';
import { cn } from '@/lib/utils';
import type { ColorToken } from '../modes/types';
import { Card, CardContent } from './ui/card';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';

interface FilterPanelProps {
  className?: string;
  courseOptions?: Array<{
    checked: boolean;
    color: ColorToken;
    id: string;
    label: string;
  }>;
  onToggleCourseOption?: (courseId: string) => void;
  variant?: 'card' | 'menu';
}

interface StoredCoursePreference {
  chipColor?: ColorToken;
  code?: string;
  friendlyCourseCode?: string;
  originalCourseCode?: string;
}

const manualLecturesStorageKey = 'incos-academy-manual-lectures';
const canvasLecturePreferencesStorageKey = 'incos-academy-canvas-lecture-preferences';

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

function getStoredCourseChipColor(courseCode: string): ColorToken | undefined {
  const storedManualLectures = readStoredJson<unknown>(manualLecturesStorageKey, []);
  const manualLectures = Array.isArray(storedManualLectures)
    ? storedManualLectures as StoredCoursePreference[]
    : [];
  const manualLecture = manualLectures.find((lecture) => (
    codesMatch(courseCode, lecture.friendlyCourseCode) || codesMatch(courseCode, lecture.code)
  ));

  if (manualLecture?.chipColor) {
    return manualLecture.chipColor;
  }

  const storedCanvasPreferences = readStoredJson<unknown>(canvasLecturePreferencesStorageKey, {});
  const canvasPreferences = storedCanvasPreferences &&
    typeof storedCanvasPreferences === 'object' &&
    !Array.isArray(storedCanvasPreferences)
    ? storedCanvasPreferences as Record<string, StoredCoursePreference>
    : {};
  const canvasLecture = Object.values(canvasPreferences).find((preference) => (
    codesMatch(courseCode, preference.friendlyCourseCode) || codesMatch(courseCode, preference.originalCourseCode)
  ));

  return canvasLecture?.chipColor;
}

export function FilterPanel({
  className,
  courseOptions,
  onToggleCourseOption,
  variant = 'card',
}: FilterPanelProps) {
  const { activeMode } = useWorkspaceMode();
  const { translateItemLabel } = useLanguage();
  const semesterLabel = activeMode.dashboardCards.find((card) => card.id === 'semester-lectures')?.pill;
  const filterGroups = activeMode.id === 'academy' && variant === 'menu'
    ? activeMode.filters.filter((group) => group.id === 'courses')
    : activeMode.filters;

  const renderOption = (groupId: string, option: typeof activeMode.filters[number]['options'][number]) => {
    const color = groupId === 'courses'
      ? getStoredCourseChipColor(option.label) ?? option.color
      : option.color;

    return (
      <Label className="flex items-center gap-2 text-sm font-bold text-muted-foreground" key={option.id}>
        <Checkbox defaultChecked={option.defaultChecked} />
        <span className={cn('h-2.5 w-2.5 rounded-full', dotColorClasses[color])} />
        <span>{translateItemLabel(option.id, option.label)}</span>
      </Label>
    );
  };
  const renderCourseOption = (option: NonNullable<FilterPanelProps['courseOptions']>[number]) => (
    <Label className="flex items-center gap-2 text-sm font-bold text-muted-foreground" key={option.id}>
      <Checkbox
        checked={option.checked}
        onCheckedChange={() => onToggleCourseOption?.(option.id)}
      />
      <span className={cn('h-2.5 w-2.5 rounded-full', dotColorClasses[option.color])} />
      <span className="truncate">{option.label}</span>
    </Label>
  );

  const content = (
    <div className="space-y-5">
      {filterGroups.map((group) => (
        <div key={group.id}>
          <div className="mb-2 text-[11px] font-black uppercase text-muted-foreground">
            {translateItemLabel(group.id, group.label)}
          </div>
          {variant === 'menu' && activeMode.id === 'academy' && group.id === 'courses' && semesterLabel ? (
            <div className="rounded-lg border bg-muted/25 p-2">
              <div className="mb-2 px-1 text-[11px] font-black text-foreground">
                {semesterLabel}
              </div>
              <div className="space-y-2">
                {(courseOptions && courseOptions.length > 0
                  ? courseOptions.map(renderCourseOption)
                  : group.options.map((option) => renderOption(group.id, option)))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {group.options.map((option) => renderOption(group.id, option))}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  if (variant === 'menu') {
    return (
      <div
        aria-label={`${activeMode.displayName} filters`}
        className={cn('min-w-56 p-2', className)}
      >
        {content}
      </div>
    );
  }

  return (
    <Card
      className={cn('rounded-xl bg-muted/25 shadow-none', className)}
      aria-label={`${activeMode.displayName} filters`}
    >
      <CardContent className="p-4">
        {content}
      </CardContent>
    </Card>
  );
}
