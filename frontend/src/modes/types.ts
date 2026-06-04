export type WorkspaceView = 'month' | 'agenda' | 'board' | 'timeline';

export type WorkspaceFeature =
  | 'calendar'
  | 'agenda'
  | 'board'
  | 'timeline'
  | 'checklist'
  | 'routines'
  | 'notes'
  | 'issues'
  | 'customers'
  | 'links'
  | 'integrations';

export type ColorToken =
  | 'blue'
  | 'green'
  | 'orange'
  | 'red'
  | 'purple'
  | 'teal'
  | 'gold'
  | 'gray';

export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'date'
  | 'url'
  | 'priority';

export interface ModeAccent {
  primary: string;
  secondary: string;
}

export interface SidebarItemConfig {
  id: string;
  label: string;
  icon: string;
  feature?: WorkspaceFeature;
}

export interface SidebarSectionConfig {
  id: string;
  label: string;
  items: SidebarItemConfig[];
}

export interface DashboardCardConfig {
  id: string;
  kicker?: string;
  title: string;
  pill?: string;
  color?: ColorToken;
  layout?: 'default' | 'agenda' | 'messages' | 'meetings';
  maxRows?: number;
  rows: Array<{
    id?: string;
    label: string;
    value: string;
    description?: string;
    href?: string;
    source?: 'gmail' | 'chat' | 'meet' | 'teams' | 'zoom' | 'docs' | 'slides' | 'sheets' | 'manual';
  }>;
}

export interface FilterOptionConfig {
  id: string;
  label: string;
  color: ColorToken;
  defaultChecked?: boolean;
}

export interface FilterGroupConfig {
  id: string;
  label: string;
  options: FilterOptionConfig[];
}

export interface CalendarItemTypeConfig {
  id: string;
  label: string;
  color: ColorToken;
  marker: 'dot' | 'line' | 'due' | 'meeting' | 'milestone';
}

export interface BoardColumnConfig {
  canAdd?: boolean;
  id: string;
  label: string;
  color: ColorToken;
}

export interface DetailFieldConfig {
  id: string;
  label: string;
}

export interface AddItemFieldConfig {
  id: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  fullWidth?: boolean;
  options?: string[];
  placeholder?: string;
}

export interface IntegrationOptionConfig {
  provider:
    | 'google_calendar'
    | 'google_meet'
    | 'google_drive'
    | 'google_docs'
    | 'google_slides'
    | 'google_sheets'
    | 'gmail'
    | 'google_chat'
    | 'microsoft_outlook'
    | 'canvas_lms'
    | 'toptrack'
    | 'topsolid_pdm'
    | 'github'
    | 'manual_url';
  enabled: boolean;
  label: string;
}

export interface WorkspaceModeConfig {
  id: string;
  displayName: string;
  icon: string;
  enabled: boolean;
  hidden?: boolean;
  purpose: string;
  accent: ModeAccent;
  features: WorkspaceFeature[];
  views: WorkspaceView[];
  sidebar: SidebarSectionConfig[];
  dashboardCards: DashboardCardConfig[];
  filters: FilterGroupConfig[];
  calendar: {
    title: string;
    subtitle: string;
    itemTypes: CalendarItemTypeConfig[];
    behavior: string[];
  };
  board: {
    columns: BoardColumnConfig[];
  };
  detailFields: DetailFieldConfig[];
  addItemFields: AddItemFieldConfig[];
  timeline: {
    label: string;
    behavior: string;
  };
  integrations: IntegrationOptionConfig[];
}

export interface ModeVisibilityOverride {
  enabled?: boolean;
  hidden?: boolean;
  displayName?: string;
}
