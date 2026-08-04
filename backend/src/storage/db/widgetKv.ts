import { db } from './index.js';

// Generic config/cache store for pluggable widgets (see widgets/types.ts) — a widget with
// simple needs (weather-shaped: "last fetched value + timestamp") uses this instead of
// getting bolted-on global_settings columns, so it stays fully prunable by widget_id alone
// on uninstall (see widgets/uninstall.ts) without any host-side schema change.

export function getKv<T>(widgetId: string, key: string): T | null {
	const row = db.prepare('SELECT value FROM widget_kv WHERE widget_id = ? AND key = ?').get(widgetId, key) as
		| { value: string }
		| undefined;
	return row ? (JSON.parse(row.value) as T) : null;
}

export function setKv(widgetId: string, key: string, value: unknown) {
	db.prepare(
		`INSERT INTO widget_kv (widget_id, key, value, updated_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(widget_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
	).run(widgetId, key, JSON.stringify(value), new Date().toISOString());
}

export function deleteAllKv(widgetId: string) {
	db.prepare('DELETE FROM widget_kv WHERE widget_id = ?').run(widgetId);
}
