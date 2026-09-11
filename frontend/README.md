# Canvas To Do frontend

React, TypeScript, and Vite client for the Canvas To Do multi-user academy
calendar. The client renders account, calendar, coursework, and Canvas connection
states; authentication, authorization, OAuth exchanges, and provider tokens remain
in the ASP.NET Core API.

## Development

```bash
npm ci
npm run dev
```

Vite serves the app at `http://localhost:6173/` by default. Copy `.env.example` to a
local ignored environment file when overrides are needed. The production container
defaults to `/canvas-to-do/`; local Vite development defaults to `/`.

```bash
npm run build
npm run lint
```

The product has one Academy mode: Calendar and Settings for standard users, plus
User Administration when the authenticated session carries administrator access.

PWA metadata and browser branding live in `index.html`,
`public/manifest.webmanifest`, and `public/brand/`. The code-native Canvas To Do icon
is shared by browser and install metadata.

## Quality notes

- Keep API response handling typed and present actionable retry/reconnect states.
- Keep confirmation/reset tokens in the URL only until the SPA exchanges them, then
  remove them with `history.replaceState`. All mutating API calls must use the shared
  client so `X-Canvas-To-Do-Request` is present.
- Do not place provider client secrets or Canvas tokens in Vite variables; every
  `VITE_*` value is public at build time.
- Preserve keyboard/focus and screen-reader behavior when changing dialogs or
  calendar interactions.
- Test slow/offline networks, expired Identity sessions, revoked Canvas access,
  narrow screens, and the `/canvas-to-do/` production path before release.
