import type { WorkspaceModeConfig } from './types';

/**
 * Canvas To Do is intentionally a single-purpose product. Authorization still
 * filters the sidebar per user, but there is no Workspace/Admin mode switch.
 */
export const defaultModeConfigs: WorkspaceModeConfig[] = [
  {
    id: 'academy',
    displayName: 'Canvas To Do',
    icon: 'graduation-cap',
    views: ['month', 'agenda', 'board'],
    sidebar: [
      {
        id: 'menu',
        label: 'Menu',
        items: [
          { id: 'dashboard', label: 'Calendar', icon: 'calendar-days' },
          { id: 'courses', label: 'Courses', icon: 'book-open' },
          { id: 'grades', label: 'Grades', icon: 'bar-chart-3' },
          { id: 'inbox', label: 'Inbox', icon: 'inbox' },
          { id: 'people', label: 'People', icon: 'users' },
          { id: 'settings', label: 'Settings', icon: 'settings' },
          { id: 'admin-users', label: 'User management', icon: 'users' },
        ],
      },
    ],
    dashboardCards: [
      {
        id: 'semester-lectures',
        title: 'Courses',
        color: 'green',
        layout: 'agenda',
        maxRows: 5,
        rows: [],
      },
      {
        id: 'upcoming-coursework',
        title: 'Coursework',
        color: 'blue',
        layout: 'agenda',
        rows: [],
      },
    ],
    calendar: {
      subtitle: '',
    },
    board: { columns: [] },
  },
];
