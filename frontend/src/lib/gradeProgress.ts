export interface GradeProgressColorThresholds {
  greenAt: number;
  yellowAt: number;
}

export const defaultGradeProgressColorThresholds: GradeProgressColorThresholds = {
  greenAt: 75,
  yellowAt: 60,
};

function clampPercent(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeGradeProgressColorThresholds(
  value: unknown,
  fallback: GradeProgressColorThresholds = defaultGradeProgressColorThresholds,
): GradeProgressColorThresholds {
  if (!isRecord(value)) {
    return fallback;
  }

  const rawGreenAt = value.greenAt ?? value.gradeProgressGreenAt;
  const rawYellowAt = value.yellowAt ?? value.gradeProgressYellowAt;
  const greenAt = Number.isFinite(Number(rawGreenAt))
    ? clampPercent(Number(rawGreenAt))
    : fallback.greenAt;
  const yellowAt = Number.isFinite(Number(rawYellowAt))
    ? Math.min(clampPercent(Number(rawYellowAt)), greenAt)
    : Math.min(fallback.yellowAt, greenAt);

  return { greenAt, yellowAt };
}

export function getGradeProgressColor(
  score?: number,
  thresholds: GradeProgressColorThresholds = defaultGradeProgressColorThresholds,
) {
  if (typeof score !== 'number') {
    return '#d6d3c6';
  }

  if (score >= thresholds.greenAt) {
    return '#10b981';
  }

  if (score >= thresholds.yellowAt) {
    return '#f59e0b';
  }

  return '#ef4444';
}
