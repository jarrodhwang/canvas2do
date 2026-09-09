import type { CanvasTokenStatus } from '../api/canvasToDoApi';

export function shouldPromptForCanvasToken(status: CanvasTokenStatus | null, enabled: boolean, dismissed: boolean) {
  return enabled && !dismissed && status !== null && !status.connected &&
    ['needs_connection', 'invalid', 'expired'].includes(status.status);
}

export function canvasSettingsUrl(instanceUrl: string): string | null {
  try {
    const url = new URL(instanceUrl.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return new URL('/profile/settings', url.origin).href;
  } catch {
    return null;
  }
}

export function canvasSchoolLogo(variables: unknown, instanceUrl: string): string {
  if (!variables || typeof variables !== 'object') return '';
  const record = variables as Record<string, unknown>;
  for (const key of ['ic-brand-mobile-global-nav-logo', 'ic-brand-header-image']) {
    const value = record[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const url = new URL(value, instanceUrl);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch { /* Ignore malformed branding; keep the app icon. */ }
  }
  return '';
}
