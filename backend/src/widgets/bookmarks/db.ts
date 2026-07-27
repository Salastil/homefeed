import { randomUUID } from 'node:crypto';
import { db } from '../../storage/db/index.js';
import type { Bookmark } from '../../storage/db/types.js';

function rowToBookmark(row: any): Bookmark {
	return {
		id: row.id,
		name: row.name,
		url: row.url,
		priorityRank: row.priority_rank,
		isPrivate: !!row.is_private,
		createdAt: row.created_at
	};
}

// Always returns every bookmark, private or not — filtering for unauthenticated visitors
// happens at the route layer (GET /api/widget/bookmarks), same as categoriesDb.listCategories().
export function listBookmarks(): Bookmark[] {
	const rows = db.prepare('SELECT * FROM widget_bookmarks_items ORDER BY priority_rank').all();
	return rows.map(rowToBookmark);
}

export function createBookmark(name: string, url: string, isPrivate = false): Bookmark {
	const id = `bm-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${randomUUID().slice(0, 6)}`;
	const maxRank = db.prepare('SELECT COALESCE(MAX(priority_rank), 0) as m FROM widget_bookmarks_items').get() as { m: number };
	const createdAt = new Date().toISOString();
	db.prepare(
		'INSERT INTO widget_bookmarks_items (id, name, url, priority_rank, is_private, created_at) VALUES (?, ?, ?, ?, ?, ?)'
	).run(id, name, url, maxRank.m + 1, isPrivate ? 1 : 0, createdAt);
	return { id, name, url, priorityRank: maxRank.m + 1, isPrivate, createdAt };
}

export function updateBookmark(id: string, patch: { name?: string; url?: string; isPrivate?: boolean }): Bookmark | null {
	const existing = db.prepare('SELECT * FROM widget_bookmarks_items WHERE id = ?').get(id);
	if (!existing) return null;
	const current = rowToBookmark(existing);
	const merged = { ...current, ...patch };
	db.prepare('UPDATE widget_bookmarks_items SET name = ?, url = ?, is_private = ? WHERE id = ?').run(
		merged.name, merged.url, merged.isPrivate ? 1 : 0, id
	);
	return merged;
}

export function deleteBookmark(id: string) {
	db.prepare('DELETE FROM widget_bookmarks_items WHERE id = ?').run(id);
}
