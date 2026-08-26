import {
  BookOpen,
  BarChart3,
  Boxes,
  Building2,
  Bug,
  CalendarDays,
  CircleAlert,
  ClipboardList,
  Clock,
  Columns3,
  GanttChart,
  GraduationCap,
  Headphones,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Lightbulb,
  Link,
  ListChecks,
  MessageSquare,
  NotebookText,
  Package,
  ReceiptText,
  Rocket,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Sun,
  Tags,
  TriangleAlert,
  UserCog,
  Users,
  Wrench,
} from 'lucide-react';
import type { ComponentType } from 'react';

import { appPath } from '../lib/appPath';
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

function TopTrackIcon({ size = 18, className }: IconProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      height={size}
      src={appPath('/brand/toptrack-icon.ico')}
      style={{ height: size, width: size }}
      width={size}
    />
  );
}

const iconMap: Record<string, ComponentType<IconProps>> = {
  'bar-chart-3': BarChart3,
  'book-open': BookOpen,
  boxes: Boxes,
  'building-2': Building2,
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
  inbox: Inbox,
  'key-round': KeyRound,
  'layout-dashboard': LayoutDashboard,
  'life-buoy': LifeBuoy,
  lightbulb: Lightbulb,
  link: Link,
  'list-checks': ListChecks,
  'message-square': MessageSquare,
  'notebook-text': NotebookText,
  outlook: MicrosoftOutlookIcon,
  package: Package,
  'receipt-text': ReceiptText,
  rocket: Rocket,
  search: Search,
  settings: Settings,
  'sliders-horizontal': SlidersHorizontal,
  star: Star,
  sun: Sun,
  tags: Tags,
  toptrack: TopTrackIcon,
  'triangle-alert': TriangleAlert,
  'user-cog': UserCog,
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
