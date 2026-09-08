import type { CanvasCourse } from '../api/canvasToDoApi';

/**
 * A completed enrollment can remain readable in Canvas. Conversion therefore
 * requires both an ended enrollment term and a fresh, explicit closed-access signal;
 * absence from a course-list response is intentionally not evidence of closure.
 */
export function shouldConvertCanvasCourseToManual(
  course: CanvasCourse | undefined,
  now: number,
) {
  if (!course || course.accessClosed !== true) {
    return false;
  }

  const rawTermEndAt = course.termEndAt;
  const termEndAt = rawTermEndAt ? Date.parse(rawTermEndAt) : Number.NaN;

  return Number.isFinite(termEndAt) && termEndAt <= now;
}
