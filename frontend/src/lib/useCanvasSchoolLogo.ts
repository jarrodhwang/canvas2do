import { useEffect, useState } from 'react';
import type { CanvasTokenStatus } from '../api/canvasToDoApi';
import { canvasSchoolLogo, canvasSettingsUrl } from './canvasOnboarding';

export function useCanvasSchoolLogo(status: CanvasTokenStatus | null, enabled: boolean) {
  const [branding, setBranding] = useState({ instanceUrl: '', logo: '' });
  const instanceUrl = enabled && status?.connected ? status.instanceUrl ?? '' : '';

  useEffect(() => {
    if (!canvasSettingsUrl(instanceUrl)) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    // Canvas documents this endpoint as public and CORS-enabled. Never send tokens
    // or cookies to Canvas's branding CDN; a failed lookup must not block sign-in.
    fetch(new URL('/api/v1/brand_variables', instanceUrl), {
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('Branding unavailable');
      const variables: unknown = await response.json();
      if (!controller.signal.aborted) {
        setBranding({ instanceUrl, logo: canvasSchoolLogo(variables, instanceUrl) });
      }
    }).catch(() => {}).finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [instanceUrl]);

  return instanceUrl && branding.instanceUrl === instanceUrl ? branding.logo : '';
}
