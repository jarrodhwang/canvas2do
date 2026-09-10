import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CalendarRange,
  Columns3,
  GraduationCap,
  Inbox,
  ListChecks,
  Settings,
  Users,
} from 'lucide-react';
import type { ComponentType } from 'react';

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

const iconMap: Record<string, ComponentType<IconProps>> = {
  'bar-chart-3': BarChart3,
  'book-open': BookOpen,
  'calendar-days': CalendarDays,
  'calendar-range': CalendarRange,
  'columns-3': Columns3,
  'graduation-cap': GraduationCap,
  inbox: Inbox,
  'list-checks': ListChecks,
  settings: Settings,
  users: Users,
};

interface WorkspaceIconProps {
  name: string;
  size?: number;
  className?: string;
}

export function WorkspaceIcon({ name, size = 18, className }: WorkspaceIconProps) {
  const Icon = iconMap[name] ?? Settings;

  return <Icon aria-hidden="true" className={className} size={size} strokeWidth={2.2} />;
}
