import type { AiProviders } from '../inference/provider.js';
import * as eventsDb from '../storage/db/events.js';
import * as articlesDb from '../storage/db/articles.js';
import { publishEventRecap } from '../pipeline/publish.js';
import type { GlobalSettings } from '../storage/db/types.js';
import { logger } from '../storage/db/logs.js';

// Minimum gap between recap ATTEMPTS regardless of success — see isDue below. A real
// production incident: a persistently malformed recap (empty title / swapped halves)
// retried on every single synthesis tick forever, since a failed attempt never advanced
// lastRecapAt. Each attempt took 10+ minutes on CPU-only hardware, and Ollama serves one
// request at a time, so that one stuck event blocked every other merge/recap for 6+
// hours straight — and its constituent article set kept growing every failed cycle
// (since's anchor never moved forward either), making each retry slower and more
// truncation-prone than the last.
const RETRY_COOLDOWN_MS = 30 * 60_000;

// null means recaps are off for this item — e.g. one just organizing a commit or
// torrent RSS feed under its own nav entry, with nothing that needs periodically
// summarizing. Individual items still publish immediately regardless (see
// priorityQueue.ts); this only gates the periodic AI wrap-up below.
function isDue(event: ReturnType<typeof eventsDb.listActiveEvents>[number]): boolean {
	if (event.recapIntervalHours === null) return false;
	const last = event.lastRecapAt ? new Date(event.lastRecapAt) : null;
	if (last && Date.now() - last.getTime() < event.recapIntervalHours * 3600_000) return false;
	const lastAttempt = event.lastRecapAttemptAt ? new Date(event.lastRecapAttemptAt) : null;
	if (lastAttempt && Date.now() - lastAttempt.getTime() < RETRY_COOLDOWN_MS) return false;
	return true;
}

/**
 * Periodically writes an AI recap summarizing everything published under a tracked
 * event since its last recap — additive alongside those individual articles (which
 * publish immediately via the normal pipeline, see priorityQueue.ts), not a replacement
 * for them.
 */
export async function runEventRecaps(providers: AiProviders, settings: GlobalSettings): Promise<number> {
	const events = eventsDb.listActiveEvents();
	let published = 0;

	for (const event of events) {
		if (event.sourceIds.length === 0 || !isDue(event)) continue;

		const since = event.lastRecapAt ?? new Date(Date.now() - 24 * 3600_000).toISOString();
		const constituents = articlesDb.articlesForEventSince(event.id, since);
		if (constituents.length === 0) continue;

		eventsDb.markRecapAttempted(event.id);
		try {
			const article = await publishEventRecap(providers, settings, event, constituents);
			eventsDb.markRecapped(event.id);
			published++;
			logger.info('events', `Published recap for "${event.name}" from ${constituents.length} article(s)`);
		} catch (err) {
			logger.error('events', `Recap failed for "${event.name}": ${(err as Error).message}`);
		}
	}

	return published;
}
