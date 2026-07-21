import { randomUUID } from 'node:crypto';
import { db } from './index.js';
import type { Category } from './types.js';

function rowToCategory(row: any): Category {
	return { id: row.id, name: row.name, priorityRank: row.priority_rank, isDefault: !!row.is_default };
}

export function listCategories(): Category[] {
	const rows = db.prepare('SELECT * FROM categories ORDER BY priority_rank').all();
	return rows.map(rowToCategory);
}

export function setCategoryOrder(order: { id: string; priorityRank: number }[]) {
	const stmt = db.prepare('UPDATE categories SET priority_rank = ? WHERE id = ?');
	for (const c of order) stmt.run(c.priorityRank, c.id);
}

export function createCategory(name: string): Category {
	const id = `cat-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${randomUUID().slice(0, 6)}`;
	const maxRank = db.prepare('SELECT COALESCE(MAX(priority_rank), 0) as m FROM categories').get() as { m: number };
	db.prepare('INSERT INTO categories (id, name, priority_rank, is_default) VALUES (?, ?, ?, 0)').run(id, name, maxRank.m + 1);
	return { id, name, priorityRank: maxRank.m + 1, isDefault: false };
}

export function deleteCategory(id: string) {
	db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}
