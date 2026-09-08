import { useState, type FormEvent } from 'react';
import { CalendarDays, ChevronDown, ChevronRight, Link, Plus, Save, Trash2 } from 'lucide-react';

import { useLanguage } from '../context/LanguageContext';
import type { ColorToken } from '../modes/types';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Textarea } from './ui/textarea';

export interface ManualLectureAssessment {
  id: string;
  label: string;
  enabled: boolean;
  count: string;
  details: string;
  gradePortion: string;
  gradeInputMode?: ManualLectureGradeInputMode;
  gradeItems?: ManualLectureGradeItem[];
}

export type ManualLectureGradeInputMode = 'percentage' | 'points';

export interface ManualLectureGradeItem {
  id: string;
  label: string;
  percentage?: string;
  pointsEarned?: string;
  pointsPossible?: string;
}

export interface ManualLectureLink {
  id: string;
  label: string;
  url: string;
}

export type ManualLectureDeliveryMode = 'inPerson' | 'online';
export type ManualLectureClassType = 'lecture' | 'lab' | 'tutorial' | 'seminar';
export type ManualLectureRecurrence = 'weekly' | 'biweekly' | 'monthly' | 'bimonthly';
export type ManualLectureWeekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export interface ManualLectureScheduleEntry {
  id: string;
  classType: ManualLectureClassType;
  deliveryMode: ManualLectureDeliveryMode;
  day: string;
  days?: ManualLectureWeekday[];
  time: string;
  startTime?: string;
  endTime?: string;
  startDate?: string;
  endDate?: string;
  recurrence?: ManualLectureRecurrence;
  recurrenceOffset?: 0 | 1;
  location: string;
}

export interface ManualLectureSchedule {
  deliveryMode: ManualLectureDeliveryMode;
  day: string;
  time: string;
  location: string;
  entries: ManualLectureScheduleEntry[];
}

export interface ManualLecture {
  id: string;
  name: string;
  code: string;
  lectureSection: string;
  labSection: string;
  tutorialSection: string;
  credits: string;
  assessments: ManualLectureAssessment[];
  schedule: ManualLectureSchedule;
  links: ManualLectureLink[];
  friendlyCourseCode?: string;
  friendlyName?: string;
  starred?: boolean;
  hidden?: boolean;
  deleted?: boolean;
  chipColor?: ColorToken;
  canvasGradeSummary?: {
    grade?: string;
    score?: number;
  };
  semester?: string;
}

interface ManualLectureDialogProps {
  open: boolean;
  description?: string;
  initialLecture?: ManualLecture;
  onAddLecture?: (lecture: ManualLecture) => void;
  onOpenChange: (open: boolean) => void;
  onRequestDeleteLecture?: (lecture: ManualLecture) => void;
  onSaveLecture?: (lecture: ManualLecture) => void;
  selectedSemester?: string;
  semesterOptions?: string[];
  submitLabel?: string;
  title?: string;
}

type AssessmentKey =
  | 'quiz'
  | 'midterms'
  | 'finalExam'
  | 'assignment'
  | 'inClassActivity'
  | 'onlineActivity'
  | 'discussion'
  | 'lab'
  | 'tutorial'
  | 'essay'
  | 'presentation'
  | 'project'
  | 'attendanceMandatory'
  | 'officeHours';

type AssessmentLabelKey =
  | 'manualLectureAssessmentQuiz'
  | 'manualLectureAssessmentMidterms'
  | 'manualLectureAssessmentFinalExam'
  | 'manualLectureAssessmentAssignment'
  | 'manualLectureAssessmentInClassActivity'
  | 'manualLectureAssessmentOnlineActivity'
  | 'manualLectureAssessmentDiscussion'
  | 'manualLectureAssessmentLab'
  | 'manualLectureAssessmentTutorial'
  | 'manualLectureAssessmentEssay'
  | 'manualLectureAssessmentPresentation'
  | 'manualLectureAssessmentProject'
  | 'manualLectureAssessmentAttendanceMandatory'
  | 'manualLectureAssessmentOfficeHours';
type ClassTypeLabelKey =
  | 'manualLectureClassTypeLecture'
  | 'manualLectureClassTypeLab'
  | 'manualLectureClassTypeTutorial'
  | 'manualLectureClassTypeSeminar';
type RecurrenceLabelKey =
  | 'manualLectureRecurrenceWeekly'
  | 'manualLectureRecurrenceBiweekly'
  | 'manualLectureRecurrenceMonthly'
  | 'manualLectureRecurrenceBimonthly';
type WeekdayLabelKey =
  | 'manualLectureWeekdayMon'
  | 'manualLectureWeekdayTue'
  | 'manualLectureWeekdayWed'
  | 'manualLectureWeekdayThu'
  | 'manualLectureWeekdayFri'
  | 'manualLectureWeekdaySat'
  | 'manualLectureWeekdaySun';

const assessmentOptions: Array<{ id: AssessmentKey; labelKey: AssessmentLabelKey }> = [
  { id: 'quiz', labelKey: 'manualLectureAssessmentQuiz' },
  { id: 'midterms', labelKey: 'manualLectureAssessmentMidterms' },
  { id: 'finalExam', labelKey: 'manualLectureAssessmentFinalExam' },
  { id: 'assignment', labelKey: 'manualLectureAssessmentAssignment' },
  { id: 'inClassActivity', labelKey: 'manualLectureAssessmentInClassActivity' },
  { id: 'onlineActivity', labelKey: 'manualLectureAssessmentOnlineActivity' },
  { id: 'discussion', labelKey: 'manualLectureAssessmentDiscussion' },
  { id: 'lab', labelKey: 'manualLectureAssessmentLab' },
  { id: 'tutorial', labelKey: 'manualLectureAssessmentTutorial' },
  { id: 'essay', labelKey: 'manualLectureAssessmentEssay' },
  { id: 'presentation', labelKey: 'manualLectureAssessmentPresentation' },
  { id: 'project', labelKey: 'manualLectureAssessmentProject' },
  { id: 'attendanceMandatory', labelKey: 'manualLectureAssessmentAttendanceMandatory' },
  { id: 'officeHours', labelKey: 'manualLectureAssessmentOfficeHours' },
];
const assessmentKeys = new Set<string>(assessmentOptions.map((option) => option.id));
const assessmentCountOptions = Array.from({ length: 20 }, (_, index) => `${index + 1}`);
const classTypeOptions: Array<{ id: ManualLectureClassType; labelKey: ClassTypeLabelKey }> = [
  { id: 'lecture', labelKey: 'manualLectureClassTypeLecture' },
  { id: 'lab', labelKey: 'manualLectureClassTypeLab' },
  { id: 'tutorial', labelKey: 'manualLectureClassTypeTutorial' },
  { id: 'seminar', labelKey: 'manualLectureClassTypeSeminar' },
];
const recurrenceOptions: Array<{ id: ManualLectureRecurrence; labelKey: RecurrenceLabelKey }> = [
  { id: 'weekly', labelKey: 'manualLectureRecurrenceWeekly' },
  { id: 'biweekly', labelKey: 'manualLectureRecurrenceBiweekly' },
  { id: 'monthly', labelKey: 'manualLectureRecurrenceMonthly' },
  { id: 'bimonthly', labelKey: 'manualLectureRecurrenceBimonthly' },
];
const weekdayOptions: Array<{ id: ManualLectureWeekday; labelKey: WeekdayLabelKey }> = [
  { id: 'Mon', labelKey: 'manualLectureWeekdayMon' },
  { id: 'Tue', labelKey: 'manualLectureWeekdayTue' },
  { id: 'Wed', labelKey: 'manualLectureWeekdayWed' },
  { id: 'Thu', labelKey: 'manualLectureWeekdayThu' },
  { id: 'Fri', labelKey: 'manualLectureWeekdayFri' },
  { id: 'Sat', labelKey: 'manualLectureWeekdaySat' },
  { id: 'Sun', labelKey: 'manualLectureWeekdaySun' },
];
const weekdayAliases: Record<string, ManualLectureWeekday> = {
  friday: 'Fri',
  fri: 'Fri',
  monday: 'Mon',
  mon: 'Mon',
  saturday: 'Sat',
  sat: 'Sat',
  sunday: 'Sun',
  sun: 'Sun',
  thursday: 'Thu',
  thu: 'Thu',
  thur: 'Thu',
  thurs: 'Thu',
  tuesday: 'Tue',
  tue: 'Tue',
  tues: 'Tue',
  wednesday: 'Wed',
  wed: 'Wed',
};

type AssessmentFormState = Record<AssessmentKey, {
  count: string;
  details: string;
  enabled: boolean;
  gradeInputMode: ManualLectureGradeInputMode;
  gradeItems: ManualLectureGradeItem[];
  gradePortion: string;
}>;

function createAssessmentState(storedAssessments: ManualLectureAssessment[] = []): AssessmentFormState {
  const nextState = assessmentOptions.reduce((state, option) => {
    state[option.id] = {
      count: '',
      details: '',
      enabled: false,
      gradeInputMode: 'points',
      gradeItems: [],
      gradePortion: '',
    };

    return state;
  }, {} as AssessmentFormState);

  storedAssessments.forEach((assessment) => {
    if (!assessmentKeys.has(assessment.id)) {
      return;
    }

    nextState[assessment.id as AssessmentKey] = {
      count: assessment.count,
      details: assessment.details,
      enabled: assessment.enabled,
      gradeInputMode: assessment.gradeInputMode ?? 'points',
      gradeItems: Array.isArray(assessment.gradeItems) ? assessment.gradeItems : [],
      gradePortion: assessment.gradePortion,
    };
  });

  return nextState;
}

function createManualLectureId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `manual-lecture-${Date.now()}`;
}

function createScheduleEntryId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `schedule-entry-${Date.now()}`;
}

function createScheduleEntry(
  overrides: Partial<ManualLectureScheduleEntry> = {},
): ManualLectureScheduleEntry {
  return {
    id: createScheduleEntryId(),
    classType: 'lecture',
    deliveryMode: 'inPerson',
    day: '',
    days: [],
    time: '',
    startTime: '',
    endTime: '',
    startDate: '',
    endDate: '',
    recurrence: 'weekly',
    recurrenceOffset: 0,
    location: '',
    ...overrides,
  };
}

function parseScheduleDays(value?: string): ManualLectureWeekday[] {
  if (!value) {
    return [];
  }

  const selectedDays = value
    .split(/[,/·|]+|\band\b/i)
    .map((part) => part.trim().toLowerCase())
    .map((part) => weekdayAliases[part])
    .filter((day): day is ManualLectureWeekday => Boolean(day));

  return weekdayOptions
    .map((option) => option.id)
    .filter((day) => selectedDays.includes(day));
}

function normalizeScheduleDays(entry: ManualLectureScheduleEntry): ManualLectureWeekday[] {
  const selectedDays = Array.isArray(entry.days)
    ? entry.days.filter((day): day is ManualLectureWeekday => weekdayOptions.some((option) => option.id === day))
    : [];

  return selectedDays.length > 0 ? selectedDays : parseScheduleDays(entry.day);
}

function normalizeTimePart(value: string) {
  const trimmedValue = value.trim().toLowerCase().replace(/\s+/g, '');
  const meridiem = trimmedValue.match(/(am|pm)$/)?.[1];
  const timeValue = trimmedValue.replace(/(am|pm)$/i, '');
  const compactMatch = timeValue.match(/^(\d{1,2})(\d{2})$/);
  const colonMatch = timeValue.match(/^(\d{1,2})(?::(\d{2}))?$/);
  const match = compactMatch || colonMatch;

  if (!match) {
    return '';
  }

  let hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2] ?? '0', 10);

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) {
    return '';
  }

  if (meridiem === 'pm' && hour < 12) {
    hour += 12;
  } else if (meridiem === 'am' && hour === 12) {
    hour = 0;
  }

  if (hour > 23) {
    return '';
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseLegacyTimeRange(value?: string) {
  if (!value) {
    return { endTime: '', startTime: '' };
  }

  const [rawStart = '', rawEnd = ''] = value.split(/\s*(?:-|–|—|\bto\b)\s*/i);

  return {
    endTime: normalizeTimePart(rawEnd),
    startTime: normalizeTimePart(rawStart),
  };
}

function formatTimeRange(startTime?: string, endTime?: string, fallback = '') {
  const normalizedStartTime = startTime?.trim();
  const normalizedEndTime = endTime?.trim();

  if (normalizedStartTime && normalizedEndTime) {
    return `${normalizedStartTime} - ${normalizedEndTime}`;
  }

  return normalizedStartTime || normalizedEndTime || fallback.trim();
}

function normalizeDecimalInput(value: string) {
  const numericCharacters = value.replace(/[^\d.]/g, '');
  const [whole = '', ...decimalParts] = numericCharacters.split('.');

  return decimalParts.length > 0
    ? `${whole}.${decimalParts.join('')}`
    : whole;
}

function parseUsefulLinks(value: string): ManualLectureLink[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [rawLabel, rawUrl] = line.includes('|')
        ? line.split('|', 2).map((part) => part.trim())
        : [`Useful link ${index + 1}`, line];

      return {
        id: `useful-${index}`,
        label: rawLabel || `Useful link ${index + 1}`,
        url: rawUrl || rawLabel,
      };
    });
}

function getKnownLinkUrl(lecture: ManualLecture | undefined, linkId: string) {
  return lecture?.links.find((link) => link.id === linkId)?.url ?? '';
}

function createUsefulLinksValue(lecture: ManualLecture | undefined) {
  const knownLinkIds = new Set([
    'lecture-website',
    'submission-link',
    'online-lecture-link',
    'online-office-hour-link',
  ]);

  return (lecture?.links ?? [])
    .filter((link) => !knownLinkIds.has(link.id))
    .map((link) => `${link.label} | ${link.url}`)
    .join('\n');
}

function normalizeRecurrenceOffset(value?: number): 0 | 1 {
  return value === 1 ? 1 : 0;
}

function parsePreviewDate(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return undefined;
  }

  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, monthIndex, day);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function getPreviewWeekOfMonth(date: Date) {
  return Math.floor((date.getDate() - 1) / 7);
}

function shouldIncludePreviewDate(
  entry: ManualLectureScheduleEntry,
  currentDate: Date,
  startDate: Date,
) {
  const recurrence = entry.recurrence ?? 'weekly';
  const offset = normalizeRecurrenceOffset(entry.recurrenceOffset);

  if (recurrence === 'weekly') {
    return true;
  }

  if (recurrence === 'biweekly') {
    const weeksSinceStart = Math.floor(
      (currentDate.getTime() - startDate.getTime()) / (7 * 86_400_000),
    );

    return Math.max(weeksSinceStart, 0) % 2 === offset;
  }

  const monthsSinceStart = (
    (currentDate.getFullYear() - startDate.getFullYear()) * 12
  ) + currentDate.getMonth() - startDate.getMonth();

  if (getPreviewWeekOfMonth(currentDate) !== getPreviewWeekOfMonth(startDate)) {
    return false;
  }

  if (recurrence === 'monthly') {
    return monthsSinceStart >= 0;
  }

  if (recurrence === 'bimonthly') {
    return Math.max(monthsSinceStart, 0) % 2 === offset;
  }

  return true;
}

function createSchedulePreviewDays(entry: ManualLectureScheduleEntry) {
  const selectedDays = normalizeScheduleDays(entry);
  const startDate = parsePreviewDate(entry.startDate) ?? new Date();
  const endDate = parsePreviewDate(entry.endDate);
  const previewEndDate = endDate ?? new Date(startDate.getFullYear(), startDate.getMonth() + 2, startDate.getDate());
  const monthStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const gridStart = new Date(monthStart);
  const dayOffset = (gridStart.getDay() + 6) % 7;
  const selectedDayIndexes = new Set(selectedDays.map((day) => weekdayOptions.findIndex((option) => option.id === day) + 1));

  gridStart.setDate(gridStart.getDate() - dayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);

    date.setDate(gridStart.getDate() + index);

    const isInDateRange = date.getTime() >= startDate.getTime() && date.getTime() <= previewEndDate.getTime();
    const isSelected = isInDateRange &&
      selectedDayIndexes.has(date.getDay() === 0 ? 7 : date.getDay()) &&
      shouldIncludePreviewDate(entry, date, startDate);

    return {
      date,
      id: date.toISOString(),
      isCurrentMonth: date.getMonth() === startDate.getMonth(),
      isSelected,
    };
  });
}

function formatPreviewMonthLabel(entry: ManualLectureScheduleEntry) {
  const startDate = parsePreviewDate(entry.startDate) ?? new Date();

  return startDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function createScheduleEntriesFromLecture(lecture: ManualLecture | undefined): ManualLectureScheduleEntry[] {
  if (lecture?.schedule.entries?.length) {
    return lecture.schedule.entries.map((entry) => {
      const legacyTimeRange = parseLegacyTimeRange(entry.time);

      return {
        ...entry,
        days: normalizeScheduleDays(entry),
        endDate: entry.endDate ?? '',
        endTime: entry.endTime ?? legacyTimeRange.endTime,
        recurrence: entry.recurrence ?? 'weekly',
        recurrenceOffset: normalizeRecurrenceOffset(entry.recurrenceOffset),
        startDate: entry.startDate ?? '',
        startTime: entry.startTime ?? legacyTimeRange.startTime,
      };
    });
  }

  if (lecture?.schedule.day || lecture?.schedule.time || lecture?.schedule.location) {
    const legacyTimeRange = parseLegacyTimeRange(lecture.schedule.time);

    return [
      createScheduleEntry({
        deliveryMode: lecture.schedule.deliveryMode,
        day: lecture.schedule.day,
        days: parseScheduleDays(lecture.schedule.day),
        endTime: legacyTimeRange.endTime,
        recurrence: 'weekly',
        recurrenceOffset: 0,
        time: lecture.schedule.time,
        startTime: legacyTimeRange.startTime,
        location: lecture.schedule.location,
      }),
    ];
  }

  return [createScheduleEntry()];
}

export function ManualLectureDialog({
  description,
  initialLecture,
  open,
  onAddLecture,
  onOpenChange,
  onRequestDeleteLecture,
  onSaveLecture,
  selectedSemester,
  semesterOptions = [],
  submitLabel,
  title,
}: ManualLectureDialogProps) {
  const { dictionary } = useLanguage();
  const [name, setName] = useState(() => initialLecture?.name ?? '');
  const [code, setCode] = useState(() => initialLecture?.code ?? '');
  const [semester, setSemester] = useState(() => initialLecture?.semester ?? selectedSemester ?? '');
  const [lectureSection, setLectureSection] = useState(() => initialLecture?.lectureSection ?? '');
  const [labSection, setLabSection] = useState(() => initialLecture?.labSection ?? '');
  const [tutorialSection, setTutorialSection] = useState(() => initialLecture?.tutorialSection ?? '');
  const [credits, setCredits] = useState(() => initialLecture?.credits ?? '');
  const [lectureWebsiteLink, setLectureWebsiteLink] = useState(() => getKnownLinkUrl(initialLecture, 'lecture-website'));
  const [submissionLink, setSubmissionLink] = useState(() => getKnownLinkUrl(initialLecture, 'submission-link'));
  const [onlineLectureLink, setOnlineLectureLink] = useState(() => getKnownLinkUrl(initialLecture, 'online-lecture-link'));
  const [onlineOfficeHourLink, setOnlineOfficeHourLink] = useState(() => getKnownLinkUrl(initialLecture, 'online-office-hour-link'));
  const [usefulLinks, setUsefulLinks] = useState(() => createUsefulLinksValue(initialLecture));
  const [scheduleEntries, setScheduleEntries] = useState<ManualLectureScheduleEntry[]>(
    () => createScheduleEntriesFromLecture(initialLecture),
  );
  const [assessments, setAssessments] = useState<AssessmentFormState>(
    () => createAssessmentState(initialLecture?.assessments),
  );
  const [areAssessmentsExpanded, setAreAssessmentsExpanded] = useState(false);
  const [previewScheduleEntryId, setPreviewScheduleEntryId] = useState<string | null>(null);
  const hasOnlineSchedule = scheduleEntries.some((entry) => entry.deliveryMode === 'online');
  const previewScheduleEntry = previewScheduleEntryId
    ? scheduleEntries.find((entry) => entry.id === previewScheduleEntryId) ?? null
    : null;

  const assessmentTotal = assessmentOptions.reduce((total, option) => {
    const assessment = assessments[option.id];

    if (!assessment.enabled) {
      return total;
    }

    return total + (Number.parseFloat(assessment.gradePortion) || 0);
  }, 0);

  const formattedAssessmentTotal = Number.isInteger(assessmentTotal)
    ? assessmentTotal.toString()
    : assessmentTotal.toFixed(1);
  const dialogTitle = title ?? (initialLecture ? dictionary.manualLectureEditTitle : dictionary.manualLectureTitle);
  const dialogDescription = description ?? (
    initialLecture ? dictionary.manualLectureEditDescription : dictionary.manualLectureDescription
  );
  const saveLabel = submitLabel ?? (
    initialLecture ? dictionary.manualLectureUpdate : dictionary.manualLectureSave
  );

  const resetForm = () => {
    setName('');
    setCode('');
    setSemester(selectedSemester ?? '');
    setLectureSection('');
    setLabSection('');
    setTutorialSection('');
    setCredits('');
    setLectureWebsiteLink('');
    setSubmissionLink('');
    setOnlineLectureLink('');
    setOnlineOfficeHourLink('');
    setUsefulLinks('');
    setScheduleEntries([createScheduleEntry()]);
    setAssessments(createAssessmentState());
    setAreAssessmentsExpanded(false);
    setPreviewScheduleEntryId(null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedScheduleEntries = scheduleEntries
      .map((entry) => {
        const days = normalizeScheduleDays(entry);
        const startTime = entry.startTime?.trim() || parseLegacyTimeRange(entry.time).startTime;
        const endTime = entry.endTime?.trim() || parseLegacyTimeRange(entry.time).endTime;
        const startDate = entry.startDate?.trim() ?? '';
        const endDate = entry.endDate?.trim() ?? '';
        const location = entry.location.trim();
        const recurrence = entry.recurrence ?? 'weekly';

        return {
          ...entry,
          day: days.join(', '),
          days,
          endDate,
          endTime,
          location,
          recurrence,
        recurrenceOffset: recurrence === 'weekly' ? 0 : normalizeRecurrenceOffset(entry.recurrenceOffset),
          startDate,
          startTime,
          time: formatTimeRange(startTime, endTime, entry.time),
        };
      })
      .filter((entry) => (
        entry.days.length > 0 ||
        Boolean(entry.startTime || entry.endTime || entry.startDate || entry.endDate || entry.location)
      ));
    const firstTimedEntry = normalizedScheduleEntries.find((entry) => entry.deliveryMode === 'inPerson')
      ?? normalizedScheduleEntries[0];

    const links: ManualLectureLink[] = [
      lectureWebsiteLink.trim()
        ? { id: 'lecture-website', label: dictionary.manualLectureWebsiteLink, url: lectureWebsiteLink.trim() }
        : null,
      submissionLink.trim()
        ? { id: 'submission-link', label: dictionary.manualLectureSubmissionLink, url: submissionLink.trim() }
        : null,
      hasOnlineSchedule && onlineLectureLink.trim()
        ? { id: 'online-lecture-link', label: dictionary.manualLectureOnlineLectureLink, url: onlineLectureLink.trim() }
        : null,
      hasOnlineSchedule && onlineOfficeHourLink.trim()
        ? { id: 'online-office-hour-link', label: dictionary.manualLectureOnlineOfficeHourLink, url: onlineOfficeHourLink.trim() }
        : null,
      ...parseUsefulLinks(usefulLinks),
    ].filter((link): link is ManualLectureLink => Boolean(link));

    const nextLecture: ManualLecture = {
      ...initialLecture,
      id: initialLecture?.id ?? createManualLectureId(),
      name: name.trim(),
      code: code.trim().toUpperCase(),
      semester: semester.trim() || selectedSemester,
      lectureSection: lectureSection.trim().toUpperCase(),
      labSection: labSection.trim().toUpperCase(),
      tutorialSection: tutorialSection.trim().toUpperCase(),
      credits: credits.trim(),
      assessments: assessmentOptions.map((option) => ({
        id: option.id,
        label: dictionary[option.labelKey],
        ...assessments[option.id],
      })),
      schedule: {
        deliveryMode: hasOnlineSchedule ? 'online' : 'inPerson',
        day: firstTimedEntry?.day ?? '',
        time: firstTimedEntry?.time ?? '',
        location: firstTimedEntry?.location ?? '',
        entries: normalizedScheduleEntries,
      },
      links,
      chipColor: initialLecture?.chipColor ?? 'blue',
    };

    if (initialLecture) {
      onSaveLecture?.(nextLecture);
    } else {
      onAddLecture?.(nextLecture);
      resetForm();
    }

    onOpenChange(false);
  };

  const updateAssessment = (
    key: AssessmentKey,
    update: Partial<AssessmentFormState[AssessmentKey]>,
  ) => {
    setAssessments((currentAssessments) => ({
      ...currentAssessments,
      [key]: {
        ...currentAssessments[key],
        ...update,
      },
    }));
  };

  const updateScheduleEntry = (
    entryId: string,
    update: Partial<ManualLectureScheduleEntry>,
  ) => {
    setScheduleEntries((currentEntries) => currentEntries.map((entry) => (
      entry.id === entryId ? { ...entry, ...update } : entry
    )));
  };

  const toggleScheduleEntryDay = (entryId: string, day: ManualLectureWeekday) => {
    setScheduleEntries((currentEntries) => currentEntries.map((entry) => {
      if (entry.id !== entryId) {
        return entry;
      }

      const currentDays = normalizeScheduleDays(entry);
      const nextDays = currentDays.includes(day)
        ? currentDays.filter((currentDay) => currentDay !== day)
        : weekdayOptions
            .map((option) => option.id)
            .filter((weekday) => [...currentDays, day].includes(weekday));

      return {
        ...entry,
        day: nextDays.join(', '),
        days: nextDays,
      };
    }));
  };

  const addScheduleEntry = () => {
    setScheduleEntries((currentEntries) => [...currentEntries, createScheduleEntry()]);
  };

  const removeScheduleEntry = (entryId: string) => {
    setScheduleEntries((currentEntries) => (
      currentEntries.length > 1
        ? currentEntries.filter((entry) => entry.id !== entryId)
        : currentEntries
    ));
  };

  const handleToggleScheduleEntryRecurrenceOffset = (entryId: string) => {
    setScheduleEntries((currentEntries) => currentEntries.map((entry) => {
      if (entry.id !== entryId) {
        return entry;
      }

      const recurrence = entry.recurrence ?? 'weekly';

      if (recurrence !== 'biweekly' && recurrence !== 'bimonthly') {
        return entry;
      }

      return {
        ...entry,
        recurrenceOffset: entry.recurrenceOffset === 1 ? 0 : 1,
      };
    }));
    setPreviewScheduleEntryId(entryId);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-auto rounded-xl p-5 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black">{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-5" onSubmit={handleSubmit}>
          <section className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2 md:col-span-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="manual-lecture-name">
                {dictionary.manualLectureName}
              </Label>
              <Input
                id="manual-lecture-name"
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="manual-lecture-code">
                {dictionary.manualLectureCode}
              </Label>
              <Input
                id="manual-lecture-code"
                onChange={(event) => setCode(event.target.value)}
                placeholder="CMPT276"
                required
                value={code}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="manual-lecture-semester">
                {dictionary.manualLectureSemester}
              </Label>
              <Select onValueChange={setSemester} value={semester || selectedSemester}>
                <SelectTrigger id="manual-lecture-semester">
                  <SelectValue placeholder={dictionary.manualLectureSelectSemester} />
                </SelectTrigger>
                <SelectContent>
                  {semesterOptions.map((semesterOption) => (
                    <SelectItem key={semesterOption} value={semesterOption}>
                      {semesterOption}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="manual-lecture-section">
                {dictionary.manualLectureSection}
              </Label>
              <Input
                id="manual-lecture-section"
                onChange={(event) => setLectureSection(event.target.value)}
                placeholder="D100"
                value={lectureSection}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="manual-lab-section">
                {dictionary.manualLectureLabSection}
              </Label>
              <Input
                id="manual-lab-section"
                onChange={(event) => setLabSection(event.target.value)}
                placeholder="D200"
                value={labSection}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="manual-tutorial-section">
                {dictionary.manualLectureTutorialSection}
              </Label>
              <Input
                id="manual-tutorial-section"
                onChange={(event) => setTutorialSection(event.target.value)}
                placeholder="T100"
                value={tutorialSection}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="manual-credits">
                {dictionary.manualLectureCredits}
              </Label>
              <Input
                id="manual-credits"
                inputMode="decimal"
                onChange={(event) => setCredits(event.target.value)}
                placeholder="3"
                value={credits}
              />
            </div>
          </section>

          <section className="grid gap-3 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-3">
              <button
                aria-expanded={areAssessmentsExpanded}
                className="flex min-w-0 items-start gap-2 text-left"
                onClick={() => setAreAssessmentsExpanded((isExpanded) => !isExpanded)}
                type="button"
              >
                {areAssessmentsExpanded ? (
                  <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <span>
                  <span className="block text-sm font-black">{dictionary.manualLectureAssessments}</span>
                  <span className="mt-1 block text-xs font-semibold text-muted-foreground">
                    {dictionary.manualLectureRecommendedTotal}
                  </span>
                </span>
              </button>
              <div className="shrink-0 rounded-md border bg-background px-2 py-1 text-xs font-black">
                {dictionary.manualLectureAssessmentTotal}: {formattedAssessmentTotal}%
              </div>
            </div>
            {areAssessmentsExpanded ? (
              <div className="grid gap-2 md:grid-cols-2">
                {assessmentOptions.map((option) => {
                  const assessment = assessments[option.id];
                  const label = dictionary[option.labelKey];

                  return (
                    <div className="grid gap-2 rounded-lg border bg-muted/25 p-3" key={option.id}>
                      <label className="flex items-center gap-2 text-sm font-black" htmlFor={`assessment-${option.id}`}>
                        <Checkbox
                          checked={assessment.enabled}
                          id={`assessment-${option.id}`}
                          onCheckedChange={(checked) => updateAssessment(option.id, { enabled: checked === true })}
                        />
                        {label}
                      </label>
                      <div className="grid gap-2 lg:grid-cols-[96px_112px_minmax(0,1fr)]">
                        <Select
                          disabled={!assessment.enabled}
                          onValueChange={(value) => updateAssessment(option.id, { count: value })}
                          value={assessment.count}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={dictionary.manualLectureAssessmentCount} />
                          </SelectTrigger>
                          <SelectContent>
                            {assessmentCountOptions.map((count) => (
                              <SelectItem key={count} value={count}>
                                {count}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          disabled={!assessment.enabled}
                          inputMode="decimal"
                          min="0"
                          onChange={(event) => updateAssessment(option.id, {
                            gradePortion: normalizeDecimalInput(event.target.value),
                          })}
                          placeholder="%"
                          step="0.1"
                          type="number"
                          value={assessment.gradePortion}
                        />
                        <Input
                          disabled={!assessment.enabled}
                          onChange={(event) => updateAssessment(option.id, { details: event.target.value })}
                          placeholder={dictionary.manualLectureAssessmentDetails}
                          value={assessment.details}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>

          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black">{dictionary.manualLectureSchedule}</h3>
              <Button onClick={addScheduleEntry} size="sm" type="button" variant="outline">
                <Plus className="size-4" />
                {dictionary.manualLectureAddClassTime}
              </Button>
            </div>
            <div className="grid gap-2">
              {scheduleEntries.map((entry) => (
                <div
                  className="grid gap-3 rounded-lg border bg-muted/25 p-3"
                  key={entry.id}
                >
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <div className="space-y-2">
                      <Label className="text-xs font-black uppercase text-muted-foreground">
                        {dictionary.manualLectureClassType}
                      </Label>
                      <Select
                        onValueChange={(value) => updateScheduleEntry(entry.id, {
                          classType: value as ManualLectureClassType,
                        })}
                        value={entry.classType}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {classTypeOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {dictionary[option.labelKey]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-black uppercase text-muted-foreground">
                        {dictionary.manualLectureDeliveryMode}
                      </Label>
                      <Select
                        onValueChange={(value) => updateScheduleEntry(entry.id, {
                          deliveryMode: value as ManualLectureDeliveryMode,
                        })}
                        value={entry.deliveryMode}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inPerson">{dictionary.manualLectureInPerson}</SelectItem>
                          <SelectItem value="online">{dictionary.manualLectureOnline}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <Button
                        aria-label={dictionary.manualLectureRemoveClassTime}
                        disabled={scheduleEntries.length === 1}
                        onClick={() => removeScheduleEntry(entry.id)}
                        size="icon-sm"
                        title={dictionary.manualLectureRemoveClassTime}
                        type="button"
                        variant="outline"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-black uppercase text-muted-foreground">
                      {dictionary.manualLectureClassDay}
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {weekdayOptions.map((option) => {
                        const selectedDays = normalizeScheduleDays(entry);
                        const isSelected = selectedDays.includes(option.id);

                        return (
                          <Button
                            className={isSelected
                              ? 'h-8 rounded-md px-2.5 text-xs font-black'
                              : 'h-8 rounded-md bg-background px-2.5 text-xs font-black text-muted-foreground hover:bg-muted hover:text-foreground'}
                            key={option.id}
                            onClick={() => toggleScheduleEntryDay(entry.id, option.id)}
                            type="button"
                            variant={isSelected ? 'default' : 'outline'}
                          >
                            {dictionary[option.labelKey]}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-black uppercase text-muted-foreground">
                      {dictionary.manualLectureRecurrence}
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {recurrenceOptions.map((option) => {
                        const recurrence = entry.recurrence ?? 'weekly';
                        const isSelected = recurrence === option.id;
                        const supportsReverse = option.id === 'biweekly' || option.id === 'bimonthly';

                        return (
                          <Button
                            className={isSelected
                              ? 'h-8 rounded-md px-2.5 text-xs font-black'
                              : 'h-8 rounded-md bg-background px-2.5 text-xs font-black text-muted-foreground hover:bg-muted hover:text-foreground'}
                            key={option.id}
                            onClick={() => updateScheduleEntry(entry.id, {
                              recurrence: option.id,
                              recurrenceOffset: supportsReverse ? normalizeRecurrenceOffset(entry.recurrenceOffset) : 0,
                            })}
                            type="button"
                            variant={isSelected ? 'default' : 'outline'}
                          >
                            {dictionary[option.labelKey]}
                          </Button>
                        );
                      })}
                      <Button
                        className="h-8 rounded-full border-dashed px-2.5 text-xs font-black"
                        disabled={!['biweekly', 'bimonthly'].includes(entry.recurrence ?? 'weekly')}
                        onClick={() => handleToggleScheduleEntryRecurrenceOffset(entry.id)}
                        type="button"
                        variant={entry.recurrenceOffset === 1 ? 'secondary' : 'outline'}
                      >
                        <CalendarDays className="size-3.5" />
                        {dictionary.manualLectureRecurrenceReverse}
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-2">
                      <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor={`manual-class-start-time-${entry.id}`}>
                        {dictionary.manualLectureStartTime}
                      </Label>
                      <Input
                        id={`manual-class-start-time-${entry.id}`}
                        onChange={(event) => updateScheduleEntry(entry.id, { startTime: event.target.value })}
                        type="time"
                        value={entry.startTime ?? ''}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor={`manual-class-end-time-${entry.id}`}>
                        {dictionary.manualLectureEndTime}
                      </Label>
                      <Input
                        id={`manual-class-end-time-${entry.id}`}
                        onChange={(event) => updateScheduleEntry(entry.id, { endTime: event.target.value })}
                        type="time"
                        value={entry.endTime ?? ''}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor={`manual-class-start-date-${entry.id}`}>
                        {dictionary.manualLectureStartDate}
                      </Label>
                      <Input
                        id={`manual-class-start-date-${entry.id}`}
                        onChange={(event) => updateScheduleEntry(entry.id, { startDate: event.target.value })}
                        type="date"
                        value={entry.startDate ?? ''}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor={`manual-class-end-date-${entry.id}`}>
                        {dictionary.manualLectureEndDate}
                      </Label>
                      <Input
                        id={`manual-class-end-date-${entry.id}`}
                        onChange={(event) => updateScheduleEntry(entry.id, { endDate: event.target.value })}
                        type="date"
                        value={entry.endDate ?? ''}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor={`manual-class-location-${entry.id}`}>
                      {entry.deliveryMode === 'online'
                        ? dictionary.manualLectureMeetingLink
                        : dictionary.manualLectureClassLocation}
                    </Label>
                    <Input
                      id={`manual-class-location-${entry.id}`}
                      onChange={(event) => updateScheduleEntry(entry.id, { location: event.target.value })}
                      placeholder={entry.deliveryMode === 'online' ? 'https://...' : 'AQ9001'}
                      value={entry.location}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <h3 className="flex items-center gap-2 text-sm font-black">
                <Link className="size-4 text-muted-foreground" />
                {dictionary.manualLectureLinks}
              </h3>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="manual-lecture-link">
                {dictionary.manualLectureWebsiteLink}
              </Label>
              <Input
                id="manual-lecture-link"
                onChange={(event) => setLectureWebsiteLink(event.target.value)}
                placeholder="https://..."
                type="url"
                value={lectureWebsiteLink}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="manual-submission-link">
                {dictionary.manualLectureSubmissionLink}
              </Label>
              <Input
                id="manual-submission-link"
                onChange={(event) => setSubmissionLink(event.target.value)}
                placeholder="https://..."
                type="url"
                value={submissionLink}
              />
            </div>
            {hasOnlineSchedule ? (
              <>
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="manual-online-lecture-link">
                    {dictionary.manualLectureOnlineLectureLink}
                  </Label>
                  <Input
                    id="manual-online-lecture-link"
                    onChange={(event) => setOnlineLectureLink(event.target.value)}
                    placeholder="https://..."
                    type="url"
                    value={onlineLectureLink}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="manual-online-office-hour-link">
                    {dictionary.manualLectureOnlineOfficeHourLink}
                  </Label>
                  <Input
                    id="manual-online-office-hour-link"
                    onChange={(event) => setOnlineOfficeHourLink(event.target.value)}
                    placeholder="https://..."
                    type="url"
                    value={onlineOfficeHourLink}
                  />
                </div>
              </>
            ) : null}
            <div className="space-y-2 md:col-span-2">
              <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor="manual-useful-links">
                {dictionary.manualLectureUsefulLinks}
              </Label>
              <Textarea
                className="min-h-24"
                id="manual-useful-links"
                onChange={(event) => setUsefulLinks(event.target.value)}
                placeholder={dictionary.manualLectureUsefulLinksPlaceholder}
                value={usefulLinks}
              />
            </div>
          </section>

          <DialogFooter>
            {initialLecture && onRequestDeleteLecture ? (
              <Button
                className="mr-auto"
                onClick={() => onRequestDeleteLecture(initialLecture)}
                type="button"
                variant="destructive"
              >
                <Trash2 className="size-4" />
                {dictionary.manualLectureDelete}
              </Button>
            ) : null}
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              {dictionary.cancel}
            </Button>
            <Button type="submit">
              <Save className="size-4" />
              {saveLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(previewScheduleEntry)} onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        setPreviewScheduleEntryId(null);
      }
    }}>
      <DialogContent className="max-w-sm rounded-xl p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="size-4 text-primary" />
            {dictionary.manualLectureRecurrencePreviewTitle}
          </DialogTitle>
          <DialogDescription>
            {dictionary.manualLectureRecurrencePreviewDescription}
          </DialogDescription>
        </DialogHeader>
        {previewScheduleEntry ? (
          <div className="grid gap-3">
            <div className="rounded-lg border bg-muted/25 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-black">{formatPreviewMonthLabel(previewScheduleEntry)}</span>
                <span className="rounded-md border bg-background px-2 py-0.5 text-xs font-black text-muted-foreground">
                  {dictionary[
                    recurrenceOptions.find((option) => option.id === (previewScheduleEntry.recurrence ?? 'weekly'))?.labelKey ??
                      'manualLectureRecurrenceWeekly'
                  ]}
                </span>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase text-muted-foreground">
                {weekdayOptions.map((option) => (
                  <span key={option.id}>{dictionary[option.labelKey]}</span>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {createSchedulePreviewDays(previewScheduleEntry).map((day) => (
                  <span
                    className={[
                      'grid aspect-square place-items-center rounded-md text-xs font-black',
                      day.isSelected
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : day.isCurrentMonth
                          ? 'bg-background text-foreground'
                          : 'bg-muted/40 text-muted-foreground/45',
                    ].join(' ')}
                    key={day.id}
                  >
                    {day.date.getDate()}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                disabled={!['biweekly', 'bimonthly'].includes(previewScheduleEntry.recurrence ?? 'weekly')}
                onClick={() => handleToggleScheduleEntryRecurrenceOffset(previewScheduleEntry.id)}
                type="button"
                variant="secondary"
              >
                <CalendarDays className="size-4" />
                {dictionary.manualLectureRecurrenceReverse}
              </Button>
              <Button onClick={() => setPreviewScheduleEntryId(null)} type="button" variant="outline">
                {dictionary.cancel}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
    </>
  );
}
