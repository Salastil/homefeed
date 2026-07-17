import type { InferenceProvider } from '../inference/provider.js';
import type { ContentItem } from '../storage/db/types.js';

const TAG_DELIMITER = '---TAGS---';

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

export async function synthesizeArticle(
	provider: InferenceProvider,
	model: string,
	items: ContentItem[]
): Promise<SynthesisResult> {
	const prompt = buildPrompt(items);
	const raw = await provider.generate(prompt, { model, system: SYSTEM_PROMPT });

	const [body, tagSection] = raw.split(TAG_DELIMITER);
	const tagLabels = (tagSection ?? '')
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t.length > 0 && t.length < 60);

	return { body: body.trim(), tagLabels };
}
