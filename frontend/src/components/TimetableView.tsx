import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { useLanguage } from '../context/LanguageContext';
import { badgeColorClasses, dotColorClasses } from '../lib/colorStyles';
import { cn } from '../lib/utils';
import { getTimetableWeek, layoutTimetableDay, type TimetableSession } from './timetableLayout';

interface TimetableViewProps {
  sessions: TimetableSession[];
  selectedDateIso: string;
  todayIso?: string;
}

export function TimetableView({ sessions, selectedDateIso, todayIso }: TimetableViewProps) {
  const { language } = useLanguage();
  const [selectedSession, setSelectedSession] = useState<TimetableSession | null>(null);
  const locale = language === 'ko' ? 'ko-KR' : 'en-US';
  const days = getTimetableWeek(selectedDateIso);
  const layouts = days.map((day) => layoutTimetableDay(sessions, day));
  const blocks = layouts.flat();
  const startHour = Math.floor(Math.min(8 * 60, ...blocks.map((block) => block.start)) / 60);
  const endHour = Math.ceil(Math.max(18 * 60, ...blocks.map((block) => block.end)) / 60);
  const hourHeight = 80;
  const height = (endHour - startHour) * hourHeight;
  const hourLabel = (hour: number) => new Date(2000, 0, 1, hour).toLocaleTimeString(locale, { hour: 'numeric' });
  const timeLabel = (minute: number) => new Date(2000, 0, 1, 0, minute).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

  return (
    <>
    <section aria-label={language === 'ko' ? '주간 시간표' : 'Weekly timetable'} className="rounded-xl border bg-card">
      {blocks.length === 0 ? (
        <p className="border-b px-4 py-3 text-sm font-semibold text-muted-foreground" role="status">
          {language === 'ko' ? '이번 주에 예정된 수업이 없습니다. 과목에서 수업 요일, 시간, 기간을 설정하세요.' : 'No classes scheduled this week. Set meeting days, times, and dates in your courses.'}
        </p>
      ) : null}
      <p className="border-b px-3 py-2 text-xs text-muted-foreground min-[521px]:hidden">
        {language === 'ko' ? '옆으로 스크롤하여 한 주를 확인하세요.' : 'Swipe across to see the full week.'}
      </p>
      <div className="grid min-w-[880px]" style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}>
        <div className="sticky left-0 top-0 z-30 flex items-center justify-center border-b bg-muted text-xs font-bold text-muted-foreground">{language === 'ko' ? '시간' : 'Time'}</div>
        {days.map((day) => {
          const isToday = todayIso && day.toDateString() === new Date(`${todayIso}T12:00:00`).toDateString();
          return <div key={day.toISOString()} className={cn('sticky top-0 z-20 border-b border-l bg-muted px-2 py-3 text-center', isToday && 'bg-primary text-primary-foreground')}>
            <div className="text-xs font-bold">{day.toLocaleDateString(locale, { weekday: 'short' })}</div>
            <div className="mt-1 text-sm font-black">{day.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</div>
          </div>;
        })}
        <div className="sticky left-0 z-10 bg-card" style={{ height }}>
          {Array.from({ length: endHour - startHour }, (_, index) => <div key={index} className="absolute w-full pr-2 pt-1 text-right text-[10px] font-bold text-muted-foreground" style={{ top: index * hourHeight }}>{hourLabel(startHour + index)}</div>)}
        </div>
        {layouts.map((layout, index) => <div key={index} className="relative border-l" style={{ height }}>
          {Array.from({ length: (endHour - startHour) * 2 }, (_, line) => <div key={line} className={cn('pointer-events-none absolute w-full border-t', line % 2 ? 'border-border/40' : 'border-border')} style={{ top: line * hourHeight / 2 }} />)}
          {layout.map(({ session, start, end, lane, lanes }) => {
            const detail = [session.title, session.endAt ? `${timeLabel(start)} – ${timeLabel(end)}` : `${timeLabel(start)} · ${language === 'ko' ? '종료 시간 없음' : 'End time not set'}`, session.location, session.isCanceledForHoliday ? `${language === 'ko' ? '휴강' : 'Canceled'} · ${session.holidayName ?? ''}` : ''].filter(Boolean).join('\n');
            return <button key={session.id} type="button" aria-label={detail} title={detail} onClick={() => setSelectedSession(session)}
              className={cn('absolute overflow-hidden rounded-lg border px-2 py-1.5 text-left text-xs outline-none transition-shadow hover:shadow-md focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring', badgeColorClasses[session.color], session.isCanceledForHoliday && 'opacity-60')}
              style={{ top: (start - startHour * 60) / 60 * hourHeight + 2, height: Math.max(4, (end - start) / 60 * hourHeight - 4), left: `calc(${lane / lanes * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)` }}>
              <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', dotColorClasses[session.color])} />
              <span className={cn('block truncate font-black', session.isCanceledForHoliday && 'line-through')}>{session.courseCode || session.title}</span>
              <span className="block truncate font-semibold">{session.type}</span>
              <span className="mt-1 block text-[10px]">{timeLabel(start)}{session.endAt ? ` – ${timeLabel(end)}` : (language === 'ko' ? ' · 종료 시간 없음' : ' · End not set')}</span>
              {session.location ? <span className="mt-1 block truncate text-[10px]">{session.location}</span> : null}
              {session.isCanceledForHoliday ? <span className="block text-[10px] font-bold">{language === 'ko' ? '휴강' : 'Canceled'}</span> : null}
            </button>;
          })}
        </div>)}
      </div>
    </section>
    <Dialog open={Boolean(selectedSession)} onOpenChange={(open) => { if (!open) setSelectedSession(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{selectedSession?.title}</DialogTitle>
          <DialogDescription>{language === 'ko' ? '수업 일정' : 'Class schedule'}</DialogDescription>
        </DialogHeader>
        {selectedSession ? <div className="space-y-3 text-sm">
          <span className={cn('inline-block rounded-md border px-2 py-1 font-bold', badgeColorClasses[selectedSession.color])}>{selectedSession.courseCode || selectedSession.title}</span>
          <p>{selectedSession.startAt ? new Date(selectedSession.startAt).toLocaleString(locale, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}{selectedSession.endAt ? ` – ${new Date(selectedSession.endAt).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}` : (language === 'ko' ? ' · 종료 시간 없음' : ' · End time not set')}</p>
          {selectedSession.location ? <p>{selectedSession.location}</p> : null}
          {selectedSession.isCanceledForHoliday ? <p className="font-bold text-muted-foreground">{language === 'ko' ? '휴강' : 'Canceled'} · {selectedSession.holidayName}</p> : null}
        </div> : null}
      </DialogContent>
    </Dialog>
    </>
  );
}
