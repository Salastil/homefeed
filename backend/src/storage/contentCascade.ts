// Deleting or "clearing" a source shouldn't leave orphaned merged articles behind
// pointing at raw items that no longer exist — this is the one place that coordinates
// content_items, merged_articles, and media_assets together, since none of those three
// tables have a single FK chain connecting them all (see storage/db/index.ts schema
// comments: sources are copied into merged_articles.sources at publish time, not
// referenced live).

import * as contentItemsDb from './db/contentItems.js';
import * as articlesDb from './db/articles.js';
import * as sourcesDb from './db/sources.js';
import { inTransaction } from './db/index.js';
import { deleteMediaRowsForArticles, deleteMediaRowsForItems, removeMediaFiles, deleteAllMedia } from './media/index.js';
import { logger, feedOf } from './db/logs.js';

export interface ClearResult {
	itemsDeleted: number;
	articlesDeleted: number;
}

export interface ReissueResult {
	articlesDeleted: number;
	itemsRequeued: number;
}

/**
 * Removes every raw content item ingested from a source, plus any merged article that
 * was composed entirely from that source's items (so it doesn't linger on the site
 * pointing at deleted raw data). Articles that merged this source's coverage together
 * with other sources' are left alone — stripping just this source's contribution back
 * out of an already-published multi-source article isn't something the merge pipeline
 * supports undoing.
 */
export function clearSourceContent(sourceId: string): ClearResult {
	const ctx = feedOf(sourceId);
	const { result, files } = inTransaction(() => clearInside(sourceId));
	removeMediaFiles(files);
	logger.info('admin', `Cleared content for "${ctx.feed}": ${result.itemsDeleted} item(s), ${result.articlesDeleted} article(s)`, ctx);
	return result;
}

/** Deletes a source together with everything it ingested, as one transaction (DELETE /api/admin/sources/:id). */
export function deleteSourceAndContent(sourceId: string): ClearResult {
	// Looked up before the delete, while the source still has a name.
	const ctx = feedOf(sourceId);
	const { result, files } = inTransaction(() => {
		const out = clearInside(sourceId);
		sourcesDb.deleteSource(sourceId);
		return out;
	});
	removeMediaFiles(files);
	logger.info('admin', `Deleted source "${ctx.feed}": ${result.itemsDeleted} item(s), ${result.articlesDeleted} article(s)`, { feed: ctx.feed });
	return result;
}

/** Articles built only from these items - the ones a source's removal must take with it. */
function articlesOnlyFrom(itemIds: Set<string>): string[] {
	if (itemIds.size === 0) return [];
	return articlesDb
		.articleItemRefs()
		.filter((a) => a.itemIds.length > 0 && a.itemIds.every((id) => itemIds.has(id)))
		.map((a) => a.id);
}

function clearInside(sourceId: string): { result: ClearResult; files: string[] } {
	const itemIds = new Set(contentItemsDb.itemIdsForSource(sourceId));
	const articleIds = articlesOnlyFrom(itemIds);
	const files = [...deleteMediaRowsForArticles(articleIds), ...deleteMediaRowsForItems([...itemIds])];
	articlesDb.deleteArticles(articleIds);
	contentItemsDb.deleteContentItemsForSource(sourceId);
	return { result: { itemsDeleted: itemIds.size, articlesDeleted: articleIds.length }, files };
}

/**
 * Deletes a source's already-published articles (and their media) so they can be
 * republished fresh through the current pipeline — unlike clearSourceContent, the raw
 * content_items are kept, since Twitter/RSS feeds don't reliably keep serving the same
 * historical items on the next poll. Reset cluster_id is what makes an item eligible
 * again: the next scheduler tick (poll or synthesis, within about a minute) picks it up
 * and re-publishes it exactly like a newly-ingested item.
 *
 * Same restriction as clearSourceContent: an article merged from this source's items
 * together with other sources' is left alone entirely (and its items stay clustered) —
 * there's no supported way to un-merge just one contributor's share back out of it.
 */
export function reissueSourceContent(sourceId: string): ReissueResult {
	const { articleIds, requeue, files } = inTransaction(() => {
		const itemIds = new Set(contentItemsDb.itemIdsForSource(sourceId));
		const refs = articlesDb.articleItemRefs().filter((a) => a.itemIds.length > 0 && a.itemIds.every((id) => itemIds.has(id)));
		const ids = refs.map((a) => a.id);
		const requeueIds = [...new Set(refs.flatMap((a) => a.itemIds))];
		const paths = deleteMediaRowsForArticles(ids);
		articlesDb.deleteArticles(ids);
		contentItemsDb.resetClusterForItems(requeueIds);
		return { articleIds: ids, requeue: requeueIds, files: paths };
	});
	removeMediaFiles(files);
	const ctx = feedOf(sourceId);
	logger.info('admin', `Reissuing content for "${ctx.feed}": ${articleIds.length} article(s) deleted, ${requeue.length} item(s) requeued`, ctx);
	return { articlesDeleted: articleIds.length, itemsRequeued: requeue.length };
}

/**
 * Deletes one specific article (and its media) and requeues every content item that
 * contributed to it — unlike reissueSourceContent, this works regardless of how many
 * different sources the article merged together, since it's scoped to the article
 * itself rather than "everything from source X". Exists for exactly the failure mode
 * synthesis.ts's assertNonEmpty guards against going forward: a bad synthesis call
 * that already made it into a published (garbage) article before that guard existed,
 * where the source-scoped reissue tools can't help because the article spans sources.
 * Returns null if the article doesn't exist.
 */
export function reissueArticle(articleId: string): ReissueResult | null {
	const article = articlesDb.getArticle(articleId);
	if (!article) return null;

	const itemIds = article.sources.map((s) => s.itemId);
	const files = inTransaction(() => {
		const paths = deleteMediaRowsForArticles([article.id]);
		articlesDb.deleteArticle(article.id);
		contentItemsDb.resetClusterForItems(itemIds);
		return paths;
	});
	removeMediaFiles(files);

	logger.info('admin', `Reissuing article ${articleId}: deleted, ${itemIds.length} item(s) requeued`);
	return { articlesDeleted: 1, itemsRequeued: itemIds.length };
}

/** Wipes every published article and its media, keeping raw ingested items intact so they can be re-synthesized fresh. */
export function clearAllArticles(): number {
	const { count, files } = inTransaction(() => {
		const ids = articlesDb.articleItemRefs().map((a) => a.id);
		const paths = deleteMediaRowsForArticles(ids);
		articlesDb.deleteAllArticles();
		return { count: ids.length, files: paths };
	});
	removeMediaFiles(files);
	logger.info('admin', `Cleared all articles: ${count} removed`);
	return count;
}

/** Wipes every locally-stored media file (both candidate and published tiers). */
export function clearAllMedia(): number {
	const count = deleteAllMedia();
	logger.info('admin', `Cleared all media: ${count} file(s) removed`);
	return count;
}
