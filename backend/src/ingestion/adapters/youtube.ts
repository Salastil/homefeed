// YouTube is its own ingestion module, deliberately separate from the RSS/Telegram
// adapters: a channel's public Atom feed (no API key needed) is fetched directly, and
// each entry becomes its own single-video article — see pipeline/publish.ts and
// queue/priorityQueue.ts, which route youtube-sourced items straight to publishDirect
// rather than through the LLM clustering/synthesis pipeline. Merging two unrelated
// videos into one AI-rewritten story would make no sense the way merging two outlets'
// coverage of the same news event does.

import Parser from 'rss-parser';
import type { Source } from '../../storage/db/types.js';
import type { SourceAdapter, FetchedItem } from './base.js';
import { logger } from '../../storage/db/logs.js';

type YoutubeEntry = Parser.Item & {
	'media:group'?: {
		'media:description'?: string[];
		'media:thumbnail'?: { $?: { url?: string } }[];
	}[];
};

const parser = new Parser<Record<string, unknown>, YoutubeEntry>({
	customFields: {
		item: [['media:group', 'media:group']]
	}
});

const USER_AGENT = 'Mozilla/5.0 (compatible; HomefeedBot/1.0; self-hosted RSS reader)';
const CHANNEL_ID_RE = /^UC[\w-]{22}$/;

/**
 * Resolves whatever the admin typed into the source's URL field into the channel's
 * Atom feed URL. YouTube's public feed endpoint (no API key needed) only accepts a
 * `channel_id` (the UC... hash) or the legacy `user` parameter — it has no equivalent
 * for the newer `@handle` format, so a handle (or a /c/ or /user/ vanity URL) has to be
 * resolved to its real channel ID first by fetching the channel page and pulling the
 * ID out of it.
 */
async function resolveFeedUrl(source: Source): Promise<string | null> {
	const channelId = source.config?.channelId as string | undefined;
	if (channelId) return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;

	const playlistId = source.config?.playlistId as string | undefined;
	if (playlistId) return `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;

	const raw = source.url?.trim();
	if (!raw) return null;

	if (raw.includes('feeds/videos.xml')) return raw;
	if (CHANNEL_ID_RE.test(raw)) return `https://www.youtube.com/feeds/videos.xml?channel_id=${raw}`;

	const idInUrl = raw.match(/\/channel\/(UC[\w-]{22})/);
	if (idInUrl) return `https://www.youtube.com/feeds/videos.xml?channel_id=${idInUrl[1]}`;

	let pageUrl: string;
	if (/^https?:\/\//i.test(raw)) {
		pageUrl = raw;
	} else if (/youtube\.com|youtu\.be/i.test(raw)) {
		pageUrl = `https://${raw}`;
	} else {
		// A bare handle or legacy username typed on its own, e.g. "PsyopAnime" or "@PsyopAnime".
		pageUrl = `https://www.youtube.com/@${raw.replace(/^@/, '')}`;
	}

	const resolvedId = await resolveChannelIdFromPage(pageUrl);
	if (!resolvedId) {
		logger.warn('youtube', `Couldn't resolve a channel ID from "${raw}" — double-check the handle/URL`);
		return null;
	}
	return `https://www.youtube.com/feeds/videos.xml?channel_id=${resolvedId}`;
}

/** Every YouTube channel page embeds its own canonical channel ID — pulled from either the canonical link tag or the page's inline JSON. */
async function resolveChannelIdFromPage(url: string): Promise<string | null> {
	try {
		const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
		if (!res.ok) return null;
		const html = await res.text();
		const match = html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/\/channel\/(UC[\w-]{22})/);
		return match ? match[1] : null;
	} catch (err) {
		logger.warn('youtube', `Channel page fetch failed for ${url}: ${(err as Error).message}`);
		return null;
	}
}

function extractVideoId(url: string): string | null {
	const match =
		url.match(/[?&]v=([\w-]{6,})/) || url.match(/youtu\.be\/([\w-]{6,})/) || url.match(/\/embed\/([\w-]{6,})/);
	return match ? match[1] : null;
}

function extractDescription(item: YoutubeEntry): string {
	const group = item['media:group']?.[0];
	return group?.['media:description']?.[0] ?? '';
}

function extractThumbnail(item: YoutubeEntry): string | null {
	const group = item['media:group']?.[0];
	return group?.['media:thumbnail']?.[0]?.$?.url ?? null;
}

export const youtubeAdapter: SourceAdapter = {
	async fetch(source: Source): Promise<FetchedItem[]> {
		const url = await resolveFeedUrl(source);
		if (!url) {
			logger.warn('youtube', `Source "${source.name}" has no usable url, channelId, or playlistId configured — skipping`);
			return [];
		}

		const feed = await parser.parseURL(url);
		const items: FetchedItem[] = [];

		for (const item of feed.items) {
			if (!item.link || !item.title) continue;
			const videoId = extractVideoId(item.link);
			const description = extractDescription(item);
			const thumbnail = extractThumbnail(item);

			items.push({
				title: item.title,
				summary: description.slice(0, 500),
				body: description || null,
				images: thumbnail ? [{ url: thumbnail }] : [],
				videos: [
					{
						url: item.link,
						provider: 'youtube',
						embedHtml: videoId ? `https://www.youtube.com/embed/${videoId}` : undefined
					}
				],
				link: item.link,
				publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
				raw: item
			});
		}

		return items;
	}
};
