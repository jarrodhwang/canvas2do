# Canvas To Do Architecture

## Product boundary

Canvas To Do is a public, multi-user academic calendar. It combines user-managed
study data with a bounded Canvas LMS surface for courses, course content, grades,
activity notifications, rosters, and calendar items. It is not an organization
directory, Google Workspace client, SFU credential collector, or browser-side Canvas
API client.

```text
Browser
  |
  v
Nginx / React SPA (HTTPS, /canvas-to-do/)
  |
  +-- /canvas-to-do/api/* --------------------------+
                                                     v
                                      ASP.NET Core API
                                        |     |     |
                                        |     |     +-- SMTP
                                        |     +-------- SFU Canvas API
                                        +-------------- PostgreSQL + key ring

Application identity
  +-- confirmed email/password
  +-- Google identity OAuth
  +-- Facebook identity OAuth
  +-- optional TOTP/recovery codes

Canvas connection
  +-- preferred: institution-approved Canvas OAuth authorization code
  +-- fallback: user-supplied personal access token when operator-enabled
```

The backend owns authentication, authorization, provider exchanges, secrets, token
protection, persistence, request validation, and audit-relevant mutations. The
frontend owns presentation, accessible feedback, local calendar editing, and request
orchestration.

## Identity and access

ASP.NET Core Identity with GUID user ids is the source of truth. Identity tables use
their own EF migration history; Canvas tokens and Academy preferences use
`user:{guid}` ownership. An unverified email string is never accepted as a data-owner
key.

Password signup creates an unconfirmed account and no application cookie. Email
confirmation is required before login. Confirmation, resend, forgot-password, and
reset endpoints use short-lived Identity tokens delivered through a small SMTP
boundary. Responses for unknown/ineligible accounts are deliberately generic, and
password reset rotates the security stamp so prior cookies stop working. Action
tokens travel in URL fragments (not HTTP request targets) and are removed by the SPA
before the exchange request.

Google and Facebook are optional identity providers. They request identity-only
scopes and application code stores no provider access token. A provider email is
trusted only when a mapped verification claim says it is verified. Accounts are not
merged merely because two providers return the same email address.

TOTP is optional per user. Setup requires an authenticated session, confirmation
requires a valid authenticator code, recovery codes are shown once, and login can
remember a device only when the user opts in.

Roles are `User` and `Admin`:

- `User`: own profile/security, Academy preferences, Canvas connection, courses, and
  calendar items.
- `Admin`: all user access plus paged user search, display-name/role/status changes,
  email-confirmation visibility, and session revocation.

Self-demotion/deactivation, removal of the final active admin, and changes to the
configured bootstrap administrator are guarded. Security-stamp validation runs on
every request so deactivation, demotion, and revocation take effect immediately.

## Browser request boundary

The application cookie is HTTP-only, `SameSite=Lax`, and secure outside Development.
Every non-GET/HEAD/OPTIONS API request must include:

```text
X-Canvas-To-Do-Request: 1
```

A cross-site HTML form cannot set that header. Cross-origin JavaScript must first
pass the credentialed CORS origin check, so the header and CORS policy form the CSRF
boundary. OAuth callbacks remain GET requests and independently validate protected
correlation/state values.

Academy preference and self-service Canvas requests also carry the session's opaque
`X-Canvas-To-Do-Owner-Key`. The server compares it with the authenticated GUID owner,
and the SPA discards responses if that owner changes while a request is in flight.
Authenticated API responses are marked `no-store` to prevent browser or proxy cache
replay across sign-out/sign-in transitions.

Authentication, recovery, 2FA, administrator writes, and Canvas reads have bounded
rate-limit partitions. Forced calendar refreshes have a stricter partition than
cache-eligible reads. Nginx adds CSP, frame-ancestor, referrer, permissions, and
content-type headers. API/database Compose ports bind only to loopback.

Production Compose explicitly enables forwarded-header trust because Nginx is the
only API ingress and published service ports are loopback-only. The outer TLS proxy
must overwrite `X-Forwarded-For` with one client address; frontend Nginx rejects a
multi-hop value before passing one hop to the API. Direct deployments default to not
trusting arbitrary forwarded headers. The public host must be supplied through
`ALLOWED_HOSTS`.

## Canvas boundary

`CanvasIntegrationEndpoints` exposes connection/token management, OAuth
start/callback, course summaries and content, course rosters, activity-stream inbox
items, calendar items, and selected course-resource routes. Assignment text/URL
submissions, discussion replies, and quiz-attempt starts are explicit user-triggered
writes with a separate rate limit; there are no background Canvas writes.
Administrators cannot read or replace another user's Canvas credential.

The default allowlisted origin is `https://sfu.instructure.com`. User-entered URLs
are normalized to configured HTTPS origins; paths, credentials, fragments, unexpected
redirect origins, and non-allowlisted pagination links are rejected. Each calendar
request shares one deadline plus page, byte, and final-item budgets across every
course, event type, and submission lookup. Active-course data uses short bounded
caching and striped refresh locks. The shared cache has a 64 MiB size budget;
outbound work admits at most 64 active-or-waiting calls, performs at most 16 calls at
once, and abandons capacity waits after three seconds. A partial best-effort calendar
response carries `isComplete: false`, is shown with a warning, and is never cached as
authoritative. The pooled Canvas HTTP handler stores no cookies between users.

Course-to-manual migration is fail-safe: a returned course requires a term end in the
past plus an `access_restricted_by_date` signal that says the user cannot view it. A
previously seen course also migrates when it is absent from a successful, complete
active-and-historical course response. Partial historical responses, token failures,
and other connection errors are not treated as lost enrollment. Previously generated
manual copies are suppressed while the same Canvas course is accessible, without
deleting the retained manual backup.

Manual accounts use Spring (January–April), Summer (May–August), and Fall
(September–December). The shared term store includes the current term plus terms
with at least one non-deleted course; hidden courses still count. Canvas accounts
retain provider term names and existing saved course allocations. A manual course's
**Change term** dialog accepts years 2000 through the current year and Spring,
Summer, Fall, or Winter. The owner-scoped API moves the course and associated saved
coursework/assessments under the same transaction lock used for preference writes.
Canvas course detail forms cannot change terms.

Disabling Canvas token reminders hides missing-connection notices in the course
summary and calendar. Expired/invalid credentials continue to prompt regeneration
and never authorize course conversion. Permanent manual mode is a separate,
explicit request under `canvas.manual-mode`, outside user-editable preferences.
Three confirmations precede the request. Administrators can approve or decline it
from user details; pending requests are marked in the user list. Approval atomically
converts saved course snapshots, retains grades/schedules/tasks, removes the saved
token, and records the reviewer and time. Canvas reconnection is permanently blocked
on both token and OAuth paths, including a token-save race with approval. Stale
clients attempting to save unconverted course preferences must refresh. Approval
cannot recover provider data that was never saved locally. No schema migration or
background provider call is needed for this workflow.

Active student-course discovery explicitly requests both published and unpublished
courses. Unpublished enrollments remain Canvas-linked and visible with a publication
warning, but the client does not request Canvas course content or expose Canvas-only
navigation until the course is published. User-saved external course links remain
available during that period.

OAuth state is protected, user-bound, local-return-path-only, and expires quickly.
The authorization code and refresh token exchange happens server-side. Access and
refresh tokens are encrypted at rest with ASP.NET Core Data Protection and never
returned to the SPA. Refresh operations are serialized per connection.

Manual tokens are a deployment-controlled fallback and are off by default outside
Development. They improve compatibility when SFU has not issued a developer key but
shift creation, expiry, and revocation to each user. The application never accepts
an SFU username/password.

## Persistence and migrations

`AuthDbContext` owns Identity users, roles, logins, tokens, lockouts, and migration
history. `CanvasToDoDbContext` maps the `user_settings` table used for encrypted
Canvas connections and Academy preferences. Settings are owned by `user:{guid}`
keys derived from authenticated Identity accounts.

Before settings-table initialization, Identity migrations, or administrator
bootstrap runs, startup acquires a PostgreSQL session advisory lock on a dedicated
non-pooled connection. This serializes initialization across API replicas; acquisition
times out after 120 seconds and fails that replica's startup rather than allowing
concurrent schema/bootstrap work.

Theme and language use the `canvas-to-do-theme` and `canvas-to-do-language` browser
storage keys. Academy records are stored server-side under the authenticated owner.

Connection configuration uses `ConnectionStrings:CanvasToDo`. The Data Protection
key ring is mounted at `/var/lib/canvas-to-do/data-protection-keys`. Database and
volume identifiers, the Data Protection application name, and protector purposes
are persistent storage contracts; changing them can disconnect stored data or
invalidate sessions and Canvas connections.

Back up PostgreSQL and the key ring together, preserve the Compose project and
volume names, and never use `down -v` when data must be retained. Canvas token
ciphertext is not cryptographically bound to its account owner, so database write
access remains privileged.

The checked-in stack persists Data Protection keys but cannot select a
deployment-specific certificate or KMS. Protect the key-ring volume with restrictive
host permissions and encrypted storage, and add certificate/KMS wrapping for
higher-assurance production environments.

## Deployment configuration

The public deployment requires explicit settings for:

- PostgreSQL connection/password;
- allowed host and forwarded-proxy trust;
- SMTP sender, TLS, and public frontend base URL for account email;
- optional Google/Facebook client credentials and exact callbacks;
- Canvas origin allowlist; and
- either institution-approved Canvas OAuth credentials or a deliberate manual-token
  fallback decision.

Secrets belong in an ignored `.env`, orchestrator secret, or managed secret store.
The Docker build context excludes `.env`, local Codex data, dependency folders, and
build output. Local operational exports are ignored by Git.

## Quality assessment

- Functional suitability/effectiveness: active frontend and backend contracts cover
  confirmed local/social auth, 2FA, admin user management, Canvas connection,
  calendar, course browser, grades, inbox, and people views without Workspace
  dependencies.
- Reliability/freedom from risk: lockout, generic recovery responses, immediate
  revocation, migration safeguards, persistent keys, bounded Canvas reads, and
  fail-safe email configuration reduce common failures. Durable last-known calendar
  snapshots and operational alerting remain future work.
- Performance efficiency: Canvas reads are paginated/cached/bounded and admin listing
  is server-paged. Restored course views are route-split; React and Radix primitives
  use stable cacheable chunks, and only the two Latin font subsets are shipped. The
  Lightsail profile caps the in-process cache, EF connection pool, container memory,
  and PostgreSQL working memory for a 1 GB host.
- Maintainability: Identity, Canvas, Academy preference, admin, and email boundaries
  are separate; canonical namespaces/folders replace former project branding.
- Compatibility/portability: reverse-proxy paths, public URLs, allowed hosts, SMTP,
  Canvas origins, and provider credentials are configuration rather than code.
- Security: least-scope OAuth, confirmed email, optional 2FA, role guards, SSRF
  controls, CSRF/CORS, CSP, secret-safe logging, dependency audit, and encrypted token
  storage are treated as one system.
- Usability/satisfaction/context coverage: the UI must keep recovery and connection
  errors actionable and be tested with keyboards, screen readers, narrow devices,
  slow networks, expired sessions, provider outages, and revoked Canvas consent.

## Next operational work

1. Add automated backend integration and browser E2E coverage for every auth and
   authorization branch, including CSRF failures and external-provider callbacks.
2. Add readiness/telemetry for PostgreSQL, SMTP, and Canvas without logging account
   addresses, codes, or tokens.
3. Add durable, observable Canvas synchronization snapshots before deadlines depend
   on live provider availability.
4. Exercise backup/restore, key-ring recovery, accessibility, and rate-limit behavior
   against a staging copy of application data.
