import {
  BookOpen,
  Boxes,
  Bug,
  CalendarDays,
  CircleAlert,
  ClipboardList,
  Clock,
  Columns3,
  GanttChart,
  GraduationCap,
  Headphones,
  LayoutDashboard,
  LifeBuoy,
  Lightbulb,
  Link,
  ListChecks,
  MessageSquare,
  NotebookText,
  Rocket,
  Search,
  Settings,
  Star,
  Sun,
  Tags,
  TriangleAlert,
  Users,
  Wrench,
} from 'lucide-react';
import type { ComponentType } from 'react';

import { GoogleProductIcon } from './GoogleProductIcon';
import { MicrosoftProductIcon } from './MicrosoftProductIcon';

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function GoogleDriveIcon({ size = 18, className }: IconProps) {
  return <GoogleProductIcon className={className} product="drive" size={size} />;
}

function GoogleGmailIcon({ size = 18, className }: IconProps) {
  return <GoogleProductIcon className={className} product="gmail" size={size} />;
}

function GoogleChatIcon({ size = 18, className }: IconProps) {
  return <GoogleProductIcon className={className} product="chat" size={size} />;
}

function MicrosoftOutlookIcon({ size = 18, className }: IconProps) {
  return <MicrosoftProductIcon className={className} product="outlook" size={size} />;
}

const iconMap: Record<string, ComponentType<IconProps>> = {
  'book-open': BookOpen,
  boxes: Boxes,
  bug: Bug,
  'calendar-days': CalendarDays,
  'circle-alert': CircleAlert,
  'clipboard-list': ClipboardList,
  clock: Clock,
  'columns-3': Columns3,
  'gantt-chart': GanttChart,
  'graduation-cap': GraduationCap,
  gmail: GoogleGmailIcon,
  'google-chat': GoogleChatIcon,
  'google-drive': GoogleDriveIcon,
  headphones: Headphones,
  'layout-dashboard': LayoutDashboard,
  'life-buoy': LifeBuoy,
  lightbulb: Lightbulb,
  link: Link,
  'list-checks': ListChecks,
  'message-square': MessageSquare,
  'notebook-text': NotebookText,
  outlook: MicrosoftOutlookIcon,
  rocket: Rocket,
  search: Search,
  settings: Settings,
  star: Star,
  sun: Sun,
  tags: Tags,
  'triangle-alert': TriangleAlert,
  users: Users,
  wrench: Wrench,
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
