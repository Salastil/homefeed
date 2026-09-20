import * as sourcesDb from '../storage/db/sources.js';
import * as contentItemsDb from '../storage/db/contentItems.js';
import { logger } from '../storage/db/logs.js';
import { rssAdapter } from './adapters/rss.js';
import { telegramAdapter } from './adapters/telegram.js';
import { apiAdapter } from './adapters/api.js';
import { youtubeAdapter } from './adapters/youtube.js';
import { nitterAdapter } from './adapters/nitter.js';
import { toContentItem, type SourceAdapter, type FetchedItem } from './adapters/base.js';
import { fetchFullArticle } from './articleFetcher.js';
import type { Source } from '../storage/db/types.js';

const adapters: Record<Source['type'], SourceAdapter> = {
	rss: rssAdapter,
	telegram: telegramAdapter,
	api: apiAdapter,
	youtube: youtubeAdapter,
	nitter: nitterAdapter
};

// Which source types point at a real webpage worth following for the full article,
// as opposed to Telegram where the message itself *is* the content.
const FOLLOWS_LINK_FOR_FULL_ARTICLE: Source['type'][] = ['rss', 'api'];

// Not every adapter bounds its own network call: rss/api/telegram had no timeout at all
// (only nitter, youtube and articleFetcher did), and the Telegram one rides a long-lived
// MTProto connection whose calls simply never return if that connection is half-dead —
// TCP up, no reply. Since pollDueSources walks sources sequentially, one such call takes
// down ingestion entirely: every source behind it is never reached, the tick's promise
// never settles, and scheduler.ts's overlap guard then skips every later tick forever.
// That is exactly how polling stopped dead after "NBC10" and stayed dead for two days
// without logging a thing. A try/catch cannot help here — a hang never rejects.
const SOURCE_FETCH_TIMEOUT_MS = 30_000;

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
	// The losing promise can't be cancelled (adapters don't uniformly accept an
	// AbortSignal, and gramJS has no per-call abort), so it's left pending — but its
	// eventual rejection is swallowed explicitly, since an unhandled rejection surfacing
	// minutes after we stopped waiting would take the whole process down under Node's
	// default policy. Leaking one abandoned promise beats wedging ingestion.
	work.catch(() => {});
	let timer: NodeJS.Timeout;
	return Promise.race([
		work.finally(() => clearTimeout(timer)),
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
			// Never hold the process open just for this timer.
			timer.unref();
		})
	]);
}

export async function pollDueSources(): Promise<number> {
	const due = sourcesDb.sourcesDueForPoll();
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
		const fetched = await withTimeout(
			adapter.fetch(source),
			SOURCE_FETCH_TIMEOUT_MS,
			`${source.type} fetch for "${source.name}"`
		);
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
		images: full.images.length > 0 ? full.images : item.images,
		videos: full.videos.length > 0 ? full.videos : item.videos
	};
}
