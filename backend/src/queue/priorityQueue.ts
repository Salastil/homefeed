import type { InferenceProvider } from '../inference/provider.js';
import * as contentItemsDb from '../storage/db/contentItems.js';
import * as sourcesDb from '../storage/db/sources.js';
import * as categoriesDb from '../storage/db/categories.js';
import * as eventsDb from '../storage/db/events.js';
import { embedPendingItems } from '../pipeline/embedding.js';
import { clusterItems } from '../pipeline/clustering.js';
import { publishCluster, publishDirect } from '../pipeline/publish.js';
import { logger } from '../storage/db/logs.js';
import type { GlobalSettings, ContentItem, TrackedEvent, Source } from '../storage/db/types.js';

function partition<T>(items: T[], predicate: (item: T) => boolean): [T[], T[]] {
	const matches: T[] = [];
	const rest: T[] = [];
	for (const item of items) (predicate(item) ? matches : rest).push(item);
	return [matches, rest];
}

/**
 * A tracked event is a displayed category like any other — matching items publish
 * normally (individually or merged with same-story coverage, exactly like regular
 * news), just tagged with the event's id so they're browsable under it and so
 * eventsRecap.ts can periodically write an AI wrap-up from them. An item only counts as
 * "claimed" if it belongs to one of the event's sources AND matches its keyword filter
 * (e.g. a general Middle-East feed assigned to an "Iran war" event, but this particular
 * item doesn't mention Iran, just isn't part of that event — it still publishes, only
 * without the tag).
 */
function claimedEventId(item: ContentItem, events: TrackedEvent[]): string | null {
	const match = events.find((e) => e.sourceIds.includes(item.sourceId) && eventsDb.itemMatchesEventKeywords(item, e.keywords));
	return match?.id ?? null;
}

function primaryCategoryRank(item: ContentItem, rankByName: Map<string, number>, sourcesById: Map<string, Source>): number {
	const source = sourcesById.get(item.sourceId);
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

/** True if any of the item's source's categories (same leading-segment match as primaryCategoryRank) has AI disabled. */
function inAiDisabledCategory(item: ContentItem, disabledNames: Set<string>, sourcesById: Map<string, Source>): boolean {
	const source = sourcesById.get(item.sourceId);
	for (const cat of source?.category ?? []) {
		const leading = cat.split(':')[0].trim().toLowerCase();
		if (disabledNames.has(leading)) return true;
	}
	return false;
}

/**
 * Shared by both the passthrough (no-AI) and synthesis direct-publish paths — same
 * publish-then-tag-then-log/error shape, differing only in how the success/failure
 * message describes why the item skipped merging.
 */
async function publishItemsDirect(
	items: ContentItem[],
	settings: GlobalSettings,
	activeEvents: TrackedEvent[],
	describeSuccess: (item: ContentItem) => string,
	failureLabel: string
): Promise<number> {
	let published = 0;
	for (const item of items) {
		try {
			const eventId = claimedEventId(item, activeEvents) ?? undefined;
			const article = await publishDirect(item, settings, { eventId });
			contentItemsDb.assignCluster([item.id], article.id);
			published++;
			logger.info('synthesis', `Published "${article.title}" directly (${describeSuccess(item)})`);
		} catch (err) {
			logger.error('synthesis', `${failureLabel} for "${item.title}": ${(err as Error).message}`);
		}
	}
	return published;
}

/**
 * Fallback for when the AI service isn't reachable yet — publishes every eligible item
 * immediately rather than leaving pages empty until Ollama is set up. Unlike the AI
 * pipeline, this doesn't wait out the hold-before-publish window: that window exists to
 * give corroborating sources time to arrive before an AI merge locks in, which doesn't
 * apply here since there's no merging happening at all — each item is just itself.
 * Still respects category priority. Harmless overlap with runDirectPublishCycle (which
 * runs regardless of reachability) — an item already published by one is simply gone
 * from the other's next "unclustered" query, since assignCluster lands before either
 * moves on to its next item.
 */
export async function runPassthroughCycle(settings: GlobalSettings): Promise<number> {
	const activeEvents = eventsDb.listActiveEvents();
	const items = contentItemsDb.unclusteredItemsExcludingSources([]);
	if (items.length === 0) return 0;

	const sourcesById = new Map(sourcesDb.listSources().map((s) => [s.id, s]));
	const categories = categoriesDb.listCategories();
	const rankByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.priorityRank]));
	const ranked = items
		.map((item) => ({ item, rank: primaryCategoryRank(item, rankByName, sourcesById) }))
		.sort((a, b) => a.rank - b.rank)
		.map((r) => r.item);

	return publishItemsDirect(ranked, settings, activeEvents, () => 'no AI available', 'Passthrough publish failed');
}

/**
 * Publishes every item that never needs the AI at all: YouTube/Nitter/Telegram items
 * (always their own article, merge or no merge) and items whose category has "No AI"
 * set (Category priority admin pane). Deliberately its own guarded tick in scheduler.ts,
 * separate from runSynthesisCycle — these items have no reason to wait behind a slow AI
 * merge backlog (a generate() call can run minutes on CPU-only inference; see
 * ollama-provider.ts), and runSynthesisCycle's own reentrancy guard used to make them
 * do exactly that: stuck for however long the current cycle's clustering/synthesis
 * portion took, since both used to run under one guarded function. Runs regardless of
 * Ollama's reachability — nothing here calls the AI.
 */
export async function runDirectPublishCycle(settings: GlobalSettings): Promise<number> {
	const activeEvents = eventsDb.listActiveEvents();
	const items = contentItemsDb.unclusteredItemsExcludingSources([]);
	if (items.length === 0) return 0;

	const sourcesById = new Map(sourcesDb.listSources().map((s) => [s.id, s]));
	const categories = categoriesDb.listCategories();

	const directPublishSourceIds = new Set(
		[...sourcesById.values()].filter((s) => s.type === 'youtube' || s.type === 'nitter' || s.type === 'telegram').map((s) => s.id)
	);
	const [typeDirectItems, remaining] = partition(items, (item) => directPublishSourceIds.has(item.sourceId));

	const aiDisabledCategoryNames = new Set(categories.filter((c) => c.disableAi).map((c) => c.name.toLowerCase()));
	const [categoryDirectItems] = partition(remaining, (item) => inAiDisabledCategory(item, aiDisabledCategoryNames, sourcesById));

	const publishedTypeDirect = await publishItemsDirect(
		typeDirectItems,
		settings,
		activeEvents,
		(item) => sourcesById.get(item.sourceId)?.type ?? 'unknown',
		'Direct publish failed'
	);

	const publishedCategoryDirect = await publishItemsDirect(
		categoryDirectItems,
		settings,
		activeEvents,
		() => 'AI disabled for category',
		'Direct publish failed'
	);

	return publishedTypeDirect + publishedCategoryDirect;
}

/**
 * One pass of the synthesis queue: cluster whatever's unclustered (excluding items
 * runDirectPublishCycle already owns — see there), ordered by admin-defined category
 * priority, and publish clusters that have cleared the hold-before-publish window.
 * Items claimed by an active tracked event (belonging to one of its sources and
 * matching its keyword filter, if any) publish exactly like everything else —
 * individually or merged with same-story coverage — just tagged with the event's id so
 * they're browsable under it and eligible for eventsRecap.ts's periodic AI wrap-up.
 */
export async function runSynthesisCycle(provider: InferenceProvider, settings: GlobalSettings): Promise<number> {
	const activeEvents = eventsDb.listActiveEvents();
	const items = contentItemsDb.unclusteredItemsExcludingSources([]);
	if (items.length === 0) return 0;

	// One fetch of the full source list per cycle, reused below for both the
	// direct-publish exclusion and each item's category/rank lookups — avoids a
	// separate sourcesDb.getSource() round-trip per item.
	const sourcesById = new Map(sourcesDb.listSources().map((s) => [s.id, s]));
	const categories = categoriesDb.listCategories();
	const rankByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.priorityRank]));

	// YouTube/Nitter/Telegram items and AI-disabled-category items are runDirectPublishCycle's
	// job (its own guarded tick, so a slow merge backlog here never blocks them) — excluded
	// here too since a batch just ingested this instant may still be unclustered when this
	// runs before that cycle's own pass gets to it.
	const directPublishSourceIds = new Set(
		[...sourcesById.values()].filter((s) => s.type === 'youtube' || s.type === 'nitter' || s.type === 'telegram').map((s) => s.id)
	);
	const aiDisabledCategoryNames = new Set(categories.filter((c) => c.disableAi).map((c) => c.name.toLowerCase()));
	const mergeableItems = items.filter(
		(item) => !directPublishSourceIds.has(item.sourceId) && !inAiDisabledCategory(item, aiDisabledCategoryNames, sourcesById)
	);

	const ranked = mergeableItems
		.map((item) => ({ item, rank: primaryCategoryRank(item, rankByName, sourcesById) }))
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
			// A cluster's event tag comes from whichever of its items (if any) is claimed —
			// in practice a cluster's items are all near-duplicate coverage of the same
			// story, so they'd all match the same event's filter anyway when they match at all.
			const eventId = cluster.items.map((i) => claimedEventId(i, activeEvents)).find((id) => id !== null) ?? undefined;
			// A single-item cluster has nothing to merge — publish the source's own text
			// verbatim instead of asking the LLM to "lightly rewrite" it, which only risked
			// introducing errors (or fabricated attribution — see synthesis.ts) with no
			// actual synthesis to justify the risk.
			const article =
				cluster.items.length === 1
					? await publishDirect(cluster.items[0], settings, { eventId })
					: await publishCluster(provider, settings, cluster, { eventId });
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
