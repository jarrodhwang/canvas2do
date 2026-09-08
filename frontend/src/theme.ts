export type AppTheme = 'light' | 'dark';

export const defaultTheme: AppTheme = 'dark';

export function getInitialTheme(): AppTheme {
  if (typeof window === 'undefined') {
    return defaultTheme;
  }

  const storedTheme = window.localStorage.getItem('canvas-to-do-theme');

  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme;
  }

  return defaultTheme;
}

export function applyTheme(theme: AppTheme, options: { persist?: boolean } = {}) {
  const shouldPersist = options.persist ?? true;

  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  if (shouldPersist) {
    window.localStorage.setItem('canvas-to-do-theme', theme);
  }
}
