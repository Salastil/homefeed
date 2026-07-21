import type { ContentItem } from '../storage/db/types.js';

export interface SelectedImage {
	url: string;
	sourceItemId: string;
	selectionReason: string;
}

/**
 * Picks the best candidate image across a cluster's items. Currently a fast heuristic
 * (largest reported resolution, first-seen as tiebreak) rather than a vision-model call —
 * cheap, deterministic, and good enough for most cases. A vision model (via the same
 * Ollama connection) could replace this later for cases where resolution alone picks
 * a poor crop or an image with a watermark; that requires downloading image bytes to
 * pass to the model, which is a larger change than swapping this function's internals.
 */
export function selectBestImage(items: ContentItem[]): SelectedImage | null {
	let best: { image: ContentItem['images'][number]; item: ContentItem; area: number } | null = null;

	for (const item of items) {
		for (const image of item.images) {
			const area = (image.width ?? 0) * (image.height ?? 0);
			if (!best || area > best.area) {
				best = { image, item, area };
			}
		}
	}

	if (!best) return null;

	const reason =
		best.area > 0
			? `Highest-resolution candidate (${best.image.width}x${best.image.height}) among ${items.length} source(s)`
			: `First available image among ${items.length} source(s)`;

	return { url: best.image.url, sourceItemId: best.item.id, selectionReason: reason };
}

/**
 * Best-effort favicon URL for a link's origin — used as a hero-image fallback when a
 * feed article has no image or video art of its own, rather than than a placeholder.
 * Doesn't parse the page's <head> for a <link rel="icon">; just tries the conventional
 * /favicon.ico path, which covers most sites without needing an extra HTTP round trip.
 */
export function faviconUrlFor(link: string): string | null {
	try {
		return `${new URL(link).origin}/favicon.ico`;
	} catch {
		return null;
	}
}
