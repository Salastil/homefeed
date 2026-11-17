// Browser half of the AutoDJ radio widget. Loaded via a runtime dynamic import() from
// /widget-assets/autodj/frontend.mjs (see DynamicWidgetSlot.svelte) - plain
// framework-agnostic JS, no build step. Base input/button styling comes from the host
// page's global stylesheet; only layout specific to this widget is added below.
//
// What's shown comes from GET /api/widget/autodj/now (see index.mjs, which relays AutoDJ's
// status because music.salastil.com sends no CORS headers). The audio is NOT relayed: an
// <audio> element plays https://music.salastil.com/stream.opus directly, which needs no CORS.

const VOLUME_KEY = 'homefeed:autodjWidget:volume';

// How often to re-ask while a song is playing, to catch a skip (which changes the track
// before its nominal end). Song boundaries are caught separately, by scheduling a fetch
// for just after the current song is due to finish.
const POLL_WHILE_PLAYING_MS = 15_000;
const POLL_WHEN_OFFLINE_MS = 30_000;
const FETCH_TIMEOUT_MS = 8000;
// The song should have changed by (end + this); if the server still reports the old one
// (AutoDJ is a beat behind), try again soon rather than waiting for the next full poll.
const AFTER_END_DELAY_MS = 1500;
const RETRY_MS = 2500;

const STYLE_ID = 'hf-autodj-widget-style';
const STYLE = `
.hf-autodj-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.hf-autodj-title { font-size: 12px; font-weight: 500; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hf-autodj-live { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.hf-autodj-live.on { color: var(--text-accent); }
.hf-autodj-live.on::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 5px; border-radius: 50%; background: currentColor; vertical-align: 1px; }
.hf-autodj-body { display: flex; gap: 12px; align-items: center; }
.hf-autodj-art { flex: none; width: 84px; height: 84px; border-radius: 8px; background: var(--surface-2); overflow: hidden; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 28px; }
.hf-autodj-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hf-autodj-text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.hf-autodj-song { font-size: 14px; font-weight: 600; line-height: 1.25; overflow-wrap: anywhere; }
.hf-autodj-artist { font-size: 13px; overflow-wrap: anywhere; }
.hf-autodj-album { font-size: 12px; color: var(--text-muted); overflow-wrap: anywhere; }
.hf-autodj-progress { margin-top: 12px; }
.hf-autodj-bar { height: 4px; border-radius: 2px; background: var(--border); overflow: hidden; }
.hf-autodj-fill { height: 100%; width: 0; background: var(--border-accent); }
.hf-autodj-times { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.hf-autodj-controls { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.hf-autodj-play { flex: none; min-width: 74px; }
.hf-autodj-volume { flex: 1; min-width: 0; accent-color: var(--border-accent); }
.hf-autodj-note { margin: 8px 0 0; font-size: 12px; color: var(--text-muted); }
/* Widget-row tile (ctx.layout === 'tile'): cover on the left, everything else in one column, fixed height. */
.hf-autodj.tile { display: flex; gap: 14px; align-items: center; height: 100%; min-width: 0; }
.hf-autodj.tile .hf-autodj-art { width: 96px; height: 96px; }
.hf-autodj.tile .hf-autodj-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.hf-autodj.tile .hf-autodj-head { margin: 0 0 2px; justify-content: flex-start; }
.hf-autodj.tile .hf-autodj-title { font-size: 10.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--tx3, var(--text-muted)); }
.hf-autodj.tile .hf-autodj-live { font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.hf-autodj.tile .hf-autodj-live.on { color: var(--up, var(--text-accent)); }
.hf-autodj.tile .hf-autodj-song { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hf-autodj.tile .hf-autodj-sub { font-size: 12px; color: var(--tx2, var(--text-secondary)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hf-autodj.tile .hf-autodj-sub > div { display: inline; font-size: inherit; color: inherit; }
.hf-autodj.tile .hf-autodj-dot { color: var(--tx3, var(--text-muted)); }
.hf-autodj.tile .hf-autodj-row { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.hf-autodj.tile .hf-autodj-play { min-width: 0; width: 26px; height: 26px; padding: 0; border-radius: 50%; display: grid; place-items: center; font-size: 10px; line-height: 1;
  background: var(--tx, var(--text-primary)); color: var(--s0, var(--surface-0)); border: 0; }
.hf-autodj.tile .hf-autodj-bar { flex: 1; height: 3px; }
.hf-autodj.tile .hf-autodj-fill { background: var(--acc, var(--border-accent)); }
.hf-autodj.tile .hf-autodj-len { font-family: var(--mono, monospace); font-size: 10.5px; color: var(--tx3, var(--text-muted)); white-space: nowrap; }
.hf-autodj.tile .hf-autodj-volume { flex: none; width: 54px; }
.hf-autodj.tile .hf-autodj-note { margin: 2px 0 0; font-size: 11px; }
.hf-autodj.tile .hf-autodj-note:empty { display: none; }
`;

function ensureStyle() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = STYLE;
	document.head.appendChild(style);
}

function el(tag, props, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(props ?? {})) {
		if (key === 'class') node.className = value;
		else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
		else if (value !== undefined && value !== null) node.setAttribute(key, value);
	}
	for (const child of children) {
		if (child == null) continue;
		node.append(child instanceof Node ? child : document.createTextNode(String(child)));
	}
	return node;
}

// localStorage can throw (full quota, strict privacy mode) - read/write fail quietly and
// the widget just falls back to full volume each time.
function loadVolume() {
	try {
		const v = parseFloat(localStorage.getItem(VOLUME_KEY));
		return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
	} catch {
		return 1;
	}
}

function saveVolume(v) {
	try {
		localStorage.setItem(VOLUME_KEY, String(v));
	} catch {
		// best-effort
	}
}

function formatTime(ms) {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function mount(container, ctx) {
	ensureStyle();

	// ---- state ---------------------------------------------------------------------
	let data = null; // last /now response
	// serverNow - Date.now() at the moment the response arrived, so the elapsed time is
	// computed against the server's clock and a wrong clock on this device can't skew it.
	let clockOffsetMs = 0;
	let playing = false;
	let buffering = false;
	let streamError = false;
	let destroyed = false;
	let pollTimer = null;
	let tickTimer = null;
	let abort = null;

	// ---- DOM -----------------------------------------------------------------------
	const titleEl = el('span', { class: 'hf-autodj-title' }, 'AutoDJ Radio');
	const liveEl = el('span', { class: 'hf-autodj-live' }, 'Offline');
	const artBox = el('div', { class: 'hf-autodj-art', 'aria-hidden': 'true' }, '♪');
	const songEl = el('div', { class: 'hf-autodj-song' }, 'Loading…');
	const artistEl = el('div', { class: 'hf-autodj-artist' });
	const albumEl = el('div', { class: 'hf-autodj-album' });
	const fillEl = el('div', { class: 'hf-autodj-fill' });
	const barEl = el(
		'div',
		{ class: 'hf-autodj-bar', role: 'progressbar', 'aria-label': 'Song progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' },
		fillEl
	);
	const elapsedEl = el('span', {}, '0:00');
	const lengthEl = el('span', {}, '0:00');
	const progressEl = el('div', { class: 'hf-autodj-progress' }, barEl, el('div', { class: 'hf-autodj-times' }, elapsedEl, lengthEl));
	const playBtn = el('button', { type: 'button', class: 'hf-autodj-play', onclick: () => (playing ? stop() : start()) }, 'Play');
	const volumeEl = el('input', {
		type: 'range',
		class: 'hf-autodj-volume',
		min: '0',
		max: '1',
		step: '0.01',
		'aria-label': 'Volume'
	});
	const noteEl = el('p', { class: 'hf-autodj-note' });

	// A widget-row tile is a fixed ~110px high, so it gets a compact one-column arrangement
	// of the same elements; everything below drives either layout through the same nodes.
	const isTile = ctx.layout === 'tile';
	const lenEl = isTile ? el('span', { class: 'hf-autodj-len' }, elapsedEl, ' / ', lengthEl) : null;
	const root = isTile
		? el(
				'div',
				{ class: 'hf-autodj tile' },
				artBox,
				el(
					'div',
					{ class: 'hf-autodj-col' },
					el('div', { class: 'hf-autodj-head' }, titleEl, el('span', { class: 'hf-autodj-dot', 'aria-hidden': 'true' }, '·'), liveEl),
					songEl,
					el('div', { class: 'hf-autodj-sub' }, artistEl, ' ', albumEl),
					el('div', { class: 'hf-autodj-row' }, playBtn, barEl, lenEl, volumeEl),
					noteEl
				)
			)
		: el(
				'div',
				{ class: 'hf-autodj' },
				el('div', { class: 'hf-autodj-head' }, titleEl, liveEl),
				el('div', { class: 'hf-autodj-body' }, artBox, el('div', { class: 'hf-autodj-text' }, songEl, artistEl, albumEl)),
				progressEl,
				el('div', { class: 'hf-autodj-controls' }, playBtn, volumeEl),
				noteEl
			);
	container.append(root);

	// ---- audio ---------------------------------------------------------------------
	// preload 'none' so merely having the widget on the page never starts a download of a
	// live stream; nothing is fetched until Play is pressed.
	const audio = new Audio();
	audio.preload = 'none';
	audio.volume = loadVolume();
	volumeEl.value = String(audio.volume);
	volumeEl.addEventListener('input', () => {
		audio.volume = Number(volumeEl.value);
		saveVolume(audio.volume);
	});

	function setPlaybackUi() {
		const label = playing ? (buffering ? 'Loading…' : 'Pause') : 'Play';
		playBtn.textContent = isTile ? (playing ? (buffering ? '…' : '❚❚') : '▶') : label;
		playBtn.setAttribute('aria-label', label);
		playBtn.setAttribute('aria-pressed', String(playing));
		liveEl.className = `hf-autodj-live${playing && !buffering ? ' on' : ''}`;
		liveEl.textContent = playing ? (buffering ? 'Connecting…' : 'Live') : data?.online === false ? 'Offline' : 'Stopped';
		noteEl.textContent = streamError ? "Couldn't play the stream - try again in a moment." : '';
	}

	function start() {
		streamError = false;
		playing = true;
		buffering = true;
		// Always set a fresh src: after a pause the element must rejoin the LIVE edge, not
		// resume from whatever it buffered minutes ago (see stop()).
		audio.src = data?.streamUrl ?? 'https://music.salastil.com/stream.opus';
		setPlaybackUi();
		audio.play().catch(() => {
			// Autoplay policy or a network failure; either way, back to a clean stopped state.
			streamError = true;
			stop(true);
		});
	}

	function stop(keepError = false) {
		playing = false;
		buffering = false;
		if (!keepError) streamError = false;
		audio.pause();
		// Dropping the source (rather than just pausing) is what makes the next Play join
		// the live stream instead of replaying stale buffered audio, and it stops the
		// browser downloading in the background while paused.
		audio.removeAttribute('src');
		audio.load();
		setPlaybackUi();
	}

	audio.addEventListener('playing', () => {
		buffering = false;
		setPlaybackUi();
	});
	audio.addEventListener('waiting', () => {
		if (playing) {
			buffering = true;
			setPlaybackUi();
		}
	});
	audio.addEventListener('error', () => {
		// Fires with no src too (after stop()); only a failure while we mean to play counts.
		if (!playing) return;
		streamError = true;
		stop(true);
	});

	// OS media controls / lock screen / headset keys.
	function updateMediaSession() {
		if (!('mediaSession' in navigator)) return;
		const np = data?.nowPlaying;
		try {
			navigator.mediaSession.metadata = np
				? new MediaMetadata({
						title: np.title,
						artist: np.kind === 'track' ? (np.artist ?? '') : (data.stationName ?? ''),
						album: np.album ?? data.stationName ?? '',
						artwork: np.coverUrl ? [{ src: np.coverUrl }] : []
					})
				: null;
			navigator.mediaSession.setActionHandler('play', () => start());
			navigator.mediaSession.setActionHandler('pause', () => stop());
			navigator.mediaSession.setActionHandler('stop', () => stop());
		} catch {
			// best-effort - a browser without full Media Session support just skips it
		}
	}

	// ---- rendering -----------------------------------------------------------------
	let shownCover = undefined; // undefined = nothing rendered yet; null = placeholder

	function setCover(url) {
		if (url === shownCover) return;
		shownCover = url;
		artBox.textContent = '';
		if (!url) {
			artBox.append('♪');
			return;
		}
		const img = el('img', { src: url, alt: '', loading: 'eager', decoding: 'async', referrerpolicy: 'no-referrer' });
		img.addEventListener('error', () => {
			if (shownCover === url) {
				shownCover = null;
				artBox.textContent = '♪';
			}
		});
		artBox.append(img);
	}

	function render() {
		const np = data?.nowPlaying;
		titleEl.textContent = data?.stationName ?? 'AutoDJ Radio';

		if (!np) {
			songEl.textContent = data ? 'Nothing playing' : 'Loading…';
			artistEl.textContent = '';
			albumEl.textContent = '';
			setCover(null);
			progressEl.hidden = true;
			barEl.hidden = isTile;
			if (lenEl) lenEl.hidden = true;
			setPlaybackUi();
			return;
		}

		progressEl.hidden = false;
		barEl.hidden = false;
		if (lenEl) lenEl.hidden = false;
		if (np.kind === 'track') {
			songEl.textContent = np.title;
			artistEl.textContent = np.artist ?? '';
			albumEl.textContent = [np.album, np.year].filter(Boolean).join(' · ');
			if (isTile && albumEl.textContent && artistEl.textContent) albumEl.textContent = '· ' + albumEl.textContent;
			setCover(np.coverUrl);
		} else {
			// A DJ break: AutoDJ's public site deliberately shows the station, not the segment.
			songEl.textContent = np.title;
			artistEl.textContent = np.artist ?? 'On air';
			albumEl.textContent = '';
			setCover(null);
		}
		setPlaybackUi();
		updateMediaSession();
		tick();
	}

	// Called twice a second, so it only touches the progress readout.
	function tick() {
		const np = data?.nowPlaying;
		if (!np) return;
		const serverNow = Date.now() + clockOffsetMs;
		// Clamped: at a song boundary the next track may not have been fetched yet, and a
		// bar past 100% or a time past the length would look broken for a moment.
		const elapsed = Math.min(np.durationMs, Math.max(0, serverNow - np.startedAt));
		const pct = (elapsed / np.durationMs) * 100;
		fillEl.style.width = `${pct.toFixed(2)}%`;
		barEl.setAttribute('aria-valuenow', String(Math.round(pct)));
		elapsedEl.textContent = formatTime(elapsed);
		lengthEl.textContent = formatTime(np.durationMs);
	}

	// ---- polling -------------------------------------------------------------------
	async function refresh() {
		if (destroyed) return;
		abort?.abort();
		abort = new AbortController();
		const timeout = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
		try {
			const res = await fetch(`${ctx.apiBase}/api/widget/autodj/now`, { signal: abort.signal });
			if (!res.ok) throw new Error(`status ${res.status}`);
			const next = await res.json();
			clockOffsetMs = next.serverNow - Date.now();
			data = next;
		} catch {
			// Keep showing the last known song; just mark the status as stale if we never had one.
			if (!data) data = { online: false, stationName: 'AutoDJ Radio', nowPlaying: null, streamUrl: null };
		} finally {
			clearTimeout(timeout);
		}
		if (destroyed) return;
		render();
		scheduleNext();
	}

	function scheduleNext() {
		clearTimeout(pollTimer);
		if (destroyed || document.hidden) return; // resumed by the visibilitychange handler
		let delay = POLL_WHEN_OFFLINE_MS;
		const np = data?.nowPlaying;
		if (data?.online && np) {
			const msUntilEnd = np.startedAt + np.durationMs - (Date.now() + clockOffsetMs);
			// A single timeout, not an interval: if the device sleeps and wakes, one stale
			// timer fires once instead of replaying every missed tick as a burst of requests.
			delay = msUntilEnd <= 0 ? RETRY_MS : Math.min(msUntilEnd + AFTER_END_DELAY_MS, POLL_WHILE_PLAYING_MS);
		}
		pollTimer = setTimeout(refresh, delay);
	}

	function onVisibility() {
		if (document.hidden) {
			clearTimeout(pollTimer);
		} else {
			refresh();
		}
	}
	document.addEventListener('visibilitychange', onVisibility);

	tickTimer = setInterval(() => {
		if (!document.hidden) tick();
	}, 500);

	setPlaybackUi();
	refresh();

	return () => {
		destroyed = true;
		clearTimeout(pollTimer);
		clearInterval(tickTimer);
		abort?.abort();
		document.removeEventListener('visibilitychange', onVisibility);
		audio.pause();
		audio.removeAttribute('src');
		audio.load();
		if ('mediaSession' in navigator) {
			try {
				navigator.mediaSession.metadata = null;
				for (const action of ['play', 'pause', 'stop']) navigator.mediaSession.setActionHandler(action, null);
			} catch {
				// best-effort
			}
		}
		root.remove();
	};
}

export default { mount };
