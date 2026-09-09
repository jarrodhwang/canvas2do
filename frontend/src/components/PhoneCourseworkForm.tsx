import { ChevronDown, X } from 'lucide-react';
import { useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { Button } from './ui/button';
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';

interface PhoneCourseworkDraft {
  title: string;
  courseCode: string;
  courseworkType: string;
  submissionType: string;
  dueAt: string;
  startAt?: string;
  endAt?: string;
  semester?: string;
}

interface PhoneCourseworkFormProps {
  courseOptions: Array<{ value: string; label: string; semester?: string }>;
  typeOptions: Array<{ value: string; label: string }>;
  submissionOptions: Array<{ value: string; label: string }>;
  draft: PhoneCourseworkDraft;
  disabled: boolean;
  onChange: (changes: Partial<PhoneCourseworkDraft>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  title: string;
}

function subscribeViewport(callback: () => void) {
  window.visualViewport?.addEventListener('resize', callback);
  window.visualViewport?.addEventListener('scroll', callback);
  window.addEventListener('resize', callback);
  return () => {
    window.visualViewport?.removeEventListener('resize', callback);
    window.visualViewport?.removeEventListener('scroll', callback);
    window.removeEventListener('resize', callback);
  };
}

function getViewportSnapshot() {
  const height = window.visualViewport?.height ?? window.innerHeight;
  const bottom = Math.max(0, window.innerHeight - height - (window.visualViewport?.offsetTop ?? 0));
  return `${height}:${bottom}`;
}

function localDate(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const fieldClass = 'h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-base text-foreground';

function PhoneDateTimeField({ label, value = '', onChange, disabled, defaultTime = '23:59' }: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  disabled: boolean;
  defaultTime?: string;
}) {
  const { language } = useLanguage();
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-2">
        <input aria-label={label} className={fieldClass} disabled={disabled} onChange={(event) => onChange(event.target.value ? `${event.target.value}T${value.slice(11, 16) || defaultTime}` : '')} type="date" value={value.slice(0, 10)} />
        <input aria-label={`${label} · ${language === 'ko' ? '시간' : 'Time'}`} className={fieldClass} disabled={disabled || !value} onChange={(event) => onChange(`${value.slice(0, 10)}T${event.target.value || defaultTime}`)} type="time" value={value ? value.slice(11, 16) : ''} />
      </div>
    </div>
  );
}

export function PhoneCourseworkForm({ courseOptions, typeOptions, submissionOptions, draft, disabled, onChange, onClose, onSubmit, submitLabel, title }: PhoneCourseworkFormProps) {
  const { dictionary, language } = useLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [customCourse, setCustomCourse] = useState(() => Boolean(draft.courseCode && !courseOptions.some((option) => option.value === draft.courseCode)));
  const [height, bottom] = useSyncExternalStore(subscribeViewport, getViewportSnapshot, () => '800:0').split(':');

  return (
    <DialogContent
      className="phone-coursework-dialog fixed bottom-[var(--phone-dialog-bottom)] left-0 top-auto flex h-auto max-h-[var(--phone-dialog-height)] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 rounded-t-2xl rounded-b-none p-0"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        dialogRef.current?.focus();
      }}
      ref={dialogRef}
      showCloseButton={false}
      style={{ '--phone-dialog-height': `${height}px`, '--phone-dialog-bottom': `${bottom}px` } as CSSProperties}
    >
      <DialogHeader className="flex-row items-center justify-between border-b px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <DialogTitle className="text-base font-bold">{title}</DialogTitle>
        <DialogDescription className="sr-only">{dictionary.courseworkDialogDescription}</DialogDescription>
        <Button aria-label={language === 'ko' ? '닫기' : 'Close'} className="size-11" onClick={onClose} type="button" variant="ghost"><X className="size-5" /></Button>
      </DialogHeader>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
        <div className="grid min-h-0 content-start gap-4 overflow-y-auto overscroll-contain p-4">
          {disabled ? <p className="rounded-lg bg-muted p-3 text-sm">{dictionary.courseworkCanvasManagedLocked}</p> : null}
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            {dictionary.courseworkName}
            <Input className="h-12 text-base" disabled={disabled} onChange={(event) => onChange({ title: event.target.value })} placeholder={language === 'ko' ? '무엇을 해야 하나요?' : 'What needs to be done?'} required value={draft.title} />
          </label>
          <div className="grid min-w-0 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-3">
            <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-muted-foreground">
              {dictionary.courseworkCourseCode}
              <select aria-label={dictionary.courseworkCourseCode} className={fieldClass} disabled={disabled} onChange={(event) => {
                const value = event.target.value;
                setCustomCourse(value === '__custom__');
                const course = courseOptions.find((option) => option.value === value);
                onChange({ courseCode: value === '__custom__' ? '' : value, semester: course?.semester ?? draft.semester });
              }} value={customCourse ? '__custom__' : draft.courseCode}>
                <option value="">{language === 'ko' ? '과목 없음' : 'No course'}</option>
                {courseOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                <option value="__custom__">{dictionary.courseworkCustomCourseCode}</option>
              </select>
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-muted-foreground">
              {dictionary.courseworkType}
              <select aria-label={dictionary.courseworkType} className={fieldClass} disabled={disabled} onChange={(event) => onChange({ courseworkType: event.target.value })} value={draft.courseworkType || 'study'}>
                {typeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          {customCourse ? <Input aria-label={dictionary.courseworkCustomCourseCode} className="h-11" disabled={disabled} onChange={(event) => onChange({ courseCode: event.target.value })} placeholder={dictionary.courseworkCustomCourseCode} value={draft.courseCode} /> : null}
          <div className="grid gap-2">
            <PhoneDateTimeField disabled={disabled} label={dictionary.courseworkDueAt} onChange={(dueAt) => onChange({ dueAt })} value={draft.dueAt} />
            <div className="flex gap-2">
              {[0, 1].map((offset) => (
                <Button className="h-11 flex-1 text-xs" disabled={disabled} key={offset} onClick={() => onChange({ dueAt: `${localDate(offset)}T${draft.dueAt.slice(11, 16) || '23:59'}` })} type="button" variant="outline">
                  {offset === 0 ? dictionary.itemLabels.today : language === 'ko' ? '내일' : 'Tomorrow'}
                </Button>
              ))}
              {draft.dueAt ? <Button aria-label={language === 'ko' ? '마감일 지우기' : 'Clear due date'} className="size-11" disabled={disabled} onClick={() => onChange({ dueAt: '' })} type="button" variant="ghost"><X className="size-4" /></Button> : null}
            </div>
          </div>

          <details className="group rounded-lg border p-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold">
              {language === 'ko' ? '추가 옵션' : 'More options'}<ChevronDown className="size-4 group-open:rotate-180" />
            </summary>
            <div className="grid gap-4 pt-3">
              <PhoneDateTimeField defaultTime="09:00" disabled={disabled} label={dictionary.calendarTodoStartAt} onChange={(startAt) => onChange({ startAt })} value={draft.startAt} />
              <PhoneDateTimeField disabled={disabled} label={dictionary.courseworkActualEndAt} onChange={(endAt) => onChange({ endAt })} value={draft.endAt} />
              <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-muted-foreground">
                {dictionary.courseworkSubmissionType}
                <select aria-label={dictionary.courseworkSubmissionType} className={fieldClass} disabled={disabled} onChange={(event) => onChange({ submissionType: event.target.value })} value={draft.submissionType}>
                  <option value="">{dictionary.courseworkSelectSubmissionType}</option>
                  {submissionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>
          </details>
        </div>
        <div className="mt-auto shrink-0 border-t bg-popover p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button className="h-12 w-full text-base font-semibold" disabled={disabled || !draft.title.trim()} type="submit">{submitLabel}</Button>
        </div>
      </form>
    </DialogContent>
  );
}
