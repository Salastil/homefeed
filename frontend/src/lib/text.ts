/**
 * Display helpers shared by the board, tiles, timelines and article pages: what kind of
 * item something is, who it's from, its picture, and cleaned-up text (feed boilerplate,
 * "BREAKING:" prefixes, Telegram flag emoji and channel promos stripped).
 */
import { resolveMediaUrl } from './config';
import type { LiteArticle, MergedArticle } from './types';

type Item = Pick<LiteArticle, 'tweet' | 'telegramMessage' | 'heroImage' | 'title' | 'sourceName'> & {
	hasVideo?: boolean;
	video?: MergedArticle['video'];
	excerpt?: string;
	body?: string;
};

export type ItemKind = 'article' | 'video' | 'photo' | 'text';

export const KIND_LABEL: Record<ItemKind, string> = { article: 'Article', video: 'Video', photo: 'Photo', text: 'Text' };

export const KIND_ICON: Record<ItemKind, string> = {
	video: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>',
	photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="m21 17-5-5-8 8"/></svg>',
	text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
	article: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>'
};

export function isPost(a: Pick<Item, 'tweet' | 'telegramMessage'>): boolean {
	return !!(a.tweet || a.telegramMessage);
}

/** A post's kind comes from its first attachment; an article with a video is a video. */
export function kindOf(a: Item): ItemKind {
	if (!isPost(a)) return a.hasVideo || a.video ? 'video' : 'article';
	const media = a.tweet?.media ?? a.telegramMessage?.media ?? [];
	if (media.length === 0) return 'text';
	return media[0].type === 'photo' ? 'photo' : 'video';
}

/** Display name and handle: an X/Telegram account, or the article's source. */
export function authorOf(a: Item): { name: string; handle: string; avatar: string | null } {
	if (a.tweet) return { name: a.tweet.authorName, handle: '@' + a.tweet.authorHandle, avatar: a.tweet.avatarUrl ? resolveMediaUrl(a.tweet.avatarUrl) : null };
	if (a.telegramMessage) {
		const t = a.telegramMessage;
		return { name: t.channelName || a.sourceName, handle: t.channelUsername ? '@' + t.channelUsername : '', avatar: t.channelAvatarUrl ? resolveMediaUrl(t.channelAvatarUrl) : null };
	}
	return { name: a.sourceName, handle: 'article', avatar: null };
}

export function initials(name: string): string {
	return (name.match(/[A-Za-z0-9]+/g) ?? [])
		.slice(0, 2)
		.map((w) => w[0])
		.join('')
		.toUpperCase();
}

/** The item's still image: hero image, or a post's first photo / video poster. */
export function imageOf(a: Item): { url: string; isVideo: boolean } | null {
	if (!isPost(a)) return a.heroImage ? { url: resolveMediaUrl(a.heroImage.url), isVideo: !!(a.hasVideo || a.video) } : null;
	const m = (a.tweet?.media ?? a.telegramMessage?.media ?? [])[0];
	if (!m) return null;
	if (m.type === 'photo') return { url: resolveMediaUrl(m.url), isVideo: false };
	return m.thumbnailUrl ? { url: resolveMediaUrl(m.thumbnailUrl), isVideo: true } : null;
}

const PROMO = /(💧\s*)?Rainbet\.com[\s\S]*$/;
const PREFIX = /^(WATCH|BREAKING UPDATE|BREAKING|JUST IN|UPDATE|NOW|NEW|MORE)\b[^A-Za-z"“‘']*/;

/** A post's own text, cleaned: reply marker, trailing @handle sign-off, URLs, leading flags/emoji and "BREAKING:" style prefixes removed. */
export function cleanPost(text: string, oneLine = false): string {
	let t = (text || '').replace(PROMO, '').replace(/^R to @\w+: /, '').trim();
	t = t.replace(/\s*@\w+\s*$/, '').replace(/https?:\/\/\S+/g, '');
	const lines = t
		.split('\n')
		.map((l) => l.replace(/^[^A-Za-z0-9"“‘']+/, '').replace(PREFIX, '').trim())
		.filter(Boolean);
	return oneLine ? lines[0] ?? '' : lines.join(' ');
}

/** Article body paragraphs with common feed boilerplate (bullet kickers, datelines, station tags) dropped. */
export function paragraphs(body: string): string[] {
	const out: string[] = [];
	for (const raw of (body || '').split(/\n+/)) {
		let p = raw.trim();
		if (!p || p.startsWith('•') || p.length < 25) continue;
		if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [A-Z][a-z]+ \d+, \d{4}/.test(p)) continue;
		if (/^(WPVI|NewsFeed|Published On|Copyright)/.test(p)) continue;
		p = p.replace(/^[A-Z][A-Za-z .'-]+(, [A-Za-z.]+)? \((WPVI|AP|KTRK|WABC)\) ?-- ?/, '');
		out.push(p);
	}
	return out;
}

/** One-line headline for any item: an article's title, or a post's cleaned first line. */
export function headlineOf(a: Item): string {
	if (!isPost(a)) return a.title;
	return cleanPost(a.excerpt ?? a.body ?? a.title, true) || a.title;
}

/** Body-ish text for a tile or row: a post's full cleaned text, or an article's cleaned excerpt. */
export function textOf(a: Item): string {
	if (isPost(a)) return cleanPost(a.excerpt ?? a.body ?? '');
	return paragraphs(a.excerpt ?? a.body ?? '').join(' ');
}

export function hhmm(iso: string): string {
	const d = new Date(iso);
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function clockTime(iso: string): string {
	return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "4m", "3h", "2d" relative to `now` - pass clock.now so it re-renders on the shared tick. */
export function ago(iso: string, now: number): string {
	const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
	if (m < 60) return `${m}m`;
	const h = Math.round(m / 60);
	return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** "just now", "35m ago", "3hr ago", "4 days ago" - pass clock.now so it re-renders on the shared tick. */
export function relTime(iso: string, now: number): string {
	const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
	if (m < 1) return 'just now';
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}hr ago`;
	const d = Math.floor(h / 24);
	return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

/** "1h 47m" / "28m" until a timestamp. */
export function until(iso: string, now: number): string {
	const m = Math.max(0, Math.round((new Date(iso).getTime() - now) / 60000));
	return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** Posts with identical text are reposts of one another: one card, the rest named on it. */
export function foldReposts<T extends LiteArticle>(items: T[]): { item: T; reposts: T[] }[] {
	const groups = new Map<string, { item: T; reposts: T[] }>();
	for (const a of [...items].sort((x, y) => x.publishedAt.localeCompare(y.publishedAt))) {
		const key = isPost(a) ? cleanPost(a.excerpt).slice(0, 200) : a.id;
		const g = groups.get(key);
		if (g) g.reposts.push(a);
		else groups.set(key, { item: a, reposts: [] });
	}
	return [...groups.values()];
}

/** Category name -> its column colour token. */
export function categoryColor(name: string | undefined): string {
	const n = (name ?? '').toLowerCase();
	const map: Record<string, string> = {
		news: 'var(--c-news)',
		world: 'var(--c-news)',
		local: 'var(--c-local)',
		business: 'var(--c-biz)',
		culture: 'var(--c-cult)',
		tech: 'var(--c-tech)',
		magazine: 'var(--c-mag)',
		wire: 'var(--c-wire)',
		general: 'var(--c-gen)'
	};
	if (map[n]) return map[n];
	// Any other admin-made category gets a stable colour from its name.
	const palette = ['#e2896a', '#d9a94e', '#7fa8ea', '#56b8a8', '#c39be6', '#e07a9a', '#8fbf6a', '#6cc3d9'];
	let h = 0;
	for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	return palette[h % palette.length];
}

/** Colours offered for board columns: theme tokens first (they adapt to light/dark), then a few fixed ones. */
export const COLUMN_SWATCHES = ['c-news', 'c-local', 'c-wire', 'c-biz', 'c-cult', 'c-tech', 'c-mag', 'c-gen', '#e2896a', '#d9a94e', '#e5484d', '#3fa9dc'];

/** A board column's colour: the admin's choice (token or hex) or the default for its name. */
export function columnColor(name: string | undefined, override?: string | null): string {
	if (override) return override.startsWith('#') ? override : `var(--${override})`;
	return categoryColor(name);
}

export const STORY_PALETTE = ['#e2896a', '#d9a94e', '#7fa8ea', '#56b8a8', '#c39be6', '#e07a9a', '#8fbf6a', '#6cc3d9', '#e0b06a'];

/** A storyline keeps one colour for as long as it lives, picked from its id. */
export function storyColor(id: string): string {
	let h = 0;
	for (const ch of id) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
	return STORY_PALETTE[h % STORY_PALETTE.length];
}
