# Homefeed — frontend, real backend, and mock backend

```
frontend/        SvelteKit app — the actual site (homepage, category pages, article view, admin panel)
backend/         The real backend — Node.js/TypeScript, SQLite, RSS/API ingestion, Ollama-backed synthesis
mock-backend/    Tiny Express server serving dummy articles — useful for pure frontend UI work without Ollama running
```

Both `backend/` and `mock-backend/` implement the identical `/api/feed`,
`/api/article/:id`, `/api/tags`, `/api/events`, `/api/admin/*` contract — the frontend
doesn't know or care which one it's talking to. Switch between them by changing
`VITE_BACKEND_URL` in `frontend/.env`.

## Running the real backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

The console prints an admin API key on every startup (a fresh one each time) — copy
it into the admin login page. See `backend/README.md` for details.

See `backend/README.md` for what's fully implemented vs. stubbed (Telegram adapter,
image-selection heuristic vs. vision model, etc.), and how it behaves when Ollama
isn't reachable.

## Running the mock backend instead (frontend-only work, no Ollama needed)

Two terminals:

```bash
# Terminal 1 — mock backend (http://localhost:4000)
cd mock-backend
npm install
npm start

# Terminal 2 — frontend (http://localhost:5173)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## What's implemented

- **Homepage** (`/`) — hero story, Local section, Business and Tech rails
- **Category pages** (`/category/local`, `/category/world`, etc.) — full listing per category, `local` maps to the Philadelphia geo filter
- **Article page** (`/article/:id`) — merge badge, hero image with single-source attribution, body, video slot, tag chips, thread continuation banners (both directions — "newer coverage" / "earlier coverage"), sources footer
- **Article cards** — show source count (`⇄ N sources`), single-source attribution, or a video indicator, matching the design decided earlier
- **Light/dark theme toggle** — slider in the masthead, top right, left of the settings cog. Dark is a genuine slate palette (not an inverted light theme). Persists via `localStorage`, respects system preference on first load, no flash-of-wrong-theme (set before hydration in `app.html`).
- **Admin panel** (`/admin/settings`) — disabled by default; set `ADMIN_PANEL_ENABLED=true` in `frontend/.env` to turn on the cog icon and the `/admin/*` pages (see `frontend/.env.example`). Six tabs, all wired to the mock backend's `/api/admin/*` routes:
  - **Merge** — strictness slider, poll interval, hold-before-publish, follow-up thresholds, category priority (reorderable), tag dedup threshold, tag expiry
  - **Sources** — list, add, enable/disable, delete RSS/API/Telegram feeds
  - **Models** — AI service status, per-task model selection (embedding/image/synthesis), fetched from the mock's simulated Ollama catalog
  - **Retention** — published-article and raw-item age presets, storage cap with FIFO note and usage bar
  - **Tracked events** — list, create, toggle active/paused, delete
  - **Connections** — the asymmetric pair: frontend→backend URL (saved to *this browser* via `localStorage`, not a backend setting) and backend→AI-service host/port (a real backend setting, saved via `/api/admin/settings`)

## Mock data

`mock-backend/data.js` has ~10 dummy articles covering: a 4-source merge with a follow-up (`art-1` → `art-2`, same `threadId`), single-source articles across Business/Tech, and a Local section with a mix of merged, single-source, and video items — enough variety to sanity-check every card/badge state in the design.

Timestamps are generated relative to `Date.now()` (see `hoursAgo()` in `data.js`) rather than hardcoded, so "time ago" labels stay sensible no matter when you run this.

## Connecting to the real backend later

The frontend never hardcodes `localhost:4000` — see `frontend/src/lib/config.ts`. It reads `VITE_BACKEND_URL` (set in `frontend/.env`) or a value saved via `setBackendUrl()`. Pointing this project at the real backend instead of the mock is a one-line change, not a rewrite — swap the URL in `.env` and everything else keeps working, since both servers implement the same `/api/feed`, `/api/article/:id`, `/api/tags`, `/api/events` contract from `homefeed-data-schema.md`.

## Deploying behind a reverse proxy (e.g. Nginx Proxy Manager)

Both apps are meant to run as plain, long-lived Node processes on your own host —
there's no platform-specific adapter or container packaging here, just two servers
you point a reverse proxy at.

This assumes **one public domain**, with the reverse proxy routing by path:
everything under `/api/` and `/media/` goes to the backend, everything else goes to
the frontend. (Two separate domains — e.g. `homefeed.example.com` +
`api.homefeed.example.com` — works too and is actually simpler to set up, since it
needs no path-based routing at all; skip the "Custom Locations" step below and just
point `VITE_BACKEND_URL` at the second domain instead of the first.)

### 1. Build and run the backend

```bash
cd backend
cp .env.example .env
# set FRONTEND_ORIGIN to your public domain, e.g. https://homefeed.example.com
npm install
npm run build
node --experimental-sqlite --env-file=.env dist/index.js
```

Keep this running (systemd, pm2, tmux — whatever you'd normally use). It prints a
fresh admin API key to its console/log on every start; you'll need whatever's there
each time it restarts (see `backend/README.md`).

### 2. Build and run the frontend

Now that it uses `@sveltejs/adapter-node`, `npm run build` produces a standalone
server at `build/index.js` rather than needing a specific hosting platform.

```bash
cd frontend
cp .env.example .env
# same-domain path routing (this section's assumption): point this at your one
# public domain, since /api and /media resolve there too, e.g.:
#   VITE_BACKEND_URL=https://homefeed.example.com
# (separate domains instead: point this at the backend's own domain)
#
# also add to this same .env file (read at runtime, not build time):
#   PORT=3000
#   ORIGIN=https://homefeed.example.com
#   HOST=0.0.0.0
npm install
npm run build
node --env-file=.env build/index.js
```

`ORIGIN` must match the public HTTPS URL exactly — adapter-node uses it to validate
requests and build absolute URLs; getting it wrong is the classic "works on
localhost, breaks behind the proxy" bug. Unlike `PORT`/`ORIGIN`/`HOST` (read fresh
at runtime, so `.env` changes take effect on restart), `VITE_BACKEND_URL` is baked
in at **build time** — changing your domain later means rebuilding the frontend,
not just editing `.env`.

### 3. Nginx Proxy Manager configuration

Add one Proxy Host for your domain:

- **Forward Hostname/IP**: wherever the frontend process is reachable from NPM
  (`127.0.0.1` if NPM and the app run on the same host, a container/host name
  otherwise) · **Forward Port**: `3000` (or whatever you set above)
- **SSL tab**: request a Let's Encrypt certificate, enable "Force SSL"
- Websockets support isn't needed — this app doesn't use any

Then, same-domain path routing only, add two **Custom Locations** on that same
Proxy Host:

| Location  | Forward Hostname/IP           | Forward Port |
| --------- | ------------------------------ | ------------ |
| `/api`    | the backend's host             | `4000`       |
| `/media`  | the backend's host             | `4000`       |

Leave the forwarded path as-is (don't strip the `/api`/`/media` prefix) — the
backend's own routes already expect them, exactly as proxied.

### Why this works without further code changes

- The frontend never assumes same-origin vs. cross-origin — every backend call goes
  through `getBackendUrl()` (see `frontend/src/lib/config.ts`), producing a full
  absolute URL either way.
- The admin API key (see the earlier hardening pass) is a request header, not a
  cookie, so there's no cross-domain cookie/SameSite concern regardless of which
  domain layout you pick.
- `backend/src/index.ts`'s CORS is still locked to `FRONTEND_ORIGIN` as a
  defense-in-depth measure, even though same-domain path routing makes it moot for
  actual browser traffic (the browser sees one origin the whole time, so CORS
  doesn't come into play) — set it to your public domain regardless.
