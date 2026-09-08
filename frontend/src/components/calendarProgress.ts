export type CalendarProgressDisplay = 'linear' | 'circular';

export interface CalendarProgressThresholds {
  greenAt: number;
  yellowAt: number;
}

export const defaultCalendarProgressThresholds: CalendarProgressThresholds = {
  greenAt: 70,
  yellowAt: 40,
};
