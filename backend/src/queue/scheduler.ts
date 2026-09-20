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

// How long a tick may run before it gets reported as stuck. Set well above each tick's
// genuine worst case so a healthy-but-slow pass never cries wolf: a synthesis pass runs
// 20+ minutes legitimately on CPU-only hardware (a long event recap at the Models tab's
// num_predict), whereas a poll pass is bounded by poller.ts's per-source fetch timeout
// and has no business taking minutes at all.
const POLL_STALL_MS = 5 * 60_000;
const DIRECT_PUBLISH_STALL_MS = 10 * 60_000;
const SYNTHESIS_STALL_MS = 45 * 60_000;
const RETENTION_STALL_MS = 10 * 60_000;

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
function everyTickSkippingOverlap(ms: number, fn: () => Promise<void>, label: string, stallWarnMs: number) {
	let running = false;
	let startedAt = 0;
	let warned = false;
	setInterval(() => {
		if (running) {
			// A tick whose promise never settles leaves `running` stuck true and silently
			// disables this subsystem permanently — which is how RSS ingestion stopped for
			// two days without a single log line. Individual awaits are bounded at their own
			// call sites (see poller.ts's withTimeout), so this is the backstop: it does NOT
			// release the guard, because letting a second pass start over the same items is
			// a worse failure for the publish ticks (concurrent passes can double-publish)
			// than a stall. It just makes the stall visible instead of silent.
			const stalledMs = Date.now() - startedAt;
			if (!warned && stalledMs >= stallWarnMs) {
				warned = true;
				logger.error(
					'scheduler',
					`${label} tick has been running ${Math.round(stalledMs / 60_000)}m and is blocking every later ${label} tick — it is likely stuck on a call that never returns`
				);
			}
			return;
		}
		running = true;
		startedAt = Date.now();
		warned = false;
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
	// A self-rearming timeout rather than setInterval, because intervalMs is allowed to be
	// a getter over admin-set config (see widgets/stocks/plugin.ts): setInterval reads it
	// once and pins the widget to whatever the cadence was at startup, so a change would
	// not take hold until the next process restart. Re-reading it each cycle means a new
	// value applies from the following tick.
	const arm = () => {
		const handle = setTimeout(() => {
			if (installedWidgetsDb.getInstalled(plugin.id)?.enabled) {
				plugin.poll!.run().catch((err) => logger.error(plugin.id, `Poll tick failed: ${(err as Error).message}`));
			}
			arm();
		}, plugin.poll!.intervalMs);
		widgetIntervals.set(plugin.id, handle);
	};
	arm();
}

export function stopWidgetPolling(id: string) {
	const handle = widgetIntervals.get(id);
	if (handle) {
		// clearTimeout, not clearInterval — startWidgetPolling schedules with setTimeout now.
		// Node treats the two as interchangeable, but the matching name keeps the pairing legible.
		clearTimeout(handle);
		widgetIntervals.delete(id);
	}
}

export function startScheduler() {
	const embeddingProvider = () => {
		const s = settingsDb.getSettings();
		return new OllamaProvider(s.embeddingServiceHost, s.embeddingServicePort);
	};
	const synthesisProvider = () => {
		const s = settingsDb.getSettings();
		return new OllamaProvider(s.synthesisServiceHost, s.synthesisServicePort);
	};

	everyTickSkippingOverlap(POLL_TICK_MS, async () => {
		try {
			const ingested = await pollDueSources();
			if (ingested > 0) logger.info('scheduler', `Poll tick: ingested ${ingested} new item(s)`);
		} catch (err) {
			logger.error('scheduler', `Poll tick failed: ${(err as Error).message}`);
		}
	}, 'poll', POLL_STALL_MS);

	everyTickSkippingOverlap(DIRECT_PUBLISH_TICK_MS, async () => {
		try {
			const settings = settingsDb.getSettings();
			const embedding = embeddingProvider();
			// This tick runs regardless of reachability (nothing here rewrites or merges),
			// but tagging direct-published items (see runDirectPublishCycle/publishDirect)
			// does need a working embedding connection — it matches against already-existing
			// tags by similarity, no synthesis-model call involved at all — so only offer the
			// provider through when embedding specifically is reachable, so an unconfigured
			// connection doesn't spam the log with a failed tag-matching attempt on every
			// single item, every tick. Synthesis's reachability is irrelevant here.
			const reachable = await embedding.isReachable();
			const published = await runDirectPublishCycle(settings, reachable ? embedding : undefined);
			if (published > 0) {
				logger.info('scheduler', `Direct-publish tick: published ${published} article(s)`);
			}
		} catch (err) {
			logger.error('scheduler', `Direct-publish tick failed: ${(err as Error).message}`);
		}
	}, 'direct-publish', DIRECT_PUBLISH_STALL_MS);

	everyTickSkippingOverlap(SYNTHESIS_TICK_MS, async () => {
		try {
			const settings = settingsDb.getSettings();
			const embedding = embeddingProvider();
			const synthesis = synthesisProvider();

			const [embeddingReachable, synthesisReachable] = await Promise.all([embedding.isReachable(), synthesis.isReachable()]);
			if (!embeddingReachable || !synthesisReachable) {
				// Either connection isn't set up yet — publish what we can directly rather
				// than leaving the site empty. Every merge/tag path here needs both
				// connections (embedding for clustering/tagging, synthesis for the article
				// text itself), so "one down" is treated the same as "both down". Tracked-event
				// recaps genuinely need the AI (summarizing many messages isn't something to
				// fake), so those still wait.
				const published = await runPassthroughCycle(settings);
				if (published > 0) {
					logger.warn('scheduler', `AI service unreachable — published ${published} article(s) directly (no rewriting/merging)`);
				}
				return;
			}

			const providers = { embedding, synthesis };
			const published = await runSynthesisCycle(providers, settings);
			const recapped = await runEventRecaps(providers, settings);
			if (published > 0 || recapped > 0) {
				logger.info('scheduler', `Synthesis tick: published ${published} article(s), ${recapped} event recap(s)`);
			}
		} catch (err) {
			logger.error('scheduler', `Synthesis tick failed: ${(err as Error).message}`);
		}
	}, 'synthesis', SYNTHESIS_STALL_MS);

	everyTickSkippingOverlap(RETENTION_TICK_MS, async () => {
		try {
			runRetentionSweep(settingsDb.getSettings());
			logger.info('retention', 'Retention sweep completed');
		} catch (err) {
			logger.error('retention', `Retention tick failed: ${(err as Error).message}`);
		}
	}, 'retention', RETENTION_STALL_MS);

	for (const plugin of loadedWidgets.values()) {
		startWidgetPolling(plugin);
	}

	logger.info(
		'scheduler',
		`Started: poll every 1m, direct-publish every 1m, synthesis every 1m, retention every 1h, ${loadedWidgets.size} widget(s) polling on their own intervals`
	);
}
