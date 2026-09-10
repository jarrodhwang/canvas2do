import type { ColorToken } from '../modes/types';

export interface TimetableSession {
  id: string;
  title: string;
  courseCode?: string;
  type: string;
  startAt?: string;
  endAt?: string;
  location?: string;
  color: ColorToken;
  isCanceledForHoliday?: boolean;
  holidayName?: string;
}

export function getTimetableWeek(dateIso: string) {
  const start = new Date(`${dateIso}T12:00:00`);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    return day;
  });
}

export function layoutTimetableDay(sessions: TimetableSession[], date: Date) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const minutes = (value: Date) => value.getHours() * 60 + value.getMinutes();
  const blocks = sessions.flatMap((session) => {
    if (!session.startAt) return [];
    const start = new Date(session.startAt);
    const end = session.endAt ? new Date(session.endAt) : new Date(start.getTime() + 60 * 60_000);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || start >= dayEnd || end <= dayStart) return [];
    return [{ session, start: start < dayStart ? 0 : minutes(start), end: end >= dayEnd ? 1440 : minutes(end), lane: 0, lanes: 1 }];
  }).sort((a, b) => a.start - b.start || b.end - a.end || a.session.id.localeCompare(b.session.id));

  // Connected overlap groups share a lane count; adjacent sessions can reuse a lane.
  let group: typeof blocks = [];
  let groupEnd = -1;
  let laneEnds: number[] = [];
  const finishGroup = () => group.forEach((block) => { block.lanes = laneEnds.length; });
  for (const block of blocks) {
    if (block.start >= groupEnd) {
      finishGroup();
      group = [];
      laneEnds = [];
    }
    let lane = laneEnds.findIndex((end) => end <= block.start);
    if (lane === -1) lane = laneEnds.length;
    block.lane = lane;
    laneEnds[lane] = block.end;
    group.push(block);
    groupEnd = Math.max(...group.map((item) => item.end));
  }
  finishGroup();
  return blocks;
}
