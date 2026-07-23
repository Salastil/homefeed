import type { InferenceProvider } from '../inference/provider.js';
import * as eventsDb from '../storage/db/events.js';
import * as contentItemsDb from '../storage/db/contentItems.js';
import { embedPendingItems } from '../pipeline/embedding.js';
import { publishCluster } from '../pipeline/publish.js';
import { randomUUID } from 'node:crypto';
import type { GlobalSettings } from '../storage/db/types.js';
import { logger } from '../storage/db/logs.js';

function isDue(event: ReturnType<typeof eventsDb.listActiveEvents>[number]): boolean {
	if (event.cadence === 'continuous') return true; // handled every cycle like normal clustering, just scoped to its sources

	const now = new Date();
	const last = event.lastRecapAt ? new Date(event.lastRecapAt) : null;

	if (event.cadence === 'hourly') {
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

export async function runEventRecaps(provider: InferenceProvider, settings: GlobalSettings): Promise<number> {
	const events = eventsDb.listActiveEvents();
	let published = 0;

	for (const event of events) {
		if (event.sourceIds.length === 0 || !isDue(event)) continue;

		const since = event.lastRecapAt ?? new Date(Date.now() - 24 * 3600_000).toISOString();
		const items = contentItemsDb
			.unclusteredItemsForSources(event.sourceIds, since)
			.filter((item) => eventsDb.itemMatchesEventKeywords(item, event.keywords));
		if (items.length === 0) continue;

		const embedded = await embedPendingItems(provider, settings.selectedModels.embedding, items);
		const withEmbeddings = embedded.filter((i) => i.embedding);
		if (withEmbeddings.length === 0) continue;

		try {
			const article = await publishCluster(
				provider,
				settings,
				{
					id: randomUUID(),
					items: withEmbeddings,
					centroid: withEmbeddings[0].embedding!
				},
				{ eventId: event.id }
			);

			contentItemsDb.assignCluster(
				withEmbeddings.map((i) => i.id),
				article.id
			);
			eventsDb.markRecapped(event.id);
			published++;
			logger.info('events', `Published recap for "${event.name}" from ${withEmbeddings.length} item(s)`);
		} catch (err) {
			logger.error('events', `Recap failed for "${event.name}": ${(err as Error).message}`);
		}
	}

	return published;
}
