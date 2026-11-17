/**
 * Live-page plumbing for a tab that stays open for days (issue #1: never scroll, never
 * refresh, no memory leaks).
 *
 *  - `clock.now` is ONE shared timestamp, ticked every 30 s by a single interval, that every
 *    relative time on the page reads - instead of a timer per row.
 *  - `poll()` runs a fetch on an interval but skips it while the tab is hidden, and catches
 *    up the moment the tab is shown again. It returns its own cleanup, so a component's
 *    $effect tears it down with the component.
 */
import { browser } from '$app/environment';

let tick = $state(Date.now());
let started = false;

export const clock = {
	// The server never ticks (startClock is browser-only), and this module lives for the
	// whole server process - so a server render reads the real time instead of the moment
	// the module was first loaded.
	get now() {
		return browser ? tick : Date.now();
	}
};

export function startClock() {
	if (!browser || started) return;
	started = true;
	setInterval(() => (tick = Date.now()), 30_000);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') tick = Date.now();
	});
}

export function poll(fn: () => Promise<unknown> | void, ms: number): () => void {
	if (!browser) return () => {};
	let busy = false;
	const run = async () => {
		if (busy || document.visibilityState !== 'visible') return;
		busy = true;
		try {
			await fn();
		} catch {
			// A failed poll keeps what's on screen; the next tick retries.
		} finally {
			busy = false;
		}
	};
	const id = setInterval(run, ms);
	const onVis = () => {
		if (document.visibilityState === 'visible') run();
	};
	document.addEventListener('visibilitychange', onVis);
	return () => {
		clearInterval(id);
		document.removeEventListener('visibilitychange', onVis);
	};
}
