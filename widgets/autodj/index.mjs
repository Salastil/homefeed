// Backend half of the AutoDJ radio widget. The player itself lives in frontend.mjs; this
// file relays AutoDJ's now-playing status to it. A relay (rather than the browser calling
// music.salastil.com directly) because it works for any visitor whatever origin they arrive
// on - AutoDJ's CORS allow-list names exact origins - and because it caps the load on the
// radio machine: one upstream request per few seconds however many tabs are open. The
// browser still *plays* the stream and *shows* the cover itself (an <audio> / <img> needs
// no CORS), so only the metadata goes through here.
//
// No tables, no poll loop: the now-playing data is fetched on demand and held for a few
// seconds, because it's only ever wanted while someone has the page open. Registers a
// public route, so installing this widget triggers the host's server rebuild (see
// backend/src/widgets/install.ts) - same as the searchbar widget.

// What BROWSERS use: the stream and the cover art are loaded by the visitor's own browser,
// so these must be the public address.
const STATION_URL = 'https://music.salastil.com';
const STREAM_URL = `${STATION_URL}/stream.opus`;

// What the BACKEND asks for the now-playing data. AutoDJ's read-only site is published on
// the same machine as this backend (port 8181), so the relay reads it over the LAN - no
// Cloudflare, no trip out to the internet and back. That address is deployment-specific
// (the NAS's LAN IP); if it stops answering the relay quietly falls back to the public URL,
// so a changed IP degrades to "a bit slower", not "broken". Set to null to always use the
// public URL.
const LAN_STATUS_URL = 'http://192.168.0.60:8181';

// Every visitor's browser polls /now, and each of those would otherwise become a request
// to the radio box. Responses are shared for this long, and concurrent misses share one
// upstream request, so upstream load is ~1 request per CACHE_MS no matter how many tabs.
const CACHE_MS = 3000;

// A fetch() can stall in a way that neither its AbortSignal nor its own timeout ever
// resolves (a half-dead connection: TCP up, no reply - the same failure the poller guards
// against in ingestion/poller.ts). Each attempt therefore races a plain timer, not just an
// abort signal. This matters more here than usual: concurrent callers share ONE in-flight
// request, so a request that never settles would block every later caller forever - which
// is exactly what wedged v1.0.0 in production until the backend was restarted.
const LAN_DEADLINE_MS = 2500;
const PUBLIC_DEADLINE_MS = 4000;

let cached = null; // { at: ms, body }
let inflight = null; // Promise<body> while an upstream request is running

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Keeps only the fields the widget shows, and only in the shapes it expects: this is
// relayed to every visitor, and the upstream is a different service, so nothing is passed
// through verbatim. In particular the cover is rebuilt from a fixed path pattern on the
// station's own host rather than trusting an arbitrary URL from the payload.
function shapeNowPlaying(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const startedAt = num(raw.started_at);
	const durationMs = num(raw.duration_ms);
	if (startedAt === null || durationMs === null || durationMs <= 0) return null;

	const cover = str(raw.cover_url);
	return {
		// "track" for a song; AutoDJ's public site reports "break" while a DJ is talking
		// (it hides the segment's real title/artist), which the widget shows as "On air".
		kind: raw.kind === 'track' ? 'track' : 'break',
		title: str(raw.title) ?? 'Unknown title',
		artist: str(raw.artist),
		album: str(raw.album),
		year: Number.isInteger(raw.year) && raw.year > 0 ? raw.year : null,
		coverUrl: cover && /^\/api\/cover\/\d+$/.test(cover) ? `${STATION_URL}${cover}` : null,
		startedAt: startedAt * 1000, // AutoDJ reports unix seconds; everything here is ms
		durationMs
	};
}

// Resolves with `work`'s result, or rejects after `ms` whether or not `work` ever settles.
// `work` is abandoned, not cancelled, on timeout (its eventual rejection is swallowed so it
// can't surface later as an unhandled rejection).
function withDeadline(work, ms) {
	work.catch(() => {});
	let timer;
	return Promise.race([
		work.finally(() => clearTimeout(timer)),
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
			timer.unref?.();
		})
	]);
}

async function readStatus(baseUrl, deadlineMs) {
	const res = await withDeadline(fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(deadlineMs) }), deadlineMs);
	if (!res.ok) throw new Error(`status ${res.status}`);
	return withDeadline(res.json(), deadlineMs);
}

async function fetchStatus() {
	const base = { streamUrl: STREAM_URL };
	const attempts = [];
	if (LAN_STATUS_URL) attempts.push([LAN_STATUS_URL, LAN_DEADLINE_MS]);
	attempts.push([STATION_URL, PUBLIC_DEADLINE_MS]);

	for (const [baseUrl, deadlineMs] of attempts) {
		try {
			const data = await readStatus(baseUrl, deadlineMs);
			return {
				...base,
				online: true,
				stationName: str(data.station_name) ?? 'AutoDJ Radio',
				listeners: Number.isInteger(data.listeners) ? data.listeners : null,
				nowPlaying: shapeNowPlaying(data.now_playing)
			};
		} catch {
			// try the next address
		}
	}
	// The widget can still offer the stream (it may be only the status endpoint that is
	// down), it just has nothing to say about what's playing.
	return { ...base, online: false, stationName: 'AutoDJ Radio', listeners: null, nowPlaying: null };
}

async function getNow() {
	const now = Date.now();
	if (cached && now - cached.at < CACHE_MS) return cached.body;
	if (!inflight) {
		inflight = fetchStatus()
			.then((body) => {
				cached = { at: Date.now(), body };
				return body;
			})
			.finally(() => {
				inflight = null;
			});
	}
	return inflight;
}

export default {
	id: 'autodj',
	displayName: 'AutoDJ Radio',
	version: '1.1.0',

	registerPublicRoutes(app) {
		app.get('/api/widget/autodj/now', async (_req, reply) => {
			const body = await getNow();
			// serverNow lets the browser work out how far into the song we are without
			// trusting its own clock: elapsed = (serverNow + time since this response) - startedAt.
			reply.header('Cache-Control', 'no-store');
			return { ...body, serverNow: Date.now() };
		});
	}
};
