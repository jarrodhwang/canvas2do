import { appPath } from '../lib/appPath';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || appPath('/api');

export interface WorkspaceCustomer {
  id: string;
  companyName: string;
  contactName?: string;
  contactEmail?: string;
  phone?: string;
  projectCount: number;
  issueCount: number;
}

export interface WorkspaceProject {
  id: string;
  customerId: string;
  customerCompany: string;
  name: string;
  description?: string;
  category: string;
  subcategory?: string;
  status: 'planned' | 'active' | 'waiting' | 'completed';
  startAtUtc?: string;
  dueAtUtc?: string;
  openIssueCount: number;
  totalIssueCount: number;
}

export interface WorkspaceIssue {
  id: string;
  customerId: string;
  customerCompany: string;
  projectId?: string;
  projectName?: string;
  title: string;
  description?: string;
  issueType: 'issue' | 'request' | 'task' | 'meeting';
  status: 'todo' | 'doing' | 'waiting' | 'solved';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  dueAtUtc?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceCalendarShare {
  targetType: 'user' | 'group';
  targetKey: string;
  targetLabel: string;
}

export interface WorkspaceCalendarEntry {
  id: string;
  title: string;
  description?: string;
  itemType: 'work' | 'meeting' | 'deadline' | 'follow-up';
  status: string;
  startAtUtc: string;
  endAtUtc: string;
  sourceTimeZone: string;
  isAllDay: boolean;
  projectId?: string;
  projectName?: string;
  issueId?: string;
  issueTitle?: string;
  ownerLabel: string;
  canEdit: boolean;
  shares: WorkspaceCalendarShare[];
}

export interface WorkspaceDirectoryUser {
  email: string;
  displayName: string;
}

export interface WorkspaceDirectoryGroup {
  id: string;
  name: string;
}

export interface WorkspaceCategory {
  name: string;
  children: string[];
}

export interface WorkspaceManagementOverview {
  generatedAtUtc: string;
  customers: WorkspaceCustomer[];
  projects: WorkspaceProject[];
  issues: WorkspaceIssue[];
  calendarItems: WorkspaceCalendarEntry[];
  users: WorkspaceDirectoryUser[];
  groups: WorkspaceDirectoryGroup[];
  categories: WorkspaceCategory[];
}

export interface SaveWorkspaceCustomerRequest {
  companyName: string;
  contactName?: string;
  contactEmail?: string;
  phone?: string;
}

export interface SaveWorkspaceProjectRequest {
  customerId: string;
  name: string;
  description?: string;
  category: string;
  subcategory?: string;
  status: WorkspaceProject['status'];
  startAtUtc?: string;
  dueAtUtc?: string;
}

export interface SaveWorkspaceIssueRequest {
  customerId: string;
  projectId?: string;
  title: string;
  description?: string;
  issueType: WorkspaceIssue['issueType'];
  status: WorkspaceIssue['status'];
  priority: WorkspaceIssue['priority'];
  dueAtUtc?: string;
}

export interface SaveWorkspaceCalendarEntryRequest {
  title: string;
  description?: string;
  itemType: WorkspaceCalendarEntry['itemType'];
  status: string;
  startAtUtc: string;
  endAtUtc: string;
  sourceTimeZone: string;
  isAllDay: boolean;
  projectId?: string;
  issueId?: string;
  shares: WorkspaceCalendarShare[];
}

async function readApiError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as {
      detail?: string;
      errors?: Record<string, string[]>;
      title?: string;
    };
    const validationMessage = payload.errors
      ? Object.values(payload.errors).flat().find(Boolean)
      : undefined;

    return validationMessage ?? payload.detail ?? payload.title ?? fallback;
  } catch {
    return fallback;
  }
}

async function requestJson<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, fallback));
  }

  return response.json() as Promise<T>;
}

export const workspaceManagementApi = {
  getOverview(signal?: AbortSignal) {
    return requestJson<WorkspaceManagementOverview>(
      '/workspace/overview',
      { method: 'GET', signal },
      'Unable to load Workspace data.',
    );
  },

  saveCustomer(request: SaveWorkspaceCustomerRequest, customerId?: string) {
    return requestJson<WorkspaceCustomer>(
      customerId ? `/workspace/customers/${encodeURIComponent(customerId)}` : '/workspace/customers',
      { body: JSON.stringify(request), method: customerId ? 'PUT' : 'POST' },
      'Unable to save the customer company.',
    );
  },

  saveProject(request: SaveWorkspaceProjectRequest, projectId?: string) {
    return requestJson<WorkspaceProject>(
      projectId ? `/workspace/projects/${encodeURIComponent(projectId)}` : '/workspace/projects',
      { body: JSON.stringify(request), method: projectId ? 'PUT' : 'POST' },
      'Unable to save the project.',
    );
  },

  saveIssue(request: SaveWorkspaceIssueRequest, issueId?: string) {
    return requestJson<WorkspaceIssue>(
      issueId ? `/workspace/issues/${encodeURIComponent(issueId)}` : '/workspace/issues',
      { body: JSON.stringify(request), method: issueId ? 'PUT' : 'POST' },
      'Unable to save the issue.',
    );
  },

  updateIssueStatus(issueId: string, status: WorkspaceIssue['status']) {
    return requestJson<WorkspaceIssue>(
      `/workspace/issues/${encodeURIComponent(issueId)}/status`,
      { body: JSON.stringify({ status }), method: 'PATCH' },
      'Unable to update the issue status.',
    );
  },

  saveCalendarEntry(request: SaveWorkspaceCalendarEntryRequest, entryId?: string) {
    return requestJson<WorkspaceCalendarEntry>(
      entryId ? `/workspace/calendar-items/${encodeURIComponent(entryId)}` : '/workspace/calendar-items',
      { body: JSON.stringify(request), method: entryId ? 'PUT' : 'POST' },
      'Unable to save the calendar item.',
    );
  },

  async deleteCalendarEntry(entryId: string) {
    const response = await fetch(`${apiBaseUrl}/workspace/calendar-items/${encodeURIComponent(entryId)}`, {
      credentials: 'include',
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Unable to delete the calendar item.'));
    }
  },
};
