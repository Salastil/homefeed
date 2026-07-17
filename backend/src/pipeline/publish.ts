import { randomUUID } from 'node:crypto';
import type { InferenceProvider } from '../inference/provider.js';
import type { Cluster } from './clustering.js';
import { synthesizeArticle } from './synthesis.js';
import { selectBestImage } from './image-selection.js';
import { downloadAndStore, promoteToPublished } from '../storage/media/index.js';
import { logger } from '../storage/db/logs.js';
import * as articles from '../storage/db/articles.js';
import * as tags from '../storage/db/tags.js';
import * as sources from '../storage/db/sources.js';
import type { GlobalSettings, MergedArticle, ContentItem } from '../storage/db/types.js';

const FOLLOW_UP_LOOKBACK_DAYS = 3;

function uniqueCategories(items: ContentItem[]): string[] {
	const cats = new Set<string>();
	for (const item of items) {
		const source = sources.getSource(item.sourceId);
		for (const cat of source?.category ?? []) cats.add(cat);
	}
	return [...cats];
}

/** Takes the first line of the synthesized body as a working title until a dedicated title-generation step exists. */
function deriveTitle(body: string): string {
	const firstLine = body.split('\n')[0];
	return firstLine.length > 100 ? firstLine.slice(0, 97) + '…' : firstLine;
}

/**
 * Publishes a single item as-is, with no AI calls at all — used when the AI service
 * isn't reachable (e.g. Ollama hasn't been set up yet, per the "assume it arrives
 * after the backend launches" requirement). No rewriting, no tag extraction, no
 * embedding. This is deliberately a lesser version of the real pipeline: once Ollama
 * is available, newly-ingested items get the full embed/cluster/synthesize treatment
 * and can be linked as follow-ups to these passthrough articles via the normal
 * tag-based thread detection — but these earlier articles aren't retroactively
 * rewritten or merged with anything after the fact.
 */
export async function publishDirect(item: ContentItem): Promise<MergedArticle> {
	const category = uniqueCategories([item]);
	const now = new Date().toISOString();

	let heroImage: MergedArticle['heroImage'] = null;
	if (item.images.length > 0) {
		const stored = await downloadAndStore(item.images[0].url, 'published', {});
		heroImage = stored
			? { url: stored.servedPath, sourceItemId: item.id, selectionReason: 'Only available image (no AI service configured yet)' }
			: { url: item.images[0].url, sourceItemId: item.id, selectionReason: 'Only available image (no AI service configured yet)' };
	}

	const video = item.videos[0] ? { url: item.videos[0].url, provider: item.videos[0].provider, sourceItemId: item.id } : null;

	return articles.insertArticle({
		title: item.title,
		body: item.body || item.summary,
		heroImage,
		video,
		category,
		geo: item.geo,
		eventId: item.eventId,
		sourceCount: 1,
		sources: [
			{
				itemId: item.id,
				sourceName: sources.getSource(item.sourceId)?.name ?? 'Unknown source',
				link: item.link,
				publishedAt: item.publishedAt
			}
		],
		publishedAt: now,
		updatedAt: now,
		mergeConfidence: 1.0,
		tags: [], // no LLM available to extract tags yet — backfilling these later is a reasonable future improvement
		threadId: randomUUID(),
		previousArticleId: null,
		nextArticleId: null
	});
}

/**
 * Publishing is always automatic — there's no draft/review state (see schema doc).
 * A cluster of size 1 publishes as-is via the same path; synthesizeArticle lightly
 * rewrites rather than merges when there's only one source.
 */
export async function publishCluster(
	provider: InferenceProvider,
	settings: GlobalSettings,
	cluster: Cluster,
	opts: { eventId?: string } = {}
): Promise<MergedArticle> {
	const items = cluster.items;

	const { body, tagLabels } = await synthesizeArticle(provider, settings.selectedModels.synthesis, items);

	const resolvedTags = [];
	for (const label of tagLabels) {
		try {
			const embedding = await provider.embed(label, { model: settings.selectedModels.embedding });
			resolvedTags.push(tags.resolveOrCreateTag(label, embedding, settings.tagDedupThreshold));
		} catch (err) {
			logger.error('synthesis', `Tag embedding failed for "${label}": ${(err as Error).message}`);
		}
	}
	const tagIds = resolvedTags.map((t) => t.id);

	const selectedImage = selectBestImage(items);
	let heroImage: MergedArticle['heroImage'] = null;
	let storedMediaId: string | null = null;
	if (selectedImage) {
		const stored = await downloadAndStore(selectedImage.url, 'published', {});
		if (stored) {
			storedMediaId = stored.id;
			heroImage = { url: stored.servedPath, sourceItemId: selectedImage.sourceItemId, selectionReason: selectedImage.selectionReason };
		} else {
			heroImage = selectedImage; // fall back to the hotlinked URL if the download failed, rather than losing the image entirely
		}
	}
	const videoItem = items.find((i) => i.videos.length > 0);
	const video = videoItem
		? { url: videoItem.videos[0].url, provider: videoItem.videos[0].provider, sourceItemId: videoItem.id }
		: null;

	const category = uniqueCategories(items);
	const geo = items.find((i) => i.geo)?.geo ?? null;

	const itemSources = items.map((item) => ({
		itemId: item.id,
		sourceName: sources.getSource(item.sourceId)?.name ?? 'Unknown source',
		link: item.link,
		publishedAt: item.publishedAt
	}));

	// Follow-up detection: only links to a previous article if enough time AND enough
	// new corroborating sources have passed the admin's thresholds (see MergeTab).
	// Otherwise this cluster just becomes its own independent thread — holding items
	// in a "pending, not yet enough to follow up" state is a reasonable future
	// improvement but adds a queue state this MVP doesn't have yet.
	const previous = tagIds.length > 0 ? articles.findRecentArticleByTags(tagIds, FOLLOW_UP_LOOKBACK_DAYS) : null;
	let threadId: string = randomUUID();
	let previousArticleId: string | null = null;

	if (previous) {
		const hoursSince = (Date.now() - new Date(previous.publishedAt).getTime()) / 3600_000;
		const previousLinks = new Set(previous.sources.map((s) => s.link));
		const newSourceCount = itemSources.filter((s) => !previousLinks.has(s.link)).length;

		if (hoursSince >= settings.followUpMinHoursSinceLast && newSourceCount >= settings.followUpMinNewSources) {
			threadId = previous.threadId;
			previousArticleId = previous.id;
		}
	}

	const now = new Date().toISOString();
	const article = articles.insertArticle({
		title: deriveTitle(body),
		body,
		heroImage,
		video,
		category,
		geo,
		eventId: opts.eventId ?? items[0]?.eventId ?? null,
		sourceCount: items.length,
		sources: itemSources,
		publishedAt: now,
		updatedAt: now,
		mergeConfidence: items.length > 1 ? 0.8 : 1.0,
		tags: tagIds,
		threadId,
		previousArticleId,
		nextArticleId: null
	});

	if (storedMediaId) {
		promoteToPublished(storedMediaId, article.id);
	}

	return article;
}
