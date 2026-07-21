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
}

const USER_AGENT = 'Mozilla/5.0 (compatible; HomefeedBot/1.0; self-hosted RSS reader)';
const FETCH_TIMEOUT_MS = 12_000;
const MIN_CONTENT_LENGTH = 200; // below this, Readability probably grabbed a paywall stub or nav junk, not an article

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

		return {
			title: article.title?.trim() ?? '',
			body: article.content ?? article.textContent,
			summary: article.excerpt?.trim() ?? '',
			images
		};
	} catch (err) {
		logger.warn('articleFetcher', `Extraction failed for ${url}: ${(err as Error).message}`);
		return null;
	}
}
