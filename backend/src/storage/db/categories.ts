import { randomUUID } from 'node:crypto';
import { db } from './index.js';
import type { Category } from './types.js';

function rowToCategory(row: any): Category {
	return {
		id: row.id,
		name: row.name,
		priorityRank: row.priority_rank,
		isDefault: !!row.is_default,
		isPrivate: !!row.is_private,
		isSpillover: !!row.is_spillover,
		disableAi: !!row.disable_ai
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

export function setCategoryOrder(
	order: { id: string; priorityRank: number; isPrivate: boolean; isSpillover: boolean; disableAi: boolean }[]
) {
	const stmt = db.prepare('UPDATE categories SET priority_rank = ?, is_private = ?, is_spillover = ?, disable_ai = ? WHERE id = ?');
	for (const c of order) stmt.run(c.priorityRank, c.isPrivate ? 1 : 0, c.isSpillover ? 1 : 0, c.disableAi ? 1 : 0, c.id);
}

export function createCategory(name: string, isPrivate = false, isSpillover = false, disableAi = false): Category {
	const id = `cat-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${randomUUID().slice(0, 6)}`;
	const maxRank = db.prepare('SELECT COALESCE(MAX(priority_rank), 0) as m FROM categories').get() as { m: number };
	db.prepare(
		'INSERT INTO categories (id, name, priority_rank, is_default, is_private, is_spillover, disable_ai) VALUES (?, ?, ?, 0, ?, ?, ?)'
	).run(id, name, maxRank.m + 1, isPrivate ? 1 : 0, isSpillover ? 1 : 0, disableAi ? 1 : 0);
	return { id, name, priorityRank: maxRank.m + 1, isDefault: false, isPrivate, isSpillover, disableAi };
}

export function deleteCategory(id: string) {
	db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

/**
 * Updates a category's flags and, if `name` changes, renames it everywhere the name is
 * stored: sources' category lists and published articles' category lists (both JSON arrays
 * of names). Returns null when the id is unknown, or 'taken' when another category already
 * has that name.
 */
export function updateCategory(id: string, patch: { name?: string; isPrivate?: boolean; disableAi?: boolean; isSpillover?: boolean }): Category | null | 'taken' {
	const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
	if (!row) return null;
	const current = rowToCategory(row);
	const name = patch.name?.trim() || current.name;
	if (name !== current.name) {
		const clash = db.prepare('SELECT 1 FROM categories WHERE lower(name) = lower(?) AND id != ?').get(name, id);
		if (clash) return 'taken';
	}
	db.exec('BEGIN');
	try {
		db.prepare('UPDATE categories SET name = ?, is_private = ?, disable_ai = ?, is_spillover = ? WHERE id = ?').run(
			name,
			(patch.isPrivate ?? current.isPrivate) ? 1 : 0,
			(patch.disableAi ?? current.disableAi) ? 1 : 0,
			(patch.isSpillover ?? current.isSpillover) ? 1 : 0,
			id
		);
		if (name !== current.name) {
			const from = JSON.stringify(current.name);
			const to = JSON.stringify(name);
			for (const s of db.prepare('SELECT id, category FROM sources WHERE category LIKE ?').all(`%${from}%`) as { id: string; category: string }[]) {
				const list = (JSON.parse(s.category) as string[]).map((c) => (c === current.name ? name : c));
				db.prepare('UPDATE sources SET category = ? WHERE id = ?').run(JSON.stringify(list), s.id);
			}
			db.prepare('UPDATE merged_articles SET category = replace(category, ?, ?) WHERE category LIKE ?').run(from, to, `%${from}%`);
		}
		db.exec('COMMIT');
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
	return rowToCategory(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
}

/** Sets priority ranks from an ordered list of ids; anything not listed keeps its relative order after them. */
export function setPriorityOrder(ids: string[]) {
	const all = listCategories();
	const rest = all.filter((c) => !ids.includes(c.id)).map((c) => c.id);
	const stmt = db.prepare('UPDATE categories SET priority_rank = ? WHERE id = ?');
	[...ids, ...rest].forEach((id, i) => stmt.run(i + 1, id));
}
