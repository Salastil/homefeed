import type { InferenceProvider } from '../inference/provider.js';
import type { ContentItem, MergedArticle } from '../storage/db/types.js';

const TAG_DELIMITER = '---TAGS---';

const RECAP_SYSTEM_PROMPT = `You are a neutral news synthesis assistant. Given a chronological list of articles already published about an ongoing tracked event, write a single recap article that:
- Summarizes what has happened across the period covered, in chronological order
- Highlights the most significant developments rather than restating every article
- Stays neutral and factual, without editorializing
- Is 3-5 short paragraphs

After the recap, on a new line, write exactly "${TAG_DELIMITER}" followed by 2-4 short comma-separated topic/entity tags (e.g. proper nouns, named events) that this recap is about. If nothing salient qualifies, leave the tag line empty.`;

const SYSTEM_PROMPT = `You are a neutral news synthesis assistant. Given summaries from multiple news sources describing the same event, write a single original article that:
- Attributes specific claims to the outlet that reported them (e.g. "Reuters reported...", "AP notes...")
- Does not copy phrasing verbatim from any source
- Stays neutral and factual, without editorializing
- Is 2-4 short paragraphs

If only one source is provided, lightly rewrite it in your own words rather than merging.

After the article, on a new line, write exactly "${TAG_DELIMITER}" followed by 2-4 short comma-separated topic/entity tags (e.g. proper nouns, named events) that this article is about. If nothing salient qualifies, leave the tag line empty.`;

export interface SynthesisResult {
	body: string;
	tagLabels: string[];
}

function buildPrompt(items: ContentItem[]): string {
	return items
		.map((item, i) => `Source ${i + 1} (${item.sourceId}):\nTitle: ${item.title}\nSummary: ${item.summary}`)
		.join('\n\n');
}

function parseResult(raw: string): SynthesisResult {
	const [body, tagSection] = raw.split(TAG_DELIMITER);
	const tagLabels = (tagSection ?? '')
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t.length > 0 && t.length < 60);

	return { body: body.trim(), tagLabels };
}

export async function synthesizeArticle(
	provider: InferenceProvider,
	model: string,
	items: ContentItem[]
): Promise<SynthesisResult> {
	const prompt = buildPrompt(items);
	const raw = await provider.generate(prompt, { model, system: SYSTEM_PROMPT });
	return parseResult(raw);
}

function buildRecapPrompt(eventName: string, articles: MergedArticle[]): string {
	const entries = articles
		.map((article, i) => `Article ${i + 1} (published ${article.publishedAt}):\nTitle: ${article.title}\n${article.body}`)
		.join('\n\n');
	return `Tracked event: ${eventName}\n\n${entries}`;
}

/**
 * Recaps a period's worth of already-published articles under one tracked event — a
 * different job from synthesizeArticle's same-story dedup (which merges multiple
 * outlets' coverage of ONE story into one article): this summarizes many already-
 * distinct articles about an ONGOING situation into a rolling wrap-up, so it gets its
 * own prompt and reads from already-synthesized article bodies rather than raw feed
 * summaries.
 */
export async function synthesizeRecap(
	provider: InferenceProvider,
	model: string,
	eventName: string,
	articles: MergedArticle[]
): Promise<SynthesisResult> {
	const prompt = buildRecapPrompt(eventName, articles);
	const raw = await provider.generate(prompt, { model, system: RECAP_SYSTEM_PROMPT });
	return parseResult(raw);
}
