import { cn } from '../lib/utils';

export type CalendarProgressDisplay = 'linear' | 'circular';

export interface CalendarProgressThresholds {
  greenAt: number;
  yellowAt: number;
}

interface CalendarProgressIndicatorProps {
  className?: string;
  display: CalendarProgressDisplay;
  label: string;
  showValueLabel?: boolean;
  size?: 'compact' | 'default';
  thresholds: CalendarProgressThresholds;
  value: number;
  valueLabel?: string;
}

export const defaultCalendarProgressThresholds: CalendarProgressThresholds = {
  greenAt: 70,
  yellowAt: 40,
};

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(Math.round(value), 0), 100);
}

function getProgressTone(value: number, thresholds: CalendarProgressThresholds) {
  if (value >= thresholds.greenAt) {
    return {
      bar: 'bg-emerald-500',
      circle: 'stroke-emerald-500',
      text: 'text-emerald-600 dark:text-emerald-300',
    };
  }

  if (value >= thresholds.yellowAt) {
    return {
      bar: 'bg-amber-400',
      circle: 'stroke-amber-400',
      text: 'text-amber-600 dark:text-amber-300',
    };
  }

  return {
    bar: 'bg-red-500',
    circle: 'stroke-red-500',
    text: 'text-red-600 dark:text-red-300',
  };
}

export function CalendarProgressIndicator({
  className,
  display,
  label,
  showValueLabel = true,
  size = 'default',
  thresholds,
  value,
  valueLabel,
}: CalendarProgressIndicatorProps) {
  const safeValue = clampPercent(value);
  const tone = getProgressTone(safeValue, thresholds);
  const visibleValue = valueLabel ?? `${safeValue}%`;
  const accessibleLabel = valueLabel
    ? `${valueLabel} ${label}, ${safeValue}%`
    : `${safeValue}% ${label}`;

  if (display === 'circular') {
    const radius = size === 'compact' ? 8 : 10;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (safeValue / 100) * circumference;

    return (
      <span
        aria-label={accessibleLabel}
        className={cn(
          'relative grid shrink-0 place-items-center font-black',
          size === 'compact' ? 'size-7 text-[7px]' : 'size-10 text-[10px]',
          tone.text,
          className,
        )}
        title={accessibleLabel}
      >
        <svg
          aria-hidden="true"
          className={cn('absolute inset-0 -rotate-90', size === 'compact' ? 'size-7' : 'size-10')}
          viewBox="0 0 24 24"
        >
          <circle
            className="stroke-muted"
            cx="12"
            cy="12"
            fill="none"
            r={radius}
            strokeWidth={size === 'compact' ? '2.25' : '2.5'}
          />
          <circle
            className={cn('transition-[stroke-dashoffset] duration-300', tone.circle)}
            cx="12"
            cy="12"
            fill="none"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            strokeWidth={size === 'compact' ? '2.25' : '2.5'}
          />
        </svg>
        {showValueLabel ? (
          <span className="relative">{visibleValue}</span>
        ) : null}
      </span>
    );
  }

  return (
    <span
      aria-label={accessibleLabel}
      className={cn(
        'flex min-w-0 items-center gap-1.5',
        size === 'compact' ? 'h-5' : 'h-8',
        className,
      )}
      title={accessibleLabel}
    >
      <span
        className={cn(
          'min-w-0 flex-1 overflow-hidden rounded-full bg-muted',
          size === 'compact' ? 'h-1.5' : 'h-2',
        )}
      >
        <span
          className={cn('block h-full rounded-full transition-[width] duration-300', tone.bar)}
          style={{ width: `${safeValue}%` }}
        />
      </span>
      {showValueLabel ? (
        <span
          className={cn(
            'shrink-0 text-right font-black',
            size === 'compact' ? 'w-8 text-[9px]' : 'w-10 text-xs',
            tone.text,
          )}
        >
          {visibleValue}
        </span>
      ) : null}
    </span>
  );
}
