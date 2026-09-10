export type WorkspaceView = 'month' | 'agenda' | 'board' | 'timetable';

export type ColorToken =
  | 'blue'
  | 'sky'
  | 'cyan'
  | 'green'
  | 'emerald'
  | 'indigo'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'orange'
  | 'red'
  | 'rose'
  | 'crimson'
  | 'coral'
  | 'peach'
  | 'apricot'
  | 'purple'
  | 'violet'
  | 'fuchsia'
  | 'pink'
  | 'magenta'
  | 'lavender'
  | 'lilac'
  | 'plum'
  | 'mauve'
  | 'teal'
  | 'mint'
  | 'aqua'
  | 'turquoise'
  | 'ocean'
  | 'cobalt'
  | 'navy'
  | 'gold'
  | 'lemon'
  | 'olive'
  | 'moss'
  | 'forest'
  | 'slate'
  | 'zinc'
  | 'neutral'
  | 'stone'
  | 'graphite'
  | 'cocoa'
  | 'sand'
  | 'midnight'
  | 'ice'
  | 'butter'
  | 'vanilla'
  | 'cream'
  | 'honeydew'
  | 'pistachio'
  | 'sage'
  | 'seafoam'
  | 'powder'
  | 'babyblue'
  | 'periwinkle'
  | 'wisteria'
  | 'blush'
  | 'cottoncandy'
  | 'peachfuzz'
  | 'softcoral'
  | 'flamingo'
  | 'watermelon'
  | 'tangerine'
  | 'marigold'
  | 'citron'
  | 'neomint'
  | 'jade'
  | 'lagoon'
  | 'serenity'
  | 'veryperi'
  | 'orchid'
  | 'amethyst'
  | 'gray';

export interface SidebarItemConfig {
  id: string;
  label: string;
  icon: string;
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
  layout?: 'default' | 'agenda';
  maxRows?: number;
  rows: Array<{
    id?: string;
    label: string;
    value: string;
    description?: string;
    href?: string;
  }>;
}

export interface BoardColumnConfig {
  canAdd?: boolean;
  id: string;
  label: string;
  color: ColorToken;
}

export interface WorkspaceModeConfig {
  id: string;
  displayName: string;
  icon: string;
  views: WorkspaceView[];
  sidebar: SidebarSectionConfig[];
  dashboardCards: DashboardCardConfig[];
  calendar: {
    subtitle: string;
  };
  board: {
    columns: BoardColumnConfig[];
  };
}
