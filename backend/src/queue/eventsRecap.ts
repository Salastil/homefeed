import type { InferenceProvider } from '../inference/provider.js';
import * as eventsDb from '../storage/db/events.js';
import * as articlesDb from '../storage/db/articles.js';
import { publishEventRecap } from '../pipeline/publish.js';
import type { GlobalSettings } from '../storage/db/types.js';
import { logger } from '../storage/db/logs.js';

// null means recaps are off for this item — e.g. one just organizing a commit or
// torrent RSS feed under its own nav entry, with nothing that needs periodically
// summarizing. Individual items still publish immediately regardless (see
// priorityQueue.ts); this only gates the periodic AI wrap-up below.
function isDue(event: ReturnType<typeof eventsDb.listActiveEvents>[number]): boolean {
	if (event.recapIntervalHours === null) return false;
	const last = event.lastRecapAt ? new Date(event.lastRecapAt) : null;
	return !last || Date.now() - last.getTime() >= event.recapIntervalHours * 3600_000;
}

/**
 * Periodically writes an AI recap summarizing everything published under a tracked
 * event since its last recap — additive alongside those individual articles (which
 * publish immediately via the normal pipeline, see priorityQueue.ts), not a replacement
 * for them.
 */
export async function runEventRecaps(provider: InferenceProvider, settings: GlobalSettings): Promise<number> {
	const events = eventsDb.listActiveEvents();
	let published = 0;

	for (const event of events) {
		if (event.sourceIds.length === 0 || !isDue(event)) continue;

		const since = event.lastRecapAt ?? new Date(Date.now() - 24 * 3600_000).toISOString();
		const constituents = articlesDb.articlesForEventSince(event.id, since);
		if (constituents.length === 0) continue;

		try {
			const article = await publishEventRecap(provider, settings, event, constituents);
			eventsDb.markRecapped(event.id);
			published++;
			logger.info('events', `Published recap for "${event.name}" from ${constituents.length} article(s)`);
		} catch (err) {
			logger.error('events', `Recap failed for "${event.name}": ${(err as Error).message}`);
		}
	}

	return published;
}
