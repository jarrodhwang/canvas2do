import assert from 'node:assert/strict';
import { getTimetableWeek, layoutTimetableDay } from '../src/components/timetableLayout.ts';

const session = (id, start, end) => ({ id, title: id, type: 'Lecture', color: 'teal', startAt: start, endAt: end });
const day = new Date('2026-09-10T12:00:00');
const blocks = layoutTimetableDay([
  session('a', '2026-09-10T09:00:00', '2026-09-10T11:00:00'),
  session('b', '2026-09-10T09:30:00', '2026-09-10T10:00:00'),
  session('c', '2026-09-10T10:00:00', '2026-09-10T11:30:00'),
  session('d', '2026-09-10T11:30:00', '2026-09-10T12:00:00'),
], day);
assert.deepEqual(blocks.map(({ lane, lanes }) => [lane, lanes]), [[0, 2], [1, 2], [1, 2], [0, 1]]);
const overnight = layoutTimetableDay([session('night', '2026-09-09T23:00:00', '2026-09-10T01:00:00')], day);
assert.equal(overnight[0].start, 0);
assert.equal(overnight[0].end, 60);
assert.equal(layoutTimetableDay([session('bad', 'invalid', 'invalid'), session('reverse', '2026-09-10T10:00:00', '2026-09-10T09:00:00')], day).length, 0);
assert.equal(layoutTimetableDay([session('missing', '2026-09-10T09:00:00')], day)[0].end, 600);
const week = getTimetableWeek('2027-01-03');
assert.equal(week[0].getFullYear(), 2026);
assert.equal(week[0].getMonth(), 11);
assert.equal(week[0].getDate(), 28);
assert.deepEqual(week.map((date) => date.getDay()), [1, 2, 3, 4, 5, 6, 0]);
assert.equal(getTimetableWeek('2026-03-08')[6].getDate(), 8);
console.log('Timetable layout tests passed.');
