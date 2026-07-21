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

/** Builds the channel's Atom feed URL — YouTube publishes these publicly with no API key required. */
function feedUrl(source: Source): string | null {
	if (source.url) return source.url;
	const channelId = source.config?.channelId as string | undefined;
	if (channelId) return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
	const playlistId = source.config?.playlistId as string | undefined;
	if (playlistId) return `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
	return null;
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
		const url = feedUrl(source);
		if (!url) {
			logger.warn('youtube', `Source "${source.name}" has no url, channelId, or playlistId configured — skipping`);
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
