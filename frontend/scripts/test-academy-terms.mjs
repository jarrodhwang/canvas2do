import assert from 'node:assert/strict';
import { getAcademyTermOptions, getDateBasedAcademySemester, normalizeAcademyTerm } from '../src/lib/academyTerms.ts';

for (const [month, term] of [[0, 'Spring'], [3, 'Spring'], [4, 'Summer'], [7, 'Summer'], [8, 'Fall'], [11, 'Fall']]) {
  assert.equal(getDateBasedAcademySemester(new Date(2026, month, 15)), `${term} 2026`);
}
assert.equal(getDateBasedAcademySemester(new Date(2027, 0, 1)), 'Spring 2027');
assert.equal(normalizeAcademyTerm(' winter 2000 '), 'Winter 2000');
assert.equal(normalizeAcademyTerm('School Trimester B'), 'School Trimester B');
const preferences = {
  manualLectures: [
    { id: 'current', semester: 'Fall 2026' },
    { id: 'hidden', semester: 'Summer 2025', hidden: true },
    { id: 'winter', semester: 'Winter 2000' },
    { id: 'deleted', semester: 'Spring 2021', deleted: true },
  ],
  manualAssessments: [{ semester: 'Fall 2020' }],
  manualCoursework: [{ semester: 'Fall 2022' }],
  calendarSettings: { selectedSemester: 'Spring 2024' },
  canvasLecturePreferences: { '1': { lastSeenAt: '2026-09-11', semester: 'School Trimester B' }, '2': { deleted: true, semester: 'Spring 2023' } },
};
assert.deepEqual(getAcademyTermOptions(preferences, [], 'Fall 2026'), ['Fall 2026', 'Summer 2025', 'Winter 2000', 'School Trimester B']);
assert.deepEqual(getAcademyTermOptions({}, [], 'Fall 2026'), ['Fall 2026']);
assert.deepEqual(getAcademyTermOptions({ manualLectures: [{ semester: 'Spring 2026' }] }, [], 'School Trimester B'), ['Spring 2026', 'School Trimester B']);
assert.deepEqual(getAcademyTermOptions({ canvasLecturePreferences: { 1: { semester: 'Wrong manual override' } } }, [{ id: '1', termName: 'School Trimester B' }], 'School Trimester B'), ['School Trimester B', 'Wrong manual override']);
assert.deepEqual(getAcademyTermOptions({ canvasLecturePreferences: { 1: { convertedToManualAt: 'now', semester: 'Old' } }, manualLectures: [{ id: 'manual-canvas-1', semester: 'Winter 2026' }] }, [], 'Fall 2026'), ['Fall 2026', 'Winter 2026']);
console.log('PASS seasonal boundaries, current and populated terms, Canvas names, deleted courses and orphan items');

assert.deepEqual(getAcademyTermOptions({ canvasLecturePreferences: { 1: { deleted: true, convertedToManualAt: 'now', semester: 'Fall 2025' } }, manualLectures: [{ id: 'manual-canvas-1', semester: 'Winter 2024' }] }, [{ id: '1', termName: 'Fall 2025', accessClosed: false }], 'Fall 2026'), ['Fall 2026', 'Fall 2025']);
