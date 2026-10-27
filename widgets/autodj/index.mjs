// Backend half of the AutoDJ radio widget. The player itself lives in frontend.mjs; this
// file exists for one reason: AutoDJ's public site (music.salastil.com) sends no CORS
// headers, so JavaScript running on the homefeed page can't read its /api/status. The
// browser can still *play* the stream and *show* the cover (an <audio> / <img> needs no
// CORS), so only the metadata has to be relayed through here.
//
// No tables, no poll loop: the now-playing data is fetched on demand and held for a few
// seconds, because it's only ever wanted while someone has the page open. Registers a
// public route, so installing this widget triggers the host's server rebuild (see
// backend/src/widgets/install.ts) - same as the searchbar widget.

const STATION_URL = 'https://music.salastil.com';
const STREAM_URL = `${STATION_URL}/stream.mp3`;

// Every visitor's browser polls /now, and each of those would otherwise become a request
// to the radio box. Responses are shared for this long, and concurrent misses share one
// upstream request, so upstream load is ~1 request per CACHE_MS no matter how many tabs.
const CACHE_MS = 3000;
const UPSTREAM_TIMEOUT_MS = 5000;

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

async function fetchStatus() {
	const base = { streamUrl: STREAM_URL };
	try {
		const res = await fetch(`${STATION_URL}/api/status`, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
		if (!res.ok) throw new Error(`status ${res.status}`);
		const data = await res.json();
		return {
			...base,
			online: true,
			stationName: str(data.station_name) ?? 'AutoDJ Radio',
			listeners: Number.isInteger(data.listeners) ? data.listeners : null,
			nowPlaying: shapeNowPlaying(data.now_playing)
		};
	} catch {
		// The widget can still offer the stream (it may be only the status endpoint that is
		// down), it just has nothing to say about what's playing.
		return { ...base, online: false, stationName: 'AutoDJ Radio', listeners: null, nowPlaying: null };
	}
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
	version: '1.0.0',

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
