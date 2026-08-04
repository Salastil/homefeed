import { pollDueSources } from '../ingestion/poller.js';
import { runSynthesisCycle, runPassthroughCycle, runDirectPublishCycle } from './priorityQueue.js';
import { runEventRecaps } from './eventsRecap.js';
import { runRetentionSweep } from './retention.js';
import { OllamaProvider } from '../inference/ollama-provider.js';
import * as settingsDb from '../storage/db/settings.js';
import * as installedWidgetsDb from '../storage/db/installedWidgets.js';
import { logger } from '../storage/db/logs.js';
import { loadedWidgets } from '../widgets/registry.js';
import type { WidgetPlugin } from '../widgets/types.js';

const POLL_TICK_MS = 60_000; // checks which sources are due every minute; each source's own interval governs actual fetch frequency
const DIRECT_PUBLISH_TICK_MS = 60_000;
const SYNTHESIS_TICK_MS = 60_000;
const RETENTION_TICK_MS = 60 * 60_000; // hourly

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

// Per-widget setInterval handles, keyed by widget id — lets a single widget's polling be
// started/stopped independently (on live upload/delete, or an enable toggle) without
// touching any other widget's interval. Exported so widgets/install.ts and
// widgets/uninstall.ts can drive it directly.
export const widgetIntervals = new Map<string, NodeJS.Timeout>();

// Starts (or re-starts) polling for one widget — an immediate poll if it's currently
// enabled (unlike RSS sources, whose "due" check makes a brand-new source eligible on the
// very next 1-minute tick, a widget has no such shortcut; without this the sidebar would
// sit empty for up to a full poll interval after every restart or fresh install), then a
// recurring interval that re-checks the enabled flag on every tick — so disabling a widget
// stops the actual external polling, not just hides it in the sidebar.
export function startWidgetPolling(plugin: WidgetPlugin) {
	if (!plugin.poll) return;
	stopWidgetPolling(plugin.id);

	if (installedWidgetsDb.getInstalled(plugin.id)?.enabled) {
		plugin.poll.run().catch((err) => logger.error(plugin.id, `Initial poll failed: ${(err as Error).message}`));
	}
	const handle = setInterval(() => {
		if (!installedWidgetsDb.getInstalled(plugin.id)?.enabled) return;
		plugin.poll!.run().catch((err) => logger.error(plugin.id, `Poll tick failed: ${(err as Error).message}`));
	}, plugin.poll.intervalMs);
	widgetIntervals.set(plugin.id, handle);
}

export function stopWidgetPolling(id: string) {
	const handle = widgetIntervals.get(id);
	if (handle) {
		clearInterval(handle);
		widgetIntervals.delete(id);
	}
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
			const p = provider();
			// This tick runs regardless of Ollama's reachability (nothing here rewrites or
			// merges), but tagging direct-published items (see runDirectPublishCycle/
			// publishDirect) does need a working AI service — only offer the provider
			// through when it's actually reachable, so an unconfigured Ollama doesn't spam
			// the log with a failed tag-extraction attempt on every single item, every tick.
			const reachable = await p.isReachable();
			const published = await runDirectPublishCycle(settings, reachable ? p : undefined);
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

	for (const plugin of loadedWidgets.values()) {
		startWidgetPolling(plugin);
	}

	logger.info(
		'scheduler',
		`Started: poll every 1m, direct-publish every 1m, synthesis every 1m, retention every 1h, ${loadedWidgets.size} widget(s) polling on their own intervals`
	);
}
