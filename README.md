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
