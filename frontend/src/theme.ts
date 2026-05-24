export type AppTheme = 'light' | 'dark';

export const defaultTheme: AppTheme = 'dark';

export function getInitialTheme(): AppTheme {
  if (typeof window === 'undefined') {
    return defaultTheme;
  }

  const storedTheme = window.localStorage.getItem('incos-workspace-theme');

  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme;
  }

  return defaultTheme;
}

export function applyTheme(theme: AppTheme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem('incos-workspace-theme', theme);
}
