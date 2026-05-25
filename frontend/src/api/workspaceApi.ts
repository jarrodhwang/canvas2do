import { getMockDataForMode } from '../data/mockWorkspaceData';
import { modeRegistry } from '../modes/ModeRegistry';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api';

function getDownloadFileName(contentDisposition: string | null) {
  if (!contentDisposition) {
    return 'download';
  }

  const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);

  if (encodedMatch?.[1]) {
    return decodeURIComponent(encodedMatch[1]);
  }

  const quotedMatch = /filename="([^"]+)"/i.exec(contentDisposition);

  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = /filename=([^;]+)/i.exec(contentDisposition);

  return plainMatch?.[1]?.trim() ?? 'download';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function extractGoogleError(value: unknown): { message?: string; reason?: string } {
  if (typeof value === 'string') {
    try {
      return extractGoogleError(JSON.parse(value));
    } catch {
      return { message: value };
    }
  }

  if (!isRecord(value)) {
    return {};
  }

  const error = isRecord(value.error) ? value.error : value;
  const errors = Array.isArray(error.errors) ? error.errors : [];
  const firstError = errors.find(isRecord);
  const message = typeof error.message === 'string'
    ? error.message
    : typeof value.detail === 'string'
      ? value.detail
      : typeof value.title === 'string'
        ? value.title
        : undefined;
  const reason = typeof firstError?.reason === 'string' ? firstError.reason : undefined;

  return { message, reason };
}

function isHtmlErrorResponse(response: Response, text: string) {
  const contentType = response.headers.get('content-type') ?? '';

  return contentType.includes('text/html') || /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(text);
}

function getFriendlyServerErrorMessage(response: Response) {
  if (response.status === 401 || response.status === 403) {
    return 'Your workspace session needs attention. Reconnect Gmail and try sending again.';
  }

  if (response.status === 404 || response.status === 405) {
    return 'The Gmail API route is not available yet. Restart the workspace API and try again.';
  }

  if (response.status === 502) {
    return 'The workspace server is temporarily unavailable. The API may still be starting or restarting.';
  }

  if (response.status === 503) {
    return 'The workspace server is temporarily unavailable. Please try again in a moment.';
  }

  if (response.status === 504) {
    return 'The workspace server took too long to respond. Please try again in a moment.';
  }

  if (response.status >= 500) {
    return 'The workspace server ran into a temporary problem. Please try again in a moment.';
  }

  return 'The workspace returned an unexpected page instead of API data.';
}

function createRequestTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  return {
    cancel: () => window.clearTimeout(timeoutId),
    signal: controller.signal,
  };
}

async function readErrorResponse(
  response: Response,
  fallbackMessage: string,
): Promise<{ message: string; googleReason?: string }> {
  const text = await response.text();

  if (!text) {
    return { message: fallbackMessage };
  }

  if (isHtmlErrorResponse(response, text)) {
    return { message: getFriendlyServerErrorMessage(response) };
  }

  try {
    const problem = JSON.parse(text) as unknown;
    const problemObject = isRecord(problem) ? problem : {};
    const problemError = extractGoogleError(problemObject.detail ?? problem);
    const message = problemError.message
      || (typeof problemObject.detail === 'string' ? problemObject.detail : undefined)
      || (typeof problemObject.title === 'string' ? problemObject.title : undefined)
      || fallbackMessage;

    return {
      message,
      googleReason: problemError.reason,
    };
  } catch {
    const textError = extractGoogleError(text);

    return {
      message: textError.message || text || fallbackMessage,
      googleReason: textError.reason,
    };
  }
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();

  if (!text) {
    throw new Error(fallbackMessage);
  }

  if (isHtmlErrorResponse(response, text)) {
    throw new Error(getFriendlyServerErrorMessage(response));
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(fallbackMessage);
  }
}

export interface GoogleIntegrationStatus {
  provider: 'google_calendar' | 'google_drive' | 'gmail' | 'google_chat';
  label: string;
  configured: boolean;
  connected: boolean;
  status: 'connected' | 'needs_connection';
  connectUrl: string;
  scopes: string[];
}

export interface CanvasIntegrationStatus {
  provider: 'canvas_lms';
  label: string;
  configured: boolean;
  connected: boolean;
  status: 'connected' | 'needs_connection';
  connectUrl: string;
  instanceUrl?: string;
  userName?: string;
  scopes: string[];
}

export interface CanvasCourse {
  id: string;
  name: string;
  courseCode?: string;
  termName?: string;
  workflowState?: string;
  startAt?: string;
  endAt?: string;
  htmlUrl?: string;
}

export interface CanvasCourses {
  courses: CanvasCourse[];
  termName?: string;
}

export interface MicrosoftIntegrationStatus {
  provider: 'outlook';
  label: string;
  configured: boolean;
  connected: boolean;
  status: 'connected' | 'needs_connection';
  connectUrl: string;
  scopes: string[];
  userName?: string;
  email?: string;
}

export interface OutlookMessage {
  id: string;
  subject?: string;
  from: string;
  to?: string;
  bodyPreview: string;
  bodyHtml?: string;
  receivedAt?: string;
  unread: boolean;
  hasAttachments: boolean;
  webLink?: string;
  importance?: string;
}

export interface OutlookMessages {
  search?: string;
  messages: OutlookMessage[];
  nextLink?: string;
}

export interface SendOutlookMessageRequest {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  parentNames: string[];
  webViewLink?: string;
  iconLink?: string;
  createdTime?: string;
  modifiedTime?: string;
  sizeBytes?: number;
  isFolder: boolean;
  locationName?: string;
}

export interface GoogleDrivePermission {
  id: string;
  type: string;
  role: string;
  displayName?: string;
  emailAddress?: string;
  photoLink?: string;
  deleted: boolean;
  allowFileDiscovery?: boolean;
}

export interface GoogleDrivePermissions {
  fileId: string;
  permissions: GoogleDrivePermission[];
}

export interface GoogleDriveDownload {
  blob: Blob;
  contentType: string;
  fileName: string;
}

export interface GoogleSharedDrive {
  id: string;
  name: string;
}

export type GoogleDriveView = 'my-drive' | 'shared-drive' | 'shared-with-me' | 'recent';

export interface GoogleDriveBrowser {
  view: GoogleDriveView;
  folderId?: string;
  driveId?: string;
  search?: string;
  requiresSharedDriveSelection: boolean;
  files: GoogleDriveFile[];
  sharedDrives: GoogleSharedDrive[];
  sharedDrivesError?: string;
}

export interface GetGoogleDriveFilesOptions {
  view?: GoogleDriveView;
  folderId?: string;
  driveId?: string;
  search?: string;
}

export interface GoogleGmailMessage {
  id: string;
  threadId: string;
  from: string;
  to?: string;
  subject: string;
  snippet: string;
  bodyPreview: string;
  bodyHtml?: string;
  receivedAt?: string;
  unread: boolean;
  labels: string[];
  attachments: GoogleGmailAttachment[];
}

export interface GoogleGmailAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
}

export interface GoogleGmailMessages {
  search?: string;
  messages: GoogleGmailMessage[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface SendGoogleGmailMessageRequest {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  attachments?: SendGoogleGmailAttachmentRequest[];
}

export interface SendGoogleGmailAttachmentRequest {
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  contentBase64: string;
}

export interface SendGoogleGmailMessageResponse {
  id: string;
  threadId: string;
}

export interface ScheduledGoogleGmailMessage {
  id: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  scheduledFor: string;
  createdAt: string;
  status: 'cancelled' | 'failed' | 'pending' | 'sending' | 'sent';
  attachments: ScheduledGoogleGmailAttachment[];
  error?: string;
  sentAt?: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
}

export interface ScheduledGoogleGmailAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
}

export interface ScheduleGoogleGmailMessageRequest extends SendGoogleGmailMessageRequest {
  scheduledFor: string;
}

export interface GoogleChatMessage {
  name: string;
  sender: string;
  text: string;
  createdAt?: string;
}

export interface GoogleChatSpace {
  name: string;
  displayName: string;
  spaceType: string;
  lastActiveTime?: string;
  messages: GoogleChatMessage[];
}

export interface GoogleChatSpaces {
  search?: string;
  spaces: GoogleChatSpace[];
  setupRequired?: boolean;
  error?: string;
}

export const workspaceApi = {
  apiBaseUrl,

  getGoogleLoginUrl(returnUrl = '/') {
    return `${apiBaseUrl}/auth/google/login?returnUrl=${encodeURIComponent(returnUrl)}`;
  },

  async getAuthSession() {
    const response = await fetch(`${apiBaseUrl}/auth/session`, {
      credentials: 'include',
    });

    if (!response.ok) {
      return { isAuthenticated: false };
    }

    return response.json() as Promise<{ isAuthenticated: boolean; displayName?: string }>;
  },

  async getAuthConfig() {
    const response = await fetch(`${apiBaseUrl}/auth/config`, {
      credentials: 'include',
    });

    if (!response.ok) {
      return { googleConfigured: false };
    }

    return response.json() as Promise<{ googleConfigured: boolean; hostedDomain?: string }>;
  },

  async getGoogleIntegrations() {
    const response = await fetch(`${apiBaseUrl}/google/integrations`, {
      credentials: 'include',
    });

    if (!response.ok) {
      return [] as GoogleIntegrationStatus[];
    }

    return response.json() as Promise<GoogleIntegrationStatus[]>;
  },

  async getCanvasIntegration() {
    const response = await fetch(`${apiBaseUrl}/canvas/integration`, {
      credentials: 'include',
    });

    if (!response.ok) {
      return {
        provider: 'canvas_lms',
        label: 'Canvas LMS',
        configured: false,
        connected: false,
        status: 'needs_connection',
        connectUrl: '',
        scopes: [],
      } satisfies CanvasIntegrationStatus;
    }

    return response.json() as Promise<CanvasIntegrationStatus>;
  },

  async getCanvasCourses(pageSize = 5) {
    const params = new URLSearchParams({ pageSize: String(Math.min(Math.max(pageSize, 1), 5)) });
    const response = await fetch(`${apiBaseUrl}/canvas/courses?${params.toString()}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to load Canvas courses.');

      throw new Error(message);
    }

    return response.json() as Promise<CanvasCourses>;
  },

  async getMicrosoftIntegrations() {
    const response = await fetch(`${apiBaseUrl}/microsoft/integrations`, {
      credentials: 'include',
    });

    if (!response.ok) {
      return [] as MicrosoftIntegrationStatus[];
    }

    return response.json() as Promise<MicrosoftIntegrationStatus[]>;
  },

  async getOutlookMessages(options: { search?: string; pageSize?: number } = {}) {
    const params = new URLSearchParams();

    if (options.search?.trim()) {
      params.set('search', options.search.trim());
    }

    if (options.pageSize) {
      params.set('pageSize', String(options.pageSize));
    }

    const query = params.toString();
    const response = await fetch(`${apiBaseUrl}/microsoft/outlook/messages${query ? `?${query}` : ''}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to load Outlook messages.');

      throw new Error(message);
    }

    return response.json() as Promise<OutlookMessages>;
  },

  async getOutlookMessage(messageId: string) {
    const response = await fetch(
      `${apiBaseUrl}/microsoft/outlook/messages/${encodeURIComponent(messageId)}`,
      {
        credentials: 'include',
      },
    );

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to load Outlook message.');

      throw new Error(message);
    }

    return response.json() as Promise<OutlookMessage>;
  },

  async markOutlookMessageRead(messageId: string) {
    const response = await fetch(
      `${apiBaseUrl}/microsoft/outlook/messages/${encodeURIComponent(messageId)}/read`,
      {
        credentials: 'include',
        method: 'POST',
      },
    );

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to update Outlook message.');

      throw new Error(message);
    }
  },

  async markOutlookMessageUnread(messageId: string) {
    const response = await fetch(
      `${apiBaseUrl}/microsoft/outlook/messages/${encodeURIComponent(messageId)}/unread`,
      {
        credentials: 'include',
        method: 'POST',
      },
    );

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to update Outlook message.');

      throw new Error(message);
    }
  },

  async sendOutlookMessage(request: SendOutlookMessageRequest) {
    const response = await fetch(`${apiBaseUrl}/microsoft/outlook/messages/send`, {
      body: JSON.stringify(request),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to send Outlook message.');

      throw new Error(message);
    }
  },

  async getGoogleDriveBrowser(options: GetGoogleDriveFilesOptions = {}) {
    const params = new URLSearchParams();

    if (options.view) {
      params.set('view', options.view);
    }

    if (options.folderId) {
      params.set('folderId', options.folderId);
    }

    if (options.driveId) {
      params.set('driveId', options.driveId);
    }

    if (options.search?.trim()) {
      params.set('search', options.search.trim());
    }

    const response = await fetch(`${apiBaseUrl}/google/drive/browser?${params.toString()}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to load Google Drive.');

      throw new Error(message);
    }

    return response.json() as Promise<GoogleDriveBrowser>;
  },

  async getGoogleDrivePermissions(fileId: string) {
    const response = await fetch(
      `${apiBaseUrl}/google/drive/files/${encodeURIComponent(fileId)}/permissions`,
      {
        credentials: 'include',
      },
    );

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to load sharing access.');

      throw new Error(message);
    }

    return response.json() as Promise<GoogleDrivePermissions>;
  },

  async getGoogleGmailMessages(
    options: { label?: string; search?: string; pageSize?: number; pageToken?: string; signal?: AbortSignal } = {},
  ) {
    const params = new URLSearchParams();

    if (options.label?.trim()) {
      params.set('label', options.label.trim());
    }

    if (options.search?.trim()) {
      params.set('search', options.search.trim());
    }

    if (options.pageToken?.trim()) {
      params.set('pageToken', options.pageToken.trim());
    }

    if (options.pageSize) {
      params.set('pageSize', String(options.pageSize));
    }

    const query = params.toString();
    const response = await fetch(`${apiBaseUrl}/google/gmail/messages${query ? `?${query}` : ''}`, {
      credentials: 'include',
      signal: options.signal,
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to load Gmail messages.');

      throw new Error(message);
    }

    return response.json() as Promise<GoogleGmailMessages>;
  },

  async getGoogleGmailMessage(messageId: string, options: { signal?: AbortSignal } = {}) {
    const response = await fetch(`${apiBaseUrl}/google/gmail/messages/${encodeURIComponent(messageId)}`, {
      credentials: 'include',
      signal: options.signal,
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to load Gmail message.');

      throw new Error(message);
    }

    return response.json() as Promise<GoogleGmailMessage>;
  },

  async markGoogleGmailMessageRead(messageId: string) {
    const response = await fetch(`${apiBaseUrl}/google/gmail/messages/${encodeURIComponent(messageId)}/read`, {
      credentials: 'include',
      method: 'POST',
    });

    if (!response.ok) {
      if (response.status === 404 || response.status === 405) {
        throw new Error('Restart the API container to enable Gmail mark-as-read.');
      }

      const { googleReason, message } = await readErrorResponse(response, 'Unable to mark Gmail message as read.');

      if (response.status === 403 || googleReason === 'insufficientPermissions' || /scope/i.test(message)) {
        throw new Error('Reconnect Gmail to grant mark-as-read permission.');
      }

      throw new Error(message);
    }
  },

  async markGoogleGmailMessageUnread(messageId: string) {
    const response = await fetch(`${apiBaseUrl}/google/gmail/messages/${encodeURIComponent(messageId)}/unread`, {
      credentials: 'include',
      method: 'POST',
    });

    if (!response.ok) {
      if (response.status === 404 || response.status === 405) {
        throw new Error('Restart the API container to enable Gmail mark-as-unread.');
      }

      const { googleReason, message } = await readErrorResponse(response, 'Unable to mark Gmail message as unread.');

      if (response.status === 403 || googleReason === 'insufficientPermissions' || /scope/i.test(message)) {
        throw new Error('Reconnect Gmail to grant mark-as-unread permission.');
      }

      throw new Error(message);
    }
  },

  async modifyGoogleGmailMessageLabels(
    messageId: string,
    labels: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) {
    const response = await fetch(`${apiBaseUrl}/google/gmail/messages/${encodeURIComponent(messageId)}/labels`, {
      body: JSON.stringify(labels),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) {
      if (response.status === 404 || response.status === 405) {
        throw new Error('Restart the API container to enable Gmail label actions.');
      }

      const { googleReason, message } = await readErrorResponse(response, 'Unable to update Gmail labels.');

      if (response.status === 403 || googleReason === 'insufficientPermissions' || /scope/i.test(message)) {
        throw new Error('Reconnect Gmail to grant label update permission.');
      }

      throw new Error(message);
    }
  },

  async sendGoogleGmailMessage(message: SendGoogleGmailMessageRequest) {
    const timeout = createRequestTimeout(45000);
    let response: Response;

    try {
      response = await fetch(`${apiBaseUrl}/google/gmail/messages/send`, {
        body: JSON.stringify(message),
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: timeout.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Gmail send took too long. Check the attachment size or try again in a moment.');
      }

      throw new Error('Unable to reach the workspace API. Check that the API container is running.');
    } finally {
      timeout.cancel();
    }

    if (!response.ok) {
      if (response.status === 404 || response.status === 405) {
        throw new Error('Restart the API container to enable Gmail send.');
      }

      const { googleReason, message: errorMessage } = await readErrorResponse(response, 'Unable to send Gmail message.');

      if (response.status === 403 || googleReason === 'insufficientPermissions' || /scope/i.test(errorMessage)) {
        throw new Error('Reconnect Gmail to grant send permission.');
      }

      throw new Error(errorMessage);
    }

    return readJsonResponse<SendGoogleGmailMessageResponse>(response, 'Gmail sent the message, but the workspace could not read the send response.');
  },

  async scheduleGoogleGmailMessage(message: ScheduleGoogleGmailMessageRequest) {
    const response = await fetch(`${apiBaseUrl}/google/gmail/messages/schedule`, {
      body: JSON.stringify(message),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) {
      const { googleReason, message: errorMessage } = await readErrorResponse(response, 'Unable to schedule Gmail message.');

      if (response.status === 403 || googleReason === 'insufficientPermissions' || /scope/i.test(errorMessage)) {
        throw new Error('Reconnect Gmail to grant scheduled-send permission.');
      }

      throw new Error(errorMessage);
    }

    return readJsonResponse<ScheduledGoogleGmailMessage>(
      response,
      'Gmail scheduled the message, but the workspace could not read the scheduled item.',
    );
  },

  async getScheduledGoogleGmailMessages() {
    const response = await fetch(`${apiBaseUrl}/google/gmail/messages/scheduled`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to load scheduled Gmail messages.');

      throw new Error(message);
    }

    return readJsonResponse<ScheduledGoogleGmailMessage[]>(
      response,
      'Unable to read scheduled Gmail messages.',
    );
  },

  async sendScheduledGoogleGmailMessageNow(messageId: string) {
    const timeout = createRequestTimeout(45000);
    let response: Response;

    try {
      response = await fetch(`${apiBaseUrl}/google/gmail/messages/scheduled/${encodeURIComponent(messageId)}/send-now`, {
        credentials: 'include',
        method: 'POST',
        signal: timeout.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Scheduled send took too long. Check the attachment size or try again in a moment.');
      }

      throw new Error('Unable to reach the workspace API. Check that the API container is running.');
    } finally {
      timeout.cancel();
    }

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to send scheduled Gmail message.');

      throw new Error(message);
    }

    return readJsonResponse<ScheduledGoogleGmailMessage>(
      response,
      'Scheduled Gmail message was processed, but the workspace could not read the result.',
    );
  },

  async cancelScheduledGoogleGmailMessage(messageId: string) {
    const response = await fetch(`${apiBaseUrl}/google/gmail/messages/scheduled/${encodeURIComponent(messageId)}`, {
      credentials: 'include',
      method: 'DELETE',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to cancel scheduled Gmail message.');

      throw new Error(message);
    }
  },

  async getGoogleChatSpaces(options: { search?: string; pageSize?: number } = {}) {
    const params = new URLSearchParams();

    if (options.search?.trim()) {
      params.set('search', options.search.trim());
    }

    if (options.pageSize) {
      params.set('pageSize', String(options.pageSize));
    }

    const query = params.toString();
    const response = await fetch(`${apiBaseUrl}/google/chat/spaces${query ? `?${query}` : ''}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          'Google Chat API is not configured in Google Cloud Console. Enable Google Chat API, save the Chat API Configuration tab, recreate the API container, and reconnect Google Chat.',
        );
      }

      const { message } = await readErrorResponse(response, 'Unable to load Google Chat spaces.');

      throw new Error(message);
    }

    const payload = await response.json() as GoogleChatSpaces;

    if (payload.setupRequired || payload.error) {
      throw new Error(
        payload.error ??
          'Google Chat API is not configured in Google Cloud Console. Enable Google Chat API, save the Chat API Configuration tab, recreate the API container, and reconnect Google Chat.',
      );
    }

    return payload;
  },

  async downloadGoogleDriveItem(fileId: string, options: { acknowledgeAbuse?: boolean } = {}) {
    const params = new URLSearchParams();

    if (options.acknowledgeAbuse) {
      params.set('acknowledgeAbuse', 'true');
    }

    const query = params.toString();
    const response = await fetch(
      `${apiBaseUrl}/google/drive/files/${encodeURIComponent(fileId)}/download${query ? `?${query}` : ''}`,
      {
        credentials: 'include',
      },
    );

    if (!response.ok) {
      const { googleReason, message } = await readErrorResponse(response, 'Unable to download Drive item.');

      const error = new Error(message) as Error & { googleReason?: string; status?: number };
      error.status = response.status;
      error.googleReason = googleReason;

      throw error;
    }

    return {
      blob: await response.blob(),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      fileName: getDownloadFileName(response.headers.get('content-disposition')),
    } satisfies GoogleDriveDownload;
  },

  async getWorkspaceModes() {
    return modeRegistry.getVisible();
  },

  async getModeWorkspace(modeId: string) {
    return getMockDataForMode(modeId);
  },
};
