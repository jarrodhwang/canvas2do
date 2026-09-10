import { useEffect, useState } from 'react';

// Browser-local layout preferences should never prevent navigation if storage is unavailable.
export function usePersistentBoolean(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === 'true' ? true : stored === 'false' ? false : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // Keep the toggle usable even when the browser cannot save preferences.
    }
  }, [key, value]);

  return [value, setValue] as const;
}
