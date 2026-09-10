import { normalizeCanvasItemPreferences } from '../lib/canvasItemIdentity';
import { appPath } from '../lib/appPath';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || appPath('/api');
const canvasCalendarRequests = new Map<string, {
  controller: AbortController;
  promise: Promise<CanvasCalendarItems>;
}>();
const academyPreferenceOwnerHeader = 'X-Canvas-To-Do-Owner-Key';
const csrfRequestHeader = 'X-Canvas-To-Do-Request';
const safeRequestMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
export const authenticationRequiredEvent = 'canvas-to-do-authentication-required';
let academyPreferenceOwnerKey: string | null = null;
let academyPreferenceOwnerVersion = 0;

interface AcademyPreferenceRequestScope {
  ownerKey: string;
  version: number;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headers = new Headers(
    init.headers ?? (input instanceof Request ? input.headers : undefined),
  );

  if (!safeRequestMethods.has(method)) {
    headers.set(csrfRequestHeader, '1');
  }

  const response = await window.fetch(input, { ...init, headers });

  if (response.status === 401) {
    window.dispatchEvent(new Event(authenticationRequiredEvent));
  }

  return response;
}

function normalizeAcademyPreferenceOwnerKey(value?: string | null) {
  const normalizedValue = value?.trim().toLowerCase();

  return normalizedValue || null;
}

function setAcademyPreferenceOwnerKey(value?: string | null) {
  const nextOwnerKey = normalizeAcademyPreferenceOwnerKey(value);

  if (nextOwnerKey === academyPreferenceOwnerKey) {
    return;
  }

  canvasCalendarRequests.forEach(({ controller }) => controller.abort());
  canvasCalendarRequests.clear();
  academyPreferenceOwnerKey = nextOwnerKey;
  academyPreferenceOwnerVersion += 1;
}

function getAcademyPreferenceRequestScope(): AcademyPreferenceRequestScope {
  if (!academyPreferenceOwnerKey) {
    throw new Error('Academy account changed. Reload this view before accessing coursework.');
  }

  return {
    ownerKey: academyPreferenceOwnerKey,
    version: academyPreferenceOwnerVersion,
  };
}

function assertCurrentAcademyPreferenceScope(scope: AcademyPreferenceRequestScope) {
  if (
    scope.version !== academyPreferenceOwnerVersion ||
    scope.ownerKey !== academyPreferenceOwnerKey
  ) {
    throw new Error('Academy account changed. Discarding data from the previous user.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function extractApiError(value: unknown): { message?: string } {
  if (typeof value === 'string') {
    try {
      return extractApiError(JSON.parse(value));
    } catch {
      return { message: value };
    }
  }

  if (!isRecord(value)) {
    return {};
  }

  const error = isRecord(value.error) ? value.error : value;
  const validationMessages = isRecord(value.errors)
    ? Object.values(value.errors)
        .flatMap((entry) => Array.isArray(entry) ? entry : [entry])
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const message = validationMessages.length > 0
    ? validationMessages.join(' ')
    : typeof error.message === 'string'
    ? error.message
    : typeof value.detail === 'string'
      ? value.detail
      : typeof value.title === 'string'
        ? value.title
        : undefined;
  return { message };
}

function isHtmlErrorResponse(response: Response, text: string) {
  const contentType = response.headers.get('content-type') ?? '';

  return contentType.includes('text/html') || /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(text);
}

function getFriendlyServerErrorMessage(response: Response) {
  if (response.status === 400) {
    return 'Canvas To Do rejected this site address. Check the configured ALLOWED_HOSTS value.';
  }

  if (response.status === 401) {
    return 'Your Canvas To Do session expired. Sign in again, then refresh this view.';
  }

  if (response.status === 403) {
    return 'Canvas To Do blocked this request. Sign in again or refresh the page.';
  }

  if (response.status === 404 || response.status === 405) {
    return 'That API route is not available.';
  }

  if (response.status === 429) {
    return 'Too many requests were made. Wait a moment, then try again.';
  }

  if (response.status === 502) {
    return 'Canvas To Do is temporarily unavailable. The API may still be starting.';
  }

  if (response.status === 503) {
    return 'Canvas To Do is temporarily unavailable. Please try again in a moment.';
  }

  if (response.status === 504) {
    return 'Canvas To Do took too long to respond. Please try again in a moment.';
  }

  if (response.status >= 500) {
    return 'Canvas To Do ran into a temporary problem. Please try again in a moment.';
  }

  return 'Canvas To Do returned an unexpected response.';
}

function createRequestTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  return {
    cancel: () => window.clearTimeout(timeoutId),
    controller,
    signal: controller.signal,
  };
}

async function readErrorResponse(
  response: Response,
  fallbackMessage: string,
): Promise<{ message: string }> {
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
    const problemError = extractApiError(problemObject.detail ?? problem);
    const message = problemError.message
      || (typeof problemObject.detail === 'string' ? problemObject.detail : undefined)
      || (typeof problemObject.title === 'string' ? problemObject.title : undefined)
      || fallbackMessage;

    return { message };
  } catch {
    const textError = extractApiError(text);

    return { message: textError.message || text || fallbackMessage };
  }
}

async function fetchCanvasScopedJson<T>(
  path: string,
  fallbackMessage: string,
  timeoutMessage: string,
  timeoutMs = 35_000,
) {
  const scope = getAcademyPreferenceRequestScope();
  const timeout = createRequestTimeout(timeoutMs);
  let response: Response;

  try {
    response = await apiFetch(`${apiBaseUrl}${path}`, {
      credentials: 'include',
      headers: { [academyPreferenceOwnerHeader]: scope.ownerKey },
      signal: timeout.signal,
    });
  } catch (error) {
    assertCurrentAcademyPreferenceScope(scope);

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(timeoutMessage, { cause: error });
    }

    throw new Error('Unable to reach the Canvas To Do API. Check that the API container is running.', { cause: error });
  } finally {
    timeout.cancel();
  }

  if (!response.ok) {
    const { message } = await readErrorResponse(response, fallbackMessage);
    assertCurrentAcademyPreferenceScope(scope);
    throw new ApiError(message, response.status);
  }

  const result = await response.json() as T;
  assertCurrentAcademyPreferenceScope(scope);
  return result;
}

async function mutateCanvasScopedJson<T>(
  path: string,
  body: unknown,
  fallbackMessage: string,
  timeoutMessage: string,
  timeoutMs = 35_000,
) {
  const scope = getAcademyPreferenceRequestScope();
  const timeout = createRequestTimeout(timeoutMs);
  let response: Response;

  try {
    response = await apiFetch(`${apiBaseUrl}${path}`, {
      body: JSON.stringify(body),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        [academyPreferenceOwnerHeader]: scope.ownerKey,
      },
      method: 'POST',
      signal: timeout.signal,
    });
  } catch (error) {
    assertCurrentAcademyPreferenceScope(scope);

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(timeoutMessage, { cause: error });
    }

    throw new Error('Unable to reach the Canvas To Do API. Check that the API container is running.', { cause: error });
  } finally {
    timeout.cancel();
  }

  if (!response.ok) {
    const { message } = await readErrorResponse(response, fallbackMessage);
    assertCurrentAcademyPreferenceScope(scope);
    throw new ApiError(message, response.status);
  }

  const result = await response.json() as T;
  assertCurrentAcademyPreferenceScope(scope);
  return result;
}

export type AdminUserStatus = 'active' | 'inactive' | 'pending';

export interface AuthSession {
  access?: string[];
  academyPreferenceOwnerKey?: string;
  displayName?: string;
  email?: string;
  hasPassword?: boolean;
  isAuthenticated: boolean;
  provider?: string;
  isAdmin?: boolean;
}

export interface AuthConfig {
  emailDeliveryConfigured: boolean;
  facebookConfigured: boolean;
  googleConfigured: boolean;
  passwordLoginConfigured: boolean;
  registrationApprovalRequired: boolean;
  twoFactorAvailable: boolean;
}

export interface AuthActionResponse {
  message: string;
  developmentActionUrl?: string;
}

export interface ConfirmEmailRequest {
  userId: string;
  code: string;
}

export interface ResetPasswordRequest {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export interface LoginResult {
  succeeded: boolean;
  requiresTwoFactor: boolean;
  session?: AuthSession;
}

export interface TwoFactorStatus {
  enabled: boolean;
  hasAuthenticator: boolean;
  recoveryCodesLeft: number;
}

export interface TwoFactorSetup {
  sharedKey: string;
  authenticatorUri: string;
}

export interface TwoFactorConfirmation {
  enabled: boolean;
  recoveryCodes: string[];
}

export interface UpdateAcademyProfileRequest {
  displayName?: string;
  currentPassword?: string;
  newPassword?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  emailConfirmed: boolean;
  displayName: string;
  role?: string;
  status: AdminUserStatus;
  lastLoginAt?: string;
  twoFactorEnabled?: boolean;
  phoneNumber?: string;
  createdAt?: string;
  lockedUntil?: string;
  hasPassword?: boolean;
  passwordRequest?: PasswordChangeStatus | null;
}

export interface PasswordChangeStatus {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  requestedAt: string;
  expiresAt: string;
  reviewedAt?: string;
  source?: 'sign-in-reset' | 'email-verified-reset' | 'legacy';
}

export interface AdminUsersResponse {
  users?: AdminUser[];
  items?: AdminUser[];
  total?: number;
  page?: number;
  pageSize?: number;
}

export interface UpdateAdminUserRequest {
  displayName?: string;
  role?: string;
  status?: AdminUserStatus;
  email?: string;
  phoneNumber?: string;
}


export interface CanvasSchool {
  name: string;
  instanceUrl: string;
}

export interface CanvasTokenStatus {
  configured: boolean;
  connected: boolean;
  status: 'connected' | 'needs_connection' | 'pending' | 'expired' | 'invalid';
  instanceUrl?: string;
  tokenSource: 'user' | 'environment' | 'none' | string;
  startsAt?: string;
  expiresAt?: string;
  updatedAt?: string;
  userName?: string;
  oauthConfigured?: boolean;
  manualTokenEnabled?: boolean;
  connectUrl?: string;
  schools?: CanvasSchool[];
}

export interface UpdateCanvasTokenRequest {
  instanceUrl: string;
  accessToken: string;
  startsAt?: string;
  expiresAt?: string;
}

export interface CanvasCourse {
  id: string;
  name: string;
  courseCode?: string;
  termName?: string;
  termStartAt?: string;
  termEndAt?: string;
  workflowState?: string;
  enrollmentState?: string;
  accessRestrictedByDate?: boolean;
  accessClosed?: boolean;
  isPublished?: boolean;
  startAt?: string;
  endAt?: string;
  htmlUrl?: string;
  currentScore?: number;
  currentGrade?: string;
}

export interface CanvasCourses {
  courses: CanvasCourse[];
  termName?: string;
  /** False when Canvas returned active courses but historical enrollment lookup was partial. */
  isComplete: boolean;
}

export interface CanvasCourseTab {
  id: string;
  label: string;
  type?: string;
  visibility?: string;
  hidden: boolean;
  htmlUrl?: string;
}

export interface CanvasCourseModuleItem {
  id: string;
  title: string;
  type?: string;
  contentId?: string;
  pageUrl?: string;
  url?: string;
  htmlUrl?: string;
  externalUrl?: string;
  completionRequirementCompletedAt?: string;
}

export interface CanvasCourseModule {
  id: string;
  name: string;
  position?: number;
  itemCount?: number;
  items: CanvasCourseModuleItem[];
}

export interface CanvasCourseAnnouncement {
  id: string;
  title: string;
  message?: string;
  postedAt?: string;
  htmlUrl?: string;
}

export interface CanvasRubricRating {
  id: string;
  description?: string;
  longDescription?: string;
  points?: number;
}

export interface CanvasRubricCriterion {
  id: string;
  description?: string;
  longDescription?: string;
  points?: number;
  criterionUseRange: boolean;
  ignoreForScoring: boolean;
  ratings: CanvasRubricRating[];
}

export interface CanvasRubricSettings {
  id?: string;
  title?: string;
  pointsPossible?: number;
  hideScoreTotal?: boolean;
  hidePoints?: boolean;
  freeFormCriterionComments?: boolean;
}

export interface CanvasCourseAssignment {
  id: string;
  name: string;
  description?: string;
  dueAt?: string;
  pointsPossible?: number;
  htmlUrl?: string;
  submissionTypes: string[];
  isSubmitted: boolean;
  score?: number;
  grade?: string;
  submittedAt?: string;
  workflowState?: string;
  useRubricForGrading?: boolean;
  rubricSettings?: CanvasRubricSettings;
  rubric: CanvasRubricCriterion[];
}

export interface CanvasAssignmentSubmissionRequest {
  submissionType: string;
  body?: string;
  url?: string;
  comment?: string;
}

export interface CanvasSubmissionResult {
  success: boolean;
  status: string;
  message?: string;
  htmlUrl?: string;
  submittedAt?: string;
}

export interface CanvasCourseQuiz {
  id: string;
  title: string;
  description?: string;
  dueAt?: string;
  pointsPossible?: number;
  htmlUrl?: string;
  quizType?: string;
  questionCount?: number;
  allowedAttempts?: number;
  assignmentId?: string;
}

export interface CanvasQuizStartRequest {
  accessCode?: string;
}

export interface CanvasQuizSubmission {
  id: string;
  quizId: string;
  submissionId?: string;
  attempt?: number;
  workflowState?: string;
  validationToken?: string;
  startedAt?: string;
  finishedAt?: string;
  endAt?: string;
  htmlUrl?: string;
}

export interface CanvasCourseDiscussion {
  id: string;
  title: string;
  message?: string;
  postedAt?: string;
  htmlUrl?: string;
  authorName?: string;
  isAnnouncement: boolean;
  assignmentId?: string;
}

export interface CanvasDiscussionEntryRequest {
  message: string;
  parentEntryId?: string;
}

export interface CanvasDiscussionEntry {
  id: string;
  message?: string;
  createdAt?: string;
  authorName?: string;
  htmlUrl?: string;
}

export interface CanvasCourseUser {
  id: string;
  name: string;
  shortName?: string;
  sortableName?: string;
  avatarUrl?: string;
  roles: string[];
  loginId?: string;
  email?: string;
  bio?: string;
  enrollmentStates: string[];
  sectionIds: string[];
}

export type CanvasCoursePerson = CanvasCourseUser;

export interface CanvasCoursePeople {
  people: CanvasCourseUser[];
  isComplete: boolean;
}

export interface CanvasCourseContent {
  course: CanvasCourse;
  tabs: CanvasCourseTab[];
  modules: CanvasCourseModule[];
  announcements: CanvasCourseAnnouncement[];
  assignments: CanvasCourseAssignment[];
  quizzes: CanvasCourseQuiz[];
  discussions: CanvasCourseDiscussion[];
  pages: CanvasCoursePage[];
  people: CanvasCourseUser[];
  frontPage?: CanvasCoursePage;
  syllabusBody?: string;
}

export type CanvasCourseContentSection =
  | 'home'
  | 'modules'
  | 'announcements'
  | 'syllabus'
  | 'assignments'
  | 'pages'
  | 'people'
  | 'grades'
  | 'all';

export interface CanvasCoursePage {
  id: string;
  title: string;
  pageUrl?: string;
  body?: string;
  htmlUrl?: string;
  updatedAt?: string;
}

export interface CanvasCourseFile {
  id: string;
  displayName: string;
  fileName?: string;
  contentType?: string;
  url?: string;
  previewUrl?: string;
  htmlUrl?: string;
  size?: number;
  updatedAt?: string;
}

export interface CanvasInboxItem {
  id: string;
  title: string;
  message?: string;
  type: string;
  courseId?: string;
  courseCode?: string;
  courseName?: string;
  createdAt?: string;
  updatedAt?: string;
  htmlUrl?: string;
  readState?: string;
}

export interface CanvasInboxItems {
  items: CanvasInboxItem[];
  isComplete: boolean;
}


export interface CanvasCalendarItem {
  id: string;
  title: string;
  type: string;
  courseId?: string;
  courseCode?: string;
  courseName?: string;
  startAt?: string;
  endAt?: string;
  dueAt?: string;
  htmlUrl?: string;
  contextCode?: string;
  submissionTypes?: string[];
  assignmentId?: string;
  isSubmitted?: boolean;
  submittedAt?: string;
}

export interface CanvasCalendarItems {
  items: CanvasCalendarItem[];
  isComplete: boolean;
}


export interface AcademyPreferences {
  manualLectures: unknown[];
  canvasLecturePreferences: Record<string, unknown>;
  manualCoursework: unknown[];
  canvasCourseworkPreferences: Record<string, unknown>;
  manualAssessments: unknown[];
  canvasAssessmentPreferences: Record<string, unknown>;
  calendarSettings?: unknown;
  exists: boolean;
}

export interface SaveAcademyPreferencesRequest {
  manualLectures?: unknown[];
  canvasLecturePreferences?: Record<string, unknown>;
  manualCoursework?: unknown[];
  canvasCourseworkPreferences?: Record<string, unknown>;
  manualAssessments?: unknown[];
  canvasAssessmentPreferences?: Record<string, unknown>;
  calendarSettings?: unknown;
}


export const canvasToDoApi = {
  async accountRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await apiFetch(`${apiBaseUrl}${path}`, {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to complete the account request.');
      throw new ApiError(message, response.status);
    }
    return response.json() as Promise<T>;
  },
  getAcademyPreferenceRequestScope,

  setAcademyPreferenceOwnerKey,

  getExternalLoginUrl(
    provider: 'google' | 'facebook',
    returnUrl = appPath('/'),
    rememberMe = false,
  ) {
    const params = new URLSearchParams({ rememberMe: String(rememberMe), returnUrl });
    return `${apiBaseUrl}/auth/${provider}/login?${params.toString()}`;
  },


  async getAuthSession() {
    let response: Response;

    try {
      response = await apiFetch(`${apiBaseUrl}/auth/session`, {
        credentials: 'include',
      });
    } catch {
      throw new Error('Unable to reach the Canvas To Do API. Check that the API container is running.');
    }

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to check your sign-in session.');

      throw new ApiError(message, response.status);
    }

    return response.json() as Promise<AuthSession>;
  },

  async logout() {
    const response = await apiFetch(`${apiBaseUrl}/auth/logout`, {
      credentials: 'include',
      method: 'POST',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to sign out.');

      throw new ApiError(message, response.status);
    }

    setAcademyPreferenceOwnerKey(null);
  },


  async getAuthConfig() {
    const response = await apiFetch(`${apiBaseUrl}/auth/config`, {
      credentials: 'include',
    });

    if (!response.ok) {
      return {
        emailDeliveryConfigured: false,
        facebookConfigured: false,
        googleConfigured: false,
        passwordLoginConfigured: true,
        registrationApprovalRequired: true,
        twoFactorAvailable: true,
      } satisfies AuthConfig;
    }

    return response.json() as Promise<AuthConfig>;
  },

  async signup(request: { displayName: string; email: string; password: string }) {
    const response = await apiFetch(`${apiBaseUrl}/auth/signup`, {
      body: JSON.stringify(request),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to create your account.');
      throw new ApiError(message, response.status);
    }

    return response.json() as Promise<AuthActionResponse>;
  },

  async confirmEmail(request: ConfirmEmailRequest) {
    const response = await apiFetch(`${apiBaseUrl}/auth/confirm-email`, {
      body: JSON.stringify(request),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to confirm your email.');
      throw new ApiError(message, response.status);
    }

    return response.json() as Promise<AuthActionResponse>;
  },

  async resendConfirmation(email: string) {
    const response = await apiFetch(`${apiBaseUrl}/auth/resend-confirmation`, {
      body: JSON.stringify({ email }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to resend confirmation instructions.');
      throw new ApiError(message, response.status);
    }

    return response.json() as Promise<AuthActionResponse>;
  },

  async requestPasswordReset(request: { email: string; newPassword: string; confirmPassword: string }) {
    return this.accountRequest<AuthActionResponse>('/auth/reset-password/request', 'POST', request);
  },

  async forgotPassword(email: string) {
    const response = await apiFetch(`${apiBaseUrl}/auth/forgot-password`, {
      body: JSON.stringify({ email }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to request password-reset instructions.');
      throw new ApiError(message, response.status);
    }

    return response.json() as Promise<AuthActionResponse>;
  },

  async resetPassword(request: ResetPasswordRequest) {
    const response = await apiFetch(`${apiBaseUrl}/auth/reset-password`, {
      body: JSON.stringify(request),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to reset your password.');
      throw new ApiError(message, response.status);
    }

    return response.json() as Promise<AuthActionResponse>;
  },

  async login(request: { email: string; password: string; rememberMe?: boolean }) {
    setAcademyPreferenceOwnerKey(null);
    const response = await apiFetch(`${apiBaseUrl}/auth/login`, {
      body: JSON.stringify(request),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'The email or password is incorrect.');
      throw new ApiError(message, response.status);
    }

    return response.json() as Promise<LoginResult>;
  },

  async loginWithTwoFactor(request: { code: string; rememberMe?: boolean; rememberMachine?: boolean }) {
    const response = await apiFetch(`${apiBaseUrl}/auth/2fa/login`, {
      body: JSON.stringify(request),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'The verification code was not accepted.');
      throw new ApiError(message, response.status);
    }

    return response.json() as Promise<LoginResult>;
  },

  async loginWithRecoveryCode(recoveryCode: string) {
    const response = await apiFetch(`${apiBaseUrl}/auth/2fa/recovery`, {
      body: JSON.stringify({ recoveryCode }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'The recovery code was not accepted.');
      throw new ApiError(message, response.status);
    }

    return response.json() as Promise<LoginResult>;
  },

  async getTwoFactorStatus() {
    const response = await apiFetch(`${apiBaseUrl}/auth/2fa/status`, { credentials: 'include' });
    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to load two-step verification status.');
      throw new ApiError(message, response.status);
    }
    return response.json() as Promise<TwoFactorStatus>;
  },

  async beginTwoFactorSetup() {
    const response = await apiFetch(`${apiBaseUrl}/auth/2fa/setup`, {
      credentials: 'include',
      method: 'POST',
    });
    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to start two-step verification setup.');
      throw new ApiError(message, response.status);
    }
    return response.json() as Promise<TwoFactorSetup>;
  },

  async confirmTwoFactor(code: string) {
    const response = await apiFetch(`${apiBaseUrl}/auth/2fa/confirm`, {
      body: JSON.stringify({ code }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'The verification code was not accepted.');
      throw new ApiError(message, response.status);
    }
    return response.json() as Promise<TwoFactorConfirmation>;
  },

  async disableTwoFactor(code: string) {
    const response = await apiFetch(`${apiBaseUrl}/auth/2fa/disable`, {
      body: JSON.stringify({ code }),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to disable two-step verification.');
      throw new ApiError(message, response.status);
    }
  },

  async updateAcademyProfile(request: UpdateAcademyProfileRequest) {
    const response = await apiFetch(`${apiBaseUrl}/auth/profile`, {
      body: JSON.stringify(request),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to update Academy profile.');
      throw new ApiError(message, response.status);
    }

    return response.json();
  },

  async getAdminUsers(options: { page?: number; pageSize?: number; search?: string } = {}) {
    const params = new URLSearchParams({
      page: String(options.page ?? 1),
      pageSize: String(options.pageSize ?? 50),
    });

    if (options.search?.trim()) {
      params.set('search', options.search.trim());
    }

    const response = await apiFetch(`${apiBaseUrl}/admin/users?${params.toString()}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to load users.');
      throw new ApiError(message, response.status);
    }

    const result = await response.json() as AdminUsersResponse;
    return {
      ...result,
      users: result.items ?? result.users ?? [],
    };
  },

  async updateAdminUser(userId: string, request: UpdateAdminUserRequest) {
    const response = await apiFetch(`${apiBaseUrl}/admin/users/${encodeURIComponent(userId)}`, {
      body: JSON.stringify(request),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'PATCH',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to update user.');
      throw new ApiError(message, response.status);
    }

    return response.json() as Promise<AdminUser>;
  },


  async signOutAdminUser(userId: string) {
    const response = await apiFetch(`${apiBaseUrl}/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, {
      credentials: 'include',
      method: 'POST',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to sign out this user.');
      throw new ApiError(message, response.status);
    }

    return undefined;
  },


  async getCanvasTokenStatus() {
    const scope = getAcademyPreferenceRequestScope();
    const response = await apiFetch(`${apiBaseUrl}/canvas/token`, {
      credentials: 'include',
      headers: { [academyPreferenceOwnerHeader]: scope.ownerKey },
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to load Canvas token status.');
      assertCurrentAcademyPreferenceScope(scope);

      throw new ApiError(message, response.status);
    }

    const result = await response.json() as CanvasTokenStatus;
    assertCurrentAcademyPreferenceScope(scope);
    return result;
  },

  async updateCanvasToken(request: UpdateCanvasTokenRequest) {
    const scope = getAcademyPreferenceRequestScope();
    const response = await apiFetch(`${apiBaseUrl}/canvas/token`, {
      body: JSON.stringify(request),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        [academyPreferenceOwnerHeader]: scope.ownerKey,
      },
      method: 'PUT',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to update Canvas API token.');
      assertCurrentAcademyPreferenceScope(scope);

      throw new ApiError(message, response.status);
    }

    const result = await response.json() as CanvasTokenStatus;
    assertCurrentAcademyPreferenceScope(scope);
    window.dispatchEvent(new Event('canvas-token-updated'));
    return result;
  },

  async deleteCanvasToken() {
    const scope = getAcademyPreferenceRequestScope();
    const response = await apiFetch(`${apiBaseUrl}/canvas/token`, {
      credentials: 'include',
      headers: { [academyPreferenceOwnerHeader]: scope.ownerKey },
      method: 'DELETE',
    });

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to reset Canvas API token.');
      assertCurrentAcademyPreferenceScope(scope);

      throw new ApiError(message, response.status);
    }

    const result = await response.json() as CanvasTokenStatus;
    assertCurrentAcademyPreferenceScope(scope);
    window.dispatchEvent(new Event('canvas-token-updated'));
    return result;
  },


  async getCanvasCourses(pageSize = 5) {
    const params = new URLSearchParams({ pageSize: String(Math.min(Math.max(pageSize, 1), 100)) });
    return fetchCanvasScopedJson<CanvasCourses>(
      `/canvas/courses?${params.toString()}`,
      'Unable to load Canvas courses.',
      'Canvas courses took too long to respond. Try again in a moment.',
    );
  },

  async getCanvasCourseContent(courseId: string, section?: CanvasCourseContentSection) {
    const params = new URLSearchParams();

    if (section) {
      params.set('section', section);
    }

    return fetchCanvasScopedJson<CanvasCourseContent>(
      `/canvas/courses/${encodeURIComponent(courseId)}/content${params.size ? `?${params.toString()}` : ''}`,
      'Unable to load Canvas course content.',
      'Canvas course content took too long to respond. Try again in a moment.',
      50_000,
    );
  },

  async getCanvasCoursePage(courseId: string, pageUrl: string) {
    const params = new URLSearchParams({ pageUrl });
    return fetchCanvasScopedJson<CanvasCoursePage>(
      `/canvas/courses/${encodeURIComponent(courseId)}/pages?${params.toString()}`,
      'Unable to load Canvas page.',
      'Canvas page took too long to respond. Try again in a moment.',
    );
  },

  async getCanvasCoursePeople(courseId: string, pageSize = 250) {
    const params = new URLSearchParams({ pageSize: String(Math.min(Math.max(pageSize, 1), 500)) });
    return fetchCanvasScopedJson<CanvasCoursePeople>(
      `/canvas/courses/${encodeURIComponent(courseId)}/people?${params.toString()}`,
      'Unable to load Canvas course people.',
      'Canvas course people took too long to respond. Try again in a moment.',
    );
  },

  async getCanvasCourseAssignment(courseId: string, assignmentId: string) {
    return fetchCanvasScopedJson<CanvasCourseAssignment>(
      `/canvas/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}`,
      'Unable to load Canvas assignment.',
      'Canvas assignment took too long to respond. Try again in a moment.',
    );
  },

  async submitCanvasCourseAssignment(
    courseId: string,
    assignmentId: string,
    request: CanvasAssignmentSubmissionRequest,
  ) {
    return mutateCanvasScopedJson<CanvasSubmissionResult>(
      `/canvas/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}/submit`,
      request,
      'Unable to submit Canvas assignment.',
      'The Canvas assignment submission took too long. Check Canvas before retrying to avoid a duplicate submission.',
    );
  },

  async getCanvasCourseQuiz(courseId: string, quizId: string) {
    return fetchCanvasScopedJson<CanvasCourseQuiz>(
      `/canvas/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(quizId)}`,
      'Unable to load Canvas quiz.',
      'Canvas quiz took too long to respond. Try again in a moment.',
    );
  },

  async startCanvasCourseQuiz(courseId: string, quizId: string, request: CanvasQuizStartRequest = {}) {
    return mutateCanvasScopedJson<CanvasQuizSubmission>(
      `/canvas/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(quizId)}/submissions`,
      request,
      'Unable to start Canvas quiz.',
      'Canvas did not confirm the quiz attempt in time. Open Canvas to check before trying again.',
    );
  },

  async getCanvasCourseDiscussion(courseId: string, topicId: string) {
    return fetchCanvasScopedJson<CanvasCourseDiscussion>(
      `/canvas/courses/${encodeURIComponent(courseId)}/discussion-topics/${encodeURIComponent(topicId)}`,
      'Unable to load Canvas discussion.',
      'Canvas discussion took too long to respond. Try again in a moment.',
    );
  },

  async submitCanvasCourseDiscussionEntry(
    courseId: string,
    topicId: string,
    request: CanvasDiscussionEntryRequest,
  ) {
    return mutateCanvasScopedJson<CanvasDiscussionEntry>(
      `/canvas/courses/${encodeURIComponent(courseId)}/discussion-topics/${encodeURIComponent(topicId)}/entries`,
      request,
      'Unable to submit Canvas discussion entry.',
      'Canvas did not confirm the discussion post in time. Check Canvas before retrying to avoid a duplicate post.',
    );
  },

  async getCanvasCourseFile(courseId: string, fileId: string) {
    return fetchCanvasScopedJson<CanvasCourseFile>(
      `/canvas/courses/${encodeURIComponent(courseId)}/files/${encodeURIComponent(fileId)}`,
      'Unable to load Canvas file.',
      'Canvas file took too long to respond. Try again in a moment.',
    );
  },

  async getCanvasCourseModuleItem(courseId: string, moduleItemId: string) {
    return fetchCanvasScopedJson<CanvasCourseModuleItem>(
      `/canvas/courses/${encodeURIComponent(courseId)}/module-items/${encodeURIComponent(moduleItemId)}`,
      'Unable to load Canvas module item.',
      'Canvas module item took too long to respond. Try again in a moment.',
    );
  },

  async getCanvasInboxItems(pageSize = 50, options: { courseId?: string } = {}) {
    const params = new URLSearchParams({ pageSize: String(Math.min(Math.max(pageSize, 1), 100)) });

    if (options.courseId) {
      params.set('courseId', options.courseId);
    }

    return fetchCanvasScopedJson<CanvasInboxItems>(
      `/canvas/inbox-items?${params.toString()}`,
      'Unable to load Canvas inbox items.',
      'Canvas inbox took too long to respond. Try again in a moment.',
    );
  },


  async getCanvasCalendarItems(options: { forceRefresh?: boolean; startDate?: string; endDate?: string; pageSize?: number } = {}) {
    const scope = getAcademyPreferenceRequestScope();
    const params = new URLSearchParams();

    if (options.forceRefresh) {
      params.set('forceRefresh', 'true');
    }

    if (options.startDate) {
      params.set('startDate', options.startDate);
    }

    if (options.endDate) {
      params.set('endDate', options.endDate);
    }

    if (options.pageSize) {
      params.set('pageSize', String(options.pageSize));
    }

    const query = params.toString();
    const requestKey = `${scope.ownerKey}:${scope.version}:${query || 'default'}`;
    const pendingRequest = canvasCalendarRequests.get(requestKey);

    if (pendingRequest) {
      return pendingRequest.promise;
    }

    // Keep the browser deadline just beyond the API's bounded 45-second
    // aggregation window so the server can return its useful timeout detail.
    const timeout = createRequestTimeout(50000);
    const request = (async () => {
      let response: Response;

      try {
        response = await apiFetch(`${apiBaseUrl}/canvas/calendar-items${query ? `?${query}` : ''}`, {
          cache: options.forceRefresh ? 'no-store' : 'default',
          credentials: 'include',
          headers: { [academyPreferenceOwnerHeader]: scope.ownerKey },
          signal: timeout.signal,
        });
      } catch (error) {
        assertCurrentAcademyPreferenceScope(scope);

        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new Error('Canvas calendar took too long to respond. Check Canvas API status and try again.', { cause: error });
        }

        throw new Error('Unable to reach the Canvas To Do API. Check that the API container is running.', { cause: error });
      } finally {
        timeout.cancel();
      }

      if (!response.ok) {
        const { message } = await readErrorResponse(response, 'Unable to load Canvas calendar items.');
        assertCurrentAcademyPreferenceScope(scope);

        throw new ApiError(message, response.status);
      }

      const result = await response.json() as CanvasCalendarItems;
      assertCurrentAcademyPreferenceScope(scope);
      return result;
    })();

    canvasCalendarRequests.set(requestKey, { controller: timeout.controller, promise: request });

    try {
      return await request;
    } finally {
      if (canvasCalendarRequests.get(requestKey)?.promise === request) {
        canvasCalendarRequests.delete(requestKey);
      }
    }
  },


  async getAcademyPreferences(
    scope: AcademyPreferenceRequestScope = getAcademyPreferenceRequestScope(),
  ) {
    const response = await apiFetch(`${apiBaseUrl}/academy/preferences`, {
      credentials: 'include',
      headers: {
        [academyPreferenceOwnerHeader]: scope.ownerKey,
      },
    });

    assertCurrentAcademyPreferenceScope(scope);

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to load Academy preferences.');

      throw new ApiError(message, response.status);
    }

    const result = await response.json() as AcademyPreferences;
    assertCurrentAcademyPreferenceScope(scope);
    return {
      ...result,
      canvasCourseworkPreferences: normalizeCanvasItemPreferences(result.canvasCourseworkPreferences ?? {}),
      canvasAssessmentPreferences: normalizeCanvasItemPreferences(result.canvasAssessmentPreferences ?? {}),
    };
  },

  async saveAcademyPreferences(
    preferences: SaveAcademyPreferencesRequest,
    scope: AcademyPreferenceRequestScope = getAcademyPreferenceRequestScope(),
  ) {
    assertCurrentAcademyPreferenceScope(scope);
    const response = await apiFetch(`${apiBaseUrl}/academy/preferences`, {
      body: JSON.stringify(preferences),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        [academyPreferenceOwnerHeader]: scope.ownerKey,
      },
      method: 'PUT',
    });

    assertCurrentAcademyPreferenceScope(scope);

    if (!response.ok) {
      const { message } = await readErrorResponse(response, 'Unable to save Academy preferences.');

      throw new ApiError(message, response.status);
    }

    const result = await response.json() as AcademyPreferences;
    assertCurrentAcademyPreferenceScope(scope);
    return {
      ...result,
      canvasCourseworkPreferences: normalizeCanvasItemPreferences(result.canvasCourseworkPreferences ?? {}),
      canvasAssessmentPreferences: normalizeCanvasItemPreferences(result.canvasAssessmentPreferences ?? {}),
    };
  },

};
