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
  timelineBar?: {
    label: string;
    color: ColorToken;
  };
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

export interface TimelineItem {
  id: string;
  name: string;
  offsetPercent: number;
  widthPercent: number;
  label: string;
  color: ColorToken;
  canOpenDetails?: boolean;
  isCanvasSource?: boolean;
  isArchivedCanvasItem?: boolean;
  isCompleted?: boolean;
  isLocked?: boolean;
  isStarred?: boolean;
}

export interface LinkItem {
  id: string;
  label: string;
  provider: string;
  url: string;
}

export interface DetailItem {
  id: string;
  title: string;
  description: string;
  fields: Record<string, string>;
  checklist: Array<{
    id: string;
    label: string;
    done: boolean;
  }>;
  links: LinkItem[];
  notes: string;
}

export interface WorkspaceModeMockData {
  monthLabel: string;
  days: CalendarDay[];
  agenda: AgendaItem[];
  boardItems: BoardItem[];
  timeline: TimelineItem[];
  detailItem: DetailItem;
}

const academyDays: CalendarDay[] = [
  {
    id: 'academy-0427',
    dateNumber: 27,
    outsideMonth: true,
    status: 'Reset',
    progress: 20,
    events: [{ id: 'old-review', title: 'Previous week review', color: 'gray', type: 'note' }],
  },
  { id: 'academy-0428', dateNumber: 28, outsideMonth: true, status: 'Light', progress: 20, events: [] },
  {
    id: 'academy-0429',
    dateNumber: 29,
    outsideMonth: true,
    status: 'Review',
    progress: 30,
    events: [{ id: 'review-notes', title: 'Review notes', color: 'green', type: 'routine' }],
  },
  {
    id: 'academy-0430',
    dateNumber: 30,
    outsideMonth: true,
    status: 'Focus',
    progress: 55,
    events: [{ id: 'reading', title: 'ENG reading prep', color: 'purple', type: 'lecture' }],
  },
  {
    id: 'academy-0501',
    dateNumber: 1,
    status: 'Focused',
    progress: 80,
    events: [
      { id: 'cs101-lecture-1', title: 'CS101 Lecture', color: 'green', type: 'lecture' },
      { id: 'study-routine-1', title: 'Study routine', color: 'blue', type: 'routine' },
    ],
  },
  {
    id: 'academy-0502',
    dateNumber: 2,
    status: 'Steady',
    progress: 60,
    events: [{ id: 'eng-reading', title: 'ENG Reading', color: 'purple', type: 'lecture' }],
  },
  { id: 'academy-0503', dateNumber: 3, status: 'Light', progress: 40, events: [] },
  {
    id: 'academy-0504',
    dateNumber: 4,
    status: 'Focused',
    progress: 70,
    events: [{ id: 'math-practice', title: 'Math Practice', color: 'orange', type: 'study' }],
  },
  {
    id: 'academy-0505',
    dateNumber: 5,
    status: 'Focused',
    progress: 90,
    events: [{ id: 'cs101-lecture-2', title: 'CS101 Lecture', color: 'green', type: 'lecture' }],
  },
  {
    id: 'academy-0506',
    dateNumber: 6,
    status: 'Start',
    progress: 75,
    events: [{ id: 'assignment-a-start', title: 'Assignment A start', color: 'blue', type: 'assignment' }],
    timelineBar: { label: 'Assignment A', color: 'blue' },
  },
  {
    id: 'academy-0507',
    dateNumber: 7,
    status: 'Review',
    progress: 55,
    events: [{ id: 'quiz-review', title: 'Quiz Review', color: 'orange', type: 'quiz' }],
    timelineBar: { label: 'Assignment A', color: 'blue' },
  },
  {
    id: 'academy-0508',
    dateNumber: 8,
    status: 'Quiz',
    progress: 80,
    events: [{ id: 'math-quiz', title: 'MATH202 Quiz', color: 'orange', type: 'quiz' }],
    timelineBar: { label: 'Assignment A', color: 'blue' },
  },
  {
    id: 'academy-0509',
    dateNumber: 9,
    status: 'Tired',
    progress: 35,
    events: [{ id: 'exam-prep', title: 'Exam prep', color: 'red', type: 'exam' }],
    timelineBar: { label: 'Assignment A', color: 'blue' },
  },
  {
    id: 'academy-0510',
    dateNumber: 10,
    status: 'Due',
    progress: 85,
    events: [{ id: 'assignment-a-due', title: 'Assignment due', color: 'red', type: 'assignment' }],
  },
  {
    id: 'academy-0511',
    dateNumber: 11,
    status: 'Link',
    progress: 50,
    events: [{ id: 'office-hour', title: 'Office hour link', color: 'teal', type: 'meeting' }],
  },
  {
    id: 'academy-0512',
    dateNumber: 12,
    status: 'Lecture',
    progress: 80,
    events: [{ id: 'eng-lecture', title: 'ENG Lecture', color: 'purple', type: 'lecture' }],
  },
  {
    id: 'academy-0513',
    dateNumber: 13,
    status: 'Draft',
    progress: 65,
    events: [{ id: 'essay-draft-start', title: 'Essay draft start', color: 'purple', type: 'assignment' }],
    timelineBar: { label: 'Essay Draft', color: 'purple' },
  },
  {
    id: 'academy-0514',
    dateNumber: 14,
    status: 'Lab',
    progress: 55,
    events: [{ id: 'cs-lab', title: 'CS Lab', color: 'green', type: 'lecture' }],
    timelineBar: { label: 'Essay Draft', color: 'purple' },
  },
  {
    id: 'academy-0515',
    dateNumber: 15,
    status: 'Due',
    progress: 92,
    events: [{ id: 'essay-draft-due', title: 'Essay draft due', color: 'purple', type: 'assignment' }],
  },
  { id: 'academy-0516', dateNumber: 16, status: 'Light', progress: 20, events: [] },
  {
    id: 'academy-0517',
    dateNumber: 17,
    status: 'Reset',
    progress: 30,
    events: [{ id: 'weekly-review', title: 'Weekly review', color: 'blue', type: 'routine' }],
  },
  {
    id: 'academy-0518',
    dateNumber: 18,
    status: 'Lecture',
    progress: 90,
    events: [{ id: 'cs101-lecture-3', title: 'CS101 Lecture', color: 'green', type: 'lecture' }],
  },
  {
    id: 'academy-0519',
    dateNumber: 19,
    status: 'Group',
    progress: 70,
    events: [{ id: 'study-group', title: 'Study group link', color: 'teal', type: 'meeting' }],
  },
  {
    id: 'academy-0520',
    dateNumber: 20,
    status: 'Practice',
    progress: 60,
    events: [{ id: 'math-homework', title: 'MATH202 homework', color: 'orange', type: 'assignment' }],
  },
  {
    id: 'academy-0521',
    dateNumber: 21,
    status: 'Review',
    progress: 80,
    events: [{ id: 'exam-review', title: 'Exam review', color: 'red', type: 'exam' }],
  },
  {
    id: 'academy-0522',
    dateNumber: 22,
    status: 'Exam',
    progress: 35,
    events: [{ id: 'midterm', title: 'Midterm Exam', color: 'red', type: 'exam' }],
  },
  { id: 'academy-0523', dateNumber: 23, status: 'Light', progress: 25, events: [] },
  {
    id: 'academy-0524',
    dateNumber: 24,
    status: 'Reset',
    progress: 40,
    events: [{ id: 'routine-reset', title: 'Routine reset', color: 'green', type: 'routine' }],
  },
  {
    id: 'academy-0525',
    dateNumber: 25,
    status: 'Notes',
    progress: 85,
    events: [{ id: 'lecture-notes', title: 'Lecture notes', color: 'blue', type: 'note' }],
  },
  {
    id: 'academy-0526',
    dateNumber: 26,
    status: 'Study',
    progress: 76,
    events: [{ id: 'project-study', title: 'Project study', color: 'green', type: 'study' }],
  },
  {
    id: 'academy-0527',
    dateNumber: 27,
    status: 'Prep',
    progress: 58,
    events: [{ id: 'quiz-prep', title: 'Quiz prep', color: 'orange', type: 'quiz' }],
  },
  {
    id: 'academy-0528',
    dateNumber: 28,
    status: 'Discuss',
    progress: 84,
    events: [{ id: 'eng-discussion', title: 'ENG discussion', color: 'purple', type: 'discussion' }],
  },
  {
    id: 'academy-0529',
    dateNumber: 29,
    status: 'Submit',
    progress: 90,
    events: [{ id: 'submit-notes', title: 'Submit notes', color: 'blue', type: 'note' }],
  },
  { id: 'academy-0530', dateNumber: 30, status: 'Light', progress: 45, events: [] },
  {
    id: 'academy-0531',
    dateNumber: 31,
    status: 'Review',
    progress: 45,
    events: [{ id: 'month-review', title: 'Month review', color: 'green', type: 'routine' }],
  },
];

const projectDays: CalendarDay[] = academyDays.map((day, index) => {
  const projectMap: Record<number, Partial<CalendarDay>> = {
    4: {
      status: 'Review',
      progress: 75,
      events: [{ id: 'design-review', title: 'Design review', color: 'teal', type: 'meeting' }],
    },
    7: {
      status: 'Feature',
      progress: 72,
      events: [{ id: 'calendar-ui-start', title: 'Calendar UI start', color: 'blue', type: 'feature' }],
      timelineBar: { label: 'Calendar UI', color: 'teal' },
    },
    8: {
      status: 'Spec',
      progress: 80,
      events: [{ id: 'feature-spec', title: 'Feature spec', color: 'purple', type: 'feature' }],
      timelineBar: { label: 'Calendar UI', color: 'teal' },
    },
    9: {
      status: 'Build',
      progress: 86,
      events: [{ id: 'dev-todo', title: 'Development todo', color: 'blue', type: 'todo' }],
      timelineBar: { label: 'Calendar UI', color: 'teal' },
    },
    10: {
      status: 'Meet',
      progress: 65,
      events: [{ id: 'web-meeting', title: 'Web meeting link', color: 'teal', type: 'meeting' }],
      timelineBar: { label: 'Calendar UI', color: 'teal' },
    },
    11: {
      status: 'Ship',
      progress: 82,
      events: [{ id: 'ui-milestone', title: 'UI milestone', color: 'green', type: 'milestone' }],
    },
    15: {
      status: 'Bug',
      progress: 76,
      events: [{ id: 'login-bug-start', title: 'Login bug start', color: 'red', type: 'bug' }],
      timelineBar: { label: 'Login Bug', color: 'red' },
    },
    16: {
      status: 'Debug',
      progress: 84,
      events: [{ id: 'debug-mobile', title: 'Debug mobile', color: 'red', type: 'bug' }],
      timelineBar: { label: 'Login Bug', color: 'red' },
    },
    17: {
      status: 'Call',
      progress: 75,
      events: [{ id: 'customer-call', title: 'Customer call link', color: 'teal', type: 'meeting' }],
      timelineBar: { label: 'Login Bug', color: 'red' },
    },
    18: {
      status: 'Solved',
      progress: 90,
      events: [{ id: 'target-fix', title: 'Target fix', color: 'green', type: 'milestone' }],
    },
    22: {
      status: 'Release',
      progress: 92,
      events: [{ id: 'release-v02', title: 'Release v0.2', color: 'green', type: 'release' }],
    },
    26: {
      status: 'Request',
      progress: 78,
      events: [{ id: 'customer-request', title: 'Customer request', color: 'gold', type: 'customer' }],
    },
  };

  return {
    ...day,
    id: day.id.replace('academy', 'project'),
    status: day.outsideMonth ? 'Older' : 'Open',
    progress: Math.max(30, Math.min(95, day.progress + (index % 3) * 5)),
    events: index % 5 === 0 ? [{ id: `project-note-${index}`, title: 'Backlog note', color: 'purple', type: 'note' }] : [],
    timelineBar: undefined,
    ...projectMap[index],
  };
});

const adminConsoleDays: CalendarDay[] = projectDays.map((day, index) => {
  const adminMap: Record<number, Partial<CalendarDay>> = {
    4: {
      status: 'Review',
      progress: 78,
      events: [{ id: 'access-review', title: 'Access review', color: 'blue', type: 'admin' }],
    },
    8: {
      status: 'Modes',
      progress: 82,
      events: [{ id: 'mode-config-check', title: 'Mode config check', color: 'purple', type: 'mode' }],
      timelineBar: { label: 'Mode rollout', color: 'purple' },
    },
    12: {
      status: 'OAuth',
      progress: 86,
      events: [{ id: 'google-oauth-check', title: 'Google OAuth check', color: 'green', type: 'integration' }],
      timelineBar: { label: 'Integration audit', color: 'green' },
    },
    16: {
      status: 'Audit',
      progress: 70,
      events: [{ id: 'audit-log-review', title: 'Audit log review', color: 'orange', type: 'audit' }],
    },
    22: {
      status: 'Done',
      progress: 94,
      events: [{ id: 'permission-cleanup', title: 'Permission cleanup', color: 'green', type: 'permission' }],
    },
  };

  return {
    ...day,
    id: day.id.replace('project', 'admin-console'),
    status: day.outsideMonth ? 'Older' : 'Ready',
    events: index % 6 === 0
      ? [{ id: `admin-note-${index}`, title: 'Admin note', color: 'gray', type: 'note' }]
      : [],
    timelineBar: undefined,
    ...adminMap[index],
  };
});

export const mockWorkspaceData: Record<string, WorkspaceModeMockData> = {
  academy: {
    monthLabel: 'May 2026',
    days: academyDays,
    agenda: [
      {
        id: 'cs101-lecture',
        time: '09:00',
        title: 'CS101 Lecture',
        subtitle: 'Meeting link and lecture notes attached',
        type: 'Lecture',
        color: 'green',
      },
      {
        id: 'assignment-work-block',
        time: '11:30',
        title: 'Assignment A work block',
        subtitle: 'Checklist: outline, draft, submit',
        type: 'Assignment',
        color: 'blue',
      },
      {
        id: 'math-review',
        time: '14:00',
        title: 'MATH202 Quiz Review',
        subtitle: 'Related lecture notes and practice set',
        type: 'Quiz',
        color: 'orange',
      },
      {
        id: 'office-hour-agenda',
        time: '16:00',
        title: 'Office Hour',
        subtitle: 'Professor Google Meet link saved',
        type: 'Meeting',
        color: 'teal',
      },
    ],
    boardItems: [
      {
        id: 'cs101-assignment-a',
        columnId: 'cmpt225',
        title: 'Assignment 1 checklist',
        type: 'Upcoming',
        color: 'blue',
        checklistProgress: '2 of 5',
      },
      {
        id: 'math202-quiz',
        columnId: 'math202',
        title: 'Quiz 1 review',
        type: 'Doing',
        color: 'orange',
        checklistProgress: '1 of 4',
      },
      {
        id: 'essay-outline',
        columnId: 'engl110',
        title: 'Essay outline',
        type: 'Doing',
        color: 'purple',
        checklistProgress: '3 of 5',
      },
      {
        id: 'lecture-review',
        columnId: 'cmpt276',
        title: 'Lecture review',
        type: 'Upcoming',
        color: 'green',
        checklistProgress: '2 of 3',
      },
      {
        id: 'professor-feedback',
        columnId: 'engl110',
        title: 'Professor feedback',
        type: 'Waiting',
        color: 'orange',
        checklistProgress: '1 of 2',
      },
      {
        id: 'submit-lab',
        columnId: 'cmpt276',
        title: 'Submit lab',
        type: 'Done',
        color: 'green',
        checklistProgress: '5 of 5',
      },
    ],
    timeline: [
      {
        id: 'cs101-assignment-a-line',
        name: 'CS101 Assignment A',
        offsetPercent: 8,
        widthPercent: 64,
        label: 'Start May 6 to due May 10',
        color: 'blue',
      },
      {
        id: 'eng-essay-draft-line',
        name: 'ENG Essay Draft',
        offsetPercent: 31,
        widthPercent: 28,
        label: 'Draft period',
        color: 'orange',
      },
      {
        id: 'math-quiz-prep-line',
        name: 'MATH Quiz Prep',
        offsetPercent: 42,
        widthPercent: 22,
        label: 'Quiz review',
        color: 'teal',
      },
      {
        id: 'midterm-study-line',
        name: 'Midterm Study',
        offsetPercent: 57,
        widthPercent: 25,
        label: 'Exam preparation',
        color: 'red',
      },
    ],
    detailItem: {
      id: 'academy-detail-assignment',
      title: 'CS101 Assignment 1',
      description: 'Start-to-due assignment timeline with checklist, notes, and useful links.',
      fields: {
        type: 'Assignment',
        course: 'CS101',
        start: 'May 6',
        due: 'May 10, 11:59 PM',
      },
      checklist: [
        { id: 'read-instructions', label: 'Read instructions', done: true },
        { id: 'make-outline', label: 'Make outline', done: false },
        { id: 'write-draft', label: 'Write first draft', done: false },
        { id: 'submit-portal', label: 'Submit on portal', done: false },
      ],
      links: [
        { id: 'assignment-page', label: 'Assignment page', provider: 'manual_url', url: '#' },
        { id: 'lecture-notes', label: 'Lecture notes', provider: 'google_docs', url: '#' },
        { id: 'meeting-link', label: 'Meeting link', provider: 'google_meet', url: '#' },
      ],
      notes:
        'Remember to include examples from lecture 3 and check formatting before submitting.',
    },
  },
  project: {
    monthLabel: 'May 2026',
    days: projectDays,
    agenda: [
      {
        id: 'calendar-ui-implementation',
        time: '10:00',
        title: 'Calendar UI implementation',
        subtitle: 'Feature task linked to Study App project',
        type: 'Feature',
        color: 'teal',
      },
      {
        id: 'login-bug-repro',
        time: '13:30',
        title: 'Login bug reproduction',
        subtitle: 'Bug, customer ABC, assignee Alex',
        type: 'Bug',
        color: 'red',
      },
      {
        id: 'customer-web-meeting',
        time: '15:00',
        title: 'Customer web meeting',
        subtitle: 'Meeting link and customer report attached',
        type: 'Meeting',
        color: 'teal',
      },
      {
        id: 'dev-todo-review',
        time: '17:00',
        title: 'Development todo review',
        subtitle: 'Checklist: test, deploy, release note',
        type: 'Todo',
        color: 'orange',
      },
    ],
    boardItems: [
      {
        id: 'ai-planner',
        columnId: 'ideas',
        title: 'AI planner',
        type: 'Idea',
        color: 'purple',
        checklistProgress: '1 of 3',
      },
      {
        id: 'mood-analytics',
        columnId: 'ideas',
        title: 'Mood analytics',
        type: 'Feature',
        color: 'purple',
        checklistProgress: '0 of 4',
      },
      {
        id: 'add-filters',
        columnId: 'todo',
        title: 'Add filters',
        type: 'Todo',
        color: 'orange',
        checklistProgress: '2 of 5',
      },
      {
        id: 'link-system',
        columnId: 'todo',
        title: 'Link system',
        type: 'Todo',
        color: 'orange',
        checklistProgress: '1 of 5',
      },
      {
        id: 'login-bug',
        columnId: 'doing',
        title: 'Login bug',
        type: 'Bug',
        color: 'red',
        checklistProgress: '3 of 5',
      },
      {
        id: 'assignment-timeline-ui',
        columnId: 'doing',
        title: 'Assignment timeline UI',
        type: 'Feature',
        color: 'teal',
        checklistProgress: '4 of 6',
      },
      {
        id: 'setup-repo',
        columnId: 'solved',
        title: 'Setup repo',
        type: 'Solved',
        color: 'green',
        checklistProgress: '5 of 5',
      },
      {
        id: 'basic-layout',
        columnId: 'solved',
        title: 'Basic layout',
        type: 'Solved',
        color: 'green',
        checklistProgress: '5 of 5',
      },
    ],
    timeline: [
      {
        id: 'calendar-ui-feature',
        name: 'Calendar UI Feature',
        offsetPercent: 6,
        widthPercent: 48,
        label: 'May 4 to May 8',
        color: 'teal',
      },
      {
        id: 'login-bug-fix',
        name: 'Login Bug Fix',
        offsetPercent: 36,
        widthPercent: 34,
        label: 'May 12 to May 15',
        color: 'red',
      },
      {
        id: 'customer-request-line',
        name: 'Customer Request',
        offsetPercent: 55,
        widthPercent: 30,
        label: 'Review and implementation',
        color: 'orange',
      },
      {
        id: 'release-v02-line',
        name: 'Release v0.2',
        offsetPercent: 70,
        widthPercent: 22,
        label: 'Deploy patch',
        color: 'green',
      },
    ],
    detailItem: {
      id: 'project-detail-login-bug',
      title: 'Login Bug on Mobile',
      description:
        'Bug issue linked to customer, category, colleague, meeting link, and development checklist.',
      fields: {
        type: 'Bug',
        project: 'Study Manager',
        customer: 'ABC Client',
        target: 'May 15',
      },
      checklist: [
        { id: 'reproduce-bug', label: 'Reproduce bug', done: true },
        { id: 'check-mobile', label: 'Check mobile viewport', done: true },
        { id: 'fix-validation', label: 'Fix validation logic', done: false },
        { id: 'test-phone', label: 'Test on phone', done: false },
        { id: 'deploy-patch', label: 'Deploy patch', done: false },
      ],
      links: [
        { id: 'github-issue', label: 'GitHub issue', provider: 'github', url: '#' },
        { id: 'web-meeting', label: 'Web meeting', provider: 'google_meet', url: '#' },
        { id: 'customer-report', label: 'Customer report', provider: 'google_drive', url: '#' },
        { id: 'design-file', label: 'Design file', provider: 'manual_url', url: '#' },
      ],
      notes:
        'Bug happens after token expiry. Customer reported it during mobile login testing.',
    },
  },
  'admin-console': {
    monthLabel: 'May 2026',
    days: adminConsoleDays,
    agenda: [
      {
        id: 'admin-access-review',
        time: '09:30',
        title: 'Review admin users',
        subtitle: 'Check active users, pending invites, and owner roles',
        type: 'Access',
        color: 'blue',
      },
      {
        id: 'admin-mode-settings',
        time: '11:00',
        title: 'Workspace mode settings',
        subtitle: 'Verify enabled, hidden, and renamed mode configuration',
        type: 'Modes',
        color: 'purple',
      },
      {
        id: 'admin-google-health',
        time: '14:00',
        title: 'Google integration health',
        subtitle: 'OAuth refresh, Drive scopes, Calendar scopes',
        type: 'Integration',
        color: 'green',
      },
      {
        id: 'admin-audit-export',
        time: '16:30',
        title: 'Audit log review',
        subtitle: 'Permission and token refresh events',
        type: 'Audit',
        color: 'orange',
      },
    ],
    boardItems: [
      {
        id: 'review-users',
        columnId: 'review',
        title: 'Review users',
        type: 'Access',
        color: 'blue',
        checklistProgress: '2 of 4',
      },
      {
        id: 'mode-visibility',
        columnId: 'configure',
        title: 'Mode visibility',
        type: 'Settings',
        color: 'purple',
        checklistProgress: '3 of 5',
      },
      {
        id: 'oauth-refresh',
        columnId: 'monitor',
        title: 'OAuth refresh',
        type: 'Integration',
        color: 'green',
        checklistProgress: '2 of 3',
      },
      {
        id: 'drive-download-policy',
        columnId: 'monitor',
        title: 'Drive download policy',
        type: 'Policy',
        color: 'orange',
        checklistProgress: '1 of 3',
      },
      {
        id: 'favicon-brand',
        columnId: 'done',
        title: 'Brand assets',
        type: 'Done',
        color: 'green',
        checklistProgress: '4 of 4',
      },
    ],
    timeline: [
      {
        id: 'admin-mode-rollout',
        name: 'Mode rollout',
        offsetPercent: 8,
        widthPercent: 38,
        label: 'Enable and rename workspace modes',
        color: 'purple',
      },
      {
        id: 'admin-integration-audit',
        name: 'Integration audit',
        offsetPercent: 34,
        widthPercent: 35,
        label: 'Google OAuth and Drive checks',
        color: 'green',
      },
      {
        id: 'admin-permission-review',
        name: 'Permission review',
        offsetPercent: 58,
        widthPercent: 30,
        label: 'Users, access, and audit logs',
        color: 'orange',
      },
    ],
    detailItem: {
      id: 'admin-console-detail',
      title: 'Google OAuth Refresh Policy',
      description:
        'Admin task for token refresh behavior, Drive permissions, and workspace access checks.',
      fields: {
        type: 'Integration',
        area: 'Google Workspace',
        owner: 'Admin',
        status: 'Monitoring',
      },
      checklist: [
        { id: 'verify-refresh', label: 'Verify refresh token flow', done: true },
        { id: 'check-drive-scope', label: 'Check Drive scopes', done: true },
        { id: 'audit-download-policy', label: 'Audit download policy', done: false },
        { id: 'review-admins', label: 'Review admin users', done: false },
      ],
      links: [
        { id: 'google-console', label: 'Google Cloud Console', provider: 'manual_url', url: '#' },
        { id: 'drive-policy', label: 'Drive policy note', provider: 'google_docs', url: '#' },
      ],
      notes:
        'Keep frontend calls routed through ASP.NET so OAuth tokens and Google API calls stay server-side.',
    },
  },
};

export const getMockDataForMode = (modeId: string): WorkspaceModeMockData =>
  mockWorkspaceData[modeId] ?? {
    monthLabel: 'May 2026',
    days: [],
    agenda: [],
    boardItems: [],
    timeline: [],
    detailItem: {
      id: `${modeId}-empty-detail`,
      title: 'No item selected',
      description: 'This mode is configured, but no mock workspace data has been added yet.',
      fields: {},
      checklist: [],
      links: [],
      notes: 'Add a mock data entry or connect the mode to the ASP.NET Core API.',
    },
  };
