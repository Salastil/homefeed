/**
 * Storyline names ("FAA Ground Stop", "Clean Harbors Explosion") without text generation.
 *
 * A name is WHO/WHERE + WHAT: the best proper name or acronym the members share, followed by
 * the best ordinary phrase they share. Both are scored the same way (class TF-IDF):
 *
 *   coverage    - the share of members that contain the phrase (each member counts once, so
 *                 one long post can't outvote the rest)
 *   specificity - how unusual the phrase is across the last few days of the whole feed
 *                 (`phraseDf`, counted by the storyline engine's lexicon)
 *
 * plus a bonus for appearing in a headline. A WHAT phrase must come from at least two
 * different sources, so one outlet's wording never becomes the name. The storyline engine can
 * then re-rank the top phrases by how close their embedding is to the storyline's centroid.
 *
 * Pure functions only: everything they need comes in through `NameContext`, so they can be
 * run over a copy of the database to compare names before and after a change.
 */

export const STOP = new Set(
	`a an the and or but if of to in on at by for with from as is are was were be been being this that these those it its
he she they them his her their we you i our your not no yes do does did done has have had will would can could should may might
than then there here what which who whom whose when where why how all any each more most other some such only own same so too very
just over under after before about into through during against between up down out off again further once also said says say new
according amid per via told year years day days time week weeks today tonight yesterday monday tuesday wednesday
thursday friday saturday sunday january february march april june july august september october november december
pm am breaking update watch live news report reports reported video photos photo one two three first last people police
man woman men women official officials us u.s president former state city county sources source mr mrs ms dr
reserved rights copyright wpvi-tv wpvi ktrk-tv wabc-tv all est edt gmt utc
jan feb mar apr jun jul aug sep sept oct nov dec com www http https`.split(/\s+/)
);

/**
 * Words that can't start or end a WHAT phrase: reporting verbs and filler that headlines are
 * full of but that never name what happened.
 */
const TOPIC_EDGE_STOP = new Set(
	`says saying halts halt halting pauses pause pausing demand demands demanding calls call calling urges urge warns warn
claims claim reveals reveal confirms confirm denies deny announces announce slams slam blasts reacts react responds respond
seems appears reportedly allegedly unclear rule rules cause causes following linked latest least still now near nearly
amid while because without within across around another many much several since until like says gets get got make makes
made take takes took give gives gave goes going come comes came keep keeps kept show shows want wants need needs know knows
look looks set sets put puts tell tells see sees use uses used find finds found work works help helps try tries left right
big biggest major huge massive large small top high low full real really reportedly officially likely possible possibly
amid ahead behind back away even ever never already yet almost every both either neither whether though although however
exclusive developing urgent alert update updates updated happening currently earlier later
morning afternoon evening night hour hours minute minutes moment moments thing things way ways lot lots
recent western eastern northern southern natural global local national international federal public early late final
potential significant serious additional multiple ongoing current previous entire various certain particular general
win wins won lose loses lost good bad best better worse worst due allege alleges alleged accuse accuses accused admit admits admitted insist insists vow vows plan plans`.split(/\s+/)
);

/** Titles and labels that come with a name but aren't it ("Secretary", "Democrat", "Prime Minister"). */
const TITLES = new Set(
	`secretary president senator sen rep representative gov governor minister prime ceo cfo chairman chair democrat democratic
republican gop mayor judge chief general gen director spokesperson spokesman spokeswoman ambassador commissioner sheriff
attorney lt col sgt north south east west northern southern eastern western`.split(/\s+/)
);

/** Words allowed in the middle of a three-word WHAT phrase ("state of emergency"). */
const MIDDLE_OK = new Set(['of', 'on', 'in', 'and']);
const SMALL = new Set(['of', 'on', 'in', 'and', 'to', 'for', 'at', 'the', 'a']);

export interface NameContext {
	/** Lower-cased words the feed writes capitalised mid-sentence (the engine's proper-noun lexicon). */
	proper: Set<string>;
	/** Background document count per phrase key, over the lexicon's window. */
	phraseDf: Map<string, number>;
	/** Documents in that background. */
	docs: number;
	/** Per-source boilerplate words (lower-cased): a station's sign-off, a channel's hashtags, page chrome. */
	boiler: Map<string, Set<string>>;
	/** Words the feed mostly uses as verbs ("to return", "will meet"): never a WHAT on their own. */
	verbs: Set<string>;
}

export interface NameMember {
	title: string;
	body: string;
	isPost: boolean;
	sourceKey: string;
}

export interface Candidate {
	key: string;
	display: string;
	kind: 'name' | 'topic';
	members: number;
	coverage: number;
	sources: number;
	inTitle: boolean;
	score: number;
}

export interface Candidates {
	n: number;
	sources: number;
	list: Candidate[];
	/** Each member's word stems, for measuring how much of the storyline a name still covers. */
	memberWords: Set<string>[];
}

// ---------- text ----------

/** A crude plural/possessive fold, so "routers" and "router", "FAA's" and "FAA" share a key. */
export function stem(w: string): string {
	let s = w.toLowerCase().replace(/['’]s$/, '').replace(/['’-]+$/, '');
	if (s.length > 4) {
		if (s.endsWith('ies')) s = s.slice(0, -3) + 'y';
		else if (/(ch|sh|x|ss)es$/.test(s)) s = s.slice(0, -2);
		else if (s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
	}
	return s;
}

const clean = (s: string) =>
	(s || '')
		.replace(/^R to @\w+: /, '')
		.replace(/https?:\/\/\S+/g, ' ')
		.replace(/@\w+/g, ' ')
		.replace(/#\w+/g, ' ')
		.replace(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?\s*(?:EST|EDT|ET|PT|CT|GMT|UTC)?/gi, ' ');

const tokensOf = (sentence: string) => (sentence.match(/[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]|\d+/g) ?? []).map((w) => w.replace(/['’]s$/, ''));

function split(text: string): string[][] {
	return clean(text)
		.split(/(?<=[.!?:;"”—–|*])\s+|\s[-–—|]\s|\n+/)
		.map(tokensOf)
		.filter((t) => t.length > 0);
}

/** The headline part and the rest of a member's text, as the names see them. */
export function partsOf(m: { title: string; body: string; isPost: boolean }): { head: string[][]; rest: string[][] } {
	if (m.isPost) {
		const body = clean(m.body).slice(0, 420);
		const nl = body.indexOf('\n');
		const head = nl > 0 && nl < 200 ? body.slice(0, nl) : body.slice(0, 160);
		const sents = split(body);
		const headN = Math.max(1, split(head).length);
		return { head: sents.slice(0, headN), rest: sents.slice(headN) };
	}
	return { head: split(m.title), rest: split((m.body || '').slice(0, 320)) };
}

const isNum = (w: string) => /^\d+$/.test(w);
const edgeOk = (lw: string) => lw.length >= 3 && !STOP.has(lw) && !isNum(lw);
const topicEdgeOk = (lw: string) => edgeOk(lw) && !TOPIC_EDGE_STOP.has(lw) && !/(ly|ed)$/.test(lw) && !/['’]/.test(lw);

/**
 * Every phrase key a document contributes to the background counts: 1-3 word runs whose
 * ends aren't stopwords (the same keys `candidates` produces, of either kind).
 */
export function docKeys(m: { title: string; body: string; isPost: boolean }): Set<string> {
	const out = new Set<string>();
	const { head, rest } = partsOf(m);
	for (const toks of [...head, ...rest]) {
		const lw = toks.map((w) => w.toLowerCase());
		for (let i = 0; i < toks.length; i++) {
			if (!edgeOk(lw[i]) && !isAcronym(toks[i])) continue;
			for (let n = 1; n <= 3 && i + n <= toks.length; n++) {
				const last = lw[i + n - 1];
				if (isNum(last)) break;
				if (!edgeOk(last) && !isAcronym(toks[i + n - 1])) continue;
				if (n === 3 && !edgeOk(lw[i + 1]) && !MIDDLE_OK.has(lw[i + 1])) continue;
				out.add(toks.slice(i, i + n).map(stem).join(' '));
			}
		}
	}
	return out;
}

// ---------- candidates ----------

const isAcronym = (w: string) => /^[A-Z]{2,5}$/.test(w) && !STOP.has(w.toLowerCase());
const titleCase = (s: string) =>
	s
		.split(' ')
		.map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : /^[A-Z]{2,}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
		.join(' ');

/** A Title Case headline ("Sean Duffy Says It's Unclear How Router Overloaded ATC System"): capitals mark every word. */
function titled(toks: string[]): boolean {
	const words = toks.filter((w) => w.length >= 4 && !isNum(w));
	return words.length >= 3 && words.filter((w) => /^[A-Z]/.test(w)).length / words.length >= 0.6;
}

/** A sentence written in capitals ("*FAA PAUSES ROUTER INSTALLATIONS"): case says nothing there. */
function shouted(toks: string[]): boolean {
	const words = toks.filter((w) => w.length >= 3 && !isNum(w));
	return words.length >= 3 && words.filter((w) => w === w.toUpperCase()).length / words.length >= 0.6;
}

interface Agg {
	kind: 'name' | 'topic';
	members: Set<number>;
	sources: Set<string>;
	inTitle: boolean;
	shown: Map<string, number>;
	/** One-word WHATs: how often it's used, and how often a content word follows (an adjective's habit). */
	uses: number;
	modifies: number;
	/** The key whose feed-wide rarity scores this phrase (a "Senate race" is as rare as "race"). */
	dfKey: string;
}

export function candidates(members: NameMember[], ctx: NameContext): Candidates {
	const agg = new Map<string, Agg>();
	const memberWords: Set<string>[] = [];
	const parts = members.map(partsOf);

	// Acronyms written as such somewhere in the storyline, so they're recognised inside
	// all-capitals headlines too.
	const acronyms = new Set<string>();
	for (const p of parts) for (const toks of [...p.head, ...p.rest]) if (!shouted(toks)) for (const w of toks) if (isAcronym(w)) acronyms.add(w);

	const add = (kind: 'name' | 'topic', toks: string[], idx: number, src: string, head: boolean, display: string | null, dfFrom = 0): Agg => {
		const key = toks.map(stem).join(' ');
		const id = `${kind}:${key}`;
		let a = agg.get(id);
		if (!a) agg.set(id, (a = { kind, members: new Set(), sources: new Set(), inTitle: false, shown: new Map(), uses: 0, modifies: 0, dfKey: toks.slice(dfFrom).map(stem).join(' ') }));
		a.uses++;
		a.members.add(idx);
		a.sources.add(src);
		if (head) a.inTitle = true;
		if (display) a.shown.set(display, (a.shown.get(display) ?? 0) + 1);
		return a;
	};

	members.forEach((m, idx) => {
		const boiler = ctx.boiler.get(m.sourceKey);
		const words = new Set<string>();
		memberWords.push(words);
		for (const [head, sents] of [
			[true, parts[idx].head],
			[false, parts[idx].rest]
		] as const) {
			for (const toks of sents) {
				const loud = shouted(toks);
				const plain = !loud && !titled(toks);
				const lw = toks.map((w) => w.toLowerCase());
				for (const w of toks) words.add(stem(w));
				// Classify each token: a name, an ordinary word, or a break (number, boilerplate).
				// Boilerplate only silences ordinary words: a local station names its city in most
				// items, and that city is still the right WHERE for its stories.
				const isName = (w: string, i: number): boolean => {
					if (loud) return acronyms.has(w) || (ctx.proper.has(lw[i]) && lw[i].length >= 3 && !STOP.has(lw[i]));
					if (isAcronym(w)) return true;
					if (/^[A-Z]/.test(w) && ctx.proper.has(lw[i]) && !STOP.has(lw[i])) return true;
					// In an ordinary sentence a capital mid-sentence marks a name even when the word
					// is usually a common one ("Clean Harbors", "Deer Park").
					if (plain && i > 0 && /^[A-Z][a-z]/.test(w) && w.length >= 3 && !STOP.has(lw[i])) return true;
					// "New York", "New Orleans": a stopword that starts a place name.
					return w === 'New' && i + 1 < toks.length && /^[A-Z]/.test(toks[i + 1]) && ctx.proper.has(lw[i + 1]);
				};
				const cls = toks.map((w, i): 'name' | 'word' | 'break' => {
					if (isNum(w)) return 'break';
					if (isName(w, i)) return 'name';
					return boiler?.has(lw[i]) ? 'break' : 'word';
				});
				for (let i = 0; i < toks.length; i++) {
					for (let n = 1; n <= 3 && i + n <= toks.length; n++) {
						const span = cls.slice(i, i + n);
						if (span.includes('break')) break;
						const t = toks.slice(i, i + n);
						const l = lw.slice(i, i + n);
						if (span.every((c) => c === 'name')) {
							const ends = (w: string, lw: string) => (edgeOk(lw) || isAcronym(w)) && !TITLES.has(lw);
							if ((ends(t[0], l[0]) || (t[0] === 'New' && n > 1)) && ends(t[n - 1], l[n - 1])) add('name', t, idx, m.sourceKey, head, loud ? null : t.join(' '));
						} else if (span.every((c) => c === 'word')) {
							if (!topicEdgeOk(l[0]) || !topicEdgeOk(l[n - 1])) continue;
							if (n === 1 && (l[0].length < 4 || ctx.verbs.has(l[0]))) continue;
							if (n === 3 && !topicEdgeOk(l[1]) && !MIDDLE_OK.has(l[1])) continue;
							const a = add('topic', l, idx, m.sourceKey, head, l.join(' '));
							if (n === 1 && cls[i + 1] === 'word' && topicEdgeOk(lw[i + 1])) a.modifies++;
						} else if (n >= 2 && span[0] === 'name' && span.slice(1).every((c) => c === 'word')) {
							// A name used as a modifier: "Senate race", "Grammy nominations".
							if (!topicEdgeOk(l[n - 1]) || (n === 3 && !topicEdgeOk(l[1]))) continue;
							add('topic', l, idx, m.sourceKey, head, loud ? null : [t[0], ...l.slice(1)].join(' '), 1);
						}
					}
				}
			}
		}
	});

	const n = members.length;
	const allSources = new Set(members.map((m) => m.sourceKey)).size;
	const norm = Math.log(ctx.docs + 1) || 1;
	let list: Candidate[] = [];
	for (const [id, a] of agg) {
		const key = id.slice(a.kind.length + 1);
		const count = a.members.size;
		if (a.kind === 'name' && count < Math.max(Math.min(2, n), Math.ceil(0.3 * n))) continue;
		// A WHAT has to be in somebody's headline: that's where a story says what happened.
		if (a.kind === 'topic' && (!a.inTitle || a.sources.size < Math.min(2, allSources) || count / n < 0.25)) continue;
		// A lone word that's nearly always followed by another ("forensic expert", "western
		// leaders") is describing something, not naming it.
		if (a.kind === 'topic' && !key.includes(' ') && a.uses >= 2 && a.modifies / a.uses >= 0.6) continue;
		const df = ctx.phraseDf.get(a.dfKey) ?? 0;
		const specificity = Math.max(0, Math.log((ctx.docs + 1) / (df + 1)) / norm);
		const display = [...a.shown].sort((x, y) => y[1] - x[1])[0]?.[0] ?? titleCase(key);
		list.push({
			key,
			display: a.kind === 'name' ? (a.shown.size ? display : titleCase(key)) : display,
			kind: a.kind,
			members: count,
			coverage: count / n,
			sources: a.sources.size,
			inTitle: a.inTitle,
			score: (count / n) * specificity * (a.inTitle ? 1.3 : 1) * (a.kind === 'topic' && key.includes(' ') ? 1.15 : 1)
		});
	}
	// A shorter phrase gives way to a longer one that nearly every one of its members also
	// says ("Harbors" to "Clean Harbors", "stop" to "ground stop").
	list = list.filter(
		(c) =>
			!list.some((o) => o !== c && o.kind === c.kind && o.key.length > c.key.length && (' ' + o.key + ' ').includes(' ' + c.key + ' ') && o.members >= 0.8 * c.members)
	);
	list.sort((a, b) => b.score - a.score);
	return { n, sources: allSources, list, memberWords };
}

// ---------- composing ----------

/** Final rank within a kind: c-TF-IDF, blended with closeness to the centroid when known. */
function ranked(list: Candidate[], closeness?: Map<string, number>): Candidate[] {
	if (list.length === 0) return [];
	const top = Math.max(...list.map((c) => c.score)) || 1;
	const cos = closeness ? list.map((c) => closeness.get(c.key)).filter((v): v is number => v !== undefined) : [];
	const lo = Math.min(...cos);
	const hi = Math.max(...cos);
	const final = (c: Candidate) => {
		const s = c.score / top;
		const v = closeness?.get(c.key);
		if (v === undefined || cos.length < 2 || hi - lo < 1e-6) return s;
		return 0.8 * s + 0.2 * ((v - lo) / (hi - lo));
	};
	return [...list].sort((a, b) => final(b) - final(a));
}

const MAX_WORDS = 4;
const MAX_CHARS = 30;

export function composeTag(c: Candidates, closeness?: Map<string, number>): string {
	const names = ranked(c.list.filter((x) => x.kind === 'name'), closeness);
	const name = names[0];
	const nameWords = name ? name.key.split(' ') : [];
	// A WHAT that only repeats the name adds nothing.
	const topics = ranked(
		c.list.filter((x) => x.kind === 'topic' && x.coverage >= 0.4 && x.key.split(' ').some((w) => !nameWords.includes(w))),
		closeness
	);
	// A WHAT phrase has to carry real weight next to the name, not just exist.
	const topic = topics.find((t) => !name || t.score >= 0.3 * name.score);
	const nameText = name ? name.display.split(' ').slice(0, 3).join(' ') : '';
	if (!topic) return nameText;
	const shown = titleCase(topic.display).split(' ');
	if (!name) return shown.join(' ');
	if (nameWords.length >= 3) return nameText;
	// "Kensington" + "Kensington shooting" -> "Kensington Shooting"; "Alaska" + "Senate race" -> "Alaska Senate Race".
	const extra = shown.filter((w, i) => !nameWords.includes(topic.key.split(' ')[i]));
	const both = topic.key.startsWith(name.key + ' ') ? shown.join(' ') : `${nameText} ${extra.join(' ')}`;
	return both.split(' ').length <= MAX_WORDS && both.length <= MAX_CHARS ? both : nameText;
}

/** How strongly the storyline backs a name: its best WHO part plus its best WHAT part. */
export function tagStrength(tag: string, c: Candidates): number {
	const words = new Set(tag.split(/\s+/).filter(Boolean).map(stem));
	const inTag = (x: Candidate) => x.key.split(' ').every((w) => words.has(w));
	const name = c.list.filter((x) => x.kind === 'name' && inTag(x)).sort((a, b) => b.score - a.score)[0];
	const used = new Set(name ? name.key.split(' ') : []);
	const topic = c.list.filter((x) => x.kind === 'topic' && inTag(x) && !x.key.split(' ').some((w) => used.has(w))).sort((a, b) => b.score - a.score)[0];
	return (name?.score ?? 0) + (topic?.score ?? 0);
}

/** The share of members that contain every word of a name. */
export function tagCoverage(tag: string, c: Candidates): number {
	const words = tag
		.split(/\s+/)
		.map(stem)
		.filter((w) => w && !STOP.has(w) && !SMALL.has(w));
	if (words.length === 0 || c.n === 0) return 0;
	return c.memberWords.filter((m) => words.every((w) => m.has(w))).length / c.n;
}

/** The candidates worth embedding for the centroid check: the top few of each kind. */
export function rerankPool(c: Candidates, perKind = 6): Candidate[] {
	return [...c.list.filter((x) => x.kind === 'name').slice(0, perKind), ...c.list.filter((x) => x.kind === 'topic').slice(0, perKind)];
}
