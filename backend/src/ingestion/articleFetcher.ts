// RSS descriptions are frequently truncated teasers, or mangled with ad markup —
// not the actual article. This follows the item's link and extracts the real page
// content using the same approach Firefox Reader View uses (Mozilla's Readability),
// which strips nav/ads/sidebars and keeps just the article itself.

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { logger } from '../storage/db/logs.js';

export interface ExtractedArticle {
	title: string;
	/** Raw extracted HTML — cleaned centrally by ingestion/clean.ts via toContentItem, same as feed content. */
	body: string;
	summary: string;
	images: { url: string }[];
	videos: { url: string }[];
}

const USER_AGENT = 'Mozilla/5.0 (compatible; HomefeedBot/1.0; self-hosted RSS reader)';
const FETCH_TIMEOUT_MS = 12_000;
const VIDEO_CHECK_TIMEOUT_MS = 6_000;
const MIN_CONTENT_LENGTH = 200; // below this, Readability probably grabbed a paywall stub or nav junk, not an article

/**
 * Finds a schema.org VideoObject's contentUrl in a parsed JSON-LD node — recursing into
 * @graph since some sites (e.g. WordPress-based ones) nest multiple typed entities
 * under a single top-level graph rather than one script tag per entity. Rejects a
 * contentUrl that's just the page's own URL — not every site follows the spec; NBC
 * stations, for one, put their article URL there instead of an actual media file, which
 * would otherwise get treated as "found" a video that isn't really one.
 */
function findVideoObjectContentUrl(node: unknown, pageUrl: string): string | null {
	if (!node || typeof node !== 'object') return null;
	const obj = node as Record<string, unknown>;
	const type = obj['@type'];
	const isVideoObject = type === 'VideoObject' || (Array.isArray(type) && type.includes('VideoObject'));
	if (isVideoObject && typeof obj.contentUrl === 'string') {
		try {
			const resolved = new URL(obj.contentUrl, pageUrl).toString();
			if (resolved !== new URL(pageUrl).toString()) return resolved;
		} catch {
			// malformed contentUrl — fall through and keep looking
		}
	}
	if (Array.isArray(obj['@graph'])) {
		for (const child of obj['@graph'] as unknown[]) {
			const found = findVideoObjectContentUrl(child, pageUrl);
			if (found) return found;
		}
	}
	return null;
}

function extractJsonLdVideoUrl(doc: Document, pageUrl: string): string | null {
	const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
	for (const script of scripts) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(script.textContent ?? '');
		} catch {
			continue;
		}
		const candidates = Array.isArray(parsed) ? parsed : [parsed];
		for (const node of candidates) {
			const found = findVideoObjectContentUrl(node, pageUrl);
			if (found) return found;
		}
	}
	return null;
}

/**
 * A JSON-LD contentUrl is a claim, not a guarantee — some sites (deliberately or not)
 * point it at an HLS manifest, a login-gated stream, or other unplayable-by-us content
 * instead of a plain file. A HEAD check confirming an actual video/* response is enough
 * to catch the common failure modes without fetching the (potentially large) file itself.
 */
async function looksLikePlayableVideoFile(url: string): Promise<boolean> {
	try {
		const res = await fetch(url, {
			method: 'HEAD',
			headers: { 'User-Agent': USER_AGENT },
			signal: AbortSignal.timeout(VIDEO_CHECK_TIMEOUT_MS)
		});
		return res.ok && (res.headers.get('content-type') ?? '').startsWith('video/');
	} catch {
		return false;
	}
}

/**
 * Returns null (rather than throwing) on any failure — the caller falls back to the
 * feed's own title/description, which is far better than losing the item entirely.
 * Real-world scraping fails constantly (paywalls, bot detection, JS-rendered pages,
 * odd markup) — that's expected, not exceptional.
 */
export async function fetchFullArticle(url: string): Promise<ExtractedArticle | null> {
	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		if (!res.ok) {
			logger.warn('articleFetcher', `${url} responded ${res.status} — falling back to feed summary`);
			return null;
		}

		const contentType = res.headers.get('content-type') ?? '';
		if (!contentType.includes('html')) {
			logger.warn('articleFetcher', `${url} is not HTML (${contentType}) — falling back to feed summary`);
			return null;
		}

		const html = await res.text();
		const dom = new JSDOM(html, { url });
		const doc = dom.window.document;

		const ogImage =
			doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ??
			doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
		// Must run before Readability.parse() — it strips <script> tags (among other
		// non-content elements) from the live document as part of extracting the
		// article body, so the JSON-LD would already be gone if read afterward.
		const jsonLdVideoUrl = extractJsonLdVideoUrl(doc, url);

		const reader = new Readability(doc);
		const article = reader.parse();

		if (!article || !article.textContent || article.textContent.trim().length < MIN_CONTENT_LENGTH) {
			logger.warn('articleFetcher', `Couldn't extract usable content from ${url} — falling back to feed summary`);
			return null;
		}

		const images: { url: string }[] = [];
		if (ogImage) {
			try {
				images.push({ url: new URL(ogImage, url).toString() });
			} catch {
				// malformed og:image URL — just skip it, not worth failing the whole extraction over
			}
		}

		const videos: { url: string }[] = [];
		if (jsonLdVideoUrl && (await looksLikePlayableVideoFile(jsonLdVideoUrl))) {
			videos.push({ url: jsonLdVideoUrl });
		}

		return {
			title: article.title?.trim() ?? '',
			body: article.content ?? article.textContent,
			summary: article.excerpt?.trim() ?? '',
			images,
			videos
		};
	} catch (err) {
		logger.warn('articleFetcher', `Extraction failed for ${url}: ${(err as Error).message}`);
		return null;
	}
}
