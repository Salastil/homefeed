import { randomUUID } from 'node:crypto';
import { db } from '../../storage/db/index.js';
import { getKv, setKv } from '../../storage/db/widgetKv.js';
import type { StockTicker } from '../../storage/db/types.js';

/**
 * How often Yahoo is polled, in minutes — stored in this widget's own widget_kv config
 * blob rather than a column, same as the bookmarks widget's column count.
 *
 * The floor is deliberate. client.ts fires one request per ticker per poll, in parallel,
 * against an undocumented Yahoo endpoint that publishes no rate limit and answers a
 * non-browser User-Agent with a 429 on the very first request — so the failure mode isn't
 * a quota you can back off from, it's a silent block. A handful of tickers at 5 minutes is
 * ~60 requests an hour, comfortably clear of anything reported as troublesome; going below
 * a minute with a long ticker list would not be.
 */
const ALLOWED_POLL_INTERVALS = [1, 5, 15, 30, 60] as const;
const DEFAULT_POLL_INTERVAL_MINUTES = 5;

export function getPollIntervalMinutes(): number {
	const stored = getKv<{ pollIntervalMinutes?: number }>('stocks', 'config')?.pollIntervalMinutes;
	return stored !== undefined && (ALLOWED_POLL_INTERVALS as readonly number[]).includes(stored)
		? stored
		: DEFAULT_POLL_INTERVAL_MINUTES;
}

/** Returns the value actually stored — an unsupported one is rejected rather than silently written, so the widget can't end up polling on a cadence the UI can't represent. */
export function setPollIntervalMinutes(minutes: number): number {
	if (!(ALLOWED_POLL_INTERVALS as readonly number[]).includes(minutes)) return getPollIntervalMinutes();
	setKv('stocks', 'config', { pollIntervalMinutes: minutes });
	return minutes;
}

function rowToTicker(row: any): StockTicker {
	return {
		id: row.id,
		label: row.label,
		symbol: row.symbol,
		priorityRank: row.priority_rank,
		lastPrice: row.last_price,
		lastChangePercent: row.last_change_percent,
		lastPolledAt: row.last_polled_at,
		lastError: row.last_error,
		createdAt: row.created_at
	};
}

export function listStockTickers(): StockTicker[] {
	const rows = db.prepare('SELECT * FROM widget_stocks_tickers ORDER BY priority_rank').all();
	return rows.map(rowToTicker);
}

export function createStockTicker(label: string, symbol: string): StockTicker {
	const id = `stk-${symbol.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${randomUUID().slice(0, 6)}`;
	const maxRank = db.prepare('SELECT COALESCE(MAX(priority_rank), 0) as m FROM widget_stocks_tickers').get() as { m: number };
	const createdAt = new Date().toISOString();
	db.prepare(
		'INSERT INTO widget_stocks_tickers (id, label, symbol, priority_rank, created_at) VALUES (?, ?, ?, ?, ?)'
	).run(id, label, symbol, maxRank.m + 1, createdAt);
	return {
		id, label, symbol, priorityRank: maxRank.m + 1,
		lastPrice: null, lastChangePercent: null, lastPolledAt: null, lastError: null, createdAt
	};
}

export function updateStockTicker(id: string, patch: { label?: string; symbol?: string }): StockTicker | null {
	const existing = db.prepare('SELECT * FROM widget_stocks_tickers WHERE id = ?').get(id);
	if (!existing) return null;
	const current = rowToTicker(existing);
	const merged = { ...current, ...patch };
	db.prepare('UPDATE widget_stocks_tickers SET label = ?, symbol = ? WHERE id = ?').run(merged.label, merged.symbol, id);
	return { ...merged };
}

export function deleteStockTicker(id: string) {
	db.prepare('DELETE FROM widget_stocks_tickers WHERE id = ?').run(id);
}

export function markStockPolled(id: string, price: number | null, changePercent: number | null, error: string | null) {
	db.prepare(
		'UPDATE widget_stocks_tickers SET last_price = ?, last_change_percent = ?, last_polled_at = ?, last_error = ? WHERE id = ?'
	).run(price, changePercent, new Date().toISOString(), error, id);
}
