import { randomUUID } from 'node:crypto';
import { db } from './index.js';
import type { Tag } from './types.js';

function rowToTag(row: any): Tag {
	return {
		id: row.id,
		label: row.label,
		aliases: JSON.parse(row.aliases),
		slug: row.slug,
		embedding: JSON.parse(row.embedding),
		firstSeenAt: row.first_seen_at,
		lastSeenAt: row.last_seen_at,
		articleCount: row.article_count,
		status: row.status
	};
}

function slugify(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
}

export function listActiveTags(): Tag[] {
	const rows = db.prepare("SELECT * FROM tags WHERE status = 'active'").all();
	return rows.map(rowToTag);
}

export function getTagsByIds(ids: string[]): Tag[] {
	if (ids.length === 0) return [];
	const placeholders = ids.map(() => '?').join(',');
	const rows = db.prepare(`SELECT * FROM tags WHERE id IN (${placeholders})`).all(...ids);
	return rows.map(rowToTag);
}

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
	let dot = 0,
		normA = 0,
		normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] ** 2;
		normB += b[i] ** 2;
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Resolves a candidate tag label to an existing tag (adding it as an alias) or creates
 * a new one, based on embedding similarity against active tags. See "Tag" and its
 * dedup flow in homefeed-data-schema.md.
 */
export function resolveOrCreateTag(label: string, embedding: number[], dedupThreshold: number): Tag {
	const active = listActiveTags();
	let best: { tag: Tag; score: number } | null = null;
	for (const tag of active) {
		const score = cosineSimilarity(embedding, tag.embedding);
		if (!best || score > best.score) best = { tag, score };
	}

	const now = new Date().toISOString();

	if (best && best.score >= dedupThreshold) {
		const tag = best.tag;
		const aliases = tag.aliases.includes(label) || tag.label === label ? tag.aliases : [...tag.aliases, label];
		db.prepare('UPDATE tags SET aliases = ?, last_seen_at = ?, article_count = article_count + 1 WHERE id = ?').run(
			JSON.stringify(aliases),
			now,
			tag.id
		);
		return { ...tag, aliases, lastSeenAt: now, articleCount: tag.articleCount + 1 };
	}

	const id = `tag-${randomUUID()}`;
	const slug = slugify(label);
	db.prepare(
		`INSERT INTO tags (id, label, aliases, slug, embedding, first_seen_at, last_seen_at, article_count, status)
		 VALUES (?, ?, '[]', ?, ?, ?, ?, 1, 'active')`
	).run(id, label, slug, JSON.stringify(embedding), now, now);

	return { id, label, aliases: [], slug, embedding, firstSeenAt: now, lastSeenAt: now, articleCount: 1, status: 'active' };
}

/** Scheduled sweep: flips tags with no new articles in `expiryDays` to expired. */
export function expireStaleTags(expiryDays: number): number {
	const cutoff = new Date(Date.now() - expiryDays * 86_400_000).toISOString();
	const result = db
		.prepare("UPDATE tags SET status = 'expired' WHERE status = 'active' AND last_seen_at < ?")
		.run(cutoff);
	return Number(result.changes);
}
