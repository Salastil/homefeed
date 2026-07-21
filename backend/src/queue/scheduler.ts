import { pollDueSources } from '../ingestion/poller.js';
import { runSynthesisCycle, runPassthroughCycle } from './priorityQueue.js';
import { runEventRecaps } from './eventsRecap.js';
import { runRetentionSweep } from './retention.js';
import { OllamaProvider } from '../inference/ollama-provider.js';
import * as settingsDb from '../storage/db/settings.js';
import { logger } from '../storage/db/logs.js';

const POLL_TICK_MS = 60_000; // checks which sources are due every minute; each source's own interval governs actual fetch frequency
const SYNTHESIS_TICK_MS = 60_000;
const RETENTION_TICK_MS = 60 * 60_000; // hourly

export function startScheduler() {
	const provider = () => {
		const s = settingsDb.getSettings();
		return new OllamaProvider(s.aiServiceHost, s.aiServicePort);
	};

	setInterval(async () => {
		try {
			const settings = settingsDb.getSettings();
			const ingested = await pollDueSources(settings.defaultPollIntervalMinutes);
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

	logger.info('scheduler', 'Started: poll every 1m, synthesis every 1m, retention every 1h');
}
