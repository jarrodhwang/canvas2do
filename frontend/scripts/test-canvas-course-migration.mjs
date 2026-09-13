import assert from 'node:assert/strict';

import {
  canRestoreConvertedCanvasCourse,
  isConvertedCanvasCourseDeleted,
  isCanvasCoursePublished,
  markConvertedCanvasCoursePermanentlyDeleted,
  shouldConvertCanvasCourseToManual,
} from '../src/lib/canvasCourseMigration.ts';

const now = Date.parse('2026-09-07T12:00:00Z');
const endedTerm = '2026-08-31T23:59:59Z';
const futureTerm = '2026-12-31T23:59:59Z';

assert.equal(
  isCanvasCoursePublished({ isPublished: false, workflowState: 'available' }),
  false,
  'the explicit API publication flag takes precedence',
);

assert.equal(
  isCanvasCoursePublished({ workflowState: 'unpublished' }),
  false,
  'an unpublished Canvas workflow is not published',
);

assert.equal(
  isCanvasCoursePublished({ workflowState: 'available' }),
  true,
  'an available Canvas workflow is published',
);

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
  'absence from an incomplete or unknown Canvas response must not trigger conversion',
);

assert.equal(
  shouldConvertCanvasCourseToManual(undefined, now, {
    courseListIsComplete: true,
    wasPreviouslySeen: true,
  }),
  true,
  'a previously seen course missing from a complete Canvas response should convert',
);

assert.equal(
  shouldConvertCanvasCourseToManual(undefined, now, {
    courseListIsComplete: false,
    wasPreviouslySeen: true,
  }),
  false,
  'a partial historical-course response must not convert a missing course',
);

assert.equal(
  shouldConvertCanvasCourseToManual(undefined, now, {
    courseListIsComplete: true,
    wasPreviouslySeen: false,
  }),
  false,
  'an unverified stored preference must not be promoted to a manual course',
);

const convertedPreference = {
  convertedToManualAt: endedTerm,
  deleted: true,
  hidden: true,
  originalCourseCode: 'CMPT 310',
};
const savedPreferences = {
  '310': convertedPreference,
  '276': { archivedAsManualLectureId: 'archived-276', originalCourseCode: 'CMPT 276' },
  '120': { originalCourseCode: 'CMPT 120' },
};
const deletedPreferences = markConvertedCanvasCoursePermanentlyDeleted(
  'manual-canvas-310', savedPreferences, new Date(now).toISOString(),
);
assert.equal(savedPreferences['310'].permanentlyDeletedAt, undefined, 'deletion does not mutate the previous snapshot');
assert.equal(deletedPreferences['310'].permanentlyDeletedAt, new Date(now).toISOString());
assert.equal(deletedPreferences['310'].deleted, true);
assert.equal(deletedPreferences['310'].hidden, true);
assert.equal(deletedPreferences['310'].convertedToManualAt, endedTerm, 'conversion history survives permanent deletion');
assert.equal(deletedPreferences['120'], savedPreferences['120'], 'other courses are untouched');
assert.deepEqual(
  markConvertedCanvasCoursePermanentlyDeleted('ordinary-manual-course', savedPreferences),
  savedPreferences,
  'deleting an ordinary manual course does not suppress an unrelated Canvas course',
);
assert.ok(markConvertedCanvasCoursePermanentlyDeleted('archived-276', savedPreferences)['276'].permanentlyDeletedAt);
assert.deepEqual(
  markConvertedCanvasCoursePermanentlyDeleted('manual-canvas-310', deletedPreferences),
  deletedPreferences,
  'repeated deletion preserves the original deletion time',
);

assert.equal(isConvertedCanvasCourseDeleted({}, false), false, 'a first conversion may create a manual course');
assert.equal(isConvertedCanvasCourseDeleted(convertedPreference, true), false, 'an existing conversion can retain grades and coursework');
assert.equal(isConvertedCanvasCourseDeleted(convertedPreference, false), true, 'legacy permanently deleted conversions must not be recreated');
const reloadedPreference = JSON.parse(JSON.stringify(deletedPreferences))['310'];
for (const manualCourseExists of [true, false]) {
  assert.equal(isConvertedCanvasCourseDeleted(reloadedPreference, manualCourseExists), true, 'a saved deletion prevents subsequent migrations');
}
assert.equal(canRestoreConvertedCanvasCourse({ accessClosed: false }, convertedPreference), true, 'accessible undeleted conversions can reconnect');
assert.equal(canRestoreConvertedCanvasCourse({ accessClosed: true }, convertedPreference), false);
for (const accessClosed of [false, undefined, true]) {
  assert.equal(canRestoreConvertedCanvasCourse({ accessClosed }, reloadedPreference), false, 'Canvas access returning cannot undo permanent deletion');
}

console.log('Canvas course migration and permanent deletion regression checks passed.');
