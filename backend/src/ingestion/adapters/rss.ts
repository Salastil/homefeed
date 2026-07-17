import Parser from 'rss-parser';
import type { Source } from '../../storage/db/types.js';
import type { SourceAdapter, FetchedItem } from './base.js';

type RssItem = Parser.Item & {
	'media:content'?: any;
	enclosure?: { url?: string; type?: string };
};

const parser = new Parser<Record<string, unknown>, RssItem>({
	customFields: {
		item: [['media:content', 'media:content']]
	}
});

function extractImages(item: RssItem): FetchedItem['images'] {
	const images: FetchedItem['images'] = [];

	const media = item['media:content'];
	if (media) {
		const entries = Array.isArray(media) ? media : [media];
		for (const m of entries) {
			if (m?.$?.url) {
				images.push({
					url: m.$.url,
					width: m.$.width ? Number(m.$.width) : undefined,
					height: m.$.height ? Number(m.$.height) : undefined
				});
			}
		}
	}

	if (item.enclosure?.url && item.enclosure.type?.startsWith('image/')) {
		images.push({ url: item.enclosure.url });
	}

	return images;
}

function extractVideos(item: RssItem): FetchedItem['videos'] {
	if (item.enclosure?.url && item.enclosure.type?.startsWith('video/')) {
		return [{ url: item.enclosure.url }];
	}
	return [];
}

export const rssAdapter: SourceAdapter = {
	async fetch(source: Source): Promise<FetchedItem[]> {
		if (!source.url) return [];

		const feed = await parser.parseURL(source.url);
		const items: FetchedItem[] = [];

		for (const item of feed.items) {
			if (!item.link || !item.title) continue;
			items.push({
				title: item.title,
				summary: (item.contentSnippet || item.summary || '').slice(0, 500),
				body: item.content ?? null,
				images: extractImages(item),
				videos: extractVideos(item),
				link: item.link,
				publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
				raw: item
			});
		}

		return items;
	}
};
