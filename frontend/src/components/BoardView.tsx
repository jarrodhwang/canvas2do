import { Check, Plus } from 'lucide-react';

import type { BoardItem } from '../data/mockWorkspaceData';
import { useLanguage } from '../context/LanguageContext';
import type { BoardColumnConfig, ColorToken } from '../modes/types';
import { dotColorClasses } from '../lib/colorStyles';
import { cn } from '../lib/utils';
import { EventPill } from './EventPill';
import { Button } from './ui/button';
import { Card } from './ui/card';

interface BoardViewProps {
  columns: BoardColumnConfig[];
  items: BoardItem[];
  onAddItem?: () => void;
  onSelectItem: () => void;
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

function isComplete(item: BoardItem) {
  const normalizedType = item.type.toLowerCase();
  const progressMatch = item.checklistProgress.match(/^(\d+)\s+of\s+(\d+)$/i);

  return normalizedType === 'done' || Boolean(progressMatch && progressMatch[1] === progressMatch[2]);
}

export function BoardView({ columns, items, onAddItem, onSelectItem }: BoardViewProps) {
  const { dictionary, translateBoardColumn } = useLanguage();

  return (
    <Card className="overflow-hidden rounded-xl bg-card shadow-none">
      <div className="grid min-h-[440px] grid-cols-4 max-xl:grid-cols-2 max-sm:grid-cols-1">
        {columns.map((column) => {
          const columnItems = items.filter((item) => item.columnId === column.id);
          const columnLabel = translateBoardColumn(column.id, column.label);
          const columnChipColor =
            getStoredCourseChipColor(column.label) ?? getStoredCourseChipColor(columnLabel) ?? column.color;

          return (
            <section className="min-w-0 border-r bg-muted/25 p-3 last:border-r-0 max-sm:border-r-0 max-sm:border-b" key={column.id}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-black">
                  <EventPill className="h-6 px-2 text-xs" color={columnChipColor} compact label={columnLabel} />
                  <EventPill color="gray" label={`${columnItems.length}`} compact />
                </h3>
                <Button
                  aria-label={dictionary.boardAddTodoItem}
                  className="size-7 shrink-0 rounded-md border-border bg-card text-muted-foreground hover:text-foreground"
                  disabled={!onAddItem}
                  onClick={onAddItem}
                  size="icon-sm"
                  title={dictionary.boardAddTodoItem}
                  type="button"
                  variant="outline"
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
              <div className="grid gap-2">
                {columnItems.map((item) => {
                  const complete = isComplete(item);

                  return (
                    <button
                      className="group flex w-full min-w-0 items-start gap-3 rounded-lg border bg-card p-2.5 text-left shadow-none transition hover:bg-muted/45"
                      key={item.id}
                      onClick={onSelectItem}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'mt-0.5 grid size-6 shrink-0 place-items-center rounded-[10px] transition-colors',
                          complete
                            ? dotColorClasses[item.color]
                            : 'bg-muted-foreground/20 group-hover:bg-muted-foreground/30',
                        )}
                      >
                        {complete ? <Check className="size-4 stroke-[3] text-white" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block whitespace-normal text-sm font-semibold leading-snug text-foreground">
                          {item.title}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          <EventPill color={item.color} label={item.type} compact />
                          <EventPill color="gray" label={item.checklistProgress} compact />
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Card>
  );
}
