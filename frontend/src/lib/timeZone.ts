export const automaticTimeZone = 'auto';
const settingKey = 'canvas-to-do-time-zone';

export function getBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function getSelectedTimeZone() {
  if (typeof window === 'undefined') return getBrowserTimeZone();
  const selected = window.localStorage.getItem(settingKey);
  return selected && selected !== automaticTimeZone ? selected : getBrowserTimeZone();
}

export function getIsoDateInTimeZone(date: Date, timeZone = getSelectedTimeZone()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function setSelectedTimeZone(value: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(settingKey, value || automaticTimeZone);
}

export function getTimeZoneOptions() {
  const zones = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['America/Vancouver', 'America/Montreal', 'America/Toronto', 'America/New_York', 'America/Los_Angeles', 'UTC'];
  return [...new Set([getBrowserTimeZone(), ...zones])].sort((a, b) => a.localeCompare(b));
}
