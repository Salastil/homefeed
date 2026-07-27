import { db } from './index.js';
import type { InstalledWidget } from './types.js';

function rowToWidget(row: any): InstalledWidget {
	return {
		id: row.id,
		displayName: row.display_name,
		source: row.source,
		codePath: row.code_path,
		enabled: !!row.enabled,
		priorityRank: row.priority_rank,
		version: row.version,
		ownedTables: JSON.parse(row.owned_tables),
		installedAt: row.installed_at
	};
}

export function listInstalled(): InstalledWidget[] {
	return (db.prepare('SELECT * FROM installed_widgets ORDER BY priority_rank').all() as any[]).map(rowToWidget);
}

export function getInstalled(id: string): InstalledWidget | null {
	const row = db.prepare('SELECT * FROM installed_widgets WHERE id = ?').get(id);
	return row ? rowToWidget(row) : null;
}

export function insertWidget(widget: {
	id: string;
	displayName: string;
	source: 'builtin' | 'uploaded';
	codePath: string;
	enabled?: boolean;
	priorityRank?: number;
	version?: string;
	ownedTables?: string[];
}): InstalledWidget {
	const maxRank = db.prepare('SELECT COALESCE(MAX(priority_rank), 0) as m FROM installed_widgets').get() as { m: number };
	const priorityRank = widget.priorityRank ?? maxRank.m + 1;
	const installedAt = new Date().toISOString();
	db.prepare(
		`INSERT INTO installed_widgets (id, display_name, source, code_path, enabled, priority_rank, version, owned_tables, installed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		widget.id,
		widget.displayName,
		widget.source,
		widget.codePath,
		widget.enabled === false ? 0 : 1,
		priorityRank,
		widget.version ?? '1.0.0',
		JSON.stringify(widget.ownedTables ?? []),
		installedAt
	);
	return getInstalled(widget.id)!;
}

export function setEnabled(id: string, enabled: boolean) {
	db.prepare('UPDATE installed_widgets SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

// Ids in display order — every id must already exist as a row; unlisted ids keep their
// current rank (mirrors the old widget_order JSON array's "admin-sortable" behavior).
export function reorder(ids: string[]) {
	const stmt = db.prepare('UPDATE installed_widgets SET priority_rank = ? WHERE id = ?');
	ids.forEach((id, i) => stmt.run(i + 1, id));
}

export function deleteInstalled(id: string) {
	db.prepare('DELETE FROM installed_widgets WHERE id = ?').run(id);
}
