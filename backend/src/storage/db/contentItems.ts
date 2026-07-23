import { randomUUID } from 'node:crypto';
import { db } from './index.js';
import type { ContentItem } from './types.js';

function rowToItem(row: any): ContentItem {
	return {
		id: row.id,
		sourceId: row.source_id,
		type: row.type,
		title: row.title,
		summary: row.summary,
		body: row.body,
		images: JSON.parse(row.images),
		videos: JSON.parse(row.videos),
		link: row.link,
		publishedAt: row.published_at,
		fetchedAt: row.fetched_at,
		tags: JSON.parse(row.tags),
		geo: row.geo,
		embedding: row.embedding ? JSON.parse(row.embedding) : null,
		eventId: row.event_id,
		clusterId: row.cluster_id,
		tweet: row.tweet ? JSON.parse(row.tweet) : null,
		raw: row.raw ? JSON.parse(row.raw) : null
	};
}

export function insertContentItem(item: Omit<ContentItem, 'id'>): ContentItem {
	const id = `ci-${randomUUID()}`;
	db.prepare(
		`INSERT INTO content_items
		 (id, source_id, type, title, summary, body, images, videos, link, published_at, fetched_at, tags, geo, embedding, event_id, cluster_id, tweet, raw)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		id,
		item.sourceId,
		item.type,
		item.title,
		item.summary,
		item.body,
		JSON.stringify(item.images),
		JSON.stringify(item.videos),
		item.link,
		item.publishedAt,
		item.fetchedAt,
		JSON.stringify(item.tags),
		item.geo,
		item.embedding ? JSON.stringify(item.embedding) : null,
		item.eventId,
		item.clusterId,
		item.tweet ? JSON.stringify(item.tweet) : null,
		item.raw ? JSON.stringify(item.raw) : null
	);
	return { ...item, id };
}

/** Avoids re-ingesting the same story twice on repeated polls. */
export function existsByLink(link: string): boolean {
	const row = db.prepare('SELECT id FROM content_items WHERE link = ?').get(link);
	return !!row;
}

export function unclusteredItemsExcludingSources(excludeSourceIds: string[]): ContentItem[] {
	const rows = db.prepare('SELECT * FROM content_items WHERE cluster_id IS NULL').all();
	const items = rows.map(rowToItem);
	if (excludeSourceIds.length === 0) return items;
	return items.filter((i) => !excludeSourceIds.includes(i.sourceId));
}

export function unclusteredItemsForSources(sourceIds: string[], sinceISO: string): ContentItem[] {
	if (sourceIds.length === 0) return [];
	const placeholders = sourceIds.map(() => '?').join(',');
	const rows = db
		.prepare(`SELECT * FROM content_items WHERE cluster_id IS NULL AND source_id IN (${placeholders}) AND fetched_at > ?`)
		.all(...sourceIds, sinceISO);
	return rows.map(rowToItem);
}

export function setEmbedding(id: string, embedding: number[]) {
	db.prepare('UPDATE content_items SET embedding = ? WHERE id = ?').run(JSON.stringify(embedding), id);
}

export function assignCluster(ids: string[], clusterId: string) {
	const stmt = db.prepare('UPDATE content_items SET cluster_id = ? WHERE id = ?');
	for (const id of ids) stmt.run(clusterId, id);
}

/** Clears cluster_id back to NULL, making these items eligible for re-publish on the next poll/synthesis tick. */
export function resetClusterForItems(ids: string[]) {
	const stmt = db.prepare('UPDATE content_items SET cluster_id = NULL WHERE id = ?');
	for (const id of ids) stmt.run(id);
}

export function itemsByCluster(clusterId: string): ContentItem[] {
	const rows = db.prepare('SELECT * FROM content_items WHERE cluster_id = ?').all(clusterId);
	return rows.map(rowToItem);
}

export function itemsOlderThan(days: number): ContentItem[] {
	const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
	const rows = db.prepare('SELECT * FROM content_items WHERE fetched_at < ?').all(cutoff);
	return rows.map(rowToItem);
}

export function deleteContentItems(ids: string[]) {
	const stmt = db.prepare('DELETE FROM content_items WHERE id = ?');
	for (const id of ids) stmt.run(id);
}

export function itemsForSource(sourceId: string): ContentItem[] {
	const rows = db.prepare('SELECT * FROM content_items WHERE source_id = ?').all(sourceId);
	return rows.map(rowToItem);
}

export function deleteContentItemsForSource(sourceId: string) {
	db.prepare('DELETE FROM content_items WHERE source_id = ?').run(sourceId);
}

export function deleteAllContentItems() {
	db.prepare('DELETE FROM content_items').run();
}
