import type { SidebarSectionConfig, WorkspaceModeConfig } from '../modes/types';

const modeAccessPrefixes: Record<string, string> = {
  academy: 'academy',
};

const sidebarAccessKeys: Record<string, Record<string, string[]>> = {
  academy: {
    dashboard: ['academy-dashboard'],
    courses: ['academy-courses'],
    grades: ['academy-grades'],
    inbox: ['academy-inbox'],
    people: ['academy-people'],
    settings: ['academy-settings-page'],
    'admin-users': ['admin-users'],
  },
};

export function createAccessSet(access?: string[]) {
  return new Set((access ?? []).map((value) => value.trim()).filter(Boolean));
}

export function canAccessSidebarItem(modeId: string, itemId: string, accessSet: ReadonlySet<string>) {
  const keys = sidebarAccessKeys[modeId]?.[itemId] ?? [`${modeAccessPrefixes[modeId] ?? modeId}-${itemId}`];

  return keys.some((key) => accessSet.has(key));
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
