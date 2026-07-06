import type { SidebarSectionConfig, WorkspaceModeConfig } from '../modes/types';

const modeAccessPrefixes: Record<string, string> = {
  academy: 'academy',
  'admin-console': 'admin',
  project: 'workspace',
};

const sidebarAccessKeys: Record<string, Record<string, string[]>> = {
  academy: {
    dashboard: ['academy-dashboard'],
    courses: ['academy-courses'],
    grades: ['academy-grades', 'academy-courses'],
    inbox: ['academy-inbox'],
    outlook: ['academy-outlook'],
    people: ['academy-people'],
    settings: ['academy-settings-page'],
  },
  'admin-console': {
    dashboard: ['admin-dashboard'],
    users: ['admin-users'],
    groups: ['admin-groups'],
    customers: ['admin-customers'],
    licenses: ['admin-licenses'],
    products: ['admin-products'],
    invoices: ['admin-invoices'],
    'settings-general': ['admin-settings-general'],
    permissions: ['admin-permissions'],
    'audit-logs': ['admin-audit-logs'],
    'workspace-mode': ['admin-workspace-mode'],
  },
  project: {
    dashboard: ['workspace-dashboard'],
    project: ['workspace-project', 'workspace'],
    calendar: ['workspace-calendar', 'workspace'],
    board: ['workspace-board'],
    timeline: ['workspace-timeline'],
    issues: ['workspace-issues'],
    bugs: ['workspace-bugs'],
    features: ['workspace-features'],
    customers: ['workspace-customers'],
    colleagues: ['workspace-colleagues'],
    categories: ['workspace-categories'],
    email: ['workspace-email'],
    chat: ['workspace-chat'],
    drive: ['workspace-drive'],
    toptrack: ['workspace-toptrack'],
    links: ['workspace-links'],
    settings: ['workspace-settings'],
  },
};

export function createAccessSet(access?: string[]) {
  return new Set((access ?? []).map((value) => value.trim()).filter(Boolean));
}

export function canAccessSidebarItem(modeId: string, itemId: string, accessSet: ReadonlySet<string>) {
  const keys = sidebarAccessKeys[modeId]?.[itemId] ?? [`${modeAccessPrefixes[modeId] ?? modeId}-${itemId}`];

  return keys.some((key) => accessSet.has(key));
}

export function canAccessMode(mode: WorkspaceModeConfig, accessSet: ReadonlySet<string>) {
  return mode.sidebar.some((section) => (
    section.items.some((item) => canAccessSidebarItem(mode.id, item.id, accessSet))
  ));
}

export function getAccessibleModes(modes: WorkspaceModeConfig[], accessSet: ReadonlySet<string>) {
  return modes.filter((mode) => canAccessMode(mode, accessSet));
}

export function getFirstAccessibleSidebarItem(mode: WorkspaceModeConfig, accessSet: ReadonlySet<string>) {
  for (const section of mode.sidebar) {
    const item = section.items.find((currentItem) => canAccessSidebarItem(mode.id, currentItem.id, accessSet));

    if (item) {
      return item;
    }
  }

  return null;
}

export function filterSidebarSectionsForAccess(
  mode: WorkspaceModeConfig,
  accessSet: ReadonlySet<string>,
): SidebarSectionConfig[] {
  return mode.sidebar
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessSidebarItem(mode.id, item.id, accessSet)),
    }))
    .filter((section) => section.items.length > 0);
}

export function filterModeForAccess(mode: WorkspaceModeConfig, accessSet: ReadonlySet<string>): WorkspaceModeConfig {
  return {
    ...mode,
    sidebar: filterSidebarSectionsForAccess(mode, accessSet),
  };
}

export function hasAccessibleSidebarItem(mode: WorkspaceModeConfig, accessSet: ReadonlySet<string>) {
  return Boolean(getFirstAccessibleSidebarItem(mode, accessSet));
}
