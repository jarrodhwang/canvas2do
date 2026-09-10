/** Canvas calendar and assignment endpoints describe the same assignment with different IDs. */
export function getCanvasItemId(id: string, value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return id;
  const item = value as Record<string, unknown>;
  const canonical = /^canvas-assignment-(\d+)-(\d+)$/.exec(id);
  const legacy = /^canvas-assignment-assignment_(\d+)$/.exec(id);
  let urlMatch: RegExpExecArray | null = null;
  if (typeof item.htmlUrl === 'string') {
    try {
      urlMatch = /^\/courses\/(\d+)\/assignments\/(\d+)\/?$/.exec(new URL(item.htmlUrl).pathname);
    } catch { /* Older snapshots may not have an absolute Canvas URL. */ }
  }
  const courseId = item.courseId || canonical?.[1] || urlMatch?.[1];
  const assignmentId = item.assignmentId || canonical?.[2] || urlMatch?.[2] || legacy?.[1];
  return courseId && assignmentId ? `canvas-assignment-${courseId}-${assignmentId}` : id;
}

/** Merge old source aliases without discarding edits or protected submission state. */
export function normalizeCanvasItemPreferences<T>(preferences: Record<string, T>): Record<string, T> {
  const result: Record<string, T> = {};
  const entries = Object.entries(preferences);
  // Prefer fields from an already canonical snapshot over an older alias.
  entries.sort(([idA, a], [idB, b]) =>
    Number(getCanvasItemId(idA, a) === idA) - Number(getCanvasItemId(idB, b) === idB));
  for (const [id, value] of entries) {
    const key = getCanvasItemId(id, value);
    const previous = result[key];
    if (previous && value && typeof previous === 'object' && typeof value === 'object') {
      const merged = { ...previous, ...value } as Record<string, unknown>;
      for (const flag of ['hidden', 'completed', 'starred', 'isSubmitted']) {
        if ((previous as Record<string, unknown>)[flag] === true ||
            (value as Record<string, unknown>)[flag] === true) merged[flag] = true;
      }
      result[key] = merged as T;
    } else {
      result[key] = value;
    }
  }
  return result;
}
