import { useState } from 'react';
import { canvasToDoApi } from '../api/canvasToDoApi';
import { getDateBasedAcademySemester, manualTermNames } from '../lib/academyTerms';
import { useLanguage } from '../context/LanguageContext';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export function CourseTermDialog({ course, onClose }: {
  course: { id: string; name: string; semester?: string }; onClose: () => void;
}) {
  const { language, dictionary } = useLanguage();
  const ko = language === 'ko';
  const currentYear = new Date().getFullYear();
  const match = /^(Spring|Summer|Fall|Winter) (\d{4})$/i.exec(course.semester ?? '') ?? getDateBasedAcademySemester().match(/^(\w+) (\d{4})$/)!;
  const [year, setYear] = useState(String(Math.min(currentYear, Math.max(2000, Number(match[2])))));
  const [term, setTerm] = useState(manualTermNames.find(name => name.toLowerCase() === match[1].toLowerCase()) ?? 'Fall');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try {
      const preferences = await canvasToDoApi.changeManualCourseTerm(course.id, Number(year), term);
      window.dispatchEvent(new CustomEvent('canvas-to-do-preferences-updated', { detail: preferences }));
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to change term.'); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{ko ? '학기 변경' : 'Change term'}</DialogTitle>
        <DialogDescription>{course.name} · {ko ? '과목과 연결된 할 일·평가의 학기를 함께 변경합니다.' : 'Move this course and its saved coursework and assessments together.'}</DialogDescription></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-2 text-sm">{ko ? '연도' : 'Year'}<Select value={year} onValueChange={setYear} disabled={busy}>
          <SelectTrigger aria-label={ko ? '연도' : 'Year'}><SelectValue /></SelectTrigger><SelectContent>
            {Array.from({ length: currentYear - 1999 }, (_, index) => String(currentYear - index)).map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
          </SelectContent></Select></label>
        <label className="grid gap-2 text-sm">{ko ? '학기' : 'Term'}<Select value={term} onValueChange={value => setTerm(value as typeof term)} disabled={busy}>
          <SelectTrigger aria-label={ko ? '학기' : 'Term'}><SelectValue /></SelectTrigger><SelectContent>
            {manualTermNames.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
          </SelectContent></Select></label>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{dictionary.cancel}</Button>
        <Button disabled={busy} onClick={() => void save()}>{busy ? (ko ? '저장 중…' : 'Saving…') : (ko ? '학기 변경' : 'Change term')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
