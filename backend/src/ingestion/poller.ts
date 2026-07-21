import * as sourcesDb from '../storage/db/sources.js';
import * as contentItemsDb from '../storage/db/contentItems.js';
import { logger } from '../storage/db/logs.js';
import { rssAdapter } from './adapters/rss.js';
import { telegramAdapter } from './adapters/telegram.js';
import { apiAdapter } from './adapters/api.js';
import { toContentItem, type SourceAdapter, type FetchedItem } from './adapters/base.js';
import { fetchFullArticle } from './articleFetcher.js';
import type { Source } from '../storage/db/types.js';

const adapters: Record<Source['type'], SourceAdapter> = {
	rss: rssAdapter,
	telegram: telegramAdapter,
	api: apiAdapter,
	custom: apiAdapter
};

// Which source types point at a real webpage worth following for the full article,
// as opposed to Telegram where the message itself *is* the content.
const FOLLOWS_LINK_FOR_FULL_ARTICLE: Source['type'][] = ['rss', 'api'];

export async function pollDueSources(defaultIntervalMinutes: number): Promise<number> {
	const due = sourcesDb.sourcesDueForPoll(defaultIntervalMinutes);
	let ingested = 0;
	for (const source of due) {
		ingested += await pollOne(source);
	}
	return ingested;
}

/** Polls a single source immediately, bypassing its schedule — used right after a source is created. */
export async function pollSourceNow(source: Source): Promise<number> {
	return pollOne(source);
}

async function pollOne(source: Source): Promise<number> {
	const adapter = adapters[source.type];
	let ingested = 0;
	try {
		const fetched = await adapter.fetch(source);
		for (const item of fetched) {
			if (contentItemsDb.existsByLink(item.link)) continue;

			const finalItem = FOLLOWS_LINK_FOR_FULL_ARTICLE.includes(source.type) ? await withFullArticle(item) : item;

			contentItemsDb.insertContentItem(toContentItem(source, finalItem));
			ingested++;
		}
		sourcesDb.markPolled(source.id, null);
		logger.info('poller', `Polled "${source.name}" (${source.type}) — ${ingested} new item(s)`);
	} catch (err) {
		const message = (err as Error).message;
		logger.error('poller', `Source "${source.name}" failed: ${message}`);
		sourcesDb.markPolled(source.id, message);
	}
	return ingested;
}

/**
 * Follows the item's link and replaces the feed's own title/summary/body/images with
 * the actual extracted article, per the "capture the real article, not the RSS teaser"
 * requirement. Falls back to the feed's own fields untouched if extraction fails.
 */
async function withFullArticle(item: FetchedItem): Promise<FetchedItem> {
	const full = await fetchFullArticle(item.link);
	if (!full) {
		logger.warn('poller', `Using feed summary for "${item.title}" (full article capture failed)`);
		return item;
	}

	logger.info('poller', `Captured full article for "${full.title || item.title}"`);
	return {
		...item,
		title: full.title || item.title,
		summary: full.summary || item.summary,
		body: full.body || item.body,
		images: full.images.length > 0 ? full.images : item.images
	};
}
