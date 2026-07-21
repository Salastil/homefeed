# Homefeed backend

Node.js + TypeScript, per `project-structure.md`. Ingests RSS/API/Telegram sources,
clusters and synthesizes them into merged articles via a self-hosted Ollama instance,
and serves the same `/api/feed`, `/api/article/:id`, `/api/tags`, `/api/events`
contract the frontend already consumes from the mock backend — plus the full
`/api/admin/*` surface behind session auth.

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Runs on `:4000` by default. Point the frontend's `VITE_BACKEND_URL` at it instead of
the mock backend and everything else keeps working unchanged — same API contract.

On startup, the console prints an admin API key — a fresh random value generated
every time the process starts (see `api/apiKey.ts`), not stored anywhere and not
configurable via `.env`. Every `/api/admin/*` request must send it as an
`X-Api-Key` header (enforced in `api/auth.ts`); the admin login page just asks for
this key and stashes it in the browser's `localStorage` rather than issuing its own
session. Restarting the backend invalidates the previous key — check the console
each time.

You'll also need a running Ollama instance (see `AI_SERVICE_HOST`/`AI_SERVICE_PORT` in
the admin panel's Connections tab, or `PATCH /api/admin/settings` directly) with at
minimum an embedding model (e.g. `nomic-embed-text`) and a generation model (e.g.
`qwen2.5:7b-instruct-q4_K_M`) pulled. Without it reachable, ingestion still runs, but
the synthesis tick quietly skips each cycle until the AI service comes back — nothing
crashes, articles just don't get published.

## Full-article capture

RSS descriptions are frequently truncated teasers or ad-mangled snippets, not the
actual article. For RSS and API sources, every newly-ingested item's link gets
followed and the real page content extracted via Mozilla's Readability (the same
approach behind Firefox Reader View) — `ingestion/articleFetcher.ts`. When extraction
succeeds, the feed's own title/summary/body/image get replaced with what was actually
on the page; nav, ads, sidebars, comments, and footers are excluded, not just stripped
of tags. Also pulls the page's `og:image`/`twitter:image` meta tag as a hero image when
the feed itself didn't provide one.

Extraction fails constantly in the real world — paywalls, bot detection, JS-rendered
pages, odd markup — so this is deliberately non-fatal: on any failure it falls back to
whatever the feed itself provided (title/description), logged at `warn` level so it's
visible in the admin panel's Logs tab rather than silent. Telegram sources skip this
entirely, since a Telegram message *is* the content — there's no separate page to follow.

This adds two dependencies (`jsdom`, `@mozilla/readability`) — the one deliberate
exception to the "no heavy dependencies" preference elsewhere in this backend, since a
hand-rolled content-extraction heuristic would be meaningfully less reliable across the
range of real-world site markup this needs to handle.

## Behavior before Ollama is set up

Per the "assume Ollama arrives after the backend launches" requirement: ingestion and
publishing don't wait for it.

- **Adding a source polls it immediately**, not on the next scheduler tick — you see
  results right away instead of waiting up to a minute.
- **With no AI service reachable**, every eligible item publishes directly and
  immediately — no hold-before-publish wait (that window exists to let corroborating
  sources arrive before an AI merge locks in, which doesn't apply when nothing's being
  merged). No rewriting, no cross-source merging, no tags (there's no LLM to extract
  them yet), but the page populates right away instead of staying empty.
- **Passthrough articles show the original feed publish date** (`pubDate`/`isoDate`
  from the source), not when they were ingested or published locally. Only
  AI-synthesized/merged articles get a "modified" timeframe reflecting when the merge
  actually happened — see `publishDirect` vs `publishCluster` in `pipeline/publish.ts`.
- **Feed content gets cleaned before storage** — RSS/API content is frequently raw (or
  double-escaped) HTML; `ingestion/clean.ts` strips tags and decodes entities into
  readable plain text with paragraph breaks preserved, applied centrally in
  `adapters/base.ts` so every adapter benefits without duplicating the logic.
- **No image or video in the feed item?** Falls back to the site's favicon
  (`{origin}/favicon.ico`, downloaded and locally hosted like any other image) rather
  than leaving the article with no art at all. Doesn't parse the page's `<head>` for a
  proper `<link rel="icon">` — just the conventional path, which covers most sites
  without an extra HTTP round trip. See `faviconUrlFor` in `pipeline/image-selection.ts`.
- **Once Ollama becomes reachable**, the real pipeline (embed → cluster → synthesize →
  tag) takes back over for anything ingested from that point on. Articles already
  published via the passthrough path aren't retroactively rewritten or merged — they
  stand as they are, but new related coverage can still link to them as a follow-up
  via the normal tag-based thread detection.
- **Tracked-event recaps are the one thing that still waits for AI** — summarizing a
  day's worth of Telegram messages isn't something worth faking with a passthrough;
  those simply don't fire until the AI service is available.

## What's real vs. stubbed

Built and verified end-to-end (see the test run in this conversation — real SQLite,
real RSS parsing, real HTTP calls to a stub Ollama server, real media download to
disk, real tag dedup across separate synthesis calls):

- SQLite schema + repository layer for every entity in `homefeed-data-schema.md`
- Per-launch API key auth (random key printed to the console on every startup,
  checked via a timing-safe comparison against an `X-Api-Key` header on every
  request, CORS locked to the configured frontend origin) protecting all
  `/api/admin/*` routes
- RSS adapter (real parsing, images/video extraction) and a generic JSON API adapter
  (configurable field mapping)
- Poller respecting per-source poll intervals
- Embedding → clustering → synthesis → tag extraction/dedup → image selection →
  media download → publish pipeline, talking to Ollama over HTTP
- Priority queue ordering by admin-ranked category before clustering
- Retention sweep (age-based for both raw items and published articles, size-based
  FIFO cap, tag expiry) running hourly
- Full admin API: settings, sources, tracked events, live model catalog from Ollama,
  AI service status

**Stubbed / simplified, worth knowing before relying on it:**

- **Telegram adapter** (`ingestion/adapters/telegram.ts`) is a stub — logs a warning
  and returns nothing. Needs a real implementation (grammY, per the architecture doc)
  keyed off `source.config.telegramChannelId`.
- **Image selection** picks the highest-resolution candidate rather than using a
  vision model to judge relevance — cheap and deterministic, but doesn't catch a
  technically-large image that's actually a poor choice (watermarked, wrong subject).
  A vision-model pass is a natural upgrade once this needs to be smarter.
- **Follow-up thread detection** matches on shared tags within a 3-day lookback rather
  than comparing article-level embeddings directly. Works, but a cluster with no tags
  extracted can't be linked to a prior thread at all.
- **Storage-cap FIFO eviction** deletes oldest articles but doesn't yet cascade-delete
  their associated media rows/files in the same pass — there's a comment in
  `queue/retention.ts` explaining the gap and the backstop that partially covers it.
- **`node:sqlite`** is still an experimental Node API. If a future Node version changes
  its behavior, `better-sqlite3` is a drop-in-shaped alternative (same synchronous
  `.prepare().run()/.get()/.all()` style).

None of these block running the backend end-to-end — they're the specific spots worth
hardening next, roughly in the order listed.
