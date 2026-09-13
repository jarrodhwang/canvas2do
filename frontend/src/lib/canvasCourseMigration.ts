import type { CanvasCourse } from '../api/canvasToDoApi';

export interface CanvasCourseLifecyclePreference {
  archivedAsManualLectureId?: string;
  convertedToManualAt?: string;
  permanentlyDeletedAt?: string;
  deleted?: boolean;
  hidden?: boolean;
}

export function canRestoreConvertedCanvasCourse(
  course: Pick<CanvasCourse, 'accessClosed'>,
  preference: CanvasCourseLifecyclePreference | undefined,
) {
  return Boolean(
    preference?.convertedToManualAt &&
    !preference.permanentlyDeletedAt &&
    course.accessClosed !== true,
  );
}

/** Keep the Canvas identity so future syncs cannot recreate a permanently deleted course. */
export function markConvertedCanvasCoursePermanentlyDeleted<T extends CanvasCourseLifecyclePreference>(
  manualLectureId: string,
  preferences: Record<string, T>,
  deletedAt = new Date().toISOString(),
): Record<string, T> {
  return Object.fromEntries(Object.entries(preferences).map(([courseId, preference]) => [
    courseId,
    manualLectureId === `manual-canvas-${courseId}` || preference.archivedAsManualLectureId === manualLectureId
      ? { ...preference, permanentlyDeletedAt: preference.permanentlyDeletedAt ?? deletedAt, deleted: true, hidden: true }
      : preference,
  ]));
}

/** A completed conversion with a missing manual record represents a previous deletion. */
export function isConvertedCanvasCourseDeleted(
  preference: CanvasCourseLifecyclePreference,
  manualCourseExists: boolean,
) {
  return Boolean(preference.permanentlyDeletedAt || (preference.convertedToManualAt && !manualCourseExists));
}

export function isCanvasCoursePublished(
  course: Pick<CanvasCourse, 'isPublished' | 'workflowState'>,
) {
  return course.isPublished ?? !/^(unpublished|created|claimed)$/i.test(course.workflowState?.trim() ?? '');
}

interface CanvasCourseConversionEvidence {
  /** True only when both active and historical Canvas course queries completed. */
  courseListIsComplete?: boolean;
  /** Prevents an unrelated or malformed stored preference from becoming a course. */
  wasPreviouslySeen?: boolean;
}

/**
 * A returned course converts only after its term ended and Canvas explicitly closed
 * access. A previously seen course that is absent from a complete active+historical
 * response has lost its Canvas connection and can convert immediately.
 */
export function shouldConvertCanvasCourseToManual(
  course: CanvasCourse | undefined,
  now: number,
  evidence: CanvasCourseConversionEvidence = {},
) {
  if (!course) {
    return evidence.courseListIsComplete === true && evidence.wasPreviouslySeen === true;
  }

  if (course.accessClosed !== true) {
    return false;
  }

  const rawTermEndAt = course.termEndAt;
  const termEndAt = rawTermEndAt ? Date.parse(rawTermEndAt) : Number.NaN;

  return Number.isFinite(termEndAt) && termEndAt <= now;
}
