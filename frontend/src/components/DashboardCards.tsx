import {
  BookOpen,
  CalendarPlus,
  ChevronDown,
  ExternalLink,
  EyeOff,
  Pencil,
  Plus,
  RefreshCw,
  Star,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { workspaceApi, type CanvasCourse } from '../api/workspaceApi';
import { useLanguage } from '../context/LanguageContext';
import { useWorkspaceMode } from '../context/WorkspaceModeContext';
import type { ColorToken, DashboardCardConfig } from '../modes/types';
import { cn } from '../lib/utils';
import { dotColorClasses } from '../lib/colorStyles';
import { EventPill } from './EventPill';
import { GoogleProductIcon, type GoogleProduct } from './GoogleProductIcon';
import {
  ManualLectureDialog,
  type ManualLecture,
  type ManualLectureClassType,
  type ManualLectureScheduleEntry,
} from './ManualLectureDialog';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Input } from './ui/input';
import { Label } from './ui/label';

type DashboardRow = DashboardCardConfig['rows'][number];
type LectureRowSource = 'manual' | 'canvas';
type RenderableDashboardRow = DashboardRow & {
  canvasCourseId?: string;
  chipColor?: ColorToken;
  courseName?: string;
  friendlyCourseCode?: string;
  friendlyName?: string;
  isStarred?: boolean;
  lectureKey?: string;
  lectureSource?: LectureRowSource;
  manualLectureId?: string;
  originalCourseCode?: string;
};
type RenderableDashboardCard = Omit<DashboardCardConfig, 'rows'> & {
  rows: RenderableDashboardRow[];
};
type CanvasCourseLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';
type CanvasLecturePreferences = Record<string, {
  chipColor?: ColorToken;
  friendlyCourseCode?: string;
  friendlyName?: string;
  hidden?: boolean;
  originalCourseCode?: string;
  starred?: boolean;
}>;

const manualLecturesStorageKey = 'incos-academy-manual-lectures';
const canvasLecturePreferencesStorageKey = 'incos-academy-canvas-lecture-preferences';
const lectureChipColors: ColorToken[] = ['green', 'blue', 'teal', 'purple', 'orange', 'gold', 'red', 'gray'];

function createCanvasLectureRows(
  courses: CanvasCourse[],
  preferences: CanvasLecturePreferences,
): RenderableDashboardRow[] {
  return courses
    .filter((course) => !preferences[course.id]?.hidden)
    .sort((firstCourse, secondCourse) => (
      Number(Boolean(preferences[secondCourse.id]?.starred)) -
      Number(Boolean(preferences[firstCourse.id]?.starred))
    ))
    .map((course) => {
      const coursePreferences = preferences[course.id] ?? {};
      const originalCourseCode = course.courseCode?.trim() || course.id;

      return {
        id: course.id,
        label: coursePreferences.friendlyCourseCode?.trim() || originalCourseCode,
        value: coursePreferences.friendlyName?.trim() || course.name,
        canvasCourseId: course.id,
        chipColor: coursePreferences.chipColor ?? 'green',
        courseName: course.name,
        friendlyCourseCode: coursePreferences.friendlyCourseCode,
        friendlyName: coursePreferences.friendlyName,
        isStarred: Boolean(coursePreferences.starred),
        lectureKey: `canvas:${course.id}`,
        lectureSource: 'canvas',
        originalCourseCode: coursePreferences.originalCourseCode?.trim() || originalCourseCode,
      };
    });
}

function createLoadingRows(label: string): RenderableDashboardRow[] {
  return [{ id: 'loading', label: '', value: label }];
}

function createMessageRows(message: string): RenderableDashboardRow[] {
  return [{ id: 'message', label: '', value: message }];
}

function getVisibleManualLectures(lectures: ManualLecture[]) {
  return lectures
    .filter((lecture) => !lecture.hidden)
    .sort((firstLecture, secondLecture) => Number(Boolean(secondLecture.starred)) - Number(Boolean(firstLecture.starred)));
}

function getManualLectureScheduleEntries(lecture: ManualLecture): ManualLectureScheduleEntry[] {
  if (Array.isArray(lecture.schedule?.entries) && lecture.schedule.entries.length > 0) {
    return lecture.schedule.entries;
  }

  if (lecture.schedule?.day || lecture.schedule?.time || lecture.schedule?.location) {
    return [{
      id: `${lecture.id}-legacy-schedule`,
      classType: 'lecture',
      deliveryMode: lecture.schedule.deliveryMode ?? 'inPerson',
      day: lecture.schedule.day ?? '',
      time: lecture.schedule.time ?? '',
      location: lecture.schedule.location ?? '',
    }];
  }

  return [];
}

function formatClassType(classType: ManualLectureClassType) {
  return classType.charAt(0).toUpperCase() + classType.slice(1);
}

function createManualLectureRows(lectures: ManualLecture[]): RenderableDashboardRow[] {
  return lectures.map((lecture) => {
    const sections = [
      lecture.lectureSection ? `Lec ${lecture.lectureSection}` : '',
      lecture.labSection ? `Lab ${lecture.labSection}` : '',
      lecture.tutorialSection ? `Tut ${lecture.tutorialSection}` : '',
    ].filter(Boolean);
    const schedule = getManualLectureScheduleEntries(lecture)
      .slice(0, 2)
      .map((entry) => [
        formatClassType(entry.classType),
        entry.deliveryMode === 'online' ? 'Online' : '',
        entry.day,
        entry.time,
        entry.location,
      ].filter(Boolean).join(' '))
      .join(' · ');

    return {
      id: lecture.id,
      label: lecture.friendlyCourseCode || lecture.code || 'Manual',
      value: [
        sections.length > 0
          ? `${lecture.friendlyName || lecture.name} · ${sections.join(' · ')}`
          : lecture.friendlyName || lecture.name,
        schedule,
      ].filter(Boolean).join(' · '),
      chipColor: lecture.chipColor ?? 'green',
      courseName: lecture.name,
      friendlyCourseCode: lecture.friendlyCourseCode,
      friendlyName: lecture.friendlyName,
      isStarred: Boolean(lecture.starred),
      lectureKey: `manual:${lecture.id}`,
      lectureSource: 'manual',
      manualLectureId: lecture.id,
      originalCourseCode: lecture.code || 'Manual',
    };
  });
}

function getStoredManualLectures(): ManualLecture[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const storedLectures = window.localStorage.getItem(manualLecturesStorageKey);
    const parsedLectures = storedLectures ? JSON.parse(storedLectures) : [];

    return Array.isArray(parsedLectures) ? parsedLectures as ManualLecture[] : [];
  } catch {
    return [];
  }
}

function storeManualLectures(lectures: ManualLecture[]) {
  window.localStorage.setItem(manualLecturesStorageKey, JSON.stringify(lectures));
}

function getStoredCanvasLecturePreferences(): CanvasLecturePreferences {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const storedPreferences = window.localStorage.getItem(canvasLecturePreferencesStorageKey);
    const parsedPreferences = storedPreferences ? JSON.parse(storedPreferences) : {};

    return parsedPreferences && typeof parsedPreferences === 'object'
      ? parsedPreferences as CanvasLecturePreferences
      : {};
  } catch {
    return {};
  }
}

function storeCanvasLecturePreferences(preferences: CanvasLecturePreferences) {
  window.localStorage.setItem(canvasLecturePreferencesStorageKey, JSON.stringify(preferences));
}

function BrandIcon({ source }: { source: DashboardRow['source'] }) {
  if (source && ['gmail', 'chat', 'meet', 'docs', 'sheets', 'slides'].includes(source)) {
    return <GoogleProductIcon product={source as GoogleProduct} size={16} />;
  }

  const fallback =
    source === 'teams'
      ? { color: '#6264A7', label: 'T' }
      : source === 'zoom'
        ? { color: '#0B5CFF', label: 'Z' }
        : { color: '#4285F4', label: 'D' };

  return (
    <span
      aria-hidden="true"
      className="inline-grid size-4 place-items-center rounded-[4px] text-[9px] font-black leading-none text-white"
      style={{ backgroundColor: fallback.color }}
    >
      {fallback.label}
    </span>
  );
}

interface DashboardRowsProps {
  card: RenderableDashboardCard;
  onHideLecture: (row: RenderableDashboardRow) => void;
  onOpenLecture: (row: RenderableDashboardRow) => void;
  onOpenLectureFriendlyName: (row: RenderableDashboardRow) => void;
  onSetLectureChipColor: (row: RenderableDashboardRow, color: ColorToken) => void;
  onToggleLectureStar: (row: RenderableDashboardRow) => void;
}

function DashboardRows({
  card,
  onHideLecture,
  onOpenLecture,
  onOpenLectureFriendlyName,
  onSetLectureChipColor,
  onToggleLectureStar,
}: DashboardRowsProps) {
  const { dictionary } = useLanguage();
  const rows = card.rows.slice(0, card.maxRows ?? card.rows.length);
  const chipColorLabels: Record<ColorToken, string> = {
    blue: dictionary.manualLectureChipColorBlue,
    green: dictionary.manualLectureChipColorGreen,
    orange: dictionary.manualLectureChipColorOrange,
    red: dictionary.manualLectureChipColorRed,
    purple: dictionary.manualLectureChipColorPurple,
    teal: dictionary.manualLectureChipColorTeal,
    gold: dictionary.manualLectureChipColorGold,
    gray: dictionary.manualLectureChipColorGray,
  };
  const renderLectureContextMenu = (row: RenderableDashboardRow, trigger: ReactElement) => {
    if (!row.lectureKey) {
      return trigger;
    }

    return (
      <ContextMenu key={`${card.id}-${row.lectureKey}`}>
        <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel>{row.label}</ContextMenuLabel>
          <ContextMenuItem onSelect={() => onOpenLecture(row)}>
            <BookOpen className="size-4" />
            <span>{dictionary.manualLectureOpenDetails}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onOpenLectureFriendlyName(row)}>
            <Pencil className="size-4" />
            <span>{dictionary.courseFriendlyNameSet}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onToggleLectureStar(row)}>
            <Star className={cn('size-4', row.isStarred && 'fill-amber-400 text-amber-500')} />
            <span>{row.isStarred ? dictionary.manualLectureUnstar : dictionary.manualLectureStar}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onHideLecture(row)}>
            <EyeOff className="size-4" />
            <span>{dictionary.manualLectureHide}</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuLabel>{dictionary.manualLectureChipColor}</ContextMenuLabel>
          {lectureChipColors.map((color) => (
            <ContextMenuItem
              disabled={row.chipColor === color}
              key={color}
              onSelect={() => onSetLectureChipColor(row, color)}
            >
              <span
                aria-hidden="true"
                className={cn('size-3 rounded-full border border-foreground/10', dotColorClasses[color])}
              />
              <span>{chipColorLabels[color]}</span>
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  if (card.id === 'upcoming-coursework' || card.id === 'upcoming-assessments') {
    return rows.map((row) => (
      <div
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t py-2 text-sm first:border-t-0"
        key={`${card.id}-${row.label}-${row.value}`}
      >
        <EventPill className="h-6 px-2 text-xs" color={card.color} compact label={row.label} />
        <strong className="min-w-0 truncate">{row.value}</strong>
        {row.description ? (
          <EventPill className="h-6 max-w-36 px-2 text-xs" color="gray" compact label={row.description} />
        ) : null}
      </div>
    ));
  }

  if (card.layout === 'agenda') {
    return rows.map((row) => {
      const rowElement = (
        <div
          className={cn(
            'flex min-w-0 items-center gap-3 border-t py-2 text-sm first:border-t-0',
            row.lectureKey && 'rounded-md px-1 transition-colors hover:bg-muted/45',
          )}
          key={`${card.id}-${row.label}-${row.value}`}
        >
          {row.label ? (
            <EventPill
              className="h-6 px-2 text-xs"
              color={row.chipColor ?? card.color}
              compact
              label={row.label}
            />
          ) : (
            <RefreshCw className="size-4 shrink-0 animate-spin text-muted-foreground" />
          )}
          <strong className="min-w-0 flex-1 truncate">{row.value}</strong>
          {row.isStarred ? (
            <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500" />
          ) : null}
        </div>
      );

      return renderLectureContextMenu(row, rowElement);
    });
  }

  if (card.layout === 'messages') {
    return rows.map((row) => (
      <div
        className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)_34px] items-center gap-2 border-t py-2 text-sm first:border-t-0"
        key={`${card.id}-${row.label}-${row.value}`}
      >
        <span className="grid size-7 place-items-center rounded-lg bg-muted">
          <BrandIcon source={row.source} />
        </span>
        <div className="min-w-0">
          <strong className="block truncate leading-tight">{row.value}</strong>
          <span className="block truncate text-xs font-bold text-muted-foreground">
            {row.description}
          </span>
        </div>
        <span className="justify-self-end text-xs font-black text-muted-foreground">{row.label}</span>
      </div>
    ));
  }

  if (card.layout === 'meetings') {
    return rows.map((row) => {
      const content = (
        <>
          <EventPill className="h-6 px-2 text-xs" color={card.color} compact label={row.label} />
          <div className="min-w-0 flex-1">
            <strong className="block truncate leading-tight">{row.value}</strong>
            <span className="block truncate text-xs font-bold text-muted-foreground">
              {row.description}
            </span>
          </div>
          <BrandIcon source={row.source} />
        </>
      );

      return row.href ? (
        <a
          className="flex min-w-0 items-center gap-3 border-t py-2 text-sm transition hover:bg-muted/45 first:border-t-0"
          href={row.href}
          key={`${card.id}-${row.label}-${row.value}`}
          rel="noreferrer"
          target="_blank"
          title={row.description ? `${row.value} - ${row.description}` : row.value}
        >
          {content}
        </a>
      ) : (
        <div
          className="flex min-w-0 items-center gap-3 border-t py-2 text-sm first:border-t-0"
          key={`${card.id}-${row.label}-${row.value}`}
          title={row.value}
        >
          {content}
        </div>
      );
    });
  }

  return rows.map((row) => (
    <div
      className="flex items-center justify-between gap-3 border-t py-2 text-sm first:border-t-0"
      key={`${card.id}-${row.label}`}
    >
      <span className="text-muted-foreground">{row.label}</span>
      <strong className="text-right">{row.value}</strong>
    </div>
  ));
}

interface ManualLectureDetailsDialogProps {
  lecture?: ManualLecture;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

function ManualLectureDetailsDialog({
  lecture,
  onOpenChange,
  open,
}: ManualLectureDetailsDialogProps) {
  const { dictionary } = useLanguage();

  if (!lecture) {
    return null;
  }

  const enabledAssessments = (lecture.assessments ?? []).filter((assessment) => assessment.enabled);
  const assessmentTotal = enabledAssessments.reduce(
    (total, assessment) => total + (Number.parseFloat(assessment.gradePortion) || 0),
    0,
  );
  const formattedAssessmentTotal = Number.isInteger(assessmentTotal)
    ? assessmentTotal.toString()
    : assessmentTotal.toFixed(1);
  const scheduleEntries = getManualLectureScheduleEntries(lecture);
  const classTypeLabels: Record<ManualLectureClassType, string> = {
    lecture: dictionary.manualLectureClassTypeLecture,
    lab: dictionary.manualLectureClassTypeLab,
    tutorial: dictionary.manualLectureClassTypeTutorial,
    seminar: dictionary.manualLectureClassTypeSeminar,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-auto rounded-xl p-5 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-2xl font-black">
            <EventPill color={lecture.chipColor ?? 'green'} label={lecture.friendlyCourseCode || lecture.code || 'Manual'} />
            {lecture.friendlyName || lecture.name}
          </DialogTitle>
          <DialogDescription>
            {[lecture.lectureSection, lecture.labSection, lecture.tutorialSection]
              .filter(Boolean)
              .join(' · ') || dictionary.notSet}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <section className="grid gap-2 rounded-lg border p-3">
            <h3 className="text-sm font-black">{dictionary.manualLectureSchedule}</h3>
            <div className="grid gap-2">
              {scheduleEntries.length > 0 ? scheduleEntries.map((entry) => (
                <div
                  className="grid gap-2 rounded-md bg-muted/45 p-2 text-sm sm:grid-cols-[120px_100px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
                  key={entry.id}
                >
                  <strong>{classTypeLabels[entry.classType]}</strong>
                  <span className="font-bold text-muted-foreground">
                    {entry.deliveryMode === 'online' ? dictionary.manualLectureOnline : dictionary.manualLectureInPerson}
                  </span>
                  <span>{entry.day || dictionary.notSet}</span>
                  <span>{entry.time || dictionary.notSet}</span>
                  <span className="min-w-0 truncate">{entry.location || dictionary.notSet}</span>
                </div>
              )) : (
                <div className="rounded-md bg-muted/45 p-2 text-sm font-bold text-muted-foreground">
                  {dictionary.notSet}
                </div>
              )}
            </div>
          </section>

          <section className="grid gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black">{dictionary.manualLectureAssessments}</h3>
              <div className="rounded-md border bg-background px-2 py-1 text-xs font-black">
                {dictionary.manualLectureAssessmentTotal}: {formattedAssessmentTotal}%
              </div>
            </div>
            <div className="grid gap-2">
              {enabledAssessments.length > 0 ? enabledAssessments.map((assessment) => (
                <div
                  className="grid gap-2 rounded-md bg-muted/45 p-2 text-sm sm:grid-cols-[minmax(0,1fr)_80px_80px]"
                  key={assessment.id}
                >
                  <strong className="min-w-0 truncate">{assessment.label}</strong>
                  <span className="font-bold text-muted-foreground">
                    {assessment.count ? `${assessment.count}x` : dictionary.notSet}
                  </span>
                  <span className="font-black">{assessment.gradePortion || 0}%</span>
                  {assessment.details ? (
                    <span className="min-w-0 text-muted-foreground sm:col-span-3">{assessment.details}</span>
                  ) : null}
                </div>
              )) : (
                <div className="rounded-md bg-muted/45 p-2 text-sm font-bold text-muted-foreground">
                  {dictionary.notSet}
                </div>
              )}
            </div>
          </section>

          <section className="grid gap-2 rounded-lg border p-3">
            <h3 className="text-sm font-black">{dictionary.manualLectureLinks}</h3>
            <div className="grid gap-2">
              {(lecture.links ?? []).length > 0 ? (lecture.links ?? []).map((link) => (
                <a
                  className="flex min-w-0 items-center gap-2 rounded-md bg-muted/45 p-2 text-sm font-bold transition hover:bg-muted"
                  href={link.url}
                  key={link.id}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{link.label}</span>
                </a>
              )) : (
                <div className="rounded-md bg-muted/45 p-2 text-sm font-bold text-muted-foreground">
                  {dictionary.noLinks}
                </div>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface CanvasLectureDetailsDialogProps {
  course?: CanvasCourse;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  preference?: CanvasLecturePreferences[string];
}

function CanvasLectureDetailsDialog({
  course,
  onOpenChange,
  open,
  preference,
}: CanvasLectureDetailsDialogProps) {
  const { dictionary } = useLanguage();

  if (!course) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl p-5 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-2xl font-black">
            <EventPill
              color={preference?.chipColor ?? 'green'}
              label={preference?.friendlyCourseCode?.trim() || course.courseCode?.trim() || course.id}
            />
            {preference?.friendlyName?.trim() || course.name}
          </DialogTitle>
          <DialogDescription>{dictionary.canvasCourseSource}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 rounded-lg border p-3">
          <div className="text-[11px] font-black uppercase text-muted-foreground">
            {dictionary.canvasCourseId}
          </div>
          <div className="break-all text-sm font-bold">{course.id}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface CourseFriendlyNameDialogProps {
  friendlyCourseCode: string;
  friendlyName: string;
  onFriendlyCourseCodeChange: (value: string) => void;
  onFriendlyNameChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  open: boolean;
  row?: RenderableDashboardRow | null;
}

function CourseFriendlyNameDialog({
  friendlyCourseCode,
  friendlyName,
  onFriendlyCourseCodeChange,
  onFriendlyNameChange,
  onOpenChange,
  onSave,
  open,
  row,
}: CourseFriendlyNameDialogProps) {
  const { dictionary } = useLanguage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl p-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black">{dictionary.courseFriendlyNameTitle}</DialogTitle>
          <DialogDescription>{dictionary.courseFriendlyNameDescription}</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase text-muted-foreground">
              {dictionary.courseFriendlyNameOriginalCourseCode}
            </Label>
            <div className="rounded-md border bg-muted/45 px-3 py-2 text-sm font-black">
              {row?.originalCourseCode || dictionary.notSet}
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="course-friendly-code">
              {dictionary.courseFriendlyNameFriendlyCourseCode}
            </Label>
            <Input
              autoFocus
              id="course-friendly-code"
              onChange={(event) => onFriendlyCourseCodeChange(event.target.value)}
              placeholder="CMPT276"
              value={friendlyCourseCode}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="course-friendly-name">
              {dictionary.courseFriendlyNameFriendlyName}
            </Label>
            <Input
              id="course-friendly-name"
              onChange={(event) => onFriendlyNameChange(event.target.value)}
              placeholder={row?.courseName || 'Software Engineering'}
              value={friendlyName}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              {dictionary.cancel}
            </Button>
            <Button type="submit">{dictionary.courseFriendlyNameSave}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DashboardCardsProps {
  onOpenAddItem?: () => void;
  onPlanMeeting?: () => void;
  onStartMeetingNow?: () => void;
  onWriteInPersonMeetingReport?: () => void;
}

export function DashboardCards({
  onOpenAddItem,
  onPlanMeeting,
  onStartMeetingNow,
  onWriteInPersonMeetingReport,
}: DashboardCardsProps) {
  const { activeMode } = useWorkspaceMode();
  const { dictionary, translateDashboardCard, translateModeName } = useLanguage();
  const [isRefreshingMessages, setIsRefreshingMessages] = useState(false);
  const [canvasCourses, setCanvasCourses] = useState<CanvasCourse[] | null>(null);
  const [canvasCourseLoadStatus, setCanvasCourseLoadStatus] = useState<CanvasCourseLoadStatus>('idle');
  const [canvasTermName, setCanvasTermName] = useState<string | undefined>();
  const [isManualLectureDialogOpen, setIsManualLectureDialogOpen] = useState(false);
  const [manualLectures, setManualLectures] = useState<ManualLecture[]>(getStoredManualLectures);
  const [canvasLecturePreferences, setCanvasLecturePreferences] = useState<CanvasLecturePreferences>(
    getStoredCanvasLecturePreferences,
  );
  const [selectedManualLectureId, setSelectedManualLectureId] = useState<string | null>(null);
  const [selectedCanvasCourseId, setSelectedCanvasCourseId] = useState<string | null>(null);
  const [friendlyNameRow, setFriendlyNameRow] = useState<RenderableDashboardRow | null>(null);
  const [friendlyCourseCodeInput, setFriendlyCourseCodeInput] = useState('');
  const [friendlyNameInput, setFriendlyNameInput] = useState('');
  const refreshTimeoutRef = useRef<number | null>(null);
  const selectedManualLecture = selectedManualLectureId
    ? manualLectures.find((lecture) => lecture.id === selectedManualLectureId)
    : undefined;
  const selectedCanvasCourse = selectedCanvasCourseId
    ? canvasCourses?.find((course) => course.id === selectedCanvasCourseId)
    : undefined;
  const dashboardCards: RenderableDashboardCard[] = activeMode.dashboardCards.map((card) => {
    const translatedCard = translateDashboardCard(activeMode.id, card);
    const maxRows = translatedCard.maxRows ?? 5;

    if (
      activeMode.id === 'academy' &&
      translatedCard.id === 'semester-lectures' &&
      (canvasCourseLoadStatus === 'idle' || canvasCourseLoadStatus === 'loading')
    ) {
      return {
        ...translatedCard,
        rows: createLoadingRows(dictionary.canvasCoursesLoading),
      };
    }

    if (activeMode.id === 'academy' && translatedCard.id === 'semester-lectures') {
      const visibleManualLectures = getVisibleManualLectures(manualLectures);
      const starredManualRows = createManualLectureRows(
        visibleManualLectures.filter((lecture) => lecture.starred),
      );
      const regularManualRows = createManualLectureRows(
        visibleManualLectures.filter((lecture) => !lecture.starred),
      );
      const manualLectureRows = [...starredManualRows, ...regularManualRows];
      const canvasLectureRows = canvasCourses
        ? createCanvasLectureRows(canvasCourses, canvasLecturePreferences)
        : [];
      const starredCanvasRows = canvasLectureRows.filter((row) => row.isStarred);
      const regularCanvasRows = canvasLectureRows.filter((row) => !row.isStarred);

      if (canvasCourseLoadStatus === 'failed') {
        return {
          ...translatedCard,
          rows: manualLectureRows.length > 0
            ? manualLectureRows.slice(0, maxRows)
            : createMessageRows(dictionary.canvasCoursesUnavailable),
        };
      }

      if (!canvasCourses || canvasCourses.length === 0) {
        return {
          ...translatedCard,
          rows: manualLectureRows.length > 0
            ? manualLectureRows.slice(0, maxRows)
            : createMessageRows(dictionary.canvasCoursesEmpty),
        };
      }

      return {
        ...translatedCard,
        pill: canvasTermName ?? translatedCard.pill,
        rows: [
          ...starredManualRows,
          ...starredCanvasRows,
          ...regularCanvasRows,
          ...regularManualRows,
        ].slice(0, maxRows),
      };
    }

    return translatedCard;
  });

  useEffect(
    () => () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let isCancelled = false;

    if (activeMode.id !== 'academy') {
      setCanvasCourses(null);
      setCanvasCourseLoadStatus('idle');
      setCanvasTermName(undefined);
      return undefined;
    }

    setCanvasCourseLoadStatus('loading');
    workspaceApi
      .getCanvasCourses(5)
      .then(({ courses, termName }) => {
        if (isCancelled) {
          return;
        }

        setCanvasCourses(courses);
        setCanvasTermName(termName);
        setCanvasCourseLoadStatus('loaded');
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setCanvasCourses(null);
        setCanvasTermName(undefined);
        setCanvasCourseLoadStatus('failed');
      });

    return () => {
      isCancelled = true;
    };
  }, [activeMode.id]);

  const updateStoredManualLectures = (updater: (lectures: ManualLecture[]) => ManualLecture[]) => {
    setManualLectures((currentLectures) => {
      const nextLectures = updater(currentLectures);

      storeManualLectures(nextLectures);

      return nextLectures;
    });
  };

  const updateStoredCanvasLecturePreferences = (
    updater: (preferences: CanvasLecturePreferences) => CanvasLecturePreferences,
  ) => {
    setCanvasLecturePreferences((currentPreferences) => {
      const nextPreferences = updater(currentPreferences);

      storeCanvasLecturePreferences(nextPreferences);

      return nextPreferences;
    });
  };

  const handleAddManualLecture = (lecture: ManualLecture) => {
    updateStoredManualLectures((currentLectures) => [...currentLectures, lecture]);
  };

  const handleOpenLecture = (row: RenderableDashboardRow) => {
    if (row.lectureSource === 'canvas' && row.canvasCourseId) {
      setSelectedCanvasCourseId(row.canvasCourseId);
      return;
    }

    if (row.manualLectureId) {
      setSelectedManualLectureId(row.manualLectureId);
    }
  };

  const handleOpenLectureFriendlyName = (row: RenderableDashboardRow) => {
    setFriendlyNameRow(row);
    setFriendlyCourseCodeInput(row.friendlyCourseCode ?? row.originalCourseCode ?? row.label);
    setFriendlyNameInput(row.friendlyName ?? '');
  };

  const handleSaveLectureFriendlyName = () => {
    if (!friendlyNameRow) {
      return;
    }

    const friendlyName = friendlyNameInput.trim();
    const friendlyCourseCode = friendlyCourseCodeInput.trim();

    if (friendlyNameRow.lectureSource === 'canvas' && friendlyNameRow.canvasCourseId) {
      updateStoredCanvasLecturePreferences((currentPreferences) => ({
        ...currentPreferences,
        [friendlyNameRow.canvasCourseId!]: {
          ...(currentPreferences[friendlyNameRow.canvasCourseId!] ?? {}),
          friendlyCourseCode: friendlyCourseCode || undefined,
          friendlyName: friendlyName || undefined,
          originalCourseCode: friendlyNameRow.originalCourseCode,
        },
      }));
    } else if (friendlyNameRow.manualLectureId) {
      updateStoredManualLectures((currentLectures) => currentLectures.map((lecture) => (
        lecture.id === friendlyNameRow.manualLectureId
          ? {
              ...lecture,
              friendlyCourseCode: friendlyCourseCode || undefined,
              friendlyName: friendlyName || undefined,
            }
          : lecture
      )));
    }

    setFriendlyNameRow(null);
    setFriendlyCourseCodeInput('');
    setFriendlyNameInput('');
  };

  const handleToggleLectureStar = (row: RenderableDashboardRow) => {
    if (row.lectureSource === 'canvas' && row.canvasCourseId) {
      updateStoredCanvasLecturePreferences((currentPreferences) => {
        const currentCoursePreferences = currentPreferences[row.canvasCourseId!] ?? {};

        return {
          ...currentPreferences,
          [row.canvasCourseId!]: {
            ...currentCoursePreferences,
            starred: !currentCoursePreferences.starred,
          },
        };
      });
      return;
    }

    if (!row.manualLectureId) {
      return;
    }

    updateStoredManualLectures((currentLectures) => currentLectures.map((lecture) => (
      lecture.id === row.manualLectureId
        ? { ...lecture, starred: !lecture.starred }
        : lecture
    )));
  };

  const handleHideLecture = (row: RenderableDashboardRow) => {
    if (row.lectureSource === 'canvas' && row.canvasCourseId) {
      updateStoredCanvasLecturePreferences((currentPreferences) => ({
        ...currentPreferences,
        [row.canvasCourseId!]: {
          ...(currentPreferences[row.canvasCourseId!] ?? {}),
          hidden: true,
        },
      }));
      return;
    }

    if (!row.manualLectureId) {
      return;
    }

    updateStoredManualLectures((currentLectures) => currentLectures.map((lecture) => (
      lecture.id === row.manualLectureId
        ? { ...lecture, hidden: true }
        : lecture
    )));
  };

  const handleSetLectureChipColor = (row: RenderableDashboardRow, color: ColorToken) => {
    if (row.lectureSource === 'canvas' && row.canvasCourseId) {
      updateStoredCanvasLecturePreferences((currentPreferences) => ({
        ...currentPreferences,
        [row.canvasCourseId!]: {
          ...(currentPreferences[row.canvasCourseId!] ?? {}),
          chipColor: color,
          originalCourseCode: row.originalCourseCode,
        },
      }));
      return;
    }

    if (!row.manualLectureId) {
      return;
    }

    updateStoredManualLectures((currentLectures) => currentLectures.map((lecture) => (
      lecture.id === row.manualLectureId
        ? { ...lecture, chipColor: color }
        : lecture
    )));
  };

  const handleRefreshMessages = () => {
    setIsRefreshingMessages(true);

    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      setIsRefreshingMessages(false);
      refreshTimeoutRef.current = null;
    }, 700);
  };

  const renderCardAction = (card: DashboardCardConfig) => {
    if (card.id === 'agenda') {
      return (
        <Button
          aria-label={dictionary.dashboardAddAgenda}
          className="size-7 border-border bg-background/70 text-muted-foreground hover:text-foreground"
          onClick={onOpenAddItem}
          size="icon-sm"
          title={dictionary.dashboardAddAgenda}
          type="button"
          variant="outline"
        >
          <Plus className="size-3.5" />
        </Button>
      );
    }

    if (card.id === 'semester-lectures') {
      return (
        <Button
          aria-label={dictionary.manualLectureAdd}
          className="size-7 border-border bg-background/70 text-muted-foreground hover:text-foreground"
          onClick={() => setIsManualLectureDialogOpen(true)}
          size="icon-sm"
          title={dictionary.manualLectureAdd}
          type="button"
          variant="outline"
        >
          <Plus className="size-3.5" />
        </Button>
      );
    }

    if (card.id === 'messages') {
      return (
        <Button
          aria-label={dictionary.dashboardRefreshMessages}
          className="size-7 border-border bg-background/70 text-muted-foreground hover:text-foreground"
          onClick={handleRefreshMessages}
          size="icon-sm"
          title={dictionary.dashboardRefreshMessages}
          type="button"
          variant="outline"
        >
          <RefreshCw className={cn('size-3.5', isRefreshingMessages && 'animate-spin')} />
        </Button>
      );
    }

    if (card.id === 'meetings') {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={dictionary.dashboardAddMeeting}
              className="h-7 gap-1 rounded-md border-border bg-background/70 px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              size="sm"
              title={dictionary.dashboardAddMeeting}
              type="button"
              variant="outline"
            >
              <GoogleProductIcon decorative product="meet" size={15} />
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem
              onSelect={() => {
                onStartMeetingNow?.();
              }}
            >
              <GoogleProductIcon decorative product="meet" size={16} />
              <span>{dictionary.dashboardStartMeetingNow}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onPlanMeeting?.();
              }}
            >
              <CalendarPlus className="size-4" />
              <span>{dictionary.dashboardPlanMeeting}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onWriteInPersonMeetingReport?.();
              }}
            >
              <GoogleProductIcon decorative product="docs" size={16} />
              <span>{dictionary.dashboardWriteMeetingReport}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    return null;
  };

  return (
    <>
      <section
        className="grid gap-3 xl:grid-cols-3"
        aria-label={`${translateModeName(activeMode.id, activeMode.displayName)} dashboard summary`}
      >
        {dashboardCards.map((card) => {
          const cardAction = renderCardAction(card);

          return (
            <Card className="rounded-xl bg-card shadow-none" key={card.id}>
              <CardHeader className="gap-2 pb-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  {card.kicker ? (
                    <div className="text-[11px] font-black uppercase text-muted-foreground">
                      {card.kicker}
                    </div>
                  ) : null}
                  <div
                    className={cn(
                      'flex min-w-0 items-center gap-2',
                      card.kicker ? 'justify-end' : 'w-full justify-between',
                    )}
                  >
                    <CardTitle
                      className={cn(
                        'min-w-0 truncate text-base font-black leading-tight',
                        card.kicker ? 'text-right' : 'text-left',
                      )}
                    >
                      {card.title}
                    </CardTitle>
                    {!card.kicker && (card.pill || cardAction) ? (
                      <div className="flex shrink-0 items-center gap-1.5">
                        {card.pill ? <EventPill color={card.color} label={card.pill} /> : null}
                        {cardAction}
                      </div>
                    ) : null}
                    {card.kicker ? cardAction : null}
                  </div>
                </div>
                {card.kicker && card.pill ? (
                  <div>
                    <EventPill color={card.color} label={card.pill} />
                  </div>
                ) : null}
              </CardHeader>
              <CardContent>
                <DashboardRows
                  card={card}
                  onHideLecture={handleHideLecture}
                  onOpenLecture={handleOpenLecture}
                  onOpenLectureFriendlyName={handleOpenLectureFriendlyName}
                  onSetLectureChipColor={handleSetLectureChipColor}
                  onToggleLectureStar={handleToggleLectureStar}
                />
              </CardContent>
            </Card>
          );
        })}
      </section>
      <ManualLectureDialog
        onAddLecture={handleAddManualLecture}
        onOpenChange={setIsManualLectureDialogOpen}
        open={isManualLectureDialogOpen}
      />
      <ManualLectureDetailsDialog
        lecture={selectedManualLecture}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedManualLectureId(null);
          }
        }}
        open={Boolean(selectedManualLecture)}
      />
      <CanvasLectureDetailsDialog
        course={selectedCanvasCourse}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setSelectedCanvasCourseId(null);
          }
        }}
        open={Boolean(selectedCanvasCourse)}
        preference={selectedCanvasCourseId ? canvasLecturePreferences[selectedCanvasCourseId] : undefined}
      />
      <CourseFriendlyNameDialog
        friendlyCourseCode={friendlyCourseCodeInput}
        friendlyName={friendlyNameInput}
        onFriendlyCourseCodeChange={setFriendlyCourseCodeInput}
        onFriendlyNameChange={setFriendlyNameInput}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setFriendlyNameRow(null);
            setFriendlyCourseCodeInput('');
            setFriendlyNameInput('');
          }
        }}
        onSave={handleSaveLectureFriendlyName}
        open={Boolean(friendlyNameRow)}
        row={friendlyNameRow}
      />
    </>
  );
}
