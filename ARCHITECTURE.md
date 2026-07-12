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
