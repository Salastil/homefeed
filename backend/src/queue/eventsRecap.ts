import type { InferenceProvider } from '../inference/provider.js';
import * as eventsDb from '../storage/db/events.js';
import * as articlesDb from '../storage/db/articles.js';
import { publishEventRecap } from '../pipeline/publish.js';
import type { GlobalSettings } from '../storage/db/types.js';
import { logger } from '../storage/db/logs.js';

function isDue(event: ReturnType<typeof eventsDb.listActiveEvents>[number]): boolean {
	const now = new Date();
	const last = event.lastRecapAt ? new Date(event.lastRecapAt) : null;

	// "Continuous" no longer means "recap every tick" — individual items matching this
	// event now publish immediately regardless of cadence (see priorityQueue.ts), so the
	// recap job's only remaining purpose is the periodic AI wrap-up. Treated the same as
	// hourly so an ongoing event still gets occasional recaps without spamming a
	// near-duplicate one on every synthesis tick.
	if (event.cadence === 'continuous' || event.cadence === 'hourly') {
		return !last || now.getTime() - last.getTime() >= 3600_000;
	}

	if (event.cadence === 'daily') {
		if (!event.cadenceTime) return false;
		const [h, m] = event.cadenceTime.split(':').map(Number);
		const scheduledToday = new Date(now);
		scheduledToday.setHours(h, m, 0, 0);
		const alreadyRecappedToday = last && last.toDateString() === now.toDateString();
		return now >= scheduledToday && !alreadyRecappedToday;
	}

	return false;
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
