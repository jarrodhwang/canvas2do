# Incos Workspace Architecture Review

## System shape

Incos Workspace is a browser application deployed as a small container stack:

```text
Browser
  |
  v
Nginx / frontend container (6173)
  |-- static React/Vite application
  |-- /api/* --------------------+
  |-- /signin-google ------------|--> ASP.NET Core API (6272)
                                 |      |
                                 |      +--> PostgreSQL
                                 |      +--> Google OAuth and APIs
                                 |      +--> Canvas LMS
                                 |      +--> Microsoft OAuth/API
                                 |      +--> filesystem-backed data-protection keys
```

`docker-compose.yml` supplies the production-like stack. `docker-compose.dev.yml`
uses the same boundaries with Vite and `dotnet watch` for hot reload. Nginx is the
browser-facing reverse proxy; the API can also be run directly during development.

## Frontend

The frontend is a React + TypeScript application built with Vite. `App.tsx` is the
composition root for authentication state, navigation, settings, calendar and
integration views. Reusable UI primitives are under `frontend/src/components/ui`.

The mode system is configuration-driven:

- `modes/types.ts` defines the mode contract.
- `modes/defaultModes.ts` defines Academy and Project/Workspace capabilities,
  navigation, fields, colors, views, and integration options.
- `ModeRegistry` applies environment-based visibility and naming overrides.
- `WorkspaceModeProvider` owns the active mode and persists that preference locally.
- `workspaceApi.ts` is the browser's API boundary and translates failed responses
  into user-facing errors.

This makes the shared workspace shell extensible, but the current mode data is still
largely mock/configuration data. A future persistence migration should keep mode
configuration separate from user-owned records so UI changes do not silently rewrite
stored data.

## Workspace / Project architecture

The Workspace mode is the generic customer-work-management surface in the shared
shell. It is not a programming-project tracker or a separate application. The
`project` entry in `defaultModes.ts` supplies navigation and capability metadata,
while the lazy-loaded `WorkspaceManagementView` owns the live dashboard, projects,
issues, workload board, calendar, timeline, customers, categories, and modal flows.
Academy components and persistence paths are not reused for Workspace mutations.

The current Workspace path is:

```text
Authenticated browser
        |
        v
WorkspaceModeProvider -> ModeRegistry -> WorkspaceManagementView
        |
        +--> workspaceManagementApi.ts -> /api/workspace/overview
        |                              -> customer/project/issue CRUD
        |                              -> calendar CRUD and sharing
        +--> workspaceApi.ts ----------> /api/workspace/preferences
        +--> existing Google views ----> Gmail, Drive, and Chat API routes
        |
        v
WorkspaceManagementEndpoints -> EF Core -> PostgreSQL
                               WorkspaceCustomer
                               WorkspaceWorkProject
                               WorkspaceWorkIssue
                               WorkspaceCalendarEntry -> WorkspaceCalendarShare
```

The mode registry remains a presentation and capability registry, not the system of
record. Environment variables can enable, hide, or rename modes at build time, and
the provider stores only the active mode id in browser local storage. Workspace work
records now come from the authenticated API; mock mode data remains only for legacy
shared-shell views and other modes.

### Domain and persistence boundary

Every project belongs to its owner and one customer company. Issues also require a
customer, but their project foreign key is nullable so an issue can stand alone.
Changing a project's customer updates its linked issues to preserve that invariant.
The controlled category taxonomy is TopSolid (CAM or Mold), Eureka, and Boxcon.

Calendar start and end values are converted from the user's configured IANA time
zone and sent as ISO instants. The API normalizes them to UTC `timestamptz` values;
each browser formats the same instant in its own configured time zone. Calendar
shares are normalized rows targeting an active user email or group id. Owners can
mutate an entry, while matching users and active group members receive read-only
visibility. Important creates, updates, status transitions, and deletes write audit
records.

Workspace settings remain JSON in `user_settings`, which is appropriate for theme,
language, time zone, display, refresh, and session preferences. Customer and workload
records are relational so they can be validated, indexed, joined, and audited. The
current deployment model creates the new tables idempotently on first Workspace API
use; a versioned EF migration should replace this compatibility bridge before schema
changes become frequent.

### Workspace quality review

- **Functional suitability:** durable customer, project, issue, calendar, sharing,
  board, and timeline flows cover the requested general workload. Standalone issues,
  customer allocation, and TopSolid/Eureka/Boxcon categorization are explicit domain
  rules rather than UI-only conventions.
- **Reliability:** server refresh after mutations, owner checks, relationship
  validation, disabled save states, retry feedback, and UTC normalization prevent the
  most likely divergent states. Add optimistic concurrency tokens before multiple
  browser sessions commonly edit the same owner record.
- **Performance efficiency:** owner/status/date and share-target indexes support the
  current overview query, and the feature is lazy-loaded. The overview is intentionally
  one request for a modest workload; add date ranges and pagination before accounts
  accumulate thousands of calendar items or issues.
- **Maintainability:** the typed Workspace API and dedicated feature component isolate
  Workspace behavior from `App.tsx` and Academy. Modal forms share DTO contracts with
  server validation. Move schema creation to migrations and split the feature into
  smaller view modules if its scope grows materially.
- **Compatibility and portability:** mode ids, API routes, local-storage keys, JSON
  preference versions, and date/time-zone behavior are cross-layer contracts. Version
  preference documents and use stable ids rather than display names so renamed modes
  and future clients remain compatible.
- **Security and freedom from risk:** all records are owner-scoped, shared calendar
  access is read-only, share targets must be active directory users/groups, and
  mutations are audited. Add explicit antiforgery protection and finer route-level
  manage permissions before broad external deployment.
- **Usability and quality in use:** focused dialogs, empty states, status controls,
  responsive layouts, local-time labels, retry feedback, and Google Calendar handoff
  keep core tasks discoverable. Keyboard, screen-reader, DST-transition, narrow-screen,
  slow-network, and expired-session paths still need automated regression coverage.

## Academy architecture

Academy is a feature configuration inside the shared workspace shell, not a separate
frontend or backend application. `defaultModes.ts` declares the Academy navigation
(`Dashboard`, `Courses`, `Grades`, `Inbox`, `People`, `Outlook`, and `Settings`),
calendar item types, dashboard cards, and the Canvas/Outlook integration choices.
`App.tsx` applies access grants and maps the Academy navigation ids to lazy-loaded
feature views. The large dashboard orchestration remains in `DashboardCards.tsx`;
the course, grade, inbox, and people experiences are split into their own components.

The main Academy data path is:

```text
Academy login/session
        |
        v
Shared React shell -> Academy view -> workspaceApi.ts
        |                         |
        |                         +--> /api/academy/preferences
        |                         +--> /api/canvas/*
        v
Local UI state and cross-view preference events
        |
        v
ASP.NET API -> PostgreSQL user_settings (JSON preferences)
            -> protected Canvas token + Canvas LMS API
```

### Identity and access

Academy users can create and use an Academy ID/password account through
`AuthEndpoints`. The account is represented by an `AdminUser` plus a unique
`AcademyCredentialAccount`; passwords are stored as hashes, and the API issues the
same protected cookie-session shape used by the rest of the workspace. The session
contains an Academy provider marker and login id, allowing access grants to be
filtered to Academy capabilities. Profile changes are deliberately limited to
Academy credential accounts, while administrators can manage account status and
Canvas token status.

### Preferences and local state

`WorkspaceEndpoints` stores the `academy.preferences` setting in the per-user
`user_settings` table as JSONB. The document contains manual lectures, manual
coursework and assessments, Canvas display/preferences, and calendar settings such
as the selected semester and grade thresholds. `App.tsx`, `DashboardCards.tsx`,
`CourseOverviewView.tsx`, and `AcademyGradesView.tsx` optimistically update local
state, persist through `PUT /api/academy/preferences`, and broadcast a browser
`academyPreferencesUpdated` event so mounted views converge without a full reload.
The API normalizes older preference shapes when they are read, which preserves
backward compatibility during the ongoing preference schema evolution.

This is intentionally lightweight and user-scoped, but it also means the JSON
document is the current source of truth for many Academy records. The relational
`Course` and `Assignment` entities exist in the shared domain model, yet the live
Academy course/grade views primarily consume Canvas DTOs and preference JSON rather
than those tables. That keeps the prototype simple, but makes reporting, querying,
conflict resolution, and offline use harder than they would be with normalized
Academy records.

### Canvas boundary

`CanvasIntegrationEndpoints` is the server-side anti-corruption layer for Canvas.
It resolves the current user's connection, decrypts the stored token with ASP.NET
Data Protection, calls Canvas, and maps provider responses into stable DTOs. The
browser never receives the raw token. The endpoint surface covers course lists,
course sections (home, modules, assignments/grades, pages, people), individual
assignment/quiz/discussion/file/module-item details and submissions, calendar
items, and inbox items. Calendar aggregation performs several provider reads,
deduplicates events, and uses memory caching; other content is loaded when the user
opens a course or resource.

Academy views therefore have two useful loading levels: summaries load courses,
preferences, and calendar/inbox data; detailed course and grade panels fetch the
smaller Canvas section or resource only when expanded. This limits initial payloads,
but provider availability and rate limits remain visible to the user because the
API is not yet a durable synchronization layer.

### Academy quality review

- **Functional suitability:** the split between shared shell behavior, user-owned
  preferences, and Canvas-backed learning data fits the current Academy workflow.
  Course, grade, content, people, calendar, inbox, and submission flows are
  represented. The main product boundary to clarify is whether manual data and
  Canvas data should eventually become one durable academic record model.
- **Reliability:** request sequence refs, cancellation checks, `Promise.allSettled`,
  loading states, and best-effort Canvas sections reduce stale or partial UI failures.
  Add bounded retries/circuit breaking for Canvas and a durable sync or snapshot
  strategy before users need reliable history during Canvas outages.
- **Performance efficiency:** lazy-loaded views, section-level Canvas requests,
  bounded course page sizes, calendar caching, and parallel summary requests are
  good choices. The next constraint is repeated provider fan-out; enforce consistent
  pagination, response-size limits, cache expiry, and per-user rate limits.
- **Maintainability:** the API client and endpoint DTOs give the frontend a clear
  boundary, and feature views isolate most Academy screens. `App.tsx` and
  `DashboardCards.tsx` still contain substantial Academy orchestration; extracting
  Academy hooks/services would make refresh, preference saves, and event contracts
  easier to test without changing the public API.
- **Compatibility and portability:** Canvas instance URL, token lifetime, reverse
  proxy configuration, cookie settings, and JSON preference versions vary by
  deployment. Validate these settings at startup and keep Canvas-specific mapping
  out of shared UI components.
- **Security and freedom from risk:** HTTP-only sessions, server-side Canvas calls,
  encrypted tokens, authorization groups, and inactive-account checks are sound
  foundations. Review CSRF protection for cookie-authenticated writes, admin
  authorization on every administrative token route, token redaction in logs, and
  secret management before production exposure.

## Admin Console architecture

Admin Console is another mode in the shared React shell. Its mode definition in
`frontend/src/modes/defaultModes.ts` supplies the navigation and preview dashboard,
while `App.tsx` selects the Users and Groups feature views. Those two views are
lazy-loaded so the normal Academy and Workspace paths do not pay their bundle cost
until an administrator opens them. `accessControl.ts` filters modes and sidebar
items from the access grants returned by the authenticated session.

The live admin data path is:

```text
Authenticated browser
        |
        v
App.tsx -> AdminUsersView / AdminGroupsView -> workspaceApi.ts
        |                         |
        |                         +--> /api/admin/users
        |                         +--> /api/admin/groups
        |                         +--> /api/canvas/admin/users/{id}/token
        v
ASP.NET access middleware -> authenticated endpoint group -> EF Core/PostgreSQL
                             AdminUser, AdminGroup, AdminGroupMember,
                             AcademyCredentialAccount, Canvas token records
```

The API is the authority for user and group changes. The `/api/admin` endpoint
group requires authentication, and the request middleware applies access grants
before endpoint execution: `admin-users` gates user routes, `admin-groups` gates
group routes, and other admin paths require an `admin-*` grant. Group records store
three separate grant dimensions—`access`, `permissions`, and `settings`—which are
then used to shape the session grants and the frontend navigation. Protected-group
handling keeps the primary administrator recoverable, while account deactivation
disables API access, revokes sessions, and removes stored Google tokens.

The Users view loads users and groups together to support group-name search, then
loads a selected user's detail, activity log, and Canvas token status on demand.
It can update Academy credential fields, status, API access, session revocation, and
Canvas token metadata. Google-managed users retain their Google identity and
password ownership. The Groups view edits normalized grant lists and member ids;
the API validates duplicate names, protected groups, and Academy grant
compatibility before saving.

This boundary is important: the console's navigation contains planned areas beyond
Users and Groups, but those pages currently fall back to the shared mock/calendar
surface. They should not be described as operational administration until they have
typed API contracts, server-side authorization, persistence, and audit coverage.

### Admin Console quality review

- **Functional suitability:** live user/group administration covers the current
  access-management workflow, including account lifecycle, group membership, and
  Canvas token status. The remaining menu entries are product placeholders, and
  the access model should distinguish menu visibility from action-level permissions
  before more destructive operations are added.
- **Reliability:** mounted-state guards, parallel initial loading, explicit loading
  states, and API validation reduce stale updates and malformed changes. Add
  transactional audit writes and idempotent mutation semantics so a membership or
  token operation cannot succeed without a traceable record.
- **Performance efficiency:** users/groups load in parallel and user details and
  token status are deferred. For larger directories, move search/filtering and
  pagination to the API, return only the fields needed for the list, and avoid
  rebuilding every user's group-name index on unrelated edits.
- **Maintainability:** the typed `workspaceApi` boundary and separate Users/Groups
  views are good seams. The permission catalog is currently embedded in
  `AdminGroupsView`; move it to a shared, versioned capability catalog so the
  frontend, middleware, and seed/default-group logic cannot drift.
- **Compatibility and portability:** grant ids, mode ids, account-status values,
  and JSON grant columns are cross-layer contracts. Treat them as stable versioned
  identifiers, and keep local Academy accounts distinct from Google directory
  identities when deployments change identity providers.
- **Security and freedom from risk:** server-side access checks, protected-group
  rules, password hashing, token encryption, and token cleanup on deactivation are
  strong foundations. Cookie-authenticated PATCH/POST/PUT/DELETE routes still need
  explicit CSRF protection, action-level authorization rather than only route-level
  grants, rate limiting for sensitive operations, and immutable audit records that
  never log passwords or token values. Preview/impersonation must also be clearly
  labeled and fully audited.
- **Usability and quality in use:** search, status badges, refresh actions, and
  focused detail panels support efficient administration. Add confirmation and
  impact summaries for deactivation, group permission changes, and token resets;
  show partial-failure states for the combined users/groups load; and test keyboard,
  narrow-screen, expired-session, and slow-directory scenarios.
- **Usability and quality in use:** users get a unified Academy workspace and
  actionable loading/error states, but slow-network, expired-token, partial-Canvas,
  small-screen, keyboard, and screen-reader paths need regression coverage. Saving
  JSON preferences should also surface a clear retry state when optimistic updates
  cannot be persisted.

## Backend

The backend is an ASP.NET Core minimal API. `Program.cs` configures dependency
injection, EF Core, cookies, Google authentication, data protection, CORS, forwarded
headers, and endpoint mapping. Endpoint groups separate the main responsibilities:

- `AuthEndpoints`: Google OAuth, Academy credentials, sessions, account status, and
  access grants.
- `WorkspaceEndpoints`: generic workspace records and preferences.
- `GoogleIntegrationEndpoints`: Calendar, Drive, Gmail, Chat, and related provider
  operations.
- `CanvasIntegrationEndpoints`: Canvas LMS operations and encrypted token handling.
- `MicrosoftIntegrationEndpoints`: Microsoft integration flows.

EF Core's `IncosWorkspaceDbContext` maps shared workspace entities plus specialized
integration and administration data. Provider tokens are intended to remain behind
the API; the frontend receives status/data DTOs rather than provider credentials.

## Request and security flow

1. The browser requests `/api/auth/session` to establish the current session.
2. Sign-in starts at the API, which performs Google OAuth and issues an HTTP-only
   cookie. Academy accounts use a server-side password verification path.
3. Protected endpoint groups require authorization and resolve the current user before
   reading or writing user-scoped data.
4. Google/Canvas/Microsoft calls are made server-side. Canvas credentials are protected
   with ASP.NET Data Protection; persistent data-protection keys are mounted in Docker
   so cookies remain valid across container restarts.
5. Nginx forwards `X-Forwarded-*` headers, allowing the API to reconstruct the public
   request scheme and host when OAuth redirects are generated.

## Quality assessment

### Strengths

- **Functional suitability:** the API boundary centralizes OAuth and integrations, and
  the mode contract supports multiple workflows without duplicating the entire shell.
- **Reliability:** health-gated PostgreSQL startup, request cancellation, friendly API
  error handling, session revocation checks, and persistent data-protection keys address
  common operational failures.
- **Maintainability:** endpoint groups, DTOs, entity/data layers, mode configuration,
  and reusable UI primitives provide useful seams for change.
- **Security:** HTTP-only cookies, server-side provider calls, domain restrictions,
  authorization groups, encrypted Canvas tokens, and inactive-user rejection are good
  foundations.
- **Usability:** the client preserves navigation/mode preferences, lazy-loads heavier
  views, supports English/Korean, and maps backend failures to actionable messages.

### Risks and practical next steps

- **Security/configuration:** the compose file contains a development database password,
  CORS allows several localhost origins, and Vite has `allowedHosts: true`. Use secrets
  and an explicit production origin/host allowlist before internet exposure. Also review
  cookie `Secure`, CSRF protection for cookie-authenticated state-changing requests, and
  OAuth scope minimization.
- **Reliability:** `Database__EnsureCreated` is convenient for a prototype but does not
  provide a safe schema migration history. Introduce EF Core migrations and a controlled
  deployment step before production data matters. Add API health/readiness endpoints and
  bounded retry/circuit-breaker behavior for provider calls.
- **Performance:** provider endpoints should enforce pagination, response-size limits,
  and per-user rate limits consistently. Keep the existing lazy loading and bounded
  Gmail concurrency, and move long sync/download work to background jobs when it can
  outlive an HTTP request.
- **Maintainability:** `App.tsx` and the large integration endpoint classes are becoming
  orchestration hotspots. Extract feature-level hooks/services and provider clients while
  preserving the current endpoint contracts. Add contract tests for auth/session and
  integration error shapes.
- **Compatibility/portability:** OAuth callback URLs, CORS origins, ports, and the
  PostgreSQL volume layout are environment-specific. Make these explicit deployment
  settings and validate them at startup so misconfiguration fails clearly.
- **Quality in use:** users can complete the main flows, but loading, retry, permission,
  and expired-session states should be tested on slow networks and small screens. Keep
  accessible labels/focus behavior under regression tests, especially for lazy-loaded
  dialogs and integration panels.

## Recommended boundary for future work

Keep the browser responsible for presentation, local navigation preferences, and
request orchestration. Keep authentication, authorization, provider credentials, sync
coordination, data ownership, and audit-relevant actions in the API. Introduce a
background sync layer only when provider latency or recurring synchronization makes
request/response handling unreliable; until then, provider-specific service classes
inside the API are a smaller and easier-to-operate step.
