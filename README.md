# Canvas To Do

Canvas To Do is a public, multi-user academy calendar for combining Canvas LMS
courses, grades, activity notifications, course rosters, assignments, quizzes,
events, and personal study plans. The canonical repository and deployment slug is
`canvas-to-do`.

## Project shape

- `frontend/`: React, TypeScript, Vite, Tailwind CSS, and shadcn/ui.
- `backend/CanvasToDo.Api/`: ASP.NET Core API on .NET 10.
- `docker-compose.yml`: production-like PostgreSQL, API, and Nginx stack.
- `docker-compose.dev.yml`: local hot-reload stack.

The browser talks only to the API. Authentication, authorization, SMTP delivery,
Canvas token storage, OAuth exchanges, and provider calls stay server-side.

## Accounts and administration

ASP.NET Core Identity provides:

- public email/password registration with administrator approval and sign-in;
- email confirmation, resend, forgot-password, and password-reset flows;
- optional Google and Facebook identity sign-in;
- optional authenticator-app two-step verification and recovery codes;
- lockout, secure cookie sessions, and immediate session revocation; and
- `User` and `Admin` roles.

Password and social registration create pending standard-user accounts and no login
session. An administrator must approve a pending account in User Management before
it can sign in; approval also confirms the submitted email for deployments without
SMTP. Google/Facebook request identity scopes only; no Gmail, Drive, Calendar, Chat,
organization-directory, or hosted-domain access is requested. Provider tokens are
not retained as integration credentials.

Administrators can search users, open **Details** to edit name, email, phone,
account settings and Canvas connection, change roles/status, and revoke sessions.
**Preview** shows a read-only snapshot of the selected user's saved Academy data,
with an optional live Canvas course/calendar read. It never signs in as that user
or copies their data into the administrator's local Academy storage. Existing
Canvas credentials are never returned; administrators can validate/replace or
disconnect them using the same institution allowlist as users.

Signed-in users change their password immediately under **Settings → Change password**,
using their current password plus the new password and confirmation. No administrator
approval is required. The current session is refreshed; other sessions and pending
reset requests are revoked. Signed-in accounts without a password can set one there.

On the sign-in page, **Forgot password? → Reset your password** asks for email,
new password, and confirmation, then queues a reset for administrator approval under
**User Management → Details → Password & requests**. This works without email delivery.
The public response does not reveal whether an account exists. Existing passwords
remain valid until approval, and anonymous resubmissions cannot replace an active
pending request. Admins see the request source and must verify the requester's identity
before approving a public request: entering an email does not prove ownership.

Requests expire after seven days and become invalid when the security stamp changes.
Approval revokes sessions and clears lockout; rejection leaves the password unchanged.
Existing verified email recovery links also submit requests for approval. Administrators
can directly set a replacement password. Changing the bootstrap environment password
does not reset an existing account. Requests store only an Identity password hash in
`auth_user_tokens`, so no schema migration is required. Approval/rejection removes the
pending hash and records actor/time. Passwords and Canvas tokens are never logged.

Standard users can access only their own Academy calendar, course and
grade summaries, Canvas inbox and course rosters, Canvas connection, preferences,
and account security. Canvas writes are limited to explicit user actions for
supported text/URL assignment submissions, discussion replies, and starting quiz
attempts; the app performs no background Canvas writes. Public registration never
grants the administrator role.

To provision the first administrator, set `AUTH_ADMIN_BOOTSTRAP_EMAIL` and a strong
`AUTH_ADMIN_BOOTSTRAP_PASSWORD`. Remove the password from deployment configuration
after the account exists. The bootstrapper will not silently promote a public,
unverified account that already uses the configured email.

Startup serializes settings-table initialization, Identity migrations, and
administrator bootstrap across API replicas with a PostgreSQL session advisory lock.
Lock acquisition times out after 120 seconds, so a waiting replica fails startup
instead of running initialization concurrently.

## Account email

Registration does not require SMTP. Confirmation resend and password recovery do;
configure them with:

```text
PUBLIC_FRONTEND_BASE_URL=https://your-host.example/canvas-to-do
EMAIL_FROM_ADDRESS=no-reply@your-host.example
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_USERNAME=...
SMTP_PASSWORD=...
SMTP_ENABLE_SSL=true
```

The frontend base URL must be HTTPS outside Development and may include the
`/canvas-to-do` path. If email is unavailable, the API remains healthy so
registration, administrator approval, and sign-in continue to work, while recovery
actions return an actionable `503` response.

For local testing only, explicitly set
`EMAIL_DEVELOPMENT_EXPOSE_TOKENS=true`. Development then returns a one-time action
link to the requesting browser instead of requiring SMTP. This setting is ignored
outside the Development environment and must never be enabled on a shared system.
Email action credentials are placed in URL fragments so reverse proxies and HTTP
access logs do not receive them; the SPA removes the fragment before making the API
request.

External login callback paths are:

```text
https://your-host.example/canvas-to-do/api/auth/google/oauth-callback
https://your-host.example/canvas-to-do/api/auth/facebook/oauth-callback
```

Provider consoles must match the exact public scheme, host, path base, and callback
path. Set `ALLOWED_HOSTS` to the public hostname; the production default accepts only
`localhost` until this is configured.

## SFU Canvas connection

The default and allowed Canvas origin is:

```text
https://sfu.instructure.com
```

Canvas To Do never asks for or stores an SFU password. The preferred flow redirects
an already signed-in Canvas To Do user to Canvas, receives an authorization code,
and exchanges it server-side. This requires an SFU Canvas root administrator to
issue and configure a developer key:

```text
CANVAS_OAUTH_ENABLED=true
CANVAS_OAUTH_CLIENT_ID=...
CANVAS_OAUTH_CLIENT_SECRET=...
CANVAS_OAUTH_CALLBACK_URL=https://your-host.example/canvas-to-do/api/canvas/oauth/callback
```

SFU CAS is a registered institutional service, not a generic credential flow for an
unapproved third-party application. Until institutional Canvas OAuth approval is
available, an operator can deliberately enable
`CANVAS_MANUAL_TOKEN_ENABLED=true`. A user can then paste a Canvas personal access
token in Settings. The API validates it against the configured origin, encrypts it
with ASP.NET Core Data Protection, and never returns the raw token to the browser.
Disable this fallback when OAuth is available.

Keep `CANVAS_ALLOWED_INSTANCE_URLS` restricted to trusted HTTPS Canvas origins.
Paths, query strings, embedded credentials, redirects to another origin, oversized
responses, and excessive pagination are rejected or bounded by the API.

## Run locally

Create a local environment file and fill only the services you intend to use:

```bash
cp .env.example .env
```

The checked-in template deliberately leaves credentials and public hostnames blank.
The development Compose file supplies localhost-safe fallbacks; production Compose
refuses to start until `POSTGRES_PASSWORD` is populated and still requires the
public hostname, email, and provider values appropriate to that deployment.

Frontend only:

```bash
cd frontend
npm install
npm run dev
```

Backend only:

```bash
dotnet run --project backend/CanvasToDo.Api/CanvasToDo.Api.csproj
```

Hot-reload stack:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

Open `http://localhost:6173/`. To test confirmation/reset without SMTP, explicitly
set `EMAIL_DEVELOPMENT_EXPOSE_TOKENS=true` in the ignored `.env` first.

Production-like stack:

```bash
docker compose up -d --build
```

Expose `https://your-host.example/canvas-to-do/` through a TLS reverse proxy. The
frontend `6173`, API `6272`, and PostgreSQL `6060` ports are bound to loopback by
Compose. The outer TLS proxy must replace (not append to) `X-Forwarded-For` with the
single connecting client address. Do not publish any of these ports directly.

For the optimized AWS Lightsail deployment at the domain root, use the separate
[`deploy/compose.lightsail.yml`](deploy/compose.lightsail.yml) stack and follow
[`DEPLOYMENT.md`](DEPLOYMENT.md). It adds bounded resources, immutable frontend
caching, private PostgreSQL networking, a one-shot migration gate, stable volume
names, and verified database/key-ring backup and restore scripts.

Useful checks:

```bash
dotnet build CanvasToDo.slnx
python3 scripts/test-admin-accounts.py backend/CanvasToDo.Api/bin/Debug/net10.0/CanvasToDo.Api.dll
dotnet list backend/CanvasToDo.Api/CanvasToDo.Api.csproj package --vulnerable --include-transitive
POSTGRES_PASSWORD=validation-only docker compose --env-file .env.example config --quiet
docker compose --env-file .env.example -f docker-compose.dev.yml config --quiet
APP_DOMAIN=example.com POSTGRES_PASSWORD=validation-only docker compose --env-file deploy/.env.example -f deploy/compose.lightsail.yml config --quiet
bash -n scripts/deploy/*.sh
cd frontend && npm ci && npm run build && npm run lint && npm run test:migration
```

## Browser and API security

- Auth cookies are HTTP-only, `SameSite=Lax`, and secure outside Development.
- Every state-changing SPA request carries `X-Canvas-To-Do-Request: 1`. Cross-origin
  JavaScript must pass the strict credentialed CORS allowlist before it can send that
  header, which protects cookie-backed mutations from CSRF.
- OAuth correlation/state values are protected and short-lived. Return paths are
  local-only.
- Nginx adds a restrictive Content Security Policy, clickjacking protection,
  referrer controls, and MIME-sniffing protection.
- Login, recovery, 2FA, administrator mutations, Canvas reads, and Canvas writes are
  separately rate-limited; forced calendar refreshes use the tightest Canvas limit.
- Root `.env` files and local operational backups are excluded from Docker build
  contexts and Git.
- The persistent Data Protection key-ring volume must be protected with restrictive
  host permissions and encrypted storage. Higher-assurance production deployments
  should additionally wrap keys with a certificate or managed KMS; the repository
  cannot choose that deployment-specific trust anchor safely.

## Persistent data

Configure PostgreSQL through `ConnectionStrings:CanvasToDo`. Keep the database,
Compose volume names, Data Protection application name, and token protector
purposes stable: stored data, sessions, and Canvas connections depend on them.
Back up PostgreSQL and the Data Protection key ring together using the
[deployment backup and restore workflow](DEPLOYMENT.md). Do not use
`docker compose down -v` on a deployment whose data must be retained.

## Practical quality priorities

- Functional suitability: verify local/social auth, confirmation/reset, 2FA, admin
  authorization, Canvas OAuth/manual token, and calendar results together.
- Reliability: retain encrypted-token/key compatibility, use migrations and backups,
  and provide last-known calendar data before deadlines depend on Canvas uptime.
- Performance: Canvas requests share deadline/page/byte/item budgets and use short
  caches under a 64 MiB process budget. Outbound admission and wait time are bounded,
  and incomplete best-effort responses are labeled and not cached. The current main
  client chunk remains above Vite's 500 kB warning threshold, so further UI
  code-splitting is still warranted.
- Maintainability: account, Canvas, calendar, and administration boundaries are
  separate.
- Compatibility and portability: callback/base URLs, SMTP, allowed hosts, proxy trust,
  and Canvas origins are explicit deployment settings.
- Security and freedom from risk: use HTTPS, least-scope OAuth, secret stores,
  lockout/rate limits, CSRF defenses, encrypted tokens, audit logs, and regular
  dependency audits. Canvas token envelopes are not cryptographically bound to an
  account owner, so database write access is a privileged security boundary.
- Usability and context coverage: test keyboard/screen-reader use, narrow screens,
  slow networks, expired sessions, provider outages, and revoked Canvas consent.
