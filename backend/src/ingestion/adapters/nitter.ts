// Nitter is its own ingestion module, deliberately separate from the RSS adapter even
// though the transport is RSS: a tweet is enriched with a second fetch to fxtwitter
// (for author name/avatar and cleaner text) and always publishes as its own article —
// see pipeline/publish.ts and queue/priorityQueue.ts, which route nitter-sourced items
// straight to publishDirect rather than the LLM clustering/synthesis pipeline. Merging
// two unrelated tweets into one AI-rewritten story would make no sense the way merging
// two outlets' coverage of the same news event does — same reasoning as YouTube.

import Parser from 'rss-parser';
import type { Source } from '../../storage/db/types.js';
import type { SourceAdapter, FetchedItem } from './base.js';
import { logger } from '../../storage/db/logs.js';
import { getSettings } from '../../storage/db/settings.js';

const parser = new Parser<Record<string, unknown>>();

const USER_AGENT = 'Mozilla/5.0 (compatible; HomefeedBot/1.0; self-hosted RSS reader)';
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Shape confirmed against a real `curl https://api.fxtwitter.com/<handle>/status/<id>`
 * response: `text`, `created_timestamp` (unix seconds), `author.name`/`avatar_url` all
 * verified exactly as read below. `media.photos[].url` is still unconfirmed — that
 * response had no attached photo — but is read with optional chaining regardless, so a
 * shape mismatch there just falls back to the RSS description's own <img> (see
 * fetch()'s photoUrl fallback) rather than breaking ingestion.
 */
interface FxTweet {
	text?: string;
	created_timestamp?: number;
	author?: { name?: string; screen_name?: string; avatar_url?: string };
	media?: { photos?: { url?: string }[] };
}

/**
 * The endpoint is keyed by handle + status ID, e.g. https://api.fxtwitter.com/zerohedge/status/123
 * — no API version prefix. The base URL is admin-configurable (Retention tab) so a
 * self-hosted FixTweet mirror (or another compatible public instance) can be used
 * instead of the public api.fxtwitter.com default.
 */
async function fetchFxTwitter(handle: string, tweetId: string): Promise<FxTweet | null> {
	const baseUrl = getSettings().fxtwitterBaseUrl.replace(/\/+$/, '');
	try {
		const res = await fetch(`${baseUrl}/${handle}/status/${tweetId}`, {
			headers: { 'User-Agent': USER_AGENT },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		if (!res.ok) return null;
		const json = (await res.json()) as { tweet?: FxTweet };
		return json?.tweet ?? null;
	} catch (err) {
		logger.warn('nitter', `fxtwitter enrichment failed for tweet ${tweetId}: ${(err as Error).message}`);
		return null;
	}
}

function extractTweetId(item: Parser.Item): string | null {
	const guid = item.guid;
	if (guid && /^\d+$/.test(guid)) return guid;
	const fromLink = item.link?.match(/status\/(\d+)/)?.[1];
	return fromLink ?? null;
}

/**
 * A Nitter list/user RSS description is the item's own tweet content (a <p> plus
 * optional <img>) followed, for retweets/quote-tweets, by a <blockquote> wrapping the
 * quoted tweet's own text/image/permalink. Only the part before that blockquote is this
 * item's own content — nested quote-tweet rendering isn't part of the approved design.
 */
function ownContentHtml(descriptionHtml: string): string {
	const cut = descriptionHtml.search(/<hr\s*\/?>|<blockquote/i);
	return cut === -1 ? descriptionHtml : descriptionHtml.slice(0, cut);
}

function extractImageUrl(html: string): string | null {
	return html.match(/<img[^>]+src="([^"]+)"/i)?.[1] ?? null;
}

export const nitterAdapter: SourceAdapter = {
	async fetch(source: Source): Promise<FetchedItem[]> {
		if (!source.url) return [];

		const feed = await parser.parseURL(source.url);
		const items: FetchedItem[] = [];

		for (const item of feed.items) {
			if (!item.link || !item.guid) continue;
			const tweetId = extractTweetId(item);
			if (!tweetId) {
				logger.warn('nitter', `Couldn't extract a tweet ID from "${item.link}" — skipping`);
				continue;
			}

			// dc:creator is reliably the author of this item's own tweet text (rss-parser
			// maps it to item.creator) — for a retweet, that's the original tweet's author,
			// not whichever list member's retweet surfaced it in this feed.
			const handle = (item.creator ?? '').replace(/^@/, '') || 'unknown';
			const ownHtml = ownContentHtml(item.content ?? '');
			const rssImageUrl = extractImageUrl(ownHtml);

			const enrichment = await fetchFxTwitter(handle, tweetId);

			const authorName = enrichment?.author?.name ?? handle;
			const avatarUrl = enrichment?.author?.avatar_url ?? null;
			const text = enrichment?.text ?? ownHtml;
			const photoUrl = enrichment?.media?.photos?.[0]?.url ?? rssImageUrl;
			const publishedAt = enrichment?.created_timestamp
				? new Date(enrichment.created_timestamp * 1000).toISOString()
				: (item.isoDate ?? item.pubDate ?? new Date().toISOString());

			items.push({
				title: item.title || text.slice(0, 100),
				summary: text.slice(0, 500),
				body: text,
				images: photoUrl ? [{ url: photoUrl }] : [],
				videos: [],
				link: item.link,
				publishedAt,
				tweet: { id: tweetId, authorName, authorHandle: handle, avatarUrl },
				raw: { rss: item, fxtwitter: enrichment }
			});
		}

		return items;
	}
};
