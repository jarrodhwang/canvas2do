import type { ColorToken } from '@/modes/types';

export const badgeColorClasses: Record<ColorToken, string> = {
  blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/25 dark:bg-blue-400/10 dark:text-blue-200',
  green:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200',
  orange:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-primary/35 dark:bg-primary/15 dark:text-primary',
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-200',
  purple:
    'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/25 dark:bg-violet-400/10 dark:text-violet-200',
  teal: 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-400/25 dark:bg-teal-400/10 dark:text-teal-200',
  gold: 'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-primary/35 dark:bg-primary/15 dark:text-primary',
  gray: 'border-neutral-200 bg-neutral-100 text-neutral-600 dark:border-white/10 dark:bg-white/10 dark:text-muted-foreground',
};

export const dotColorClasses: Record<ColorToken, string> = {
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  orange: 'bg-amber-500',
  red: 'bg-red-500',
  purple: 'bg-violet-500',
  teal: 'bg-teal-500',
  gold: 'bg-yellow-500',
  gray: 'bg-neutral-500',
};

export const timelineTextClasses: Record<ColorToken, string> = {
  blue: 'text-blue-600 dark:text-blue-300',
  green: 'text-emerald-600 dark:text-emerald-300',
  orange: 'text-amber-600 dark:text-primary',
  red: 'text-red-600 dark:text-red-300',
  purple: 'text-violet-600 dark:text-violet-300',
  teal: 'text-teal-600 dark:text-teal-300',
  gold: 'text-yellow-700 dark:text-primary',
  gray: 'text-neutral-500 dark:text-muted-foreground',
};

export const trackGradientClasses: Record<ColorToken, string> = {
  blue: 'from-blue-500 to-indigo-500',
  green: 'from-emerald-500 to-teal-500',
  orange: 'from-primary to-yellow-500 text-primary-foreground',
  red: 'from-red-500 to-rose-400',
  purple: 'from-violet-500 to-fuchsia-400',
  teal: 'from-teal-500 to-cyan-400',
  gold: 'from-primary to-yellow-500 text-primary-foreground',
  gray: 'from-neutral-500 to-neutral-400',
};
