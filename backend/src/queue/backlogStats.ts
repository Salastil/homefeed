import * as contentItemsDb from '../storage/db/contentItems.js';
import * as sourcesDb from '../storage/db/sources.js';
import * as categoriesDb from '../storage/db/categories.js';
import { clusterItems } from '../pipeline/clustering.js';
import type { ContentItem, GlobalSettings, Source } from '../storage/db/types.js';

interface CycleRecord {
	at: string;
	published: number;
}

let lastDirectCycle: CycleRecord | null = null;
let lastSynthesisCycle: CycleRecord | null = null;

/** Called by priorityQueue.ts at the end of runDirectPublishCycle. */
export function recordDirectPublishCycle(published: number): void {
	lastDirectCycle = { at: new Date().toISOString(), published };
}

/** Called by priorityQueue.ts at the end of runSynthesisCycle. */
export function recordSynthesisCycle(published: number): void {
	lastSynthesisCycle = { at: new Date().toISOString(), published };
}

export function getLastCycles(): { lastDirectCycle: CycleRecord | null; lastSynthesisCycle: CycleRecord | null } {
	return { lastDirectCycle, lastSynthesisCycle };
}

function inAiDisabledCategory(item: ContentItem, disabledNames: Set<string>, sourcesById: Map<string, Source>): boolean {
	const source = sourcesById.get(item.sourceId);
	for (const cat of source?.category ?? []) {
		if (disabledNames.has(cat.split(':')[0].trim().toLowerCase())) return true;
	}
	return false;
}

export interface BacklogSnapshot {
	totalUnclusteredItems: number;
	/** Items that need no AI at all (YouTube/Nitter/Telegram sources, or "No AI" categories) — publish on the next direct-publish tick. */
	directEligibleItems: number;
	/** Mergeable items that haven't been embedded yet (embed() failed/pending, or just ingested since the last synthesis tick). */
	awaitingEmbeddingItems: number;
	clusters: {
		total: number;
		/** Cleared the hold-before-publish window — will publish on the next synthesis tick. */
		readyNow: number;
		/** Of readyNow, clusters with 2+ items — these are the ones that actually need an LLM generate() call (single-item clusters publish verbatim, no AI). */
		readyNowNeedingSynthesis: number;
		/** Still waiting out the hold-before-publish window. */
		onHold: number;
		itemsOnHold: number;
		earliestHoldRemainingMs: number | null;
	};
}

/**
 * Read-only snapshot of the current backlog for the admin dashboard — mirrors the same
 * categorization runDirectPublishCycle/runSynthesisCycle use (priorityQueue.ts), but never
 * calls the AI itself: items with no embedding yet are just counted, not embedded, and
 * clustering only runs over items that already have one (cosine similarity over stored
 * vectors — no network call). Cheap enough to call on every dashboard refresh.
 */
export function getBacklogSnapshot(settings: GlobalSettings): BacklogSnapshot {
	const items = contentItemsDb.unclusteredItemsExcludingSources([]);
	const sourcesById = new Map(sourcesDb.listSources().map((s) => [s.id, s]));
	const categories = categoriesDb.listCategories();

	const directPublishSourceIds = new Set(
		[...sourcesById.values()].filter((s) => s.type === 'youtube' || s.type === 'nitter' || s.type === 'telegram').map((s) => s.id)
	);
	const aiDisabledCategoryNames = new Set(categories.filter((c) => c.disableAi).map((c) => c.name.toLowerCase()));

	const directEligible: ContentItem[] = [];
	const mergeable: ContentItem[] = [];
	for (const item of items) {
		if (directPublishSourceIds.has(item.sourceId) || inAiDisabledCategory(item, aiDisabledCategoryNames, sourcesById)) {
			directEligible.push(item);
		} else {
			mergeable.push(item);
		}
	}

	const awaitingEmbedding = mergeable.filter((item) => !item.embedding);
	const embedded = mergeable.filter((item) => item.embedding);

	const clusters = clusterItems(embedded, settings.mergeStrictness);
	const holdMs = settings.holdBeforePublishMinutes * 60_000;

	let readyNow = 0;
	let readyNowNeedingSynthesis = 0;
	let onHold = 0;
	let itemsOnHold = 0;
	let earliestHoldRemainingMs: number | null = null;

	for (const cluster of clusters) {
		const earliestFetch = Math.min(...cluster.items.map((i) => new Date(i.fetchedAt).getTime()));
		const remaining = holdMs - (Date.now() - earliestFetch);
		if (remaining > 0) {
			onHold++;
			itemsOnHold += cluster.items.length;
			earliestHoldRemainingMs = earliestHoldRemainingMs === null ? remaining : Math.min(earliestHoldRemainingMs, remaining);
		} else {
			readyNow++;
			if (cluster.items.length > 1) readyNowNeedingSynthesis++;
		}
	}

	return {
		totalUnclusteredItems: items.length,
		directEligibleItems: directEligible.length,
		awaitingEmbeddingItems: awaitingEmbedding.length,
		clusters: { total: clusters.length, readyNow, readyNowNeedingSynthesis, onHold, itemsOnHold, earliestHoldRemainingMs }
	};
}
