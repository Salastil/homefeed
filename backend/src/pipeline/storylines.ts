/**
 * Storylines: published articles grouped, as they arrive, into live stories - and a tracked
 * event's articles grouped into "developments" the same way. Embeddings only: there is no
 * text generation anywhere here (the host is CPU-only, see README), so this runs whether or
 * not the AI writer does.
 *
 * Each new article is embedded once (title + body excerpt, or a post's own text) and then:
 *  1. joins the open storyline in its scope whose centroid it is most similar to, if that
 *     similarity reaches the join threshold AND the two share a specific name;
 *  2. otherwise starts a storyline with any loose article from the last few hours it is
 *     similar enough to (the join threshold + 0.04), under the same name check;
 *  3. otherwise stays loose.
 *
 * The name check ("guard") is what stops genre merges - two unrelated local shootings, two
 * pedestrian crashes - which embed close together because they read alike. A "name" is a
 * word the feed usually writes capitalised mid-sentence (a proper-noun lexicon learned from
 * the last few days of articles, so Title Case headlines and sentence-initial words don't
 * count), minus words that appear in most of one source's items (boilerplate like a
 * station's copyright line), minus names so common across the feed that they vouch for
 * nothing ("Trump"). Tracked events measure that commonness against the whole feed too:
 * inside a war event the event's own names are everywhere, and measured locally they'd
 * stop vouching at all.
 *
 * Thresholds were tuned on 549 real items against 19 hand-labelled stories with
 * nomic-embed-text (the default embedding model); the admin Storylines tab exposes them.
 * Lifecycle: live while updates arrive, cooling after `coolingHours` quiet, closed after
 * `closeHours` quiet or `maxLifetimeHours` total - derived from timestamps at read time.
 */
import type { InferenceProvider } from '../inference/provider.js';
import type { MergedArticle, StorylineSettings } from '../storage/db/types.js';
import * as articlesDb from '../storage/db/articles.js';
import * as stl from '../storage/db/storylines.js';
import { logger } from '../storage/db/logs.js';
import { STOP, candidates, composeTag, docKeys, rerankPool, tagCoverage, tagStrength, type Candidates, type NameMember } from './storylineNames.js';

const HOUR = 3_600_000;
/** Articles older than this when the tick first sees them go to the historical pass instead of the live lane. */
const BACKLOG_HOURS = 48;
const BATCH = 60;
/**
 * The historical pass gets this much of each one-minute tick, after new articles: about 40%
 * of the embedding host's time, so a CPU-only box isn't pinned for hours - roughly 150
 * articles a minute at nomic-embed-text's ~0.1 s per article.
 */
const BACKFILL_BUDGET_MS = 25_000;
const BACKFILL_CHUNK = 20;
const LEXICON_WINDOW_HOURS = 72;
const LEXICON_TTL_MS = 10 * 60_000;
/** A name in more than this share of recent articles is too common to vouch for a join. */
const COMMON_DF = 0.06;
/** At or above this similarity an article joins without the name check - a near-duplicate needs no vouching. */
const STRONG_SIMILARITY = 0.9;
/** Seeding a storyline needs a bit more similarity than joining one. */
const SEED_MARGIN = 0.04;
/** Words a verb follows, for spotting verbs (see buildLexicon). */
const MODALS = new Set(['to', 'will', 'would', 'could', 'can', 'may', 'might', 'must', 'should', 'cannot', 'not', "won't", "didn't", "doesn't", "don't"]);

// ---------- text ----------


/** The text that gets embedded - identical to what the thresholds were tuned on. */
export function embedTextOf(a: Pick<MergedArticle, 'title' | 'body' | 'tweet' | 'telegramMessage'>): string {
	const body = (a.body || '').replace(/^R to @\w+: /, '').replace(/https?:\/\/\S+/g, '');
	if (a.tweet || a.telegramMessage) return body.slice(0, 600);
	return `${a.title}\n${body.slice(0, 500)}`;
}

function sourceKeyOf(a: { tweet?: MergedArticle['tweet'] | null; telegramMessage?: MergedArticle['telegramMessage'] | null; sources: MergedArticle['sources'] }): string {
	if (a.tweet) return '@' + a.tweet.authorHandle.toLowerCase();
	if (a.telegramMessage) return a.telegramMessage.channelUsername ? '@' + a.telegramMessage.channelUsername.toLowerCase() : a.telegramMessage.channelName;
	return a.sources[0]?.sourceName ?? 'unknown';
}

const norm = (w: string) => w.toLowerCase().replace(/^['’-]+|['’-]+$/g, '');

function sentencesOf(title: string, body: string): string[][] {
	const text = `${title}\n${(body || '').replace(/^R to @\w+: /, '').slice(0, 900)}`
		.replace(/https?:\/\/\S+/g, ' ')
		.replace(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?\s*(?:EST|EDT|ET|PT|CT|GMT|UTC)?/gi, ' ');
	return text.split(/(?<=[.!?:;"”—–-])\s+|\n+/).map((s) => s.match(/[A-Za-z][A-Za-z'’-]*|\d+/g) ?? []);
}

// ---------- name lexicon ----------

interface Lexicon {
	builtAt: number;
	proper: Set<string>;
	boiler: Map<string, Set<string>>;
	df: Map<string, number>;
	cache: Map<string, Set<string>>;
	/** Phrase document counts over the same window, for naming storylines (see storylineNames.ts). */
	phraseDf: Map<string, number>;
	docs: number;
	verbs: Set<string>;
	wordBoiler: Map<string, Set<string>>;
}

let lexicon: Lexicon | null = null;
/**
 * The historical pass groups articles from weeks ago; which names are distinctive depends on
 * what was in the news then, so while it runs the lexicon is built from the 72 hours up to
 * the end of the article's own day (one rebuild per day of history) instead of from now.
 */
let anchorDay: number | null = null;
let historical: (Lexicon & { day: number }) | null = null;

interface TextRow {
	id: string;
	title: string;
	body: string;
	sourceKey: string;
	isPost: boolean;
}

function rawEntities(r: TextRow, proper: Set<string>): Set<string> {
	const out = new Set<string>();
	for (const toks of sentencesOf(r.title, r.body)) {
		for (const w of toks) {
			if (/^\d+$/.test(w)) {
				if (w.length >= 3 && !/^(19|20)\d\d$/.test(w)) out.add(w);
			} else if (proper.has(norm(w))) {
				out.add(norm(w));
			}
		}
	}
	return out;
}

function buildLexicon(until?: number): Lexicon {
	const end = until ?? Date.now();
	const since = new Date(end - LEXICON_WINDOW_HOURS * HOUR).toISOString();
	const rows: TextRow[] = stl.recentArticleTexts(since, until === undefined ? undefined : new Date(end).toISOString()).map((r) => {
		const tweet = r.tweet ? JSON.parse(r.tweet) : null;
		const telegramMessage = r.telegram_message ? JSON.parse(r.telegram_message) : null;
		return { id: r.id, title: r.title, body: r.body, isPost: !!(tweet || telegramMessage), sourceKey: sourceKeyOf({ tweet, telegramMessage, sources: JSON.parse(r.sources) }) };
	});
	// Proper nouns: written capitalised mid-sentence at least twice and more than twice as
	// often as lowercase.
	const cap = new Map<string, number>();
	const low = new Map<string, number>();
	for (const r of rows) {
		for (const toks of sentencesOf(r.title, r.body)) {
			toks.forEach((w, i) => {
				if (i === 0 || /^\d+$/.test(w)) return;
				const m = /^[A-Z]/.test(w) ? cap : low;
				const k = norm(w);
				m.set(k, (m.get(k) ?? 0) + 1);
			});
		}
	}
	const proper = new Set<string>();
	// Verbs, for naming: lowercase words that mostly follow "to", "will", "can" and the like.
	const verbUses = new Map<string, number>();
	for (const r of rows) {
		for (const toks of sentencesOf(r.title, r.body)) {
			for (let i = 1; i < toks.length; i++) if (MODALS.has(toks[i - 1].toLowerCase()) && /^[a-z]/.test(toks[i])) verbUses.set(norm(toks[i]), (verbUses.get(norm(toks[i])) ?? 0) + 1);
		}
	}
	const verbs = new Set<string>();
	for (const [w, k] of verbUses) if (k >= 2 && k / ((low.get(w) ?? 0) + (cap.get(w) ?? 0) || 1) >= 0.12) verbs.add(w);
	for (const [w, k] of cap) {
		if (k >= 2 && k > 2 * (low.get(w) ?? 0) && w.length >= 3 && !STOP.has(w)) proper.add(w);
	}
	// Per-source boilerplate: names in more than 30% of one source's items (5+ items).
	const perSource = new Map<string, Map<string, number>>();
	const perSourceN = new Map<string, number>();
	const raw = new Map<string, Set<string>>();
	for (const r of rows) {
		const ents = rawEntities(r, proper);
		raw.set(r.id, ents);
		perSourceN.set(r.sourceKey, (perSourceN.get(r.sourceKey) ?? 0) + 1);
		const c = perSource.get(r.sourceKey) ?? new Map<string, number>();
		for (const e of ents) c.set(e, (c.get(e) ?? 0) + 1);
		perSource.set(r.sourceKey, c);
	}
	const boiler = new Map<string, Set<string>>();
	for (const [src, c] of perSource) {
		const n = perSourceN.get(src) ?? 0;
		const set = new Set<string>();
		if (n >= 5) for (const [w, k] of c) if (k / n > 0.3) set.add(w);
		boiler.set(src, set);
	}
	const cache = new Map<string, Set<string>>();
	const dfCount = new Map<string, number>();
	for (const r of rows) {
		const ents = new Set([...(raw.get(r.id) ?? [])].filter((w) => !boiler.get(r.sourceKey)?.has(w)));
		cache.set(r.id, ents);
		for (const e of ents) dfCount.set(e, (dfCount.get(e) ?? 0) + 1);
	}
	const df = new Map<string, number>();
	for (const [w, k] of dfCount) df.set(w, k / Math.max(1, rows.length));
	const phraseDf = new Map<string, number>();
	for (const r of rows) for (const k of docKeys(r)) phraseDf.set(k, (phraseDf.get(k) ?? 0) + 1);
	// Naming's boilerplate: ANY word in more than 30% of one source's items (5+ items) -
	// hashtags a channel stamps on every post, page chrome a scraper picked up.
	const wordsPerSource = new Map<string, Map<string, number>>();
	for (const r of rows) {
		const c = wordsPerSource.get(r.sourceKey) ?? new Map<string, number>();
		for (const w of new Set(sentencesOf(r.title, r.body).flat().map(norm))) c.set(w, (c.get(w) ?? 0) + 1);
		wordsPerSource.set(r.sourceKey, c);
	}
	const wordBoiler = new Map<string, Set<string>>();
	for (const [src, c] of wordsPerSource) {
		const n = perSourceN.get(src) ?? 0;
		const set = new Set<string>();
		if (n >= 5) for (const [w, k] of c) if (k / n > 0.3 && !STOP.has(w)) set.add(w);
		wordBoiler.set(src, set);
	}
	return { builtAt: Date.now(), proper, boiler, df, cache, phraseDf, docs: rows.length, verbs, wordBoiler };
}

function getLexicon(): Lexicon {
	if (anchorDay !== null) {
		if (!historical || historical.day !== anchorDay) historical = { ...buildLexicon(anchorDay + 24 * HOUR), day: anchorDay };
		return historical;
	}
	if (!lexicon || Date.now() - lexicon.builtAt > LEXICON_TTL_MS) lexicon = buildLexicon();
	return lexicon;
}

function entitiesOf(a: MergedArticle): Set<string> {
	const lx = getLexicon();
	const hit = lx.cache.get(a.id);
	if (hit) return hit;
	const key = sourceKeyOf(a);
	const ents = new Set([...rawEntities({ id: a.id, title: a.title, body: a.body, sourceKey: key, isPost: !!(a.tweet || a.telegramMessage) }, lx.proper)].filter((w) => !lx.boiler.get(key)?.has(w)));
	lx.cache.set(a.id, ents);
	return ents;
}

function salient(ents: Set<string>): Set<string> {
	const df = getLexicon().df;
	return new Set([...ents].filter((w) => (df.get(w) ?? 0) <= COMMON_DF));
}

/** Names a storyline's members share: in 2+ members once it has 4+, otherwise in any. */
function storyNames(members: MergedArticle[]): Set<string> {
	const count = new Map<string, number>();
	for (const m of members) for (const w of salient(entitiesOf(m))) count.set(w, (count.get(w) ?? 0) + 1);
	const need = members.length >= 4 ? 2 : 1;
	return new Set([...count].filter(([, k]) => k >= need).map(([w]) => w));
}

function guardOk(a: MergedArticle, members: MergedArticle[], similarity: number, settings: StorylineSettings): boolean {
	if (!settings.nameGuard || similarity >= STRONG_SIMILARITY) return true;
	const names = storyNames(members);
	for (const w of salient(entitiesOf(a))) if (names.has(w)) return true;
	return false;
}

// ---------- vectors ----------

function normalize(v: number[]): number[] {
	let s = 0;
	for (const x of v) s += x * x;
	const n = Math.sqrt(s) || 1;
	return v.map((x) => x / n);
}

function dot(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
}

function centroidOf(vectors: number[][]): number[] {
	const sum = new Array(vectors[0].length).fill(0);
	for (const v of vectors) for (let i = 0; i < v.length; i++) sum[i] += v[i];
	return normalize(sum);
}

// ---------- labels ----------

/** The headline that stands for the storyline: the member closest to the centroid, preferring an article over a post. */
function labelOf(members: MergedArticle[], vectors: Map<string, number[]>, centroid: number[]): string | null {
	const articles = members.filter((m) => !m.tweet && !m.telegramMessage);
	const pool = articles.length ? articles : members;
	let best: string | null = null;
	let bestScore = -2;
	for (const m of pool) {
		const v = vectors.get(m.id);
		if (!v) continue;
		const s = dot(v, centroid);
		if (s > bestScore) [best, bestScore] = [m.id, s];
	}
	return best;
}

function refresh(storylineId: string) {
	const ids = stl.memberIds(storylineId);
	const members = ids.map((id) => articlesDb.getArticle(id)).filter((a): a is MergedArticle => !!a);
	if (members.length === 0) return;
	const vectors = new Map<string, number[]>();
	for (const m of members) {
		const v = stl.articleEmbedding(m.id);
		if (v) vectors.set(m.id, v);
	}
	if (vectors.size === 0) return;
	const centroid = centroidOf([...vectors.values()]);
	stl.updateStoryline(storylineId, {
		labelArticleId: labelOf(members, vectors, centroid),
		centroid,
		firstItemAt: members[0].publishedAt,
		lastItemAt: members[members.length - 1].publishedAt,
		itemCount: members.length,
		sourceCount: new Set(members.map(sourceKeyOf)).size
	});
	// Live: named at the end of the tick, with the embedding check. Historical: named now,
	// while the lexicon is still anchored to the article's day.
	if (anchorDay === null) dirty.set(storylineId, dirty.get(storylineId) ?? false);
	else retagNow(storylineId);
}

// ---------- naming ----------

/** Storylines whose members changed this tick, to be (re)named at its end. true = skip the stability check. */
const dirty = new Map<string, boolean>();
/** Phrase vectors for the centroid check; bounded, oldest dropped first. */
const phraseVectors = new Map<string, number[]>();
const PHRASE_CACHE = 2000;
/** A new name has to be this much better backed than the current one to replace it. */
const RENAME_MARGIN = 1.2;

function nameMember(a: MergedArticle): NameMember {
	return { title: a.title, body: a.body, isPost: !!(a.tweet || a.telegramMessage), sourceKey: sourceKeyOf(a) };
}

/** What naming needs from the lexicon (exported for offline reports). */
export function nameContext() {
	const lx = getLexicon();
	return { proper: lx.proper, phraseDf: lx.phraseDf, docs: lx.docs, boiler: lx.wordBoiler, verbs: lx.verbs };
}

function nameCandidates(members: MergedArticle[]): Candidates {
	return candidates(members.map(nameMember), nameContext());
}

/** Whether `next` should replace the storyline's current name. */
function shouldRename(row: stl.StorylineRow, next: string, c: Candidates, force: boolean): boolean {
	if (!next || next.toLowerCase() === row.tag.toLowerCase()) return false;
	if (force || !row.tag) return true;
	if (c.n < 3) return false;
	const now = tagStrength(row.tag, c);
	const then = tagStrength(next, c);
	// A name most of the storyline no longer says goes as soon as something better backed exists.
	if (tagCoverage(row.tag, c) < 0.3) return then > now;
	return then >= RENAME_MARGIN * now;
}

/** Names a storyline from statistics alone (no embedding calls). */
export function retagNow(id: string, force = false): string | null {
	const row = stl.getStoryline(id);
	if (!row || row.tagLocked) return row?.tag ?? null;
	const members = membersOf(id);
	if (members.length === 0) return row.tag;
	const c = nameCandidates(members);
	const next = composeTag(c);
	if (shouldRename(row, next, c, force)) stl.setStorylineTag(id, next);
	return next || row.tag;
}

/**
 * The name the storyline would get now, re-ranking the top phrases by closeness to its
 * centroid when a provider is given (statistics alone if not, or if the call fails).
 */
export async function proposeName(id: string, provider?: InferenceProvider, model?: string): Promise<{ row: stl.StorylineRow; next: string; c: Candidates } | null> {
	const row = stl.getStoryline(id);
	if (!row) return null;
	const members = membersOf(id);
	if (members.length === 0) return null;
	const c = nameCandidates(members);
	let closeness: Map<string, number> | undefined;
	// Only the board's storylines get the embedding check; event developments aren't shown by name.
	if (provider && model && row.scope === 'news' && c.list.length > 1) {
		try {
			closeness = new Map();
			for (const cand of rerankPool(c)) {
				const k = `${model}|${cand.display.toLowerCase()}`;
				let v = phraseVectors.get(k);
				if (!v) {
					v = normalize(await provider.embed(cand.display, { model }));
					phraseVectors.set(k, v);
					if (phraseVectors.size > PHRASE_CACHE) phraseVectors.delete(phraseVectors.keys().next().value!);
				}
				closeness.set(cand.key, dot(v, row.centroid));
			}
		} catch {
			closeness = undefined; // embedding service away: statistics alone
		}
	}
	return { row, next: composeTag(c, closeness), c };
}

async function retag(id: string, force: boolean, provider: InferenceProvider, model: string): Promise<void> {
	const p = await proposeName(id, provider, model);
	if (!p || p.row.tagLocked) return;
	if (shouldRename(p.row, p.next, p.c, force)) stl.setStorylineTag(id, p.next);
}

async function flushNames(provider: InferenceProvider, model: string) {
	const todo = [...dirty];
	dirty.clear();
	for (const [id, force] of todo) await retag(id, force, provider, model);
}

/** For offline reports: name against the lexicon of a past day (null = now). */
export function anchorNamesTo(day: number | null) {
	anchorDay = day;
}

let namesMigrated = false;
/**
 * Once per start: re-name the last week's storylines (names now come from storylineNames.ts),
 * each against the lexicon of its own day, and queue the open ones for the embedding check.
 */
function renameRecent(settings: StorylineSettings) {
	const rows = stl.storylinesTouchedSince('news', new Date(Date.now() - 7 * 24 * HOUR).toISOString());
	const today = Math.floor(Date.now() / (24 * HOUR)) * 24 * HOUR;
	let renamed = 0;
	try {
		for (const r of rows.sort((a, b) => a.lastItemAt.localeCompare(b.lastItemAt))) {
			const day = Math.floor(new Date(r.lastItemAt).getTime() / (24 * HOUR)) * 24 * HOUR;
			anchorDay = day >= today - 24 * HOUR ? null : day;
			const before = r.tag;
			if ((retagNow(r.id, true) ?? before) !== before) renamed++;
			if (storylineState(r, settings) !== 'closed') dirty.set(r.id, true);
		}
	} finally {
		anchorDay = null;
	}
	logger.info('storylines', `Re-named ${renamed} of ${rows.length} storylines from the last 7 days`);
}

// ---------- assignment ----------

export function scopeOf(a: Pick<MergedArticle, 'eventId'>): string {
	return a.eventId ? `event:${a.eventId}` : 'news';
}

interface ScopeParams {
	join: number;
	seed: number;
	closeHours: number;
	maxHours: number;
	seedWindowHours: number;
}

function paramsFor(scope: string, s: StorylineSettings): ScopeParams {
	if (scope === 'news') {
		return { join: s.joinSimilarity, seed: s.joinSimilarity + SEED_MARGIN, closeHours: s.closeHours, maxHours: s.maxLifetimeHours, seedWindowHours: s.seedWindowHours };
	}
	return {
		join: s.eventJoinSimilarity,
		seed: s.eventJoinSimilarity + SEED_MARGIN,
		closeHours: s.eventCloseHours,
		maxHours: s.eventMaxHours,
		seedWindowHours: Math.min(s.seedWindowHours, s.eventMaxHours)
	};
}

function membersOf(storylineId: string): MergedArticle[] {
	return stl
		.memberIds(storylineId)
		.map((id) => articlesDb.getArticle(id))
		.filter((a): a is MergedArticle => !!a);
}

/** Places one embedded article. Returns the storyline it ended up in, if any. */
export function assignArticle(a: MergedArticle, v: number[], settings: StorylineSettings): string | null {
	const scope = scopeOf(a);
	const p = paramsFor(scope, settings);
	const t = new Date(a.publishedAt).getTime();
	const iso = (ms: number) => new Date(ms).toISOString();

	// 1. Join the most similar open storyline.
	let best: { id: string; score: number } | null = null;
	for (const s of stl.storylinesActiveIn(scope, iso(t - p.closeHours * HOUR), iso(t - p.maxHours * HOUR), iso(t + 5 * 60_000))) {
		const score = dot(v, s.centroid);
		if (score >= p.join && (!best || score > best.score)) {
			if (guardOk(a, membersOf(s.id), score, settings)) best = { id: s.id, score };
		}
	}
	if (best) {
		stl.addMember(best.id, a.id, best.score);
		refresh(best.id);
		return best.id;
	}

	// 2. Start one with similar loose articles from the seed window.
	const loose = stl.looseArticlesIn(scope, iso(t - p.seedWindowHours * HOUR), iso(t + 5 * 60_000), a.id);
	const matches: { id: string; score: number }[] = [];
	for (const l of loose) {
		const score = dot(v, l.embedding);
		if (score < p.seed) continue;
		const other = articlesDb.getArticle(l.id);
		if (other && guardOk(a, [other], score, settings)) matches.push({ id: l.id, score });
	}
	if (matches.length === 0) return null;

	const vectors = [v, ...matches.map((m) => loose.find((l) => l.id === m.id)!.embedding)];
	const centroid = centroidOf(vectors);
	// A storyline that closed in the last day and reads the same is the one this continues.
	let continuesId: string | null = null;
	if (scope === 'news') {
		const ended = stl.storylinesEndedBetween(scope, iso(t - 24 * HOUR), iso(t - p.closeHours * HOUR));
		const prior = ended.find((s) => dot(centroid, s.centroid) >= p.join);
		continuesId = prior?.id ?? null;
	}
	const id = stl.createStoryline(scope, centroid, a.publishedAt, a.publishedAt, continuesId);
	for (const m of matches) stl.addMember(id, m.id, m.score);
	stl.addMember(id, a.id, 1);
	refresh(id);
	return id;
}

// ---------- tick ----------

let backlogQueued = false;

/**
 * Whether the last storyline tick could reach the embedding service (null before the first
 * tick), and how the historical pass is going - read by the board ("grouping paused") and
 * the admin Storylines tab.
 */
export const engineStatus: {
	reachable: boolean | null;
	backfillRatePerMin: number | null;
	lastTickAt: string | null;
} = { reachable: null, backfillRatePerMin: null, lastTickAt: null };

/** Embeds and places one article. False when the embedding call failed (leave the rest for later). */
async function processArticle(id: string, provider: InferenceProvider, model: string, settings: StorylineSettings): Promise<{ ok: boolean; placed: boolean }> {
	const a = articlesDb.getArticle(id);
	if (!a) return { ok: true, placed: false };
	let v: number[];
	try {
		v = normalize(await provider.embed(embedTextOf(a), { model }));
	} catch (err) {
		logger.error('storylines', `Embedding failed for "${a.title.slice(0, 80)}": ${(err as Error).message}`);
		return { ok: false, placed: false };
	}
	stl.setArticleEmbedding(a.id, v);
	return { ok: true, placed: !!assignArticle(a, v, settings) };
}

/**
 * One storyline pass, once a minute. First the live lane: up to BATCH newly published
 * articles, oldest first. Then, if that lane is clear, the historical pass gets
 * BACKFILL_BUDGET_MS to work through the articles that predate storylines, oldest first, so
 * the archive fills in over a few hours without starving new arrivals or pinning the CPU.
 * Grouping is relative to each article's own publish time, so history builds the same
 * storylines it would have built live (they're simply closed by now).
 */
export async function runStorylineCycle(
	provider: InferenceProvider,
	model: string,
	settings: StorylineSettings
): Promise<{ placed: number; backfilled: number; backfillLeft: number }> {
	if (!backlogQueued) {
		const queued = stl.queueBackfillBefore(new Date(Date.now() - BACKLOG_HOURS * HOUR).toISOString());
		if (queued > 0) logger.info('storylines', `Queued ${queued} article(s) older than ${BACKLOG_HOURS}h for the historical pass`);
		backlogQueued = true;
	}
	if (!namesMigrated) {
		namesMigrated = true;
		renameRecent(settings);
	}
	const removed = stl.deleteEmptyStorylines();
	if (removed > 0) logger.info('storylines', `Removed ${removed} empty storyline(s)`);
	engineStatus.lastTickAt = new Date().toISOString();

	let placed = 0;
	const recent = stl.uncheckedArticleIds(BATCH);
	for (const id of recent) {
		const r = await processArticle(id, provider, model, settings);
		if (!r.ok) {
			await flushNames(provider, model);
			return { placed, backfilled: 0, backfillLeft: stl.pendingCounts().backfill };
		}
		if (r.placed) placed++;
	}
	await flushNames(provider, model);
	if (recent.length >= BATCH) return { placed, backfilled: 0, backfillLeft: stl.pendingCounts().backfill };

	const started = Date.now();
	let backfilled = 0;
	try {
		while (Date.now() - started < BACKFILL_BUDGET_MS) {
			const ids = stl.backfillArticleIds(BACKFILL_CHUNK);
			if (ids.length === 0) break;
			for (const id of ids) {
				const a = articlesDb.getArticle(id);
				const t = a ? new Date(a.publishedAt).getTime() : Date.now();
				anchorDay = Math.floor(t / (24 * HOUR)) * 24 * HOUR;
				const r = await processArticle(id, provider, model, settings);
				if (!r.ok) throw new Error('embedding failed');
				backfilled++;
				if (Date.now() - started >= BACKFILL_BUDGET_MS) break;
			}
		}
	} catch {
		// Leave the rest for the next tick.
	} finally {
		anchorDay = null;
	}
	// Ticks are a minute apart, so one tick's count is the per-minute pace.
	if (backfilled > 0) engineStatus.backfillRatePerMin = backfilled;
	const backfillLeft = stl.pendingCounts().backfill;
	if (backfillLeft === 0) {
		engineStatus.backfillRatePerMin = null;
		historical = null;
	}
	return { placed, backfilled, backfillLeft };
}

// ---------- read side ----------

export type StorylineState = 'live' | 'cooling' | 'closed';

export function storylineState(s: Pick<stl.StorylineRow, 'firstItemAt' | 'lastItemAt' | 'scope'>, settings: StorylineSettings, now = Date.now()): StorylineState {
	const idle = (now - new Date(s.lastItemAt).getTime()) / HOUR;
	const age = (now - new Date(s.firstItemAt).getTime()) / HOUR;
	const close = s.scope === 'news' ? settings.closeHours : settings.eventCloseHours;
	const max = s.scope === 'news' ? settings.maxLifetimeHours : settings.eventMaxHours;
	if (idle > close || age > max) return 'closed';
	return idle > settings.coolingHours ? 'cooling' : 'live';
}

export function closesAt(s: Pick<stl.StorylineRow, 'firstItemAt' | 'lastItemAt' | 'scope'>, settings: StorylineSettings): string {
	const close = s.scope === 'news' ? settings.closeHours : settings.eventCloseHours;
	const max = s.scope === 'news' ? settings.maxLifetimeHours : settings.eventMaxHours;
	return new Date(Math.min(new Date(s.lastItemAt).getTime() + close * HOUR, new Date(s.firstItemAt).getTime() + max * HOUR)).toISOString();
}

export { sourceKeyOf };
