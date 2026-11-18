/**
 * "Add by URL" (admin Sources & columns, the board's ⌘K palette): turns whatever the admin
 * pasted - a feed, a site, a YouTube channel, a t.me link, an x.com profile or a Nitter feed -
 * into the fields a new source needs (type, name, the url the poller reads), and says when
 * an existing source already reads it. Only reads the network for plain web links (to find
 * the feed and its title) and YouTube links (to find the channel's name); nothing is saved.
 *
 * Admin-only and admin-supplied, like every source URL the poller fetches anyway, so it
 * isn't SSRF-guarded: a self-hosted feed or Nitter on the LAN is a normal thing to add.
 */
import Parser from 'rss-parser';
import type { Source } from '../storage/db/types.js';

export interface DetectedSource {
	type: Source['type'];
	name: string;
	url: string;
	/** What was found, in a few words for the UI ("RSS feed", "YouTube channel"…). */
	found: string;
	/** An existing source that already reads this url. */
	existing: { id: string; name: string; category: string[] } | null;
	/** Anything the admin should know before adding it. */
	note: string | null;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; HomefeedBot/1.0; self-hosted RSS reader)';
const TIMEOUT_MS = 10_000;
const parser = new Parser();

const norm = (u: string) =>
	u
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/^www\./, '')
		.replace(/^@/, '')
		.replace(/\/+$/, '');

/** A url or handle reduced to what identifies the feed: no scheme, www, trailing slash, or the
 *  youtube.com/ / t.me/ prefix and "@" that the same channel is sometimes stored with or without. */
const key = (u: string) =>
	norm(u)
		.replace(/^(m\.)?youtube\.com\//, '')
		.replace(/^(t\.me|telegram\.me)\//, '')
		.replace(/^@/, '');

function findExisting(url: string, type: Source['type'], sources: Source[]): DetectedSource['existing'] {
	const k = key(url);
	const hit = sources.find((s) => !!s.url && s.type === type && key(s.url) === k) ?? sources.find((s) => !!s.url && norm(s.url) === norm(url));
	return hit ? { id: hit.id, name: hit.name, category: hit.category } : null;
}

async function get(url: string): Promise<{ text: string; type: string; finalUrl: string }> {
	const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5' }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
	if (!res.ok) throw new Error(`the site answered ${res.status}`);
	const text = (await res.text()).slice(0, 2_000_000);
	return { text, type: res.headers.get('content-type') ?? '', finalUrl: res.url || url };
}

const looksLikeFeed = (text: string, type: string) => /(rss|atom|xml)/i.test(type) || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)[\s>]/i.test(text);

const decode = (s: string) =>
	s
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.trim();

/** The page's advertised feeds (<link rel="alternate" type="application/rss+xml" href=…>), RSS before Atom. */
function feedLinks(html: string, base: string): string[] {
	const out: { href: string; atom: boolean }[] = [];
	for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
		if (!/rel=["']?alternate/i.test(tag)) continue;
		const type = tag.match(/type=["']([^"']+)["']/i)?.[1] ?? '';
		if (!/(rss|atom)\+xml/i.test(type)) continue;
		const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
		if (!href) continue;
		try {
			out.push({ href: new URL(decode(href), base).toString(), atom: /atom/i.test(type) });
		} catch {
			/* a malformed href: skip it */
		}
	}
	return out.sort((a, b) => Number(a.atom) - Number(b.atom)).map((l) => l.href);
}

async function feedTitle(xml: string): Promise<string | null> {
	try {
		const feed = await parser.parseString(xml);
		return feed.title?.trim() || null;
	} catch {
		return null;
	}
}

const hostName = (u: string) => {
	try {
		return new URL(u).hostname.replace(/^www\./, '');
	} catch {
		return u;
	}
};

export async function detectSource(rawInput: string, nitterInstanceUrl: string, sources: Source[]): Promise<DetectedSource> {
	const input = rawInput.trim();
	if (!input) throw new Error('Paste a link or a handle.');
	const done = (d: Omit<DetectedSource, 'existing'>): DetectedSource => ({ ...d, existing: findExisting(d.url, d.type, sources) });

	// Telegram: t.me / telegram.me links, or a bare @name.
	const tg = input.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]{4,})\/?$/i) ?? input.match(/^@([A-Za-z0-9_]{4,})$/);
	if (tg) {
		return done({
			type: 'telegram',
			name: tg[1],
			url: `@${tg[1]}`,
			found: 'Telegram channel',
			note: input.startsWith('@') ? 'Read as a Telegram channel. Paste an x.com link for an X account.' : null
		});
	}

	// X / Twitter profiles become a feed on the configured Nitter instance.
	const x = input.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/i);
	if (x) {
		const base = (nitterInstanceUrl || 'https://nitter.net').replace(/\/+$/, '');
		return done({ type: 'nitter', name: `@${x[1]}`, url: `${base}/${x[1]}/rss`, found: 'X account, read through Nitter', note: null });
	}

	// A feed on the configured Nitter instance, pasted as is.
	if (nitterInstanceUrl && norm(input).startsWith(norm(nitterInstanceUrl))) {
		const handle = input.replace(/\/rss\/?$/, '').split('/').filter(Boolean).pop() ?? 'Nitter feed';
		return done({ type: 'nitter', name: handle.startsWith('@') ? handle : `@${handle}`, url: input, found: 'Nitter feed', note: null });
	}

	// YouTube channels (any form the poller understands); the channel's name comes from its page.
	if (/^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(input)) {
		if (/[?&]v=|youtu\.be\/|\/shorts\/|\/watch/i.test(input)) throw new Error('That is a single video. Paste the channel link instead (youtube.com/@name).');
		const url = /^https?:\/\//i.test(input) ? input : `https://${input}`;
		let name = url.match(/\/@([^/?#]+)/)?.[1] ?? url.match(/\/(?:c|user)\/([^/?#]+)/)?.[1] ?? 'YouTube channel';
		try {
			const { text } = await get(url);
			const og = text.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1];
			if (og) name = decode(og);
		} catch {
			/* keep the name from the link */
		}
		return done({ type: 'youtube', name, url, found: 'YouTube channel', note: null });
	}

	// Anything else has to be a web link: a feed, or a page that advertises one.
	let url = input;
	if (!/^https?:\/\//i.test(url)) {
		if (!/^[\w-]+(\.[\w-]+)+(\/|$)/.test(url)) throw new Error('Not a link, channel or handle Homefeed can read.');
		url = `https://${url}`;
	}
	const page = await get(url);
	if (looksLikeFeed(page.text, page.type)) {
		const title = await feedTitle(page.text);
		if (!title && !/<(rss|feed|rdf:RDF)/i.test(page.text)) throw new Error('That link answered, but not with a feed.');
		return done({ type: 'rss', name: title ?? hostName(page.finalUrl), url: page.finalUrl, found: 'RSS feed', note: null });
	}
	for (const link of feedLinks(page.text, page.finalUrl)) {
		try {
			const feed = await get(link);
			if (!looksLikeFeed(feed.text, feed.type)) continue;
			const title = await feedTitle(feed.text);
			return done({ type: 'rss', name: title ?? hostName(page.finalUrl), url: feed.finalUrl, found: 'RSS feed, found on the page', note: null });
		} catch {
			/* try the next advertised feed */
		}
	}
	throw new Error('No feed found on that page. Paste the feed link itself if the site has one.');
}
