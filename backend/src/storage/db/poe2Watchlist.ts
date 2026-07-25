import { randomUUID } from 'node:crypto';
import { db } from './index.js';
import type { Poe2WatchlistEntry } from './types.js';

function rowToEntry(row: any): Poe2WatchlistEntry {
	return {
		id: row.id,
		currencyId: row.currency_id,
		name: row.name,
		icon: row.icon,
		priorityRank: row.priority_rank,
		lastValue: row.last_value,
		lastChangePercent: row.last_change_percent,
		lastPolledAt: row.last_polled_at,
		lastError: row.last_error,
		createdAt: row.created_at
	};
}

export function listWatchlist(): Poe2WatchlistEntry[] {
	const rows = db.prepare('SELECT * FROM poe2_watchlist ORDER BY priority_rank').all();
	return rows.map(rowToEntry);
}

// No update() — entries are picked from a live browse list (see poe2/client.ts's
// browseCurrencies), not typed, so there's nothing to edit; remove and re-add covers the
// rare "picked the wrong one" case.
export function addWatchlistEntry(currencyId: string, name: string, icon: string | null): Poe2WatchlistEntry {
	const id = `poe2-${currencyId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${randomUUID().slice(0, 6)}`;
	const maxRank = db.prepare('SELECT COALESCE(MAX(priority_rank), 0) as m FROM poe2_watchlist').get() as { m: number };
	const createdAt = new Date().toISOString();
	db.prepare(
		'INSERT INTO poe2_watchlist (id, currency_id, name, icon, priority_rank, created_at) VALUES (?, ?, ?, ?, ?, ?)'
	).run(id, currencyId, name, icon, maxRank.m + 1, createdAt);
	return {
		id, currencyId, name, icon, priorityRank: maxRank.m + 1,
		lastValue: null, lastChangePercent: null, lastPolledAt: null, lastError: null, createdAt
	};
}

export function removeWatchlistEntry(id: string) {
	db.prepare('DELETE FROM poe2_watchlist WHERE id = ?').run(id);
}

export function markPolled(id: string, value: number | null, changePercent: number | null, error: string | null) {
	db.prepare(
		'UPDATE poe2_watchlist SET last_value = ?, last_change_percent = ?, last_polled_at = ?, last_error = ? WHERE id = ?'
	).run(value, changePercent, new Date().toISOString(), error, id);
}
