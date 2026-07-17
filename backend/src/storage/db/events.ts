import { randomUUID } from 'node:crypto';
import { db } from './index.js';
import type { TrackedEvent } from './types.js';

function rowToEvent(row: any): TrackedEvent {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		sourceIds: JSON.parse(row.source_ids),
		cadence: row.cadence,
		cadenceTime: row.cadence_time,
		active: !!row.active,
		retentionOverrideDays: row.retention_override_days,
		lastRecapAt: row.last_recap_at,
		createdAt: row.created_at
	};
}

export function listEvents(): TrackedEvent[] {
	const rows = db.prepare('SELECT * FROM tracked_events ORDER BY created_at').all();
	return rows.map(rowToEvent);
}

export function listActiveEvents(): TrackedEvent[] {
	const rows = db.prepare('SELECT * FROM tracked_events WHERE active = 1').all();
	return rows.map(rowToEvent);
}

export function getEvent(id: string): TrackedEvent | null {
	const row = db.prepare('SELECT * FROM tracked_events WHERE id = ?').get(id);
	return row ? rowToEvent(row) : null;
}

export function createEvent(input: Partial<TrackedEvent>): TrackedEvent {
	const id = `evt-${randomUUID()}`;
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO tracked_events (id, name, description, source_ids, cadence, cadence_time, active, retention_override_days, last_recap_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
	).run(
		id,
		input.name ?? 'Untitled event',
		input.description ?? '',
		JSON.stringify(input.sourceIds ?? []),
		input.cadence ?? 'continuous',
		input.cadenceTime ?? null,
		input.active === false ? 0 : 1,
		input.retentionOverrideDays ?? null,
		now
	);
	return getEvent(id)!;
}

export function updateEvent(id: string, patch: Partial<TrackedEvent>): TrackedEvent | null {
	const existing = getEvent(id);
	if (!existing) return null;
	const merged = { ...existing, ...patch };
	db.prepare(
		`UPDATE tracked_events SET name=?, description=?, source_ids=?, cadence=?, cadence_time=?, active=?, retention_override_days=?, last_recap_at=? WHERE id=?`
	).run(
		merged.name,
		merged.description,
		JSON.stringify(merged.sourceIds),
		merged.cadence,
		merged.cadenceTime,
		merged.active ? 1 : 0,
		merged.retentionOverrideDays,
		merged.lastRecapAt,
		id
	);
	return getEvent(id);
}

export function deleteEvent(id: string) {
	db.prepare('DELETE FROM tracked_events WHERE id = ?').run(id);
}

export function markRecapped(id: string) {
	db.prepare('UPDATE tracked_events SET last_recap_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}
