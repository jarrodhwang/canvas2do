import assert from 'node:assert/strict';

import { shouldConvertCanvasCourseToManual } from '../src/lib/canvasCourseMigration.ts';

const now = Date.parse('2026-09-07T12:00:00Z');
const endedTerm = '2026-08-31T23:59:59Z';
const futureTerm = '2026-12-31T23:59:59Z';

assert.equal(
  shouldConvertCanvasCourseToManual({
    id: 'cmpt-310-closed',
    name: 'CMPT 310',
    termEndAt: endedTerm,
    accessClosed: true,
  }, now),
  true,
  'an ended course with explicitly closed access should convert',
);

assert.equal(
  shouldConvertCanvasCourseToManual({
    id: 'cmpt-276-readable',
    name: 'CMPT 276',
    termEndAt: endedTerm,
    enrollmentState: 'completed',
    accessClosed: false,
  }, now),
  false,
  'a completed but readable course must remain a Canvas course',
);

assert.equal(
  shouldConvertCanvasCourseToManual({
    id: 'closed-future-course',
    name: 'Future course',
    termEndAt: futureTerm,
    accessClosed: true,
  }, now),
  false,
  'closed access alone must not convert a course before its term ends',
);

assert.equal(
  shouldConvertCanvasCourseToManual({
    id: 'closed-unknown-term',
    name: 'Unknown term',
    accessClosed: true,
  }, now),
  false,
  'a missing term end must fail safely',
);

assert.equal(
  shouldConvertCanvasCourseToManual(undefined, now),
  false,
  'absence from the Canvas response must never trigger conversion',
);

console.log('Canvas course migration regression checks passed.');
