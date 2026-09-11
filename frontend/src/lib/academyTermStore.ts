import { getAcademyTermOptions, getDateBasedAcademySemester, normalizeAcademyTerm, record } from './academyTerms';

let preferences: Record<string, unknown> = {};
let courses: unknown[] = [];
let reportedTerm: string | undefined;
let connected = false;
let ready = false;
const listeners = new Set<() => void>();
let snapshot = { currentTerm: getDateBasedAcademySemester(), options: [getDateBasedAcademySemester()], ready };
function emit() {
  const settings = record(preferences.calendarSettings);
  const currentTerm = connected
    ? normalizeAcademyTerm(reportedTerm ?? settings.lastCanvasTermName)
    : getDateBasedAcademySemester();
  const next = { currentTerm, options: getAcademyTermOptions(preferences, courses, currentTerm), ready };
  if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
  snapshot = next;
  listeners.forEach(listener => listener());
}
export const academyTermStore = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => snapshot,
  reset() { preferences = {}; courses = []; reportedTerm = undefined; connected = false; ready = false; emit(); },
  preferences(value: unknown) { preferences = record(value); ready = true; emit(); },
  courses(value: unknown[], term?: string) { courses = value; reportedTerm = term; connected = true; emit(); },
  connection(status: string, configured: boolean) {
    connected = configured && status !== 'manual_mode';
    if (!connected) { courses = []; reportedTerm = undefined; }
    emit();
  },
};
