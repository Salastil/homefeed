import { randomUUID } from 'node:crypto';
import { db } from './index.js';
import type { MergedArticle } from './types.js';
import { listPrivateCategoryNames } from './categories.js';

function rowToArticle(row: any): MergedArticle {
	return {
		id: row.id,
		title: row.title,
		body: row.body,
		heroImage: row.hero_image ? JSON.parse(row.hero_image) : null,
		video: row.video ? JSON.parse(row.video) : null,
		category: JSON.parse(row.category),
		geo: row.geo,
		eventId: row.event_id,
		sourceCount: row.source_count,
		sources: JSON.parse(row.sources),
		publishedAt: row.published_at,
		updatedAt: row.updated_at,
		mergeConfidence: row.merge_confidence,
		tags: JSON.parse(row.tags),
		threadId: row.thread_id,
		previousArticleId: row.previous_article_id,
		nextArticleId: row.next_article_id,
		topStories: !!row.top_stories,
		tweet: row.tweet ? JSON.parse(row.tweet) : null,
		telegramMessage: row.telegram_message ? JSON.parse(row.telegram_message) : null,
		isRecap: !!row.is_recap,
		fromPosts: !!row.from_posts,
		synthesisInfo: row.synthesis_model
			? { model: row.synthesis_model, genTokensPerSec: row.synthesis_gen_tokens_per_sec, durationMs: row.synthesis_duration_ms }
			: null
	};
}

export function insertArticle(article: Omit<MergedArticle, 'id'>): MergedArticle {
	const id = `art-${randomUUID()}`;
	db.prepare(
		`INSERT INTO merged_articles
		 (id, title, body, hero_image, video, category, geo, event_id, source_count, sources, published_at, updated_at, merge_confidence, tags, thread_id, previous_article_id, next_article_id, top_stories, tweet, telegram_message, is_recap, synthesis_model, synthesis_gen_tokens_per_sec, synthesis_duration_ms, from_posts)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		id,
		article.title,
		article.body,
		article.heroImage ? JSON.stringify(article.heroImage) : null,
		article.video ? JSON.stringify(article.video) : null,
		JSON.stringify(article.category),
		article.geo,
		article.eventId,
		article.sourceCount,
		JSON.stringify(article.sources),
		article.publishedAt,
		article.updatedAt,
		article.mergeConfidence,
		JSON.stringify(article.tags),
		article.threadId,
		article.previousArticleId,
		article.nextArticleId,
		article.topStories ? 1 : 0,
		article.tweet ? JSON.stringify(article.tweet) : null,
		article.telegramMessage ? JSON.stringify(article.telegramMessage) : null,
		article.isRecap ? 1 : 0,
		article.synthesisInfo?.model ?? null,
		article.synthesisInfo?.genTokensPerSec ?? null,
		article.synthesisInfo?.durationMs ?? null,
		article.fromPosts ? 1 : 0
	);
	if (article.previousArticleId) {
		db.prepare('UPDATE merged_articles SET next_article_id = ? WHERE id = ?').run(id, article.previousArticleId);
	}
	return { ...article, id };
}

export function getArticle(id: string): MergedArticle | null {
	const row = db.prepare('SELECT * FROM merged_articles WHERE id = ?').get(id);
	return row ? rowToArticle(row) : null;
}

/** Unpaginated — for internal use (retention sweep), not the public feed API which caps page size. */
export function allArticlesNewestFirst(): MergedArticle[] {
	const rows = db.prepare('SELECT * FROM merged_articles ORDER BY published_at DESC').all();
	return rows.map(rowToArticle);
}

export function queryFeed(
	filters: {
		category?: string;
		geo?: string;
		eventId?: string;
		tag?: string;
		/** The board's two catch-all columns: posts (wire) or articles (general) with no category and no tracked event. */
		kind?: 'wire' | 'general';
		before?: string;
		limit?: number;
	},
	includePrivate = false
): MergedArticle[] {
	let sql = 'SELECT * FROM merged_articles WHERE 1=1';
	const params: unknown[] = [];

	// Without a valid private-access cookie, an article belonging to ANY private
	// category is excluded entirely — including from a public category it's also
	// tagged with, so a private source can't leak in sideways through a shared tag.
	if (!includePrivate) {
		for (const name of listPrivateCategoryNames()) {
			sql += ' AND category NOT LIKE ?';
			params.push(`%"${name}"%`);
		}
	}

	// The bare feed (no category/geo/eventId/tag — i.e. the homepage/"Top stories") only
	// shows articles whose contributing source(s) opted into "Push to Top Stories?" —
	// otherwise every ingested article from every source would flood the homepage.
	// Any explicit filter (a real category page, Local's geo filter, a tag or event page)
	// is unaffected — those show everything matching, regardless of this flag.
	const isHomepage = !filters.category && !filters.geo && !filters.eventId && !filters.tag && !filters.kind;
	if (isHomepage) {
		sql += ' AND top_stories = 1';
	}

	if (filters.category) {
		sql += ' AND category LIKE ?';
		params.push(`%"${filters.category}"%`);
	}
	if (filters.geo) {
		sql += ' AND geo = ?';
		params.push(filters.geo);
	}
	if (filters.eventId) {
		sql += ' AND event_id = ?';
		params.push(filters.eventId);
	}
	if (filters.tag) {
		sql += ' AND tags LIKE ?';
		params.push(`%"${filters.tag}"%`);
	}
	if (filters.kind) {
		sql += filters.kind === 'wire' ? ' AND (tweet IS NOT NULL OR telegram_message IS NOT NULL OR from_posts = 1)' : ' AND tweet IS NULL AND telegram_message IS NULL AND from_posts = 0';
		sql += " AND category = '[]' AND event_id IS NULL";
	}
	if (filters.before) {
		sql += ' AND published_at < ?';
		params.push(filters.before);
	}
	sql += ' ORDER BY published_at DESC LIMIT ?';
	params.push(Math.min(filters.limit ?? 15, 50));
	const rows = db.prepare(sql).all(...(params as any[]));
	return rows.map(rowToArticle);
}

/** Individual (non-recap) articles published under a tracked event since a timestamp — the recap job's input, see eventsRecap.ts. */
export function articlesForEventSince(eventId: string, since: string): MergedArticle[] {
	const rows = db
		.prepare('SELECT * FROM merged_articles WHERE event_id = ? AND is_recap = 0 AND published_at > ? ORDER BY published_at')
		.all(eventId, since);
	return rows.map(rowToArticle);
}

export function articlesOlderThan(days: number): MergedArticle[] {
	const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
	const rows = db.prepare('SELECT * FROM merged_articles WHERE published_at < ?').all(cutoff);
	return rows.map(rowToArticle);
}

export function findRecentArticleByTags(tagIds: string[], sinceDays: number): MergedArticle | null {
	if (tagIds.length === 0) return null;
	const cutoff = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
	const rows = db
		.prepare('SELECT * FROM merged_articles WHERE published_at > ? ORDER BY published_at DESC')
		.all(cutoff);
	for (const row of rows) {
		const article = rowToArticle(row);
		if (article.tags.some((t) => tagIds.includes(t))) return article;
	}
	return null;
}

/**
 * Newest-first articles matching a raw SQL predicate - for the board's Wire/General columns,
 * which select on shape (post vs. article, no category) rather than any one filter queryFeed
 * offers. `where` is always a fixed string from api/storylines.ts, never user input.
 */
export function queryWhere(where: string, params: unknown[], limit: number): MergedArticle[] {
	return db
		.prepare(`SELECT * FROM merged_articles WHERE ${where} ORDER BY published_at DESC LIMIT ?`)
		.all(...(params as any[]), limit)
		.map(rowToArticle);
}

export function countWhere(where: string, params: unknown[]): number {
	const row = db.prepare(`SELECT COUNT(*) AS c FROM merged_articles WHERE ${where}`).get(...(params as any[])) as { c: number };
	return row.c;
}

export function getArticles(ids: string[]): MergedArticle[] {
	if (ids.length === 0) return [];
	return db
		.prepare(`SELECT * FROM merged_articles WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY published_at`)
		.all(...ids)
		.map(rowToArticle);
}

/** Every article's id and the content items it was built from - without the bodies, embeddings and the rest of each row. */
export function articleItemRefs(): { id: string; itemIds: string[] }[] {
	const rows = db.prepare('SELECT id, sources FROM merged_articles').all() as { id: string; sources: string }[];
	return rows.map((r) => ({ id: r.id, itemIds: (JSON.parse(r.sources) as { itemId: string }[]).map((s) => s.itemId) }));
}

/** Deletes many articles with a few statements (run it inside inTransaction). */
export function deleteArticles(ids: string[]) {
	for (let i = 0; i < ids.length; i += 500) {
		const chunk = ids.slice(i, i + 500);
		db.prepare(`DELETE FROM merged_articles WHERE id IN (${chunk.map(() => '?').join(',')})`).run(...chunk);
	}
}

export function deleteArticle(id: string) {
	db.prepare('DELETE FROM merged_articles WHERE id = ?').run(id);
}

export function deleteAllArticles() {
	db.prepare('DELETE FROM merged_articles').run();
}
