// Nitter is its own ingestion module, deliberately separate from the RSS adapter even
// though the transport is RSS: a tweet is enriched with a second fetch to fxtwitter
// (for author name/avatar and cleaner text) and always publishes as its own article —
// see pipeline/publish.ts and queue/priorityQueue.ts, which route nitter-sourced items
// straight to publishDirect rather than the LLM clustering/synthesis pipeline. Merging
// two unrelated tweets into one AI-rewritten story would make no sense the way merging
// two outlets' coverage of the same news event does — same reasoning as YouTube.

import Parser from 'rss-parser';
import type { Source, TweetMediaItem } from '../../storage/db/types.js';
import type { SourceAdapter, FetchedItem } from './base.js';
import { logger } from '../../storage/db/logs.js';
import { getSettings } from '../../storage/db/settings.js';

/** fxtwitter caps a tweet at 4 attached photos/videos/gifs, in tweet display order. */
const MAX_TWEET_MEDIA = 4;

const parser = new Parser<Record<string, unknown>>();

const USER_AGENT = 'Mozilla/5.0 (compatible; HomefeedBot/1.0; self-hosted RSS reader)';
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Shape confirmed against two real `curl https://api.fxtwitter.com/<handle>/status/<id>`
 * responses: `text`, `created_timestamp` (unix seconds), `author.name`/`avatar_url`, and
 * (from a second, video-attached tweet) `media.all[]` — an ordered array covering both
 * photos and videos, each with `type` ('photo' | 'video' | 'gif'), `url` (the direct
 * playable/displayable URL — for video this is a real .mp4, not the .m3u8 playlist also
 * present under `formats`), `thumbnail_url` (video/gif poster frame), and `width`/`height`.
 * `media.all` is preferred over `media.photos`/`media.videos` since it's the only field
 * that preserves the tweet's original media order.
 */
interface FxTweetMedia {
	type?: string;
	url?: string;
	thumbnail_url?: string;
	width?: number;
	height?: number;
}

interface FxTweet {
	text?: string;
	created_timestamp?: number;
	author?: { name?: string; screen_name?: string; avatar_url?: string };
	media?: { all?: FxTweetMedia[]; photos?: FxTweetMedia[] };
}

/** Maps fxtwitter's media shape to our own, capped at the 4 items a tweet can carry. */
function toTweetMedia(enrichment: FxTweet | null): TweetMediaItem[] {
	const items = enrichment?.media?.all ?? enrichment?.media?.photos ?? [];
	return items.slice(0, MAX_TWEET_MEDIA).map((m): TweetMediaItem => ({
		type: m.type === 'video' || m.type === 'gif' ? m.type : 'photo',
		url: m.url ?? '',
		thumbnailUrl: m.thumbnail_url ?? null,
		width: m.width ?? null,
		height: m.height ?? null
	})).filter((m) => m.url);
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

			// dc:creator (rss-parser maps it to item.creator) is actually whichever list
			// member's retweet/reply surfaced this item in the feed — NOT the original
			// tweet's author for a retweet. It's only used here to look up the fxtwitter
			// enrichment (fxtwitter needs *a* handle + the tweet ID, and any handle works
			// for that lookup); the author identity actually displayed always comes from
			// the enrichment response below, keyed consistently off the same tweet — so
			// name and handle never end up describing two different people.
			const rssHandle = (item.creator ?? '').replace(/^@/, '') || 'unknown';
			const ownHtml = ownContentHtml(item.content ?? '');
			const rssImageUrl = extractImageUrl(ownHtml);

			const enrichment = await fetchFxTwitter(rssHandle, tweetId);

			const authorName = enrichment?.author?.name ?? rssHandle;
			const handle = enrichment?.author?.screen_name ?? rssHandle;
			const avatarUrl = enrichment?.author?.avatar_url ?? null;
			const text = enrichment?.text ?? ownHtml;
			// Enrichment failed (or came back with no media) — fall back to the RSS
			// description's own <img> as a single photo, same as before multi-media support.
			const media = toTweetMedia(enrichment);
			if (media.length === 0 && rssImageUrl) {
				media.push({ type: 'photo', url: rssImageUrl, thumbnailUrl: null, width: null, height: null });
			}
			const publishedAt = enrichment?.created_timestamp
				? new Date(enrichment.created_timestamp * 1000).toISOString()
				: (item.isoDate ?? item.pubDate ?? new Date().toISOString());

			items.push({
				title: item.title || text.slice(0, 100),
				summary: text.slice(0, 500),
				body: text,
				images: [],
				videos: [],
				link: item.link,
				publishedAt,
				tweet: { id: tweetId, authorName, authorHandle: handle, avatarUrl, media },
				raw: { rss: item, fxtwitter: enrichment }
			});
		}

		return items;
	}
};
