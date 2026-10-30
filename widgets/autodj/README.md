# AutoDJ Radio widget

A sidebar player for an [AutoDJ](https://git.salastil.com/Salastil/AutoDJ) station
(https://music.salastil.com): album art, song, artist, album and year, elapsed / length
with a progress bar, play/pause and volume. Uploaded through the admin Widgets tab - it is
not built into the app.

| File | Role |
| --- | --- |
| `index.mjs` | Backend. Serves `GET /api/widget/autodj/now`, relaying AutoDJ's `/api/status` (cached 3 s, fields validated, cover URL rebuilt on the station's own host). Reads it over the LAN (`LAN_STATUS_URL`) and falls back to the public URL. |
| `frontend.mjs` | Browser UI, loaded from `/widget-assets/autodj/frontend.mjs`. Plays `https://music.salastil.com/stream.mp3` directly in an `<audio>` element. |

## Install

Admin panel -> Widgets -> **+ Upload**: id `autodj`, display name `AutoDJ Radio`,
version `1.0.0`, backend file `index.mjs`, frontend file `frontend.mjs`. Installing
registers a public route, so the backend rebuilds its HTTP server (no process restart).
Updating means deleting the widget and uploading again.

## Why the status goes through the backend

The browser needs CORS headers to read another site's JSON, and the audio and cover
image don't. AutoDJ's public site now sends them for origins listed in its
`server.public_cors_origins`, but the relay is kept on purpose: it works for any visitor
whatever origin they arrive on (`www.`, a preview URL), and it caps load on the radio
machine at about one request per 3 s however many tabs are open.

## Station address

Two constants at the top of `index.mjs`:

- `STATION_URL` - the public address (`https://music.salastil.com`). Browsers use it for
  the stream and the cover art, so it must be reachable from outside.
- `LAN_STATUS_URL` - where the *backend* reads the status (`http://192.168.0.60:8181`,
  AutoDJ's read-only site on the same machine). It is tried first and the public URL is the
  fallback, so a changed LAN IP makes the widget slower, not broken. `null` disables it.

## Reliability

Every upstream request races a hard timer as well as an abort signal. v1.0.0 relied on the
abort signal alone, and one request that stalled without ever failing wedged the shared
in-flight request: the route stopped answering and the widget showed "Offline" until the
backend was restarted. Now a stalled request is abandoned after 2.5 s (LAN) / 4 s (public)
and the next call starts fresh.

## Known limits

- Elapsed time follows the station's clock. What you *hear* trails it by the stream's
  buffering (a few seconds), so the display can lead the audio slightly.
- During a DJ break AutoDJ's public site reports only "On air" (no title, art or album),
  and so does the widget.
- Volume is ignored by iOS Safari (the OS volume applies).
