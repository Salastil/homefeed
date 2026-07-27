import { pollDueSources } from '../ingestion/poller.js';
import { runSynthesisCycle, runPassthroughCycle } from './priorityQueue.js';
import { runEventRecaps } from './eventsRecap.js';
import { runRetentionSweep } from './retention.js';
import { OllamaProvider } from '../inference/ollama-provider.js';
import * as settingsDb from '../storage/db/settings.js';
import * as installedWidgetsDb from '../storage/db/installedWidgets.js';
import { logger } from '../storage/db/logs.js';
import { loadedWidgets } from '../widgets/registry.js';
import type { WidgetPlugin } from '../widgets/types.js';

const POLL_TICK_MS = 60_000; // checks which sources are due every minute; each source's own interval governs actual fetch frequency
const SYNTHESIS_TICK_MS = 60_000;
const RETENTION_TICK_MS = 60 * 60_000; // hourly

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

	setInterval(async () => {
		try {
			const ingested = await pollDueSources();
			if (ingested > 0) logger.info('scheduler', `Poll tick: ingested ${ingested} new item(s)`);
		} catch (err) {
			logger.error('scheduler', `Poll tick failed: ${(err as Error).message}`);
		}
	}, POLL_TICK_MS);

	setInterval(async () => {
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
	}, SYNTHESIS_TICK_MS);

	setInterval(() => {
		try {
			runRetentionSweep(settingsDb.getSettings());
			logger.info('retention', 'Retention sweep completed');
		} catch (err) {
			logger.error('retention', `Retention tick failed: ${(err as Error).message}`);
		}
	}, RETENTION_TICK_MS);

	for (const plugin of loadedWidgets.values()) {
		startWidgetPolling(plugin);
	}

	logger.info(
		'scheduler',
		`Started: poll every 1m, synthesis every 1m, retention every 1h, ${loadedWidgets.size} widget(s) polling on their own intervals`
	);
}
