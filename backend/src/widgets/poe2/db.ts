import { randomUUID } from 'node:crypto';
import { db } from '../../storage/db/index.js';
import type { Poe2WatchlistEntry } from '../../storage/db/types.js';

interface CurrencyRef {
	currencyId: string;
	name: string;
}

function rowToEntry(row: any): Poe2WatchlistEntry {
	return {
		id: row.id,
		baseCurrencyId: row.base_currency_id,
		baseName: row.base_name,
		quoteCurrencyId: row.quote_currency_id,
		quoteName: row.quote_name,
		priorityRank: row.priority_rank,
		lastRate: row.last_rate,
		lastChange24h: row.last_change_24h,
		lastPolledAt: row.last_polled_at,
		lastError: row.last_error,
		createdAt: row.created_at
	};
}

export function listWatchlist(): Poe2WatchlistEntry[] {
	const rows = db.prepare('SELECT * FROM widget_poe2_watchlist ORDER BY priority_rank').all();
	return rows.map(rowToEntry);
}

// No update() — currencies are picked from a live browse list (see widgets/poe2/client.ts's
// browseCurrencies), not typed, so there's nothing to edit; remove and re-add covers the
// rare "picked the wrong one" case.
export function addWatchlistEntry(base: CurrencyRef, quote: CurrencyRef): Poe2WatchlistEntry {
	const id = `poe2-${base.currencyId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${quote.currencyId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 6)}`
		.replace(/-+/g, '-')
		.replace(/(^-|-$)/g, '');
	const maxRank = db.prepare('SELECT COALESCE(MAX(priority_rank), 0) as m FROM widget_poe2_watchlist').get() as { m: number };
	const createdAt = new Date().toISOString();
	db.prepare(
		`INSERT INTO widget_poe2_watchlist
			(id, base_currency_id, base_name, quote_currency_id, quote_name, priority_rank, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`
	).run(id, base.currencyId, base.name, quote.currencyId, quote.name, maxRank.m + 1, createdAt);
	return {
		id,
		baseCurrencyId: base.currencyId,
		baseName: base.name,
		quoteCurrencyId: quote.currencyId,
		quoteName: quote.name,
		priorityRank: maxRank.m + 1,
		lastRate: null,
		lastChange24h: null,
		lastPolledAt: null,
		lastError: null,
		createdAt
	};
}

export function removeWatchlistEntry(id: string) {
	db.prepare('DELETE FROM widget_poe2_rate_history WHERE watchlist_id = ?').run(id);
	db.prepare('DELETE FROM widget_poe2_watchlist WHERE id = ?').run(id);
}

// One snapshot per poll (see widgets/poe2/poll.ts) — the raw material 24h change is computed
// from, since poe.ninja itself doesn't expose per-pair rates or a matching change window.
export function recordRate(watchlistId: string, rate: number, recordedAt: string) {
	db.prepare('INSERT INTO widget_poe2_rate_history (watchlist_id, rate, recorded_at) VALUES (?, ?, ?)').run(
		watchlistId,
		rate,
		recordedAt
	);
}

// The closest snapshot at-or-before cutoffIso — null if there isn't one yet (e.g. a
// pair added less than 24h ago), which the poller treats as "no change data yet" rather
// than fabricating a 0% figure.
export function rateAtOrBefore(watchlistId: string, cutoffIso: string): number | null {
	const row = db
		.prepare('SELECT rate FROM widget_poe2_rate_history WHERE watchlist_id = ? AND recorded_at <= ? ORDER BY recorded_at DESC LIMIT 1')
		.get(watchlistId, cutoffIso) as { rate: number } | undefined;
	return row ? row.rate : null;
}

export function markPolled(id: string, rate: number | null, change24h: number | null, error: string | null) {
	db.prepare(
		`UPDATE widget_poe2_watchlist
			SET last_rate = ?, last_change_24h = ?, last_polled_at = ?, last_error = ?
			WHERE id = ?`
	).run(rate, change24h, new Date().toISOString(), error, id);
}

// Keeps history bounded — a day or two of slack past the 24h window is plenty for a
// poll to be briefly late without losing the data point it needs.
export function pruneOldHistory() {
	const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
	db.prepare('DELETE FROM widget_poe2_rate_history WHERE recorded_at < ?').run(cutoff);
}
