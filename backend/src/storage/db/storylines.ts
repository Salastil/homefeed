import { randomUUID } from 'node:crypto';
import { db } from './index.js';

/** A storyline row. State (live / cooling / closed) is derived from the timestamps at read time - see pipeline/storylines.ts's storylineState. */
export interface StorylineRow {
	id: string;
	scope: string;
	tag: string;
	labelArticleId: string | null;
	centroid: number[];
	firstItemAt: string;
	lastItemAt: string;
	itemCount: number;
	sourceCount: number;
	continuesId: string | null;
	createdAt: string;
	updatedAt: string;
}

function rowToStoryline(row: any): StorylineRow {
	return {
		id: row.id,
		scope: row.scope,
		tag: row.tag,
		labelArticleId: row.label_article_id,
		centroid: JSON.parse(row.centroid),
		firstItemAt: row.first_item_at,
		lastItemAt: row.last_item_at,
		itemCount: row.item_count,
		sourceCount: row.source_count,
		continuesId: row.continues_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export function getStoryline(id: string): StorylineRow | null {
	const row = db.prepare('SELECT * FROM storylines WHERE id = ?').get(id);
	return row ? rowToStoryline(row) : null;
}

/** Storylines in a scope whose last item is at or after `lastSince` and whose first item is at or after `firstSince` - i.e. not yet closed relative to some moment. */
/**
 * Storylines in a scope that were open at a moment: last update at or after `lastSince`,
 * started at or after `firstSince` and - so the historical pass can't join an old article to
 * a storyline that only began later - started no later than `firstUntil`.
 */
export function storylinesActiveIn(scope: string, lastSince: string, firstSince: string, firstUntil: string): StorylineRow[] {
	return db
		.prepare('SELECT * FROM storylines WHERE scope = ? AND last_item_at >= ? AND first_item_at >= ? AND first_item_at <= ? ORDER BY last_item_at DESC')
		.all(scope, lastSince, firstSince, firstUntil)
		.map(rowToStoryline);
}

/** Storylines in a scope (or every 'event:' scope when scope is 'event:*') whose last item is at or after `since`. */
export function storylinesTouchedSince(scope: string, since: string): StorylineRow[] {
	if (scope === 'event:*') {
		return db
			.prepare("SELECT * FROM storylines WHERE scope LIKE 'event:%' AND last_item_at >= ? ORDER BY last_item_at DESC")
			.all(since)
			.map(rowToStoryline);
	}
	return db.prepare('SELECT * FROM storylines WHERE scope = ? AND last_item_at >= ? ORDER BY last_item_at DESC').all(scope, since).map(rowToStoryline);
}

export function storylineIdOf(articleId: string): string | null {
	const row = db.prepare('SELECT storyline_id FROM storyline_items WHERE article_id = ?').get(articleId) as { storyline_id: string } | undefined;
	return row?.storyline_id ?? null;
}

/** Article ids in a storyline, oldest first. */
export function memberIds(storylineId: string): string[] {
	return (
		db
			.prepare(
				`SELECT si.article_id AS id FROM storyline_items si JOIN merged_articles a ON a.id = si.article_id
				 WHERE si.storyline_id = ? ORDER BY a.published_at`
			)
			.all(storylineId) as { id: string }[]
	).map((r) => r.id);
}

/** article id -> storyline id, for every member of the given storylines. */
export function membershipOf(storylineIds: string[]): Map<string, string> {
	const out = new Map<string, string>();
	if (storylineIds.length === 0) return out;
	const rows = db
		.prepare(`SELECT article_id, storyline_id FROM storyline_items WHERE storyline_id IN (${storylineIds.map(() => '?').join(',')})`)
		.all(...storylineIds) as { article_id: string; storyline_id: string }[];
	for (const r of rows) out.set(r.article_id, r.storyline_id);
	return out;
}

export function createStoryline(scope: string, centroid: number[], firstItemAt: string, lastItemAt: string, continuesId: string | null): string {
	const id = `stl-${randomUUID()}`;
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO storylines (id, scope, tag, label_article_id, centroid, first_item_at, last_item_at, item_count, source_count, continues_id, created_at, updated_at)
		 VALUES (?, ?, '', NULL, ?, ?, ?, 0, 0, ?, ?, ?)`
	).run(id, scope, JSON.stringify(centroid), firstItemAt, lastItemAt, continuesId, now, now);
	return id;
}

export function addMember(storylineId: string, articleId: string, similarity: number) {
	db.prepare('INSERT OR REPLACE INTO storyline_items (article_id, storyline_id, similarity, added_at) VALUES (?, ?, ?, ?)').run(
		articleId,
		storylineId,
		similarity,
		new Date().toISOString()
	);
}

export function updateStoryline(
	id: string,
	fields: { tag: string; labelArticleId: string | null; centroid: number[]; firstItemAt: string; lastItemAt: string; itemCount: number; sourceCount: number }
) {
	db.prepare(
		`UPDATE storylines SET tag = ?, label_article_id = ?, centroid = ?, first_item_at = ?, last_item_at = ?, item_count = ?, source_count = ?, updated_at = ?
		 WHERE id = ?`
	).run(
		fields.tag,
		fields.labelArticleId,
		JSON.stringify(fields.centroid),
		fields.firstItemAt,
		fields.lastItemAt,
		fields.itemCount,
		fields.sourceCount,
		new Date().toISOString(),
		id
	);
}

/** Storylines whose members have all been deleted (retention) - nothing left to show. */
export function deleteEmptyStorylines(): number {
	const res = db.prepare('DELETE FROM storylines WHERE id NOT IN (SELECT DISTINCT storyline_id FROM storyline_items)').run();
	return Number(res.changes);
}

// ---------- article-side columns ----------

export function setArticleEmbedding(articleId: string, embedding: number[] | null) {
	db.prepare('UPDATE merged_articles SET embedding = ?, storyline_checked_at = ? WHERE id = ?').run(
		embedding ? JSON.stringify(embedding) : null,
		new Date().toISOString(),
		articleId
	);
}

export function articleEmbedding(articleId: string): number[] | null {
	const row = db.prepare('SELECT embedding FROM merged_articles WHERE id = ?').get(articleId) as { embedding: string | null } | undefined;
	return row?.embedding ? JSON.parse(row.embedding) : null;
}

/** Oldest-first articles the storyline tick hasn't looked at yet. */
export function uncheckedArticleIds(limit: number): string[] {
	return (
		db
			.prepare('SELECT id FROM merged_articles WHERE storyline_checked_at IS NULL ORDER BY published_at LIMIT ?')
			.all(limit) as { id: string }[]
	).map((r) => r.id);
}

/**
 * Queues every unchecked article published before `before` for the historical pass
 * ('backfill') - the articles that predate storylines, grouped after new arrivals, at a
 * slower pace. See runStorylineCycle.
 */
export function queueBackfillBefore(before: string): number {
	const res = db
		.prepare("UPDATE merged_articles SET storyline_checked_at = 'backfill' WHERE storyline_checked_at IS NULL AND published_at < ?")
		.run(before);
	return Number(res.changes);
}

/** The historical pass's next articles, oldest first. */
export function backfillArticleIds(limit: number): string[] {
	return (
		db
			.prepare("SELECT id FROM merged_articles WHERE storyline_checked_at = 'backfill' ORDER BY published_at LIMIT ?")
			.all(limit) as { id: string }[]
	).map((r) => r.id);
}

/** How much is waiting: new articles not yet grouped, and the historical pass's queue. */
export function pendingCounts(): { recent: number; backfill: number; backfillOldest: string | null; backfillDone: number } {
	const recent = (db.prepare('SELECT COUNT(*) AS n FROM merged_articles WHERE storyline_checked_at IS NULL').get() as { n: number }).n;
	const b = db
		.prepare("SELECT COUNT(*) AS n, MIN(published_at) AS oldest, MAX(published_at) AS newest FROM merged_articles WHERE storyline_checked_at = 'backfill'")
		.get() as { n: number; oldest: string | null; newest: string | null };
	// Done so far: everything already grouped that's older than the queue's newest article.
	const done = b.newest
		? (
				db
					.prepare("SELECT COUNT(*) AS n FROM merged_articles WHERE storyline_checked_at IS NOT NULL AND storyline_checked_at != 'backfill' AND published_at <= ?")
					.get(b.newest) as { n: number }
			).n
		: 0;
	return { recent, backfill: b.n, backfillOldest: b.oldest, backfillDone: done };
}

/** Storyline totals for the admin status line. */
export function storylineCounts(): { news: number; developments: number } {
	const r = db
		.prepare("SELECT SUM(scope = 'news') AS news, SUM(scope LIKE 'event:%') AS dev FROM storylines")
		.get() as { news: number | null; dev: number | null };
	return { news: r.news ?? 0, developments: r.dev ?? 0 };
}

/**
 * Embedded articles in a scope, published in [from, to], that aren't in any storyline -
 * the candidates a new article can start a storyline with. `scope` 'news' means "not part
 * of any tracked event"; 'event:<id>' means that event's articles.
 */
export function looseArticlesIn(scope: string, from: string, to: string, excludeId: string): { id: string; embedding: number[] }[] {
	const eventClause = scope === 'news' ? 'a.event_id IS NULL' : 'a.event_id = ?';
	const params: unknown[] = scope === 'news' ? [] : [scope.slice('event:'.length)];
	const rows = db
		.prepare(
			`SELECT a.id, a.embedding FROM merged_articles a
			 WHERE ${eventClause} AND a.embedding IS NOT NULL AND a.published_at BETWEEN ? AND ? AND a.id != ?
			   AND NOT EXISTS (SELECT 1 FROM storyline_items si WHERE si.article_id = a.id)
			 ORDER BY a.published_at`
		)
		.all(...(params as any[]), from, to, excludeId) as { id: string; embedding: string }[];
	return rows.map((r) => ({ id: r.id, embedding: JSON.parse(r.embedding) }));
}

/** Closed storylines in a scope whose last item fell in [from, to] - candidates for a new storyline to "continue". */
export function storylinesEndedBetween(scope: string, from: string, to: string): StorylineRow[] {
	return db
		.prepare('SELECT * FROM storylines WHERE scope = ? AND last_item_at BETWEEN ? AND ? ORDER BY last_item_at DESC LIMIT 50')
		.all(scope, from, to)
		.map(rowToStoryline);
}

/** Text fields of recent articles, for the name lexicon (see pipeline/storylines.ts). */
export function recentArticleTexts(since: string, until?: string): { id: string; title: string; body: string; tweet: string | null; telegram_message: string | null; sources: string }[] {
	if (until) {
		return db
			.prepare('SELECT id, title, body, tweet, telegram_message, sources FROM merged_articles WHERE published_at >= ? AND published_at < ?')
			.all(since, until) as any[];
	}
	return db
		.prepare('SELECT id, title, body, tweet, telegram_message, sources FROM merged_articles WHERE published_at >= ?')
		.all(since) as any[];
}
