import type { Source, ContentItem } from '../../storage/db/types.js';
import { cleanHtml, toSummary } from '../clean.js';

export interface FetchedItem {
	title: string;
	summary: string;
	body: string | null;
	images: { url: string; caption?: string; width?: number; height?: number }[];
	videos: { url: string; provider?: string; embedHtml?: string }[];
	link: string;
	publishedAt: string;
	/** Set by the Nitter adapter only — carries the tweet's author info through to ContentItem.tweet. */
	tweet?: { id: string; authorName: string; authorHandle: string; avatarUrl: string | null };
	raw: unknown;
}

export interface SourceAdapter {
	/** Fetches and normalizes new items from this source. Should not throw on individual bad items. */
	fetch(source: Source): Promise<FetchedItem[]>;
}

export function toContentItem(source: Source, item: FetchedItem): Omit<ContentItem, 'id'> {
	// Feed content is frequently raw (or double-escaped) HTML — cleaned here once,
	// centrally, so every adapter (RSS, API, Telegram once implemented) benefits
	// without each needing its own cleanup logic.
	const cleanBody = item.body ? cleanHtml(item.body) : null;
	const cleanSummary = cleanHtml(item.summary) || (cleanBody ? toSummary(cleanBody) : '');

	return {
		sourceId: source.id,
		type: 'article',
		title: cleanHtml(item.title) || item.title,
		summary: cleanSummary,
		body: cleanBody,
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
		tweet: item.tweet ? { ...item.tweet } : null,
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
