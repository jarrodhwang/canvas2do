import { useEffect, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronRight, Link, Plus, Save, Trash2 } from 'lucide-react';

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
}

export interface ManualLectureLink {
  id: string;
  label: string;
  url: string;
}

export type ManualLectureDeliveryMode = 'inPerson' | 'online';
export type ManualLectureClassType = 'lecture' | 'lab' | 'tutorial' | 'seminar';

export interface ManualLectureScheduleEntry {
  id: string;
  classType: ManualLectureClassType;
  deliveryMode: ManualLectureDeliveryMode;
  day: string;
  time: string;
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
  chipColor?: ColorToken;
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

type AssessmentFormState = Record<AssessmentKey, {
  count: string;
  details: string;
  enabled: boolean;
  gradePortion: string;
}>;

function createAssessmentState(storedAssessments: ManualLectureAssessment[] = []): AssessmentFormState {
  const nextState = assessmentOptions.reduce((state, option) => {
    state[option.id] = {
      count: '',
      details: '',
      enabled: false,
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
    time: '',
    location: '',
    ...overrides,
  };
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

function createScheduleEntriesFromLecture(lecture: ManualLecture | undefined) {
  if (lecture?.schedule.entries?.length) {
    return lecture.schedule.entries.map((entry) => ({ ...entry }));
  }

  if (lecture?.schedule.day || lecture?.schedule.time || lecture?.schedule.location) {
    return [
      createScheduleEntry({
        deliveryMode: lecture.schedule.deliveryMode,
        day: lecture.schedule.day,
        time: lecture.schedule.time,
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
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [semester, setSemester] = useState(selectedSemester ?? '');
  const [lectureSection, setLectureSection] = useState('');
  const [labSection, setLabSection] = useState('');
  const [tutorialSection, setTutorialSection] = useState('');
  const [credits, setCredits] = useState('');
  const [lectureWebsiteLink, setLectureWebsiteLink] = useState('');
  const [submissionLink, setSubmissionLink] = useState('');
  const [onlineLectureLink, setOnlineLectureLink] = useState('');
  const [onlineOfficeHourLink, setOnlineOfficeHourLink] = useState('');
  const [usefulLinks, setUsefulLinks] = useState('');
  const [scheduleEntries, setScheduleEntries] = useState<ManualLectureScheduleEntry[]>(() => [
    createScheduleEntry(),
  ]);
  const [assessments, setAssessments] = useState<AssessmentFormState>(createAssessmentState);
  const [areAssessmentsExpanded, setAreAssessmentsExpanded] = useState(true);
  const hasOnlineSchedule = scheduleEntries.some((entry) => entry.deliveryMode === 'online');

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
    setAreAssessmentsExpanded(true);
  };

  const loadLecture = (lecture: ManualLecture) => {
    setName(lecture.name);
    setCode(lecture.code);
    setSemester(lecture.semester ?? selectedSemester ?? '');
    setLectureSection(lecture.lectureSection);
    setLabSection(lecture.labSection);
    setTutorialSection(lecture.tutorialSection);
    setCredits(lecture.credits);
    setLectureWebsiteLink(getKnownLinkUrl(lecture, 'lecture-website'));
    setSubmissionLink(getKnownLinkUrl(lecture, 'submission-link'));
    setOnlineLectureLink(getKnownLinkUrl(lecture, 'online-lecture-link'));
    setOnlineOfficeHourLink(getKnownLinkUrl(lecture, 'online-office-hour-link'));
    setUsefulLinks(createUsefulLinksValue(lecture));
    setScheduleEntries(createScheduleEntriesFromLecture(lecture));
    setAssessments(createAssessmentState(lecture.assessments));
    setAreAssessmentsExpanded(true);
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    if (initialLecture) {
      loadLecture(initialLecture);
      return;
    }

    resetForm();
  }, [initialLecture?.id, open]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedScheduleEntries = scheduleEntries
      .map((entry) => ({
        ...entry,
        day: entry.day.trim(),
        time: entry.time.trim(),
        location: entry.location.trim(),
      }))
      .filter((entry) => entry.deliveryMode === 'online' || entry.day || entry.time || entry.location);
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

  return (
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
                  className="grid gap-2 rounded-lg border bg-muted/25 p-3 xl:grid-cols-[130px_130px_minmax(0,120px)_minmax(0,1fr)_minmax(0,1fr)_36px]"
                  key={entry.id}
                >
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
                  <div className="space-y-2">
                    <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor={`manual-class-day-${entry.id}`}>
                      {dictionary.manualLectureClassDay}
                    </Label>
                    <Input
                      id={`manual-class-day-${entry.id}`}
                      onChange={(event) => updateScheduleEntry(entry.id, { day: event.target.value })}
                      placeholder="Mon"
                      value={entry.day}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor={`manual-class-time-${entry.id}`}>
                      {dictionary.manualLectureClassTime}
                    </Label>
                    <Input
                      id={`manual-class-time-${entry.id}`}
                      onChange={(event) => updateScheduleEntry(entry.id, { time: event.target.value })}
                      placeholder="12:30 PM - 2:00 PM"
                      value={entry.time}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-black uppercase text-muted-foreground" htmlFor={`manual-class-location-${entry.id}`}>
                      {dictionary.manualLectureClassLocation}
                    </Label>
                    <Input
                      id={`manual-class-location-${entry.id}`}
                      onChange={(event) => updateScheduleEntry(entry.id, { location: event.target.value })}
                      placeholder={entry.deliveryMode === 'online' ? 'Zoom link' : 'AQ9001'}
                      value={entry.location}
                    />
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
  );
}
