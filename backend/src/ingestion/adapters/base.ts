import type { Source, ContentItem } from '../../storage/db/types.js';

export interface FetchedItem {
	title: string;
	summary: string;
	body: string | null;
	images: { url: string; caption?: string; width?: number; height?: number }[];
	videos: { url: string; provider?: string; embedHtml?: string }[];
	link: string;
	publishedAt: string;
	raw: unknown;
}

export interface SourceAdapter {
	/** Fetches and normalizes new items from this source. Should not throw on individual bad items. */
	fetch(source: Source): Promise<FetchedItem[]>;
}

export function toContentItem(source: Source, item: FetchedItem): Omit<ContentItem, 'id'> {
	return {
		sourceId: source.id,
		type: 'article',
		title: item.title,
		summary: item.summary,
		body: item.body,
		images: item.images,
		videos: item.videos,
		link: item.link,
		publishedAt: item.publishedAt,
		fetchedAt: new Date().toISOString(),
		tags: [],
		geo: source.category.some((c) => c.toLowerCase().startsWith('local')) ? extractGeoTag(source) : null,
		embedding: null,
		eventId: null,
		clusterId: null,
		raw: item.raw
	};
}

function extractGeoTag(source: Source): string | null {
	// Sources assigned to a LocalRegion carry a "Local: X" category by convention in the
	// admin panel (see SourcesTab). Real geo-tagging comes from LocalRegion.sourceIds
	// membership; this is a lightweight fallback derived from the category label.
	const match = source.category.find((c) => c.toLowerCase().startsWith('local'));
	if (!match) return null;
	const parts = match.split(':');
	return parts[1]?.trim().toLowerCase().replace(/\s+/g, '-') ?? null;
}
