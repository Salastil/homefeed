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
