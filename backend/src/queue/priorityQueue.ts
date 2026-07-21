import type { InferenceProvider } from '../inference/provider.js';
import * as contentItemsDb from '../storage/db/contentItems.js';
import * as sourcesDb from '../storage/db/sources.js';
import * as categoriesDb from '../storage/db/categories.js';
import * as eventsDb from '../storage/db/events.js';
import { embedPendingItems } from '../pipeline/embedding.js';
import { clusterItems } from '../pipeline/clustering.js';
import { publishCluster, publishDirect } from '../pipeline/publish.js';
import { logger } from '../storage/db/logs.js';
import type { GlobalSettings, ContentItem } from '../storage/db/types.js';

function primaryCategoryRank(item: ContentItem, rankByName: Map<string, number>): number {
	const source = sourcesDb.getSource(item.sourceId);
	const cats = source?.category ?? [];
	let best = Infinity;
	for (const cat of cats) {
		// Category names on sources can be free text (e.g. "Local: Philadelphia") —
		// match on the leading segment against the admin-ranked category list.
		const leading = cat.split(':')[0].trim();
		const rank = rankByName.get(leading.toLowerCase());
		if (rank !== undefined && rank < best) best = rank;
	}
	return best;
}

/**
 * Fallback for when the AI service isn't reachable yet — publishes every eligible item
 * immediately rather than leaving pages empty until Ollama is set up. Unlike the AI
 * pipeline, this doesn't wait out the hold-before-publish window: that window exists to
 * give corroborating sources time to arrive before an AI merge locks in, which doesn't
 * apply here since there's no merging happening at all — each item is just itself.
 * Still respects category priority.
 */
export async function runPassthroughCycle(settings: GlobalSettings): Promise<number> {
	const eventSourceIds = eventsDb.listActiveEvents().flatMap((e) => e.sourceIds);
	const items = contentItemsDb.unclusteredItemsExcludingSources(eventSourceIds);
	if (items.length === 0) return 0;

	const categories = categoriesDb.listCategories();
	const rankByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.priorityRank]));
	const ranked = items
		.map((item) => ({ item, rank: primaryCategoryRank(item, rankByName) }))
		.sort((a, b) => a.rank - b.rank)
		.map((r) => r.item);

	let published = 0;

	for (const item of ranked) {
		try {
			const article = await publishDirect(item);
			contentItemsDb.assignCluster([item.id], article.id);
			published++;
			logger.info('synthesis', `Published "${article.title}" directly (no AI available)`);
		} catch (err) {
			logger.error('synthesis', `Passthrough publish failed for "${item.title}": ${(err as Error).message}`);
		}
	}

	return published;
}

/**
 * One pass of the synthesis queue: cluster whatever's unclustered (excluding items
 * belonging to tracked-event sources, which are handled by eventsRecap.ts instead),
 * ordered by admin-defined category priority, and publish clusters that have cleared
 * the hold-before-publish window.
 */
export async function runSynthesisCycle(provider: InferenceProvider, settings: GlobalSettings): Promise<number> {
	const eventSourceIds = eventsDb.listActiveEvents().flatMap((e) => e.sourceIds);
	const items = contentItemsDb.unclusteredItemsExcludingSources(eventSourceIds);
	if (items.length === 0) return 0;

	const categories = categoriesDb.listCategories();
	const rankByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.priorityRank]));

	const ranked = items
		.map((item) => ({ item, rank: primaryCategoryRank(item, rankByName) }))
		.sort((a, b) => a.rank - b.rank)
		.map((r) => r.item);

	const embedded = await embedPendingItems(provider, settings.selectedModels.embedding, ranked);
	const clusters = clusterItems(embedded, settings.mergeStrictness);

	const holdMs = settings.holdBeforePublishMinutes * 60_000;
	let published = 0;
	let pending = 0;
	let earliestRemainingMs = Infinity;

	for (const cluster of clusters) {
		const earliestFetch = Math.min(...cluster.items.map((i) => new Date(i.fetchedAt).getTime()));
		const remaining = holdMs - (Date.now() - earliestFetch);
		if (remaining > 0) {
			pending += cluster.items.length;
			earliestRemainingMs = Math.min(earliestRemainingMs, remaining);
			continue; // left unclustered — reconsidered next cycle, possibly with more corroborating items
		}

		try {
			const article = await publishCluster(provider, settings, cluster);
			contentItemsDb.assignCluster(
				cluster.items.map((i) => i.id),
				cluster.id
			);
			published++;
			logger.info(
				'synthesis',
				`Published "${article.title}" from ${cluster.items.length} source(s)`
			);
		} catch (err) {
			logger.error('synthesis', `Failed to publish cluster: ${(err as Error).message}`);
		}
	}

	if (published === 0 && pending > 0) {
		const minutesLeft = Math.ceil(earliestRemainingMs / 60_000);
		logger.info(
			'synthesis',
			`${pending} item(s) ingested, waiting on hold-before-publish (~${minutesLeft}m remaining on the earliest)`
		);
	}

	return published;
}
