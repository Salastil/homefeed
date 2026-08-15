import type { InferenceProvider, GenerateStats } from '../inference/provider.js';
import type { ContentItem, GlobalSettings, MergedArticle, TrackedEvent } from '../storage/db/types.js';
import { logger } from '../storage/db/logs.js';

/**
 * Ollama's structured-output support (a JSON Schema passed as the request's `format`)
 * constrains the model's actual output tokens at the sampling level, not just via a
 * prompt instruction it's free to ignore or mangle. This replaced an earlier free-text
 * "write exactly ---TITLE---, then the article" delimiter convention that kept failing
 * in new ways — a numbered-list marker, a "Title:" label, a bare divider line, a
 * markdown header, an empty title, a whole article dumped into the title field — every
 * one of those was the SAME underlying problem (a small/quantized model choosing its
 * own formatting instead of the literal delimiter text) wearing a different costume.
 * Patching each new costume never addressed why the model kept improvising one; a
 * schema-constrained response has no delimiter left for it to improvise around.
 */
const SYNTHESIS_JSON_SCHEMA = {
	type: 'object',
	properties: {
		title: { type: 'string' },
		body: { type: 'string' },
		tags: { type: 'array', items: { type: 'string' } }
	},
	required: ['title', 'body', 'tags']
};

// Ollama truncates prompts that don't fit its context window by keeping a small prefix
// and dropping everything else in the middle — silently, with no error, and with no
// regard for which sources end up cut (see ollama-provider.ts for the incident that
// prompted this). Rather than relying on that, prompts here are sized to fit the
// admin-configured num_ctx/num_predict (Models tab) up front: each source/article gets
// an equal character budget, cut only when the whole prompt would otherwise overflow, so
// every source stays at least partially represented (and attributable) instead of some
// being dropped outright. ~4 chars/token is a rough heuristic (no tokenizer available
// here) — good enough for a safety margin, not meant to be exact.
const CHARS_PER_TOKEN = 4;
const RESERVED_OVERHEAD_TOKENS = 300; // system prompt + per-entry headers/formatting
const MIN_ENTRY_CHARS = 300; // floor so a huge cluster/recap doesn't shrink every entry to nothing

/** Character budget for prompt *input* — leaves numPredict's worth of the context window free for the model's own response, per the admin's configured num_ctx/num_predict (GlobalSettings.synthesisNumCtx/synthesisNumPredict). */
function maxInputChars(numCtx: number, numPredict: number): number {
	return Math.max(0, (numCtx - numPredict - RESERVED_OVERHEAD_TOKENS) * CHARS_PER_TOKEN);
}

function capEntryText(text: string, budgetChars: number): string {
	return text.length > budgetChars ? text.slice(0, budgetChars) + '…' : text;
}

const RECAP_SYSTEM_PROMPT_BASE = `You are a neutral news synthesis assistant. Given a chronological list of articles already published about an ongoing tracked event, respond with a JSON object with exactly these fields:
- "title": a short, specific headline for this recap (ideally under 12 words, no surrounding quotation marks, no trailing period)
- "body": the recap —
   - Write a full, comprehensive news article covering the period — not a short summary or a bare list of bullet points. Use as many paragraphs and as much length as the material actually warrants; do not artificially cut it short.
   - Organize it in chronological order, but group and connect related developments into a coherent narrative rather than restating each source article one at a time
   - Give real weight and detail to the most significant developments; minor ones can be covered more briefly, but nothing significant should be dropped for the sake of brevity
   - Stays neutral and factual, without editorializing
- "tags": 2-4 short topic/entity tags (e.g. proper nouns, named events) that this recap is about — an empty array if nothing salient qualifies`;

const SYSTEM_PROMPT_BASE = `You are a neutral news synthesis assistant. Given summaries from multiple news sources describing the same event, respond with a JSON object with exactly these fields:
- "title": a short, specific headline for this story (ideally under 12 words, no surrounding quotation marks, no trailing period, no site/outlet name)
- "body": the article —
   - Use as many paragraphs and as much length as the source material actually warrants — do not artificially cut it short, but don't pad it with filler either.
   - If you attribute a specific claim to an outlet, only use one of the exact source names given below (e.g. if a source is labeled "Source 1 (Reuters)", write "Reuters reported...") — never invent, guess, or substitute an outlet name that isn't one of them.
   - Does not copy phrasing verbatim from any source
   - Stays neutral and factual, without editorializing
- "tags": 2-4 short topic/entity tags (e.g. proper nouns, named events) that this article is about — an empty array if nothing salient qualifies`;

// Admin-selectable presets (Merge tab, "Writing style") — appended to whichever base
// prompt applies. 'default' adds nothing: the base prompts above already describe the
// original neutral wire-service tone this pipeline shipped with.
const STYLE_PRESETS: Record<GlobalSettings['synthesisStylePreset'], string> = {
	default: '',
	casual: 'Write in a casual, conversational tone, like a knowledgeable friend catching you up on what happened — contractions and plain language are fine. Still stay factual and keep outlet attribution accurate.',
	formal: 'Write in a formal, measured register — precise language, no contractions, no colloquialisms.'
};

/**
 * Admin-configurable tone/length/attribution style: a preset plus optional free-text
 * instructions, both from GlobalSettings — the only knobs that affect HOW the model
 * writes, as opposed to WHAT gets clustered/published. Appended to the base prompt,
 * which only still hard-mandates the JSON field shape (SYNTHESIS_JSON_SCHEMA enforces
 * that regardless) and never inventing a source name — length and whether to name
 * outlets at all (vs. a single unified narrative with attribution handled by the
 * site's own Sources list) are
 * deliberately left to this addendum to decide, not fixed in the base prompt. Applies
 * only to regular same-story merges — recaps have their own independent style knob, see
 * recapStyleAddendum below.
 */
function styleAddendum(settings: GlobalSettings): string {
	const preset = STYLE_PRESETS[settings.synthesisStylePreset] ?? '';
	const custom = settings.synthesisCustomInstructions.trim();
	const lines = [preset, custom].filter(Boolean);
	if (lines.length === 0) return '';
	return `\n\nAdditional style instructions from the site admin (follow these without breaking the rules above):\n${lines.join('\n')}`;
}

/**
 * Per-tracked-item recap style — deliberately independent of the global synthesisStylePreset
 * above (set in the Merge tab), since a recap's tone/scope is a very different kind of
 * knob: it's set once per tracked item (the "More" section on its own edit panel, next to
 * its recap cadence), not globally for every merge on the site. Reuses the same preset
 * strings for consistency, but reads from the event's own fields instead of GlobalSettings.
 */
function recapStyleAddendum(event: TrackedEvent): string {
	const preset = STYLE_PRESETS[event.recapStylePreset] ?? '';
	const custom = event.recapCustomInstructions.trim();
	const lines = [preset, custom].filter(Boolean);
	if (lines.length === 0) return '';
	return `\n\nAdditional style instructions from the site admin for this recap (follow these without breaking the rules above):\n${lines.join('\n')}`;
}

export interface SynthesisResult {
	title: string;
	body: string;
	tagLabels: string[];
	/** Raw throughput for the generate() call that produced this result — the caller (publish.ts) persists it as a benchmark row once it knows the resulting article's id/title (see storage/db/synthesisRuns.ts). */
	stats: GenerateStats;
}

function buildPrompt(items: ContentItem[], sourceNames: Map<string, string>, numCtx: number, numPredict: number): string {
	const budgetPerItem = Math.max(MIN_ENTRY_CHARS, Math.floor(maxInputChars(numCtx, numPredict) / items.length));
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

/**
 * With format: SYNTHESIS_JSON_SCHEMA, Ollama guarantees `raw` parses as an object
 * shaped like the schema — no delimiter text for the model to mangle, so no decoration
 * to strip. Still defensive about the actual field VALUES (a schema constrains shape,
 * not content — the model could still write an empty string, or something absurdly
 * long, into any field), just no longer about the response's overall structure.
 */
function parseResult(raw: string, stats: GenerateStats): SynthesisResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(`Model's response wasn't valid JSON despite the schema constraint: ${(err as Error).message}`);
	}
	const obj = (parsed ?? {}) as Record<string, unknown>;
	const title = typeof obj.title === 'string' ? obj.title.trim() : '';
	const body = typeof obj.body === 'string' ? obj.body.trim() : '';
	const tagLabels = Array.isArray(obj.tags)
		? obj.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0 && t.length < 60).map((t) => t.trim())
		: [];
	return { title, body, tagLabels, stats };
}

/**
 * A real headline is one line, and the prompt itself asks for "under 12 words" (~80-90
 * chars generously) — every well-formed title actually observed in production has been
 * well under 100 chars. 150 leaves a full 2x margin over that while still catching real
 * failures: not just a title/body swap (which tends to run into the thousands of chars),
 * but also a reasoning model's leaked chain-of-thought preamble ("Alright, let me tackle
 * this step by step...") when it ends up short enough to slip past a laxer check —
 * seen in production at 293 chars, comfortably past this ceiling but under the old 300.
 */
const MAX_TITLE_CHARS = 150;

/**
 * The JSON schema constrains structure, not content — a technically valid response can
 * still have an empty string in a required field, or (much less likely now, but cheap
 * to keep guarding against) a wildly oversized title if the model gets confused about
 * which field is which. Hard-fails rather than attempting a correction, same as before:
 * lets the caller's existing catch-and-retry logic (see priorityQueue.ts's
 * runSynthesisCycle) leave the cluster unclustered for the next cycle instead of ever
 * inserting a malformed result.
 */
function assertWellFormed(result: SynthesisResult, context: string): SynthesisResult {
	if (!result.body.trim()) {
		throw new Error(`Model returned an empty article body for ${context}`);
	}
	if (!result.title.trim()) {
		throw new Error(`Model produced an empty title for ${context}`);
	}
	if (result.title.includes('\n\n') || result.title.length > MAX_TITLE_CHARS) {
		throw new Error(`Model wrote a suspiciously long/multi-paragraph title (${result.title.length} chars) for ${context} — likely put article content in the wrong field`);
	}
	return result;
}

/**
 * A custom-instructions ban on exact phrases ("never use 'escalating tensions'") is
 * weak against small/quantized models, which readily substitute a synonym that dodges
 * the literal string while keeping the same cliché — seen in production: qwen3:8b
 * avoided "escalating tensions" verbatim but wrote "marked a significant escalation,"
 * "escalated dramatically," "potential for further conflict" instead. This is a
 * deterministic backstop, independent of whether the model actually follows the
 * prompt: scan the generated body for the same phrase family and, on a hit, retry
 * once with the specific violation named back to the model (self-correction prompting
 * tends to work better than the original blanket instruction, since it points at the
 * literal offending text rather than an abstract rule). If the retry still contains a
 * match, publish anyway rather than looping — CPU-only inference makes an unbounded
 * retry loop expensive, and one logged near-miss is a better outcome than blocking
 * publication indefinitely.
 */
const ESCALATION_CLICHE_PATTERNS: RegExp[] = [
	/\bescalat(?:e|es|ed|ing|ion|ions)\b/i,
	/\b(?:growing|rising|mounting)\s+tensions?\b/i,
	/\bintensif(?:y|ies|ied|ying|ication)\b/i,
	/\bpotential for further conflict\b/i
];

function findBannedPhrase(body: string): string | null {
	for (const pattern of ESCALATION_CLICHE_PATTERNS) {
		const match = body.match(pattern);
		if (match) return match[0];
	}
	return null;
}

async function generateAvoidingCliches(
	provider: InferenceProvider,
	prompt: string,
	system: string,
	genOpts: { model: string; numCtx: number; numPredict: number; label: string; think?: boolean },
	context: string
): Promise<SynthesisResult> {
	const run = async (sys: string) => {
		const { text, stats } = await provider.generate(prompt, { ...genOpts, system: sys, format: SYNTHESIS_JSON_SCHEMA });
		return assertWellFormed(parseResult(text, stats), context);
	};

	let result = await run(system);
	const hit = findBannedPhrase(result.body);
	if (hit) {
		logger.warn('synthesis', `Escalation-cliché phrase "${hit}" found in ${context} — retrying once with the violation named back to the model`);
		const correctiveSystem = `${system}\n\nYour previous attempt used the banned phrase "${hit}." Do not use it, or any similar escalation-framing cliché, anywhere in this rewrite.`;
		result = await run(correctiveSystem);
		const secondHit = findBannedPhrase(result.body);
		if (secondHit) {
			logger.warn('synthesis', `Escalation-cliché phrase "${secondHit}" still present in ${context} after retry — publishing as-is`);
		}
	}
	return result;
}

export async function synthesizeArticle(
	provider: InferenceProvider,
	model: string,
	items: ContentItem[],
	sourceNames: Map<string, string>,
	settings: GlobalSettings
): Promise<SynthesisResult> {
	const { synthesisNumCtx: numCtx, synthesisNumPredict: numPredict } = settings;
	const prompt = buildPrompt(items, sourceNames, numCtx, numPredict);
	const system = SYSTEM_PROMPT_BASE + styleAddendum(settings);
	const label = `Merging ${items.length} source${items.length === 1 ? '' : 's'}: "${items[0]?.title.slice(0, 60) ?? ''}"`;
	const context = `"${items[0]?.title.slice(0, 60) ?? ''}"`;
	return generateAvoidingCliches(
		provider,
		prompt,
		system,
		{ model, numCtx, numPredict, label, ...(settings.synthesisDisableThinking ? { think: false } : {}) },
		context
	);
}

function buildRecapPrompt(eventName: string, articles: MergedArticle[], numCtx: number, numPredict: number): string {
	const budgetPerArticle = Math.max(MIN_ENTRY_CHARS, Math.floor(maxInputChars(numCtx, numPredict) / articles.length));
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
	event: TrackedEvent,
	articles: MergedArticle[],
	settings: GlobalSettings
): Promise<SynthesisResult> {
	const { synthesisNumCtx: numCtx, synthesisNumPredict: numPredict } = settings;
	const prompt = buildRecapPrompt(event.name, articles, numCtx, numPredict);
	const system = RECAP_SYSTEM_PROMPT_BASE + recapStyleAddendum(event);
	const label = `Recapping event: "${event.name.slice(0, 60)}"`;
	const context = `event recap "${event.name.slice(0, 60)}"`;
	return generateAvoidingCliches(
		provider,
		prompt,
		system,
		{ model, numCtx, numPredict, label, ...(settings.synthesisDisableThinking ? { think: false } : {}) },
		context
	);
}
