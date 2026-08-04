import { randomUUID } from 'node:crypto';
import { db } from '../../storage/db/index.js';
import type { StockTicker } from '../../storage/db/types.js';

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
