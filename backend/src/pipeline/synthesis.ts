import type { InferenceProvider } from '../inference/provider.js';
import type { ContentItem, MergedArticle } from '../storage/db/types.js';
import { DEFAULT_NUM_CTX, DEFAULT_NUM_PREDICT } from '../inference/ollama-provider.js';
import { logger } from '../storage/db/logs.js';

const TAG_DELIMITER = '---TAGS---';

// Ollama truncates prompts that don't fit its context window by keeping a small prefix
// and dropping everything else in the middle — silently, with no error, and with no
// regard for which sources end up cut (see ollama-provider.ts for the incident that
// prompted this). Rather than relying on that, prompts here are sized to fit
// DEFAULT_NUM_CTX up front: each source/article gets an equal character budget, cut only
// when the whole prompt would otherwise overflow, so every source stays at least
// partially represented (and attributable) instead of some being dropped outright.
// ~4 chars/token is a rough heuristic (no tokenizer available here) — good enough for a
// safety margin, not meant to be exact.
const CHARS_PER_TOKEN = 4;
const RESERVED_OVERHEAD_TOKENS = 300; // system prompt + per-entry headers/formatting
const MAX_INPUT_CHARS = (DEFAULT_NUM_CTX - DEFAULT_NUM_PREDICT - RESERVED_OVERHEAD_TOKENS) * CHARS_PER_TOKEN;
const MIN_ENTRY_CHARS = 300; // floor so a huge cluster/recap doesn't shrink every entry to nothing

function capEntryText(text: string, budgetChars: number): string {
	return text.length > budgetChars ? text.slice(0, budgetChars) + '…' : text;
}

const RECAP_SYSTEM_PROMPT = `You are a neutral news synthesis assistant. Given a chronological list of articles already published about an ongoing tracked event, write a single recap article that:
- Summarizes what has happened across the period covered, in chronological order
- Highlights the most significant developments rather than restating every article
- Stays neutral and factual, without editorializing
- Is 3-5 short paragraphs

After the recap, on a new line, write exactly "${TAG_DELIMITER}" followed by 2-4 short comma-separated topic/entity tags (e.g. proper nouns, named events) that this recap is about. If nothing salient qualifies, leave the tag line empty.`;

const SYSTEM_PROMPT = `You are a neutral news synthesis assistant. Given summaries from multiple news sources describing the same event, write a single original article that:
- Attributes specific claims to the outlet that reported them, using each source's exact name as given below (e.g. if a source is labeled "Source 1 (Reuters)", write "Reuters reported..."). Never invent, guess, or substitute an outlet name that isn't one of the source names actually given below.
- Does not copy phrasing verbatim from any source
- Stays neutral and factual, without editorializing
- Is 2-4 short paragraphs

After the article, on a new line, write exactly "${TAG_DELIMITER}" followed by 2-4 short comma-separated topic/entity tags (e.g. proper nouns, named events) that this article is about. If nothing salient qualifies, leave the tag line empty.`;

export interface SynthesisResult {
	body: string;
	tagLabels: string[];
}

function buildPrompt(items: ContentItem[], sourceNames: Map<string, string>): string {
	const budgetPerItem = Math.max(MIN_ENTRY_CHARS, Math.floor(MAX_INPUT_CHARS / items.length));
	let truncated = 0;
	const entries = items.map((item, i) => {
		// Same fallback publishDirect uses (publish.ts) — body is the full article text
		// when the feed supplies it (e.g. RSS <content:encoded>), summary is a ~500-char
		// blurb. Using summary alone starved the model of real content to synthesize
		// from, so a single-source cluster just echoed the blurb back nearly verbatim.
		const full = item.body || item.summary;
		const text = capEntryText(full, budgetPerItem);
		if (text !== full) truncated++;
		// The label here (not item.sourceId, an opaque internal id the model can't use)
		// is the only real outlet name the model ever sees — without it, a small model
		// has nothing to attribute to and falls back to copying the illustrative outlet
		// names out of its own system prompt instructions instead (seen in production:
		// a single-source item fabricating "Reuters reported..."/"AP notes..." wholesale).
		const name = sourceNames.get(item.sourceId) ?? 'Unknown source';
		return `Source ${i + 1} (${name}):\nTitle: ${item.title}\nSummary: ${text}`;
	});
	if (truncated > 0) {
		logger.warn('synthesis', `Trimmed ${truncated}/${items.length} source article${truncated === 1 ? '' : 's'} to fit the model's context window`);
	}
	return entries.join('\n\n');
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
	items: ContentItem[],
	sourceNames: Map<string, string>
): Promise<SynthesisResult> {
	const prompt = buildPrompt(items, sourceNames);
	const raw = await provider.generate(prompt, { model, system: SYSTEM_PROMPT, numCtx: DEFAULT_NUM_CTX, numPredict: DEFAULT_NUM_PREDICT });
	return parseResult(raw);
}

function buildRecapPrompt(eventName: string, articles: MergedArticle[]): string {
	const budgetPerArticle = Math.max(MIN_ENTRY_CHARS, Math.floor(MAX_INPUT_CHARS / articles.length));
	let truncated = 0;
	const entries = articles.map((article, i) => {
		const body = capEntryText(article.body, budgetPerArticle);
		if (body !== article.body) truncated++;
		return `Article ${i + 1} (published ${article.publishedAt}):\nTitle: ${article.title}\n${body}`;
	});
	if (truncated > 0) {
		logger.warn('events', `Trimmed ${truncated}/${articles.length} recap article bod${truncated === 1 ? 'y' : 'ies'} to fit the model's context window`);
	}
	return `Tracked event: ${eventName}\n\n${entries.join('\n\n')}`;
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
	const raw = await provider.generate(prompt, {
		model,
		system: RECAP_SYSTEM_PROMPT,
		numCtx: DEFAULT_NUM_CTX,
		numPredict: DEFAULT_NUM_PREDICT
	});
	return parseResult(raw);
}
