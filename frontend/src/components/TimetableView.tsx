import { CalendarDays, Clock3 } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { badgeColorClasses } from '../lib/colorStyles';
import { cn } from '../lib/utils';
import { EventPill } from './EventPill';
import { getTimetableWeek, layoutTimetableDay, type TimetableSession } from './timetableLayout';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';

interface TimetableViewProps {
  sessions: TimetableSession[];
  selectedDateIso: string;
  todayIso?: string;
  isPhone?: boolean;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function TimetableView({ sessions, selectedDateIso, todayIso, isPhone = false }: TimetableViewProps) {
  const { language } = useLanguage();
  const [selectedSession, setSelectedSession] = useState<TimetableSession | null>(null);
  const [showWeekends, setShowWeekends] = useState(false);
  const locale = language === 'ko' ? 'ko-KR' : 'en-US';
  const days = getTimetableWeek(selectedDateIso);
  const layouts = days.map((day) => layoutTimetableDay(sessions, day));
  const blocks = layouts.flat();
  const includeWeekends = showWeekends || layouts.slice(5).some((layout) => layout.length > 0);
  const visibleDays = includeWeekends ? days : days.slice(0, 5);
  const startHour = blocks.length ? Math.floor(Math.min(...blocks.map((block) => block.start)) / 60) : 8;
  const endHour = blocks.length ? Math.ceil(Math.max(...blocks.map((block) => block.end)) / 60) : 18;
  const duration = Math.max(60, (endHour - startHour) * 60);
  const timeLabel = (minute: number) => new Date(2000, 0, 1, 0, minute).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const sessionTime = (session: TimetableSession, start: number, end: number) => session.endAt
    ? `${timeLabel(start)} – ${timeLabel(end)}`
    : `${timeLabel(start)} · ${language === 'ko' ? '종료 시간 없음' : 'End not set'}`;
  const canceledLabel = language === 'ko' ? '휴강' : 'Canceled';
  const emptyState = () => (
    <div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/20 p-5 text-center" role="status">
      <CalendarDays aria-hidden="true" className="size-6 text-muted-foreground" />
      <p className="text-sm font-bold">{language === 'ko' ? '이번 주에는 수업이 없습니다' : 'No classes this week'}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{language === 'ko' ? '과목에서 수업 요일, 시간, 기간을 설정하세요.' : 'Add meeting days, times, and dates in your courses.'}</p>
    </div>
  );

  return (
    <>
      <section aria-label={language === 'ko' ? '주간 시간표' : 'Weekly timetable'} className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-2', isPhone ? 'w-full' : 'h-full overflow-hidden')}>
        <div className="flex shrink-0 items-center justify-between gap-2 px-1 text-xs">
          <span className="text-muted-foreground">{language === 'ko' ? `이번 주 수업 ${blocks.length}개` : `${blocks.length} ${blocks.length === 1 ? 'class' : 'classes'} this week`}</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 rounded-full px-2 text-[11px]" aria-pressed={includeWeekends} disabled={layouts.slice(5).some((layout) => layout.length > 0)} onClick={() => setShowWeekends((value) => !value)}>{language === 'ko' ? '주말' : 'Weekends'}</Button>
        </div>
        {blocks.length ? <div className={cn('timetable-grid grid min-h-0 min-w-0 flex-1 gap-x-1', isPhone && 'h-[clamp(360px,calc(100dvh-270px),680px)] flex-none gap-x-0.5')} style={{ gridTemplateColumns: `${isPhone ? 30 : 42}px repeat(${visibleDays.length}, minmax(0, 1fr))`, gridTemplateRows: `${isPhone ? 42 : 34}px minmax(0, 1fr)` }}>
          <div className="flex items-center justify-center text-muted-foreground"><Clock3 aria-label={language === 'ko' ? '시간' : 'Time'} className="size-3.5" /></div>
          {visibleDays.map((day) => <div key={dateKey(day)} className="flex min-w-0 items-start justify-center">
            <span aria-current={dateKey(day) === todayIso ? 'date' : undefined} className={cn('flex max-w-full items-center gap-1.5 rounded-full border bg-muted/60 px-2.5 py-1 text-[11px] font-semibold', isPhone && 'flex-col gap-0 rounded-lg px-1 py-1 text-[10px]', dateKey(day) === todayIso && 'border-primary/40 bg-primary/15 text-foreground')}>
              <span>{day.toLocaleDateString(locale, { weekday: 'short' })}</span><span className="font-black">{day.getDate()}</span>
            </span>
          </div>)}
          <div className={cn('relative min-h-0 text-right text-[10px] tabular-nums text-muted-foreground', isPhone && 'text-[9px]')}>
            {Array.from({ length: endHour - startHour + 1 }, (_, index) => <span key={index} className="absolute right-1 whitespace-nowrap" style={{ top: `${index * 60 / duration * 100}%`, transform: index === 0 ? undefined : 'translateY(-100%)' }}>{new Date(2000, 0, 1, startHour + index).toLocaleTimeString(locale, { hour: 'numeric' })}</span>)}
          </div>
          {visibleDays.map((day, index) => <div key={dateKey(day)} className="relative min-h-0 min-w-0 overflow-hidden rounded-lg border bg-muted/10">
            {Array.from({ length: (endHour - startHour) * 2 }, (_, line) => <div aria-hidden="true" key={line} className={cn('pointer-events-none absolute w-full border-t', line % 2 ? 'border-border/25' : 'border-border/70')} style={{ top: `${line * 30 / duration * 100}%` }} />)}
            {layouts[index].map(({ session, start, end, lane, lanes }) => {
              const detail = [session.title, sessionTime(session, start, end), session.location, session.isCanceledForHoliday ? `${canceledLabel} · ${session.holidayName ?? ''}` : ''].filter(Boolean).join('\n');
              return <button key={session.id} type="button" aria-label={detail} title={detail} onClick={() => setSelectedSession(session)}
                className={cn('timetable-class absolute flex min-w-0 flex-col items-start overflow-hidden rounded-lg border px-1.5 py-1 text-left outline-none transition-shadow hover:z-10 hover:shadow-sm focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', badgeColorClasses[session.color], isPhone && 'rounded-md px-1 py-1', session.isCanceledForHoliday && 'opacity-60')}
                style={{ top: `calc(${(start - startHour * 60) / duration * 100}% + 1px)`, height: `max(8px, calc(${(end - start) / duration * 100}% - 2px))`, left: `calc(${lane / lanes * 100}% + ${isPhone ? 1 : 2}px)`, width: `calc(${100 / lanes}% - ${isPhone ? 2 : 4}px)`, containerType: 'size' } as CSSProperties}>
                <span className={cn('block w-full text-[11px] font-bold leading-tight', isPhone ? 'line-clamp-2 text-[10px] [overflow-wrap:anywhere]' : 'truncate', session.isCanceledForHoliday && 'line-through')}>{isPhone ? (session.courseCode || session.title).replace(/([A-Za-z])(\d)/g, '$1 $2') : session.courseCode || session.title}</span>
                <span className={cn('timetable-class-meta block w-full truncate text-[10px] leading-tight', isPhone && 'text-[9px]')}>{session.isCanceledForHoliday ? canceledLabel : session.type}</span>
                <span className={cn('timetable-class-time mt-0.5 block w-full text-[9px] leading-tight', isPhone ? '[overflow-wrap:anywhere]' : 'truncate')}>{sessionTime(session, start, end)}</span>
                {session.location ? <span className="timetable-class-location mt-0.5 block w-full truncate text-[9px] leading-tight">{session.location}</span> : null}
              </button>;
            })}
          </div>)}
        </div> : emptyState()}
      </section>
      <Dialog open={Boolean(selectedSession)} onOpenChange={(open) => { if (!open) setSelectedSession(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedSession?.title}</DialogTitle>
            <DialogDescription>{language === 'ko' ? '수업 일정' : 'Class schedule'}</DialogDescription>
          </DialogHeader>
          {selectedSession ? <div className="space-y-3 text-sm">
            <EventPill color={selectedSession.color} label={selectedSession.courseCode || selectedSession.title} className="rounded-full" />
            <p>{selectedSession.startAt ? new Date(selectedSession.startAt).toLocaleString(locale, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}{selectedSession.endAt ? ` – ${new Date(selectedSession.endAt).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}` : (language === 'ko' ? ' · 종료 시간 없음' : ' · End time not set')}</p>
            {selectedSession.location ? <p className="break-words">{selectedSession.location}</p> : null}
            {selectedSession.isCanceledForHoliday ? <p className="font-bold text-muted-foreground">{canceledLabel} · {selectedSession.holidayName}</p> : null}
          </div> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
