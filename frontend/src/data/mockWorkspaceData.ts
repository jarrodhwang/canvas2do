import type { ColorToken } from '../modes/types';

export interface CalendarEvent {
  id: string;
  title: string;
  color: ColorToken;
  courseLabel?: string;
  displayStyle?: 'dot';
  holidayName?: string;
  isCanceledForHoliday?: boolean;
  type: string;
  time?: string;
}

export interface CalendarDay {
  id: string;
  dateIso?: string;
  dateNumber: number;
  isSunday?: boolean;
  isToday?: boolean;
  outsideMonth?: boolean;
  status: string;
  progress: number;
  progressLabel?: string;
  events: CalendarEvent[];
}

export interface AgendaItem {
  id: string;
  time: string;
  title: string;
  subtitle: string;
  type: string;
  color: ColorToken;
  canOpenDetails?: boolean;
  isCanvasSource?: boolean;
  isArchivedCanvasItem?: boolean;
  holidayName?: string;
  isCanceledForHoliday?: boolean;
  isCompleted?: boolean;
  isLocked?: boolean;
  isStarred?: boolean;
}

export interface BoardItem {
  id: string;
  columnId: string;
  title: string;
  type: string;
  color: ColorToken;
  checklistProgress: string;
  dueAt?: string;
  endAt?: string;
  isCompleted?: boolean;
  isClassSession?: boolean;
  holidayName?: string;
  isCanceledForHoliday?: boolean;
  isLocked?: boolean;
  isTitleEditable?: boolean;
  canOpenDetails?: boolean;
  isCanvasSource?: boolean;
  isArchivedCanvasItem?: boolean;
  isStarred?: boolean;
  time?: string;
}

export interface WorkspaceModeMockData {
  monthLabel: string;
  days: CalendarDay[];
  agenda: AgendaItem[];
  boardItems: BoardItem[];
}

/**
 * Live Canvas data and the signed-in user's private preferences populate this
 * shape at runtime. The empty seed prevents demo or administrator content from
 * appearing while an account loads.
 */
export const academyWorkspaceData: WorkspaceModeMockData = {
  monthLabel: '',
  days: [],
  agenda: [],
  boardItems: [],
};
