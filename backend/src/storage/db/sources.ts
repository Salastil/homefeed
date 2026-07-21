import { randomUUID } from 'node:crypto';
import { db } from './index.js';
import type { Source } from './types.js';

function rowToSource(row: any): Source {
	return {
		id: row.id,
		name: row.name,
		type: row.type,
		category: JSON.parse(row.category),
		url: row.url,
		config: JSON.parse(row.config),
		pollIntervalMinutes: row.poll_interval_minutes,
		enabled: !!row.enabled,
		pushToTopStories: !!row.push_to_top_stories,
		lastPolledAt: row.last_polled_at,
		lastError: row.last_error,
		createdAt: row.created_at
	};
}

export function listSources(): Source[] {
	const rows = db.prepare('SELECT * FROM sources ORDER BY created_at').all();
	return rows.map(rowToSource);
}

export function listEnabledSources(): Source[] {
	const rows = db.prepare('SELECT * FROM sources WHERE enabled = 1').all();
	return rows.map(rowToSource);
}

export function getSource(id: string): Source | null {
	const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
	return row ? rowToSource(row) : null;
}

export function createSource(input: Partial<Source>): Source {
	const id = `src-${randomUUID()}`;
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO sources (id, name, type, category, url, config, poll_interval_minutes, enabled, push_to_top_stories, last_polled_at, last_error, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`
	).run(
		id,
		input.name ?? 'Untitled source',
		input.type ?? 'rss',
		JSON.stringify(input.category ?? []),
		input.url ?? null,
		JSON.stringify(input.config ?? {}),
		input.pollIntervalMinutes ?? 15,
		input.enabled === false ? 0 : 1,
		input.pushToTopStories ? 1 : 0,
		now
	);
	return getSource(id)!;
}

export function updateSource(id: string, patch: Partial<Source>): Source | null {
	const existing = getSource(id);
	if (!existing) return null;
	const merged = { ...existing, ...patch };
	db.prepare(
		`UPDATE sources SET name=?, type=?, category=?, url=?, config=?, poll_interval_minutes=?, enabled=?, push_to_top_stories=?, last_polled_at=?, last_error=? WHERE id=?`
	).run(
		merged.name,
		merged.type,
		JSON.stringify(merged.category),
		merged.url,
		JSON.stringify(merged.config),
		merged.pollIntervalMinutes,
		merged.enabled ? 1 : 0,
		merged.pushToTopStories ? 1 : 0,
		merged.lastPolledAt,
		merged.lastError,
		id
	);
	return getSource(id);
}

export function deleteSource(id: string): void {
	db.prepare('DELETE FROM sources WHERE id = ?').run(id);
}

export function markPolled(id: string, error: string | null) {
	db.prepare('UPDATE sources SET last_polled_at = ?, last_error = ? WHERE id = ?').run(
		new Date().toISOString(),
		error,
		id
	);
}

/** Sources due for polling right now, based on their own interval (or the global default). */
export function sourcesDueForPoll(defaultIntervalMinutes: number): Source[] {
	const now = Date.now();
	return listEnabledSources().filter((s) => {
		if (!s.lastPolledAt) return true;
		const interval = (s.pollIntervalMinutes || defaultIntervalMinutes) * 60_000;
		return now - new Date(s.lastPolledAt).getTime() >= interval;
	});
}
