import type { DatabaseSync } from 'node:sqlite';

// Host-side safety net for widget data pruning (see widgets/types.ts's uninstall contract
// and the plan's "data isolation strategy"). This alone is sufficient to fully clean a
// widget's data even with zero cooperation from its own code — a widget's own uninstall()
// hook (if present) is an optimization/extension point, not a requirement for correctness.

function ownedTablesForId(db: DatabaseSync, widgetId: string, extraOwnedTables: string[] = []): string[] {
	const prefix = `widget_${widgetId}_`;
	const rows = db
		.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ? ESCAPE '\\'`)
		.all(`${prefix.replace(/_/g, '\\_')}%`) as { name: string }[];
	return Array.from(new Set([...rows.map((r) => r.name), ...extraOwnedTables]));
}

// Drops every table owned by a single widget (by the widget_<id>_ naming convention, plus
// any self-reported extraOwnedTables for a grandfathered name), and clears its widget_kv
// rows. Safe to call even if the widget's own code is missing/broken/never uninstall()ed.
export function sweepWidgetData(db: DatabaseSync, widgetId: string, extraOwnedTables: string[] = []) {
	for (const table of ownedTablesForId(db, widgetId, extraOwnedTables)) {
		db.exec(`DROP TABLE IF EXISTS "${table}";`);
	}
	db.prepare('DELETE FROM widget_kv WHERE widget_id = ?').run(widgetId);
}

// Full-registry sweep, run once at every startup after the registry loads (see
// widgets/registry.ts) — catches anything left behind by a process crash mid-uninstall, or
// a manually-edited installed_widgets table, that the per-widget sweep above never got a
// chance to run for.
export function sweepOrphanedWidgetData(db: DatabaseSync, knownWidgetIds: string[]) {
	const known = new Set(knownWidgetIds);
	const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'widget\\_%' ESCAPE '\\'`).all() as {
		name: string;
	}[];
	for (const { name } of tables) {
		if (name === 'widget_kv') continue; // the shared kv table itself, not a per-widget owned table
		const id = name.slice('widget_'.length).split('_')[0];
		if (!known.has(id)) {
			db.exec(`DROP TABLE IF EXISTS "${name}";`);
		}
	}
	const kvWidgetIds = db.prepare('SELECT DISTINCT widget_id FROM widget_kv').all() as { widget_id: string }[];
	const orphanedKvIds = kvWidgetIds.map((r) => r.widget_id).filter((id) => !known.has(id));
	if (orphanedKvIds.length > 0) {
		const placeholders = orphanedKvIds.map(() => '?').join(',');
		db.prepare(`DELETE FROM widget_kv WHERE widget_id IN (${placeholders})`).run(...orphanedKvIds);
	}
}
