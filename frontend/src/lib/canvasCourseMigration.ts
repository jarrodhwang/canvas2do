import type { CanvasCourse } from '../api/canvasToDoApi';

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
