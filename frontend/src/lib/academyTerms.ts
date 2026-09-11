import { compareSemestersNewestFirst } from './semesterSort.ts';

export const manualTermNames = ['Spring', 'Summer', 'Fall', 'Winter'] as const;
export function getDateBasedAcademySemester(date = new Date()) {
  return `${date.getMonth() < 4 ? 'Spring' : date.getMonth() < 8 ? 'Summer' : 'Fall'} ${date.getFullYear()}`;
}
export function normalizeAcademyTerm(value: unknown, fallback = getDateBasedAcademySemester()): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const term = value.trim();
  const seasonal = /^(spring|summer|fall|winter)\s+(\d{4})$/i.exec(term);
  if (seasonal) return `${seasonal[1][0].toUpperCase()}${seasonal[1].slice(1).toLowerCase()} ${seasonal[2]}`;
  return /^default term$/i.test(term) ? 'Default Term' : term;
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Include hidden courses, but never deleted courses, orphan tasks or an empty selection. */
export function getAcademyTermOptions(preferences: unknown, courses: unknown[] = [], currentTerm = getDateBasedAcademySemester()) {
  const prefs = record(preferences);
  const saved = record(prefs.canvasLecturePreferences);
  const terms = new Set([normalizeAcademyTerm(currentTerm)]);
  const seen = new Set<string>();
  const accessibleIds = new Set(courses.map(record).filter(course => course.accessClosed !== true).map(course => String(course.id ?? '')));
  const suppressedManualIds = new Set([...accessibleIds].flatMap(id => {
    const archivedId = record(saved[id]).archivedAsManualLectureId;
    return [`manual-canvas-${id}`, ...(typeof archivedId === 'string' ? [archivedId] : [])];
  }));
  for (const value of courses) {
    const course = record(value);
    const id = String(course.id ?? '');
    seen.add(id);
    const preference = record(saved[id]);
    const restoredConversion = preference.convertedToManualAt && course.accessClosed !== true;
    if (course.accessClosed || (preference.deleted && !restoredConversion)) continue;
    terms.add(normalizeAcademyTerm(preference.semester ?? preference.termName ?? course.termName, 'Default Term'));
  }
  for (const [id, value] of Object.entries(saved)) {
    const course = record(value);
    if (seen.has(id) || course.deleted || course.convertedToManualAt || course.archivedAsManualLectureId) continue;
    if (!course.lastSeenAt && !course.courseName && !course.originalCourseCode) continue;
    terms.add(normalizeAcademyTerm(course.semester ?? course.termName, currentTerm));
  }
  for (const value of Array.isArray(prefs.manualLectures) ? prefs.manualLectures : []) {
    const course = record(value);
    if (!course.deleted && !suppressedManualIds.has(String(course.id ?? ''))) {
      terms.add(normalizeAcademyTerm(course.semester));
    }
  }
  return [...terms].sort(compareSemestersNewestFirst);
}
