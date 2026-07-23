import { randomUUID } from 'node:crypto';
import { db } from './index.js';
import type { Category } from './types.js';

function rowToCategory(row: any): Category {
	return {
		id: row.id,
		name: row.name,
		priorityRank: row.priority_rank,
		isDefault: !!row.is_default,
		isPrivate: !!row.is_private
	};
}

export function listCategories(): Category[] {
	const rows = db.prepare('SELECT * FROM categories ORDER BY priority_rank').all();
	return rows.map(rowToCategory);
}

/** Names of every category marked private — used to filter articles/feed for unauthenticated visitors. */
export function listPrivateCategoryNames(): string[] {
	const rows = db.prepare('SELECT name FROM categories WHERE is_private = 1').all() as { name: string }[];
	return rows.map((r) => r.name);
}

export function setCategoryOrder(order: { id: string; priorityRank: number; isPrivate: boolean }[]) {
	const stmt = db.prepare('UPDATE categories SET priority_rank = ?, is_private = ? WHERE id = ?');
	for (const c of order) stmt.run(c.priorityRank, c.isPrivate ? 1 : 0, c.id);
}

export function createCategory(name: string, isPrivate = false): Category {
	const id = `cat-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${randomUUID().slice(0, 6)}`;
	const maxRank = db.prepare('SELECT COALESCE(MAX(priority_rank), 0) as m FROM categories').get() as { m: number };
	db.prepare('INSERT INTO categories (id, name, priority_rank, is_default, is_private) VALUES (?, ?, ?, 0, ?)').run(
		id,
		name,
		maxRank.m + 1,
		isPrivate ? 1 : 0
	);
	return { id, name, priorityRank: maxRank.m + 1, isDefault: false, isPrivate };
}

export function deleteCategory(id: string) {
	db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}
