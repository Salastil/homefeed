import { randomUUID } from 'node:crypto';
import { db } from './index.js';
import type { MergedArticle } from './types.js';

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
		tweet: row.tweet ? JSON.parse(row.tweet) : null
	};
}

export function insertArticle(article: Omit<MergedArticle, 'id'>): MergedArticle {
	const id = `art-${randomUUID()}`;
	db.prepare(
		`INSERT INTO merged_articles
		 (id, title, body, hero_image, video, category, geo, event_id, source_count, sources, published_at, updated_at, merge_confidence, tags, thread_id, previous_article_id, next_article_id, top_stories, tweet)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
		article.tweet ? JSON.stringify(article.tweet) : null
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

export function queryFeed(filters: {
	category?: string;
	geo?: string;
	eventId?: string;
	tag?: string;
	before?: string;
	limit?: number;
}): MergedArticle[] {
	let sql = 'SELECT * FROM merged_articles WHERE 1=1';
	const params: unknown[] = [];

	// The bare feed (no category/geo/eventId/tag — i.e. the homepage/"Top stories") only
	// shows articles whose contributing source(s) opted into "Push to Top Stories?" —
	// otherwise every ingested article from every source would flood the homepage.
	// Any explicit filter (a real category page, Local's geo filter, a tag or event page)
	// is unaffected — those show everything matching, regardless of this flag.
	const isHomepage = !filters.category && !filters.geo && !filters.eventId && !filters.tag;
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
	if (filters.before) {
		sql += ' AND published_at < ?';
		params.push(filters.before);
	}
	sql += ' ORDER BY published_at DESC LIMIT ?';
	params.push(Math.min(filters.limit ?? 15, 50));
	const rows = db.prepare(sql).all(...(params as any[]));
	return rows.map(rowToArticle);
}

export function latestArticleInThread(threadId: string): MergedArticle | null {
	const row = db
		.prepare('SELECT * FROM merged_articles WHERE thread_id = ? ORDER BY published_at DESC LIMIT 1')
		.get(threadId);
	return row ? rowToArticle(row) : null;
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

export function deleteArticle(id: string) {
	db.prepare('DELETE FROM merged_articles WHERE id = ?').run(id);
}

export function deleteAllArticles() {
	db.prepare('DELETE FROM merged_articles').run();
}
