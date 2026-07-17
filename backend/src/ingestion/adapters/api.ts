import type { Source } from '../../storage/db/types.js';
import type { SourceAdapter, FetchedItem } from './base.js';

function getPath(obj: unknown, path: string): unknown {
	return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as any)[key] : undefined), obj);
}

/**
 * For arbitrary JSON APIs. `source.config.fieldMap` tells the adapter where to find
 * the array of items and each field within an item, e.g.:
 *   { itemsPath: "articles", title: "headline", link: "url", summary: "description", publishedAt: "date" }
 */
export const apiAdapter: SourceAdapter = {
	async fetch(source: Source): Promise<FetchedItem[]> {
		if (!source.url) return [];
		const fieldMap = (source.config.fieldMap as Record<string, string>) ?? {};
		const headers = (source.config.authHeaders as Record<string, string>) ?? {};

		const res = await fetch(source.url, { headers });
		if (!res.ok) throw new Error(`API fetch failed: ${res.status}`);
		const data = await res.json();

		const rawItems = fieldMap.itemsPath ? getPath(data, fieldMap.itemsPath) : data;
		if (!Array.isArray(rawItems)) return [];

		const items: FetchedItem[] = [];
		for (const raw of rawItems) {
			const title = getPath(raw, fieldMap.title ?? 'title');
			const link = getPath(raw, fieldMap.link ?? 'link');
			if (typeof title !== 'string' || typeof link !== 'string') continue;

			items.push({
				title,
				summary: String(getPath(raw, fieldMap.summary ?? 'summary') ?? '').slice(0, 500),
				body: null,
				images: [],
				videos: [],
				link,
				publishedAt: String(getPath(raw, fieldMap.publishedAt ?? 'publishedAt') ?? new Date().toISOString()),
				raw
			});
		}
		return items;
	}
};
