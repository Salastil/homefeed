import { pollDueSources } from '../ingestion/poller.js';
import { runSynthesisCycle, runPassthroughCycle, runDirectPublishCycle } from './priorityQueue.js';
import { runEventRecaps } from './eventsRecap.js';
import { runRetentionSweep } from './retention.js';
import { OllamaProvider } from '../inference/ollama-provider.js';
import * as settingsDb from '../storage/db/settings.js';
import { logger } from '../storage/db/logs.js';
import { pollWeatherNow } from '../weather/poller.js';
import { pollStocksNow } from '../stocks/poller.js';
import { pollPoe2Now } from '../poe2/poller.js';

const POLL_TICK_MS = 60_000; // checks which sources are due every minute; each source's own interval governs actual fetch frequency
const DIRECT_PUBLISH_TICK_MS = 60_000;
const SYNTHESIS_TICK_MS = 60_000;
const RETENTION_TICK_MS = 60 * 60_000; // hourly
const WEATHER_TICK_MS = 45 * 60_000;
const STOCKS_TICK_MS = 15 * 60_000; // per admin spec — stock prices move faster than weather
const POE2_TICK_MS = 60 * 60_000; // poe.ninja's own overview data doesn't refresh faster than hourly, so polling more often than this just re-fetches the same numbers

/**
 * Runs fn on every tick, but skips a tick outright if the previous one is still in
 * flight instead of overlapping it. Matters most for the synthesis tick: an item stays
 * "unclustered" (cluster_id IS NULL — see contentItems.unclusteredItemsExcludingSources)
 * until AFTER its cluster finishes synthesizing and publishing, so a generate() call
 * that runs past the next tick (easily minutes, on CPU-only inference — see
 * ollama-provider.ts) used to let the same item get picked up and republished as a
 * fresh, differently-worded article by an overlapping cycle, repeatedly, until the
 * first cycle's assignCluster() finally landed. Node is single-threaded, so the only
 * source of "concurrent" runs here is exactly this interval overlap.
 *
 * Each call gets its own independent `running` flag/timer — the direct-publish and
 * synthesis ticks are deliberately two separate calls to this (not one shared guard)
 * precisely so a slow AI-merge backlog on one never blocks the other's fast,
 * no-AI-needed items from publishing on schedule. They operate on disjoint item sets
 * (see priorityQueue.ts), so there's no risk of the two racing each other into a
 * duplicate publish the way an overlapping call to the *same* fn would.
 */
function everyTickSkippingOverlap(ms: number, fn: () => Promise<void>) {
	let running = false;
	setInterval(() => {
		if (running) return;
		running = true;
		fn().finally(() => {
			running = false;
		});
	}, ms);
}

export function startScheduler() {
	const provider = () => {
		const s = settingsDb.getSettings();
		return new OllamaProvider(s.aiServiceHost, s.aiServicePort);
	};

	everyTickSkippingOverlap(POLL_TICK_MS, async () => {
		try {
			const ingested = await pollDueSources();
			if (ingested > 0) logger.info('scheduler', `Poll tick: ingested ${ingested} new item(s)`);
		} catch (err) {
			logger.error('scheduler', `Poll tick failed: ${(err as Error).message}`);
		}
	});

	everyTickSkippingOverlap(DIRECT_PUBLISH_TICK_MS, async () => {
		try {
			const settings = settingsDb.getSettings();
			const published = await runDirectPublishCycle(settings);
			if (published > 0) {
				logger.info('scheduler', `Direct-publish tick: published ${published} article(s)`);
			}
		} catch (err) {
			logger.error('scheduler', `Direct-publish tick failed: ${(err as Error).message}`);
		}
	});

	everyTickSkippingOverlap(SYNTHESIS_TICK_MS, async () => {
		try {
			const settings = settingsDb.getSettings();
			const p = provider();

			if (!(await p.isReachable())) {
				// Ollama isn't set up yet — publish what we can directly rather than
				// leaving the site empty. Tracked-event recaps genuinely need the AI
				// (summarizing many messages isn't something to fake), so those still wait.
				const published = await runPassthroughCycle(settings);
				if (published > 0) {
					logger.warn('scheduler', `AI service unreachable — published ${published} article(s) directly (no rewriting/merging)`);
				}
				return;
			}

			const published = await runSynthesisCycle(p, settings);
			const recapped = await runEventRecaps(p, settings);
			if (published > 0 || recapped > 0) {
				logger.info('scheduler', `Synthesis tick: published ${published} article(s), ${recapped} event recap(s)`);
			}
		} catch (err) {
			logger.error('scheduler', `Synthesis tick failed: ${(err as Error).message}`);
		}
	});

	everyTickSkippingOverlap(RETENTION_TICK_MS, async () => {
		try {
			runRetentionSweep(settingsDb.getSettings());
			logger.info('retention', 'Retention sweep completed');
		} catch (err) {
			logger.error('retention', `Retention tick failed: ${(err as Error).message}`);
		}
	});

	// Immediate first call for all three — unlike RSS sources (whose "due" check makes a
	// brand-new source eligible on the very next 1-minute tick), weather/stocks/poe2 have
	// no such shortcut; without this the sidebar is empty for up to 45/15/60 minutes after
	// every restart. Each is also gated on its Widgets-tab enabled flag (see
	// admin/settings' consolidated Widgets tab) — disabling a widget stops these external
	// calls entirely rather than just hiding the sidebar box, so there's no pointless
	// polling for something nobody's looking at. Re-enabling it triggers an immediate
	// poll instead (see admin.ts's PATCH /api/admin/settings), same as this initial call.
	if (settingsDb.getSettings().widgets.weather) {
		pollWeatherNow().catch((err) => logger.error('weather', `Initial poll failed: ${err.message}`));
	}
	setInterval(() => {
		if (!settingsDb.getSettings().widgets.weather) return;
		pollWeatherNow().catch((err) => logger.error('weather', `Poll tick failed: ${err.message}`));
	}, WEATHER_TICK_MS);

	if (settingsDb.getSettings().widgets.stocks) {
		pollStocksNow().catch((err) => logger.error('stocks', `Initial poll failed: ${err.message}`));
	}
	setInterval(() => {
		if (!settingsDb.getSettings().widgets.stocks) return;
		pollStocksNow().catch((err) => logger.error('stocks', `Poll tick failed: ${err.message}`));
	}, STOCKS_TICK_MS);

	if (settingsDb.getSettings().widgets.poe2) {
		pollPoe2Now().catch((err) => logger.error('poe2', `Initial poll failed: ${err.message}`));
	}
	setInterval(() => {
		if (!settingsDb.getSettings().widgets.poe2) return;
		pollPoe2Now().catch((err) => logger.error('poe2', `Poll tick failed: ${err.message}`));
	}, POE2_TICK_MS);

	logger.info(
		'scheduler',
		'Started: poll every 1m, direct-publish every 1m, synthesis every 1m, retention every 1h, weather every 45m, stocks every 15m, poe2 every 1h'
	);
}
