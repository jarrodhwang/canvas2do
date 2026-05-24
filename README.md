# Incos Workspace

Flexible workspace management app scaffolded from the personal manager prototype.

## Shape

- `frontend/`: React TypeScript + Vite UI built with shadcn/ui and Tailwind CSS.
- `backend/Incos.Workspace.Api/`: ASP.NET Core Web API on .NET 10.
- `docker-compose.yml`: PostgreSQL, API, and frontend containers.

The frontend treats Academy and Project as sample modes, not permanent app logic. Modes are defined in `frontend/src/modes/defaultModes.ts` and can be enabled, hidden, renamed, or expanded without rewriting the component tree.

## Frontend Mode System

- `ModeRegistry` owns available workspace modes and applies optional visibility overrides.
- `WorkspaceModeProvider` exposes the active mode and mock data.
- Each `WorkspaceModeConfig` defines sidebar items, dashboard cards, filters, calendar item types, board columns, detail fields, add-item fields, timeline behavior, and integration options.
- Reusable shadcn/ui primitives live in `frontend/src/components/ui/`; app-level workspace components compose those primitives instead of maintaining a separate custom component library.
- The frontend was initialized against the shadcn/ui Vite preset with `npx shadcn@latest init --preset b5fybI --template vite`, then themed around a dark charcoal surface system with Incos yellow as the primary color.
- Brand image slots live in `frontend/public/brand/`: `INCOS New Logo_Crop.png` for the in-app top bar and `Incos New Logo_Square.png` for the browser tab. These should be exact copies of the transparent PNG files, with no generated fallback or image modification.
- If the logo shows as a broken placeholder, copy the PNGs into that folder with the exact filenames above. On WSL this is usually:
  `cp "/mnt/c/Users/jarrod/Downloads/Temp/INCOS New Logo_Crop.png" frontend/public/brand/`
  `cp "/mnt/c/Users/jarrod/Downloads/Temp/Incos New Logo_Square.png" frontend/public/brand/`
- The UI currently supports English and Korean via `frontend/src/i18n.ts`; the selected language controls labels, month/weekdays, and May 2026 holiday date coloring.

Environment overrides:

```bash
VITE_ENABLED_WORKSPACE_MODES=academy,project
VITE_HIDDEN_WORKSPACE_MODES=academy
VITE_MODE_NAME_ACADEMY=Training
VITE_MODE_NAME_PROJECT=Delivery
```

## Backend Direction

The API is designed around shared generic tables first:

- `workspace_modes`
- `mode_settings`
- `calendar_items`
- `checklist_items`
- `links`
- `notes`
- `tags`
- `people`

Specialized tables are included for Academy, Project, Support CRM, TopTrack, Google, and future PDM workflows where they add useful structure.

The frontend should call the ASP.NET API only. Google Workspace, Canvas LMS, TopTrack, and TopSolid PDM integrations belong behind the API for OAuth, token storage, background sync, and security.

## Authentication

The app shows a login landing page before the workspace. The only sign-in action is `Continue with Google`, which links to `/api/auth/google/login`; the React frontend does not call Google directly.

The ASP.NET Core API owns Google OAuth and signs users in with an HTTP-only cookie. Configure Google OAuth with environment variables:

```bash
cp .env.example .env
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
GOOGLE_WORKSPACE_DOMAIN=your-company-domain.com
CANVAS_INSTANCE_URL=https://your-school.instructure.com
CANVAS_ACCESS_TOKEN=your-canvas-api-access-token
```

Academy mode requires Canvas LMS access. Canvas uses a server-side API access token, not a browser OAuth flow.

For local Docker/Nginx dev, add this authorized redirect URI in Google Cloud Console:

```text
http://localhost:6173/signin-google
```

If you run the API directly without Nginx/Vite proxy, also add:

```text
http://localhost:6272/signin-google
```

`GOOGLE_WORKSPACE_DOMAIN` is optional but recommended. When set, the API rejects Google accounts outside that Workspace domain.

The Google login also requests the initial integration scopes used by the Calendar and Drive connection UI:

```text
https://www.googleapis.com/auth/calendar.events.readonly
https://www.googleapis.com/auth/calendar.calendarlist.readonly
https://www.googleapis.com/auth/drive.readonly
```

Enable the Google Calendar API and Google Drive API in the same Google Cloud project before building real sync jobs behind these endpoints. The React app only calls the ASP.NET API; ASP.NET owns OAuth and Google API calls.

## Run Locally

Frontend only:

```bash
cd frontend
npm install
npm run dev
```

Backend only:

```bash
dotnet run --project backend/Incos.Workspace.Api/Incos.Workspace.Api.csproj
```

Full stack with Docker, built static frontend and API containers:

```bash
docker compose up -d --build
```

Then open `http://localhost:6173`.

Docker ports:

- Frontend/Nginx: `6173:6173`
- ASP.NET Core API: `6272:6272`
- PostgreSQL: `6060:5432` with user `incos` and password `incos123`

Containers use `restart: unless-stopped`, so they keep running after SSH disconnects and restart after a PC reboot unless manually stopped.

Nginx serves static images from `/static/images/` using the `incos-static-images` Docker volume and reverse-proxies `/api/` to the ASP.NET Core container.

Hot-reload Docker dev mode:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Dev mode runs:

- API: `dotnet watch run --no-launch-profile --urls http://0.0.0.0:6272`
- Frontend: `npm run dev -- --host 0.0.0.0 --port 6173`
- Static images: mounted to `frontend/public/static/images`, served by Vite at `/static/images/...`
- Vite API proxy: Docker dev sets `VITE_API_PROXY_TARGET=http://api:6272`; local dev defaults to `http://localhost:6272`.

Useful dev commands:

```bash
docker compose -f docker-compose.dev.yml logs -f
docker compose -f docker-compose.dev.yml restart api
docker compose -f docker-compose.dev.yml restart frontend
docker compose -f docker-compose.dev.yml down
```

When package/project files change:

- `package.json` or `package-lock.json`: restart the frontend container so `npm install` runs again.
- `.csproj` or NuGet packages: restart the API container so `dotnet restore` runs again.
- Dockerfile or compose changes: run `docker compose -f docker-compose.dev.yml up -d --build --force-recreate`.
- Rude .NET hot-reload edits are configured with `DOTNET_WATCH_RESTART_ON_RUDE_EDIT=1`, so Docker should restart the app without asking for terminal confirmation.
