/**
 * Read API for the new board: storylines, tracked-event timelines, the board's columns in a
 * single poll, and storyline context for an article page. All public; private-category
 * articles are filtered out without a private-access cookie, the same as /api/feed.
 *
 * Payloads use a "lite" article (no full body - an excerpt instead) since the board polls
 * these every minute and holds them in a long-lived tab.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as articlesDb from '../storage/db/articles.js';
import * as categoriesDb from '../storage/db/categories.js';
import * as eventsDb from '../storage/db/events.js';
import * as settingsDb from '../storage/db/settings.js';
import * as stl from '../storage/db/storylines.js';
import type { MergedArticle, StorylineSettings } from '../storage/db/types.js';
import { hasPrivateAccess } from './privateAccess.js';
import { closesAt, engineStatus, sourceKeyOf, storylineState } from '../pipeline/storylines.js';

const HOUR = 3_600_000;
const EXCERPT = 600;
const COLUMN_SIZE = 30;
const MAX_MEMBERS = 40;

export interface LiteArticle {
	id: string;
	title: string;
	excerpt: string;
	heroImage: MergedArticle['heroImage'];
	hasVideo: boolean;
	tweet: MergedArticle['tweet'];
	telegramMessage: MergedArticle['telegramMessage'];
	category: string[];
	eventId: string | null;
	sourceName: string;
	sourceKey: string;
	sourceLink: string | null;
	sourceCount: number;
	publishedAt: string;
	isRecap: boolean;
}

export function lite(a: MergedArticle): LiteArticle {
	return {
		id: a.id,
		title: a.title,
		excerpt: (a.body || '').slice(0, EXCERPT),
		heroImage: a.heroImage,
		hasVideo: !!a.video,
		tweet: a.tweet,
		telegramMessage: a.telegramMessage,
		category: a.category,
		eventId: a.eventId,
		sourceName: a.sources[0]?.sourceName ?? '',
		sourceKey: sourceKeyOf(a),
		sourceLink: a.sources[0]?.link ?? null,
		sourceCount: a.sourceCount,
		publishedAt: a.publishedAt,
		isRecap: a.isRecap
	};
}

function visibilityFilter(req: FastifyRequest): (a: MergedArticle) => boolean {
	if (hasPrivateAccess(req)) return () => true;
	const hidden = new Set(categoriesDb.listPrivateCategoryNames());
	return (a) => !a.category.some((c) => hidden.has(c));
}

/** Newest photo among the members: an article's hero image first, then a post's photo. Video-only posts have no still to show. */
function pickImage(membersNewestFirst: MergedArticle[]): { url: string; credit: string; at: string } | null {
	for (const preferArticle of [true, false]) {
		for (const m of membersNewestFirst) {
			if (preferArticle && !m.heroImage) continue;
			if (m.heroImage) return { url: m.heroImage.url, credit: m.sources[0]?.sourceName ?? '', at: m.publishedAt };
			const media = m.tweet?.media ?? m.telegramMessage?.media ?? [];
			const photo = media.find((x) => x.type === 'photo');
			if (photo) return { url: photo.url, credit: m.tweet ? '@' + m.tweet.authorHandle : m.sources[0]?.sourceName ?? '', at: m.publishedAt };
		}
	}
	return null;
}

function activity(members: MergedArticle[], now: number): number {
	return members.reduce((sum, m) => sum + Math.exp(-(now - new Date(m.publishedAt).getTime()) / HOUR / 3), 0);
}

interface StorylinePayload {
	id: string;
	scope: string;
	tag: string;
	label: string;
	labelArticleId: string | null;
	state: 'live' | 'cooling' | 'closed';
	closesAt: string;
	firstItemAt: string;
	lastItemAt: string;
	itemCount: number;
	sourceCount: number;
	continuesId: string | null;
	image: { url: string; credit: string; at: string } | null;
	score: number;
	members: LiteArticle[];
}

function payload(row: stl.StorylineRow, members: MergedArticle[], settings: StorylineSettings, now: number): StorylinePayload {
	const labelArticle = members.find((m) => m.id === row.labelArticleId) ?? members.find((m) => !m.tweet && !m.telegramMessage) ?? members[0];
	const shown = members.slice(-MAX_MEMBERS);
	return {
		id: row.id,
		scope: row.scope,
		tag: row.tag,
		label: labelArticle?.title ?? '',
		labelArticleId: labelArticle?.id ?? null,
		state: storylineState(row, settings, now),
		closesAt: closesAt(row, settings),
		firstItemAt: members[0]?.publishedAt ?? row.firstItemAt,
		lastItemAt: members[members.length - 1]?.publishedAt ?? row.lastItemAt,
		itemCount: members.length,
		sourceCount: new Set(members.map(sourceKeyOf)).size,
		continuesId: row.continuesId,
		image: pickImage([...members].reverse()),
		score: activity(members, now),
		members: shown.map(lite)
	};
}

function membersVisible(row: stl.StorylineRow, visible: (a: MergedArticle) => boolean): MergedArticle[] {
	return articlesDb.getArticles(stl.memberIds(row.id)).filter(visible);
}

function isShown(p: StorylinePayload, minItems: number, minSources: number): boolean {
	return p.itemCount >= minItems && p.sourceCount >= minSources;
}

/** A tracked event's developments touched within `hours`, oldest first, plus everything else it published in that window. */
function eventTimeline(eventId: string, hours: number, visible: (a: MergedArticle) => boolean, settings: StorylineSettings, now: number) {
	const since = new Date(now - hours * HOUR).toISOString();
	const devs = stl
		.storylinesTouchedSince(`event:${eventId}`, since)
		.map((row) => payload(row, membersVisible(row, visible), settings, now))
		.filter((p) => isShown(p, 2, 2))
		.sort((a, b) => a.lastItemAt.localeCompare(b.lastItemAt));
	const inDev = new Set(devs.flatMap((d) => d.members.map((m) => m.id)));
	const posts = articlesDb.queryWhere('event_id = ? AND published_at >= ?', [eventId, since], 500).filter(visible);
	const singles = posts.filter((p) => !inDev.has(p.id)).map(lite);
	return {
		developments: devs,
		singles,
		postCount: posts.length,
		channelCount: new Set(posts.map(sourceKeyOf)).size
	};
}

export async function registerStorylineRoutes(app: FastifyInstance) {
	// The board's storyline panel: open storylines (most active first) and, when enabled,
	// each active tracked event as a pinned storyline whose timeline is its developments.
	app.get('/api/storylines', async (req) => {
		const settings = settingsDb.getSettings().storylines;
		const visible = visibilityFilter(req);
		const now = Date.now();
		const since = new Date(now - Math.max(settings.closeHours, 1) * HOUR).toISOString();
		const all = stl.storylinesTouchedSince('news', since).map((row) => payload(row, membersVisible(row, visible), settings, now));
		const storylines = all
			.filter((p) => p.state !== 'closed' && isShown(p, settings.minItems, settings.minSources))
			.sort((a, b) => b.score - a.score);
		const dayAgo = new Date(now - 24 * HOUR).toISOString();
		const closedToday = stl
			.storylinesTouchedSince('news', dayAgo)
			.filter((row) => storylineState(row, settings, now) === 'closed' && row.itemCount >= settings.minItems && row.sourceCount >= settings.minSources).length;

		const events = settings.includeEvents
			? eventsDb.listActiveEvents().map((ev) => {
					const tl = eventTimeline(ev.id, 12, visible, settings, now);
					const devs = tl.developments.slice(-6);
					const image = pickImage(devs.slice().reverse().flatMap((d) => articlesDb.getArticles(d.members.map((m) => m.id)).reverse()));
					return {
						id: ev.id,
						name: ev.name,
						recapIntervalHours: ev.recapIntervalHours,
						postCount: tl.postCount,
						channelCount: tl.channelCount,
						developmentCount: tl.developments.length,
						developments: devs,
						image,
						score: devs.reduce((sum, d) => sum + Math.exp(-(now - new Date(d.lastItemAt).getTime()) / HOUR / 3), 0)
					};
				})
			: [];

		return {
			settings: {
				rows: settings.rows,
				rotateSeconds: settings.rotateSeconds,
				jumpOnUpdate: settings.jumpOnUpdate,
				pauseOnHover: settings.pauseOnHover,
				closeHours: settings.closeHours
			},
			storylines,
			events,
			closedToday,
			// False while the embedding service is unreachable: nothing new can be grouped.
			grouping: engineStatus.reachable !== false
		};
	});

	app.get('/api/storylines/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		const row = stl.getStoryline(id);
		if (!row) return reply.code(404).send({ error: 'not found' });
		const settings = settingsDb.getSettings().storylines;
		const members = membersVisible(row, visibilityFilter(req));
		if (members.length === 0) return reply.code(404).send({ error: 'not found' });
		const p = payload(row, members, settings, Date.now());
		return { ...p, members: members.map(lite) };
	});

	app.get('/api/events/:id/timeline', async (req, reply) => {
		const { id } = req.params as { id: string };
		const { hours } = req.query as { hours?: string };
		const ev = eventsDb.getEvent(id);
		if (!ev || !ev.active) return reply.code(404).send({ error: 'not found' });
		const h = Math.min(Math.max(Number(hours) || 12, 1), 72);
		const settings = settingsDb.getSettings().storylines;
		const tl = eventTimeline(id, h, visibilityFilter(req), settings, Date.now());
		return {
			event: { id: ev.id, name: ev.name, recapIntervalHours: ev.recapIntervalHours, lastRecapAt: ev.lastRecapAt },
			hours: h,
			...tl
		};
	});

	// Every board column in one poll. Category columns follow the admin's category list
	// (Top stories excluded - the board itself is the top-level view); Wire is posts
	// (X/Telegram) from sources with no category, General is articles with none. A
	// tracked event's own posts stay out of Wire/General - they show in the event's row.
	app.get('/api/board', async (req) => {
		const includePrivate = hasPrivateAccess(req);
		const dayAgo = new Date(Date.now() - 24 * HOUR).toISOString();
		const categories = categoriesDb.listCategories().filter((c) => (includePrivate || !c.isPrivate) && c.name.toLowerCase() !== 'top stories');
		const columns = categories.map((c) => {
			const items = articlesDb.queryFeed({ category: c.name, limit: COLUMN_SIZE }, includePrivate);
			return {
				key: `cat:${c.id}`,
				kind: 'category' as const,
				name: c.name,
				categoryId: c.id,
				isSpillover: c.isSpillover,
				isPrivate: c.isPrivate,
				count24h: articlesDb.countWhere('category LIKE ? AND published_at >= ?', [`%"${c.name}"%`, dayAgo]),
				items: items.map(lite)
			};
		});
		const POST = '(tweet IS NOT NULL OR telegram_message IS NOT NULL)';
		const NOT_POST = '(tweet IS NULL AND telegram_message IS NULL)';
		const LOOSE = "category = '[]' AND event_id IS NULL";
		const special = [
			{ key: 'wire', name: 'Wire', where: `${POST} AND ${LOOSE}` },
			{ key: 'general', name: 'General', where: `${NOT_POST} AND ${LOOSE}` }
		].map((col) => ({
			key: col.key,
			kind: col.key as 'wire' | 'general',
			name: col.name,
			categoryId: null,
			isSpillover: false,
			isPrivate: false,
			count24h: articlesDb.countWhere(`${col.where} AND published_at >= ?`, [dayAgo]),
			items: articlesDb.queryWhere(col.where, [], COLUMN_SIZE).map(lite)
		}));
		return { columns: [...columns, ...special].filter((c) => c.items.length > 0 || c.kind === 'category') };
	});

	// Article page side rail: the storyline this article belongs to, or recent articles from
	// its category when it belongs to none.
	app.get('/api/article/:id/context', async (req, reply) => {
		const { id } = req.params as { id: string };
		const article = articlesDb.getArticle(id);
		const visible = visibilityFilter(req);
		if (!article || !visible(article)) return reply.code(404).send({ error: 'not found' });
		const settings = settingsDb.getSettings().storylines;
		const sid = stl.storylineIdOf(id);
		const row = sid ? stl.getStoryline(sid) : null;
		if (row) {
			const members = membersVisible(row, visible);
			const p = payload(row, members, settings, Date.now());
			const minItems = row.scope === 'news' ? settings.minItems : 2;
			const minSources = row.scope === 'news' ? settings.minSources : 2;
			if (isShown(p, minItems, minSources)) return { storyline: { ...p, members: members.map(lite) }, related: [] };
		}
		const cat = article.category[0];
		const related = (cat ? articlesDb.queryFeed({ category: cat, limit: 8 }, hasPrivateAccess(req)) : [])
			.filter((a) => a.id !== id && !a.tweet && !a.telegramMessage)
			.slice(0, 5)
			.map(lite);
		return { storyline: null, related };
	});
}
