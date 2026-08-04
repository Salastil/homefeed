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

## Docker

`docker-compose.yml` builds and runs the real backend and the frontend as two
separate containers (the mock backend isn't included — it's a dev-only
convenience, not meant to be deployed).

```bash
cp .env.example .env
docker compose up --build
```

Open http://localhost:3000. The backend's admin API key prints to its container
log on every start (`docker compose logs backend`) — same as running it directly,
just a fresh one each time the container restarts.

`.env.example` documents every variable `docker-compose.yml` reads; the two that
matter most:

- **`PUBLIC_ORIGIN`** — the one URL everything treats as "where this site is."
  Feeds both the backend's `FRONTEND_ORIGIN` (CORS) and the frontend's `ORIGIN`
  (adapter-node) — see the reverse-proxy section above for why these two must
  match exactly. Defaults to `http://localhost:3000` for local testing.
- **`VITE_BACKEND_URL`** — baked into the frontend image at *build* time (same
  build-time-vs-runtime distinction as the non-Docker deployment below), so
  changing it needs `docker compose build frontend`, not just a restart or
  `up`. The frontend container runs with `network_mode: service:backend` (shares
  the backend container's network namespace rather than getting its own)
  specifically so `http://localhost:4000` correctly reaches the backend from
  *both* the visitor's browser and the frontend container's own
  server-rendered (SSR) requests on a page's first load — no single URL value
  would otherwise work for both. Don't remove that `network_mode` line without
  replacing it with something that solves the same problem (a reverse proxy
  routing by path, as below, is the standard fix).

For a real deployment, put both containers behind a reverse proxy exactly as
described in the next section (`FRONTEND_PORT`/`BACKEND_PORT`'s published ports
are what you'd point the proxy at), and set `PUBLIC_ORIGIN`/`VITE_BACKEND_URL` to
your public domain instead of `localhost`.

The backend's SQLite DB, downloaded media, and uploaded widgets all persist in
the `backend-data` named volume — `docker compose down` alone doesn't touch it;
add `-v` if you actually want to wipe it. Once running, point the admin panel's
AI Service host (Connections tab) at your Ollama instance — if Ollama runs on
the same machine outside Docker, use `http://host.docker.internal:11434`, not
`localhost` (which inside the container means the container itself).

### Registry and CI (Gitea)

Both services also carry an `image:` name pointed at this project's Gitea
container registry (`git.salastil.com/salastil/homefeed-{backend,frontend}`),
so `docker compose build` tags them correctly and `docker compose push`/`pull`
work directly against it — override `REGISTRY`/`IMAGE_TAG` in `.env` for a
different registry or a specific tag (see `.env.example`).

`.gitea/workflows/docker-build.yml` builds and pushes both images on every
push to `master` or `development` — `latest` on `master`, the branch name and
commit SHA otherwise. It reads `VITE_BACKEND_URL` from the repo's Actions
variables (Settings → Actions → Variables) for the frontend build, since that
needs to be the real public URL, not `localhost`.

## Deploying behind a reverse proxy (e.g. Nginx Proxy Manager)

Both apps can also run as plain, long-lived Node processes on your own host
without Docker at all — two servers you point a reverse proxy at.

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

> **`FRONTEND_ORIGIN` here and `ORIGIN` in `frontend/.env` (next step) must be the
> exact same value** — same scheme, same host, same trailing-slash-or-not. SvelteKit's
> server-side `fetch` (used to load the homepage's data) enforces real CORS during
> SSR, just like a browser would; if these two don't match character-for-character,
> every page fails with `CORS error: Incorrect 'Access-Control-Allow-Origin' header
> is present on the requested resource`. Both should be your public HTTPS domain —
> not `localhost`, not an internal port — since that's what the browser (and
> SvelteKit's own SSR fetch) actually sees as the origin.

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
