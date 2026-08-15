import type { InferenceProvider, GenerateStats } from '../inference/provider.js';
import type { ContentItem, GlobalSettings, MergedArticle, TrackedEvent } from '../storage/db/types.js';
import { logger } from '../storage/db/logs.js';

const TITLE_DELIMITER = '---TITLE---';
const TAG_DELIMITER = '---TAGS---';

// Small/quantized models don't always reproduce a literal delimiter exactly — extra
// dashes, an inserted blank line, different case (seen in production with the tag
// delimiter: "---\n\nTAGS---" instead of "---TAGS---", which an exact-string split
// missed entirely, leaking the raw delimiter text into the published body). Splitting
// on a loose regex instead tolerates that variance.
const TITLE_DELIMITER_RE = /-{2,}\s*TITLE\s*-{2,}/i;
const TAG_DELIMITER_RE = /-{2,}\s*TAGS\s*-{2,}/i;

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

function parseTagLabels(raw: string): string[] {
	return raw
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t.length > 0 && t.length < 60);
}

const RECAP_SYSTEM_PROMPT_BASE = `You are a neutral news synthesis assistant. Given a chronological list of articles already published about an ongoing tracked event, write your response in exactly three parts, in this order:

1. A short, specific headline for this recap (a single line, ideally under 12 words, no surrounding quotation marks, no trailing period).
2. On a new line, write exactly "${TITLE_DELIMITER}", then the recap:
   - Write a full, comprehensive news article covering the period — not a short summary or a bare list of bullet points. Use as many paragraphs and as much length as the material actually warrants; do not artificially cut it short.
   - Organize it in chronological order, but group and connect related developments into a coherent narrative rather than restating each source article one at a time
   - Give real weight and detail to the most significant developments; minor ones can be covered more briefly, but nothing significant should be dropped for the sake of brevity
   - Stays neutral and factual, without editorializing
3. On a new line after the recap, write exactly "${TAG_DELIMITER}" followed by 2-4 short comma-separated topic/entity tags (e.g. proper nouns, named events) that this recap is about. If nothing salient qualifies, leave the tag line empty.`;

const SYSTEM_PROMPT_BASE = `You are a neutral news synthesis assistant. Given summaries from multiple news sources describing the same event, write your response in exactly three parts, in this order:

1. A short, specific headline for this story (a single line, ideally under 12 words, no surrounding quotation marks, no trailing period, no site/outlet name).
2. On a new line, write exactly "${TITLE_DELIMITER}", then the article:
   - Use as many paragraphs and as much length as the source material actually warrants — do not artificially cut it short, but don't pad it with filler either.
   - If you attribute a specific claim to an outlet, only use one of the exact source names given below (e.g. if a source is labeled "Source 1 (Reuters)", write "Reuters reported...") — never invent, guess, or substitute an outlet name that isn't one of them.
   - Does not copy phrasing verbatim from any source
   - Stays neutral and factual, without editorializing
3. On a new line after the article, write exactly "${TAG_DELIMITER}" followed by 2-4 short comma-separated topic/entity tags (e.g. proper nouns, named events) that this article is about. If nothing salient qualifies, leave the tag line empty.`;

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
 * which only still hard-mandates the delimiter/tag format (parseResult depends on it)
 * and never inventing a source name — length and whether to name outlets at all (vs. a
 * single unified narrative with attribution handled by the site's own Sources list) are
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

/** Only used when the model doesn't follow the requested title/delimiter format at all — a real headline beats a truncated sentence fragment, but publishing with no title at all is worse than either. */
function fallbackTitle(body: string): string {
	const firstLine = body.split('\n')[0];
	return firstLine.length > 100 ? firstLine.slice(0, 97) + '…' : firstLine;
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
 * Some models wrap the headline in a numbered-list marker or quotation marks instead of
 * the plain single line the prompt asks for (seen in production: mistral:7b writing
 * `1. "Goldman Sachs Expands..."` as its opening line instead of using the requested
 * ---TITLE--- delimiter at all). Neither decoration is wrong content, just formatting
 * the prompt didn't ask for — strip it rather than publishing a title with a stray
 * "1. " prefix and literal quote characters around it.
 */
function stripTitleDecoration(title: string): string {
	return title
		.replace(/^\d+[.)]\s*/, '')
		// A model can write its own "Title: <headline>" label line BEFORE the actual
		// requested ---TITLE--- delimiter (seen in production: mistral:7b did exactly
		// this, so titlePart captured "Title: <headline>" rather than the clean text
		// after it) — a label the delimiter itself already makes redundant.
		.replace(/^(?:title|headline)\s*:\s*/i, '')
		.trim()
		.replace(/^["“](.+)["”]$/, '$1')
		.trim();
}

function parseResult(raw: string, stats: GenerateStats): SynthesisResult {
	const [beforeTags, tagSection] = raw.split(TAG_DELIMITER_RE);
	const tagLabels = parseTagLabels(tagSection ?? '');

	const titleSplit = (beforeTags ?? raw).split(TITLE_DELIMITER_RE);
	const titlePart = titleSplit[0];
	// join() rather than titleSplit[1] in case the delimiter text somehow appears again
	// inside the body itself — keeps that content rather than silently dropping it.
	const bodyPart = titleSplit.length > 1 ? titleSplit.slice(1).join('') : undefined;
	// If the title delimiter never showed up, the model didn't follow the requested
	// format — treat the whole thing as body rather than mistaking the article itself
	// for a "title", and fall back to the old truncated-first-line heuristic.
	let body = (bodyPart ?? titlePart).trim();
	if (bodyPart === undefined) {
		// A bare divider line ("---", "===", ...) with no "TITLE" text at all doesn't
		// match TITLE_DELIMITER_RE, so it falls through to here — but it's a malformed
		// delimiter attempt, not real content. Seen in production: the model wrote a
		// lone "---" as its own line, immediately followed by the actual headline as
		// plain text; without this, fallbackTitle below took the "---" itself as the
		// title and left the real headline sitting as the body's first line. Strip any
		// such leading line(s) first so the first *substantive* line is what gets used.
		body = body.replace(/^(?:[-=*]{2,}\s*\n)+/, '');
	}
	const title = stripTitleDecoration(bodyPart !== undefined ? titlePart.trim() : fallbackTitle(body));

	// In that no-delimiter fallback case, the headline is also still sitting as the
	// article's own first line (it's the same text `body` was derived from) — seen in
	// production as a published article whose body literally opened with a restatement
	// of its own headline. Drop that redundant line once we can confirm it really is a
	// duplicate of the title we just extracted, rather than risk cutting real content.
	if (bodyPart === undefined) {
		const firstLine = body.split('\n')[0];
		if (stripTitleDecoration(firstLine) === title) {
			body = body.slice(firstLine.length).trim();
			// The rest of a numbered-list-style response numbers its next line too
			// (the same production case: "1. <headline>\n2. <article text>") — that
			// leading marker is decoration from the same formatting deviation, not
			// real list content, so strip it here alongside the line it came with.
			body = body.replace(/^\d+[.)]\s+/, '');
		}
	}

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
 * Two distinct ways a quantized/small model's output can pass parseResult's own logic
 * (delimiters found, nothing crashed) while still being garbage:
 *
 * 1. It reproduces just the requested delimiter scaffold ("---TITLE---\n\n---TAGS---")
 *    with no real headline or article text in between — empty in substance. Left
 *    unchecked this published a blank article (empty title/body, still with real
 *    sources/hero image attached) once in production.
 * 2. It writes the full multi-paragraph article BEFORE the ---TITLE--- delimiter and
 *    a short heading/summary AFTER it — the reverse of what the prompt asked for.
 *    parseResult has no way to tell this apart from a well-formed response (it just
 *    trusts whichever half came first), so the entire article ends up published as the
 *    article's *title* field — seen in production on a real merge.
 *
 * Both get treated as a hard failure rather than an attempted auto-correction (e.g.
 * blindly swapping title/body back) — a swap-back still often carries a stray trailing
 * paragraph the model tacked onto the "headline" half, so it wouldn't reliably produce
 * a clean result either. Failing lets the caller's existing catch-and-retry logic (see
 * priorityQueue.ts's runSynthesisCycle) leave the cluster unclustered for the next
 * cycle instead of ever inserting one of these.
 */
function assertWellFormed(result: SynthesisResult, context: string): SynthesisResult {
	if (!result.body.trim()) {
		throw new Error(`Model returned an empty article body for ${context}`);
	}
	// A blank title (seen in production: the model emitted the ---TITLE--- delimiter as
	// close to the very first thing it wrote, with nothing — not even whitespace worth
	// keeping — before it) parses "successfully" by parseResult's own logic (the
	// delimiter was found, bodyPart is defined) but leaves the published article with no
	// headline at all: an empty <h1>, and nothing to identify it by in the feed list.
	if (!result.title.trim()) {
		throw new Error(`Model produced an empty title for ${context}`);
	}
	if (result.title.includes('\n\n') || result.title.length > MAX_TITLE_CHARS) {
		throw new Error(`Model likely swapped the title/body halves of its ---TITLE--- response (title came out ${result.title.length} chars) for ${context}`);
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
		const { text, stats } = await provider.generate(prompt, { ...genOpts, system: sys });
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
