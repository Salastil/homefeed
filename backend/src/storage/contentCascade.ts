// Deleting or "clearing" a source shouldn't leave orphaned merged articles behind
// pointing at raw items that no longer exist — this is the one place that coordinates
// content_items, merged_articles, and media_assets together, since none of those three
// tables have a single FK chain connecting them all (see storage/db/index.ts schema
// comments: sources are copied into merged_articles.sources at publish time, not
// referenced live).

import * as contentItemsDb from './db/contentItems.js';
import * as articlesDb from './db/articles.js';
import { deleteMediaByArticleId, deleteMediaByContentItemIds, deleteAllMedia } from './media/index.js';
import { logger } from './db/logs.js';

export interface ClearResult {
	itemsDeleted: number;
	articlesDeleted: number;
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
	const items = contentItemsDb.itemsForSource(sourceId);
	const itemIds = new Set(items.map((i) => i.id));

	let articlesDeleted = 0;
	if (itemIds.size > 0) {
		for (const article of articlesDb.allArticlesNewestFirst()) {
			if (article.sources.length > 0 && article.sources.every((s) => itemIds.has(s.itemId))) {
				deleteMediaByArticleId(article.id);
				articlesDb.deleteArticle(article.id);
				articlesDeleted++;
			}
		}
		deleteMediaByContentItemIds([...itemIds]);
	}

	contentItemsDb.deleteContentItemsForSource(sourceId);
	logger.info('admin', `Cleared content for source ${sourceId}: ${itemIds.size} item(s), ${articlesDeleted} article(s)`);
	return { itemsDeleted: itemIds.size, articlesDeleted };
}

/** Wipes every published article and its media, keeping raw ingested items intact so they can be re-synthesized fresh. */
export function clearAllArticles(): number {
	const articles = articlesDb.allArticlesNewestFirst();
	for (const article of articles) deleteMediaByArticleId(article.id);
	articlesDb.deleteAllArticles();
	logger.info('admin', `Cleared all articles: ${articles.length} removed`);
	return articles.length;
}

/** Wipes every locally-stored media file (both candidate and published tiers). */
export function clearAllMedia(): number {
	const count = deleteAllMedia();
	logger.info('admin', `Cleared all media: ${count} file(s) removed`);
	return count;
}
