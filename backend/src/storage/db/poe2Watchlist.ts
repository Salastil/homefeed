import { randomUUID } from 'node:crypto';
import { db } from './index.js';
import type { Poe2WatchlistEntry } from './types.js';

interface CurrencyRef {
	currencyId: string;
	name: string;
	icon: string | null;
}

function rowToEntry(row: any): Poe2WatchlistEntry {
	return {
		id: row.id,
		baseCurrencyId: row.base_currency_id,
		baseName: row.base_name,
		baseIcon: row.base_icon,
		quoteCurrencyId: row.quote_currency_id,
		quoteName: row.quote_name,
		quoteIcon: row.quote_icon,
		priorityRank: row.priority_rank,
		lastRate: row.last_rate,
		lastChange1h: row.last_change_1h,
		lastChange24h: row.last_change_24h,
		lastChange7d: row.last_change_7d,
		lastPolledAt: row.last_polled_at,
		lastError: row.last_error,
		createdAt: row.created_at
	};
}

export function listWatchlist(): Poe2WatchlistEntry[] {
	const rows = db.prepare('SELECT * FROM poe2_watchlist ORDER BY priority_rank').all();
	return rows.map(rowToEntry);
}

// No update() — currencies are picked from a live browse list (see poe2/client.ts's
// browseCurrencies), not typed, so there's nothing to edit; remove and re-add covers the
// rare "picked the wrong one" case.
export function addWatchlistEntry(base: CurrencyRef, quote: CurrencyRef): Poe2WatchlistEntry {
	const id = `poe2-${base.currencyId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${quote.currencyId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 6)}`
		.replace(/-+/g, '-')
		.replace(/(^-|-$)/g, '');
	const maxRank = db.prepare('SELECT COALESCE(MAX(priority_rank), 0) as m FROM poe2_watchlist').get() as { m: number };
	const createdAt = new Date().toISOString();
	db.prepare(
		`INSERT INTO poe2_watchlist
			(id, base_currency_id, base_name, base_icon, quote_currency_id, quote_name, quote_icon, priority_rank, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(id, base.currencyId, base.name, base.icon, quote.currencyId, quote.name, quote.icon, maxRank.m + 1, createdAt);
	return {
		id,
		baseCurrencyId: base.currencyId,
		baseName: base.name,
		baseIcon: base.icon,
		quoteCurrencyId: quote.currencyId,
		quoteName: quote.name,
		quoteIcon: quote.icon,
		priorityRank: maxRank.m + 1,
		lastRate: null,
		lastChange1h: null,
		lastChange24h: null,
		lastChange7d: null,
		lastPolledAt: null,
		lastError: null,
		createdAt
	};
}

export function removeWatchlistEntry(id: string) {
	db.prepare('DELETE FROM poe2_rate_history WHERE watchlist_id = ?').run(id);
	db.prepare('DELETE FROM poe2_watchlist WHERE id = ?').run(id);
}

// One snapshot per poll (see poe2/poller.ts) — the raw material 1h/24h/7d change is
// computed from, since poe.ninja itself doesn't expose per-pair rates or multiple
// change windows.
export function recordRate(watchlistId: string, rate: number, recordedAt: string) {
	db.prepare('INSERT INTO poe2_rate_history (watchlist_id, rate, recorded_at) VALUES (?, ?, ?)').run(
		watchlistId,
		rate,
		recordedAt
	);
}

// The closest snapshot at-or-before cutoffIso — null if there isn't one yet (e.g. a
// pair added less than a window ago), which the poller treats as "no change data yet"
// rather than fabricating a 0% figure.
export function rateAtOrBefore(watchlistId: string, cutoffIso: string): number | null {
	const row = db
		.prepare('SELECT rate FROM poe2_rate_history WHERE watchlist_id = ? AND recorded_at <= ? ORDER BY recorded_at DESC LIMIT 1')
		.get(watchlistId, cutoffIso) as { rate: number } | undefined;
	return row ? row.rate : null;
}

export function markPolled(
	id: string,
	rate: number | null,
	change1h: number | null,
	change24h: number | null,
	change7d: number | null,
	error: string | null
) {
	db.prepare(
		`UPDATE poe2_watchlist
			SET last_rate = ?, last_change_1h = ?, last_change_24h = ?, last_change_7d = ?, last_polled_at = ?, last_error = ?
			WHERE id = ?`
	).run(rate, change1h, change24h, change7d, new Date().toISOString(), error, id);
}

// Keeps history bounded — 8 days is enough slack past the 7d window for a poll to be
// briefly late without losing the data point it needs.
export function pruneOldHistory() {
	const cutoff = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
	db.prepare('DELETE FROM poe2_rate_history WHERE recorded_at < ?').run(cutoff);
}
