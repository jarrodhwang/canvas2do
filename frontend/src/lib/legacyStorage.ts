const legacyStorageKeys = [
  'incos-workspace-theme',
  'incos-workspace-language',
] as const;

/**
 * Copies non-account appearance preferences from the previous product keyspace.
 * Academy records are deliberately not auto-imported from browser storage because
 * those old values are not cryptographically bound to the newly signed-in user.
 */
export function migrateLegacyLocalStorage() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    for (const legacyKey of legacyStorageKeys) {
      const nextKey = legacyKey.replace(/^incos-(?:workspace-|academy-)/, 'canvas-to-do-');

      if (window.localStorage.getItem(nextKey) !== null) {
        continue;
      }

      const legacyValue = window.localStorage.getItem(legacyKey);

      if (legacyValue !== null) {
        window.localStorage.setItem(nextKey, legacyValue);
      }
    }
  } catch {
    // Privacy modes can deny storage access. The app remains usable with defaults.
  }
}
