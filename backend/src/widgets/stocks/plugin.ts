import type { DatabaseSync } from 'node:sqlite';
import type { WidgetPlugin } from '../types.js';
import { logger } from '../../storage/db/logs.js';
import * as stocksDb from './db.js';
import { pollStocksNow } from './poll.js';

const OWNED_TABLES = ['widget_stocks_tickers'];

// Sidebar "Stocks" widget — polled every 15 minutes from Yahoo Finance (see poll.ts).
// Price/change/poll-state live directly on its own table, same as sources.last_polled_at,
// rather than a separate quote-cache table. Built-in and non-deletable, but otherwise a
// full WidgetPlugin like an uploaded one.
export const stocksPlugin: WidgetPlugin = {
	id: 'stocks',
	displayName: 'Stocks',
	version: '1.0.0',
	ownedTables: OWNED_TABLES,

	migrate(db: DatabaseSync) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS widget_stocks_tickers (
				id TEXT PRIMARY KEY,
				label TEXT NOT NULL,
				symbol TEXT NOT NULL,
				priority_rank INTEGER NOT NULL,
				last_price REAL,
				last_change_percent REAL,
				last_polled_at TEXT,
				last_error TEXT,
				created_at TEXT NOT NULL
			);
		`);

		// Seed a handful of sensible default tickers so the widget isn't empty on a fresh
		// install — the admin can remove/replace any of them.
		const tickerCount = db.prepare('SELECT COUNT(*) as c FROM widget_stocks_tickers').get() as { c: number };
		if (tickerCount.c === 0) {
			const defaults: [string, string][] = [
				['Dow Jones', '^DJI'],
				['S&P 500', '^GSPC'],
				['Bitcoin', 'BTC-USD']
			];
			const stmt = db.prepare(
				'INSERT INTO widget_stocks_tickers (id, label, symbol, priority_rank, created_at) VALUES (?, ?, ?, ?, ?)'
			);
			defaults.forEach(([label, symbol], i) => {
				stmt.run(`stk-${symbol.replace(/[^a-z0-9]+/gi, '-')}`, label, symbol, i + 1, new Date().toISOString());
			});
		}
	},

	poll: {
		// Per admin spec — stock prices move faster than weather.
		intervalMs: 15 * 60_000,
		run: pollStocksNow
	},

	registerPublicRoutes(app) {
		app.get('/api/widget/stocks', async () => stocksDb.listStockTickers());
	},

	registerAdminRoutes(app) {
		app.get('/api/admin/widget/stocks', async () => stocksDb.listStockTickers());

		app.post('/api/admin/widget/stocks', async (req, reply) => {
			const { label, symbol } = req.body as { label?: string; symbol?: string };
			if (!label || !label.trim() || !symbol || !symbol.trim()) {
				return reply.code(400).send({ error: 'label and symbol are required' });
			}
			const created = stocksDb.createStockTicker(label.trim(), symbol.trim());
			// Poll immediately rather than waiting for the next tick (up to 15 minutes) — cheap,
			// and refreshes every existing ticker's price too.
			pollStocksNow().catch((err) => logger.error('stocks', `Immediate poll failed: ${err.message}`));
			return reply.code(201).send(created);
		});

		app.patch('/api/admin/widget/stocks/:id', async (req, reply) => {
			const { id } = req.params as { id: string };
			const updated = stocksDb.updateStockTicker(id, req.body as any);
			if (!updated) return reply.code(404).send({ error: 'not found' });
			return updated;
		});

		app.delete('/api/admin/widget/stocks/:id', async (req, reply) => {
			const { id } = req.params as { id: string };
			stocksDb.deleteStockTicker(id);
			return reply.code(204).send();
		});
	},

	uninstall(db: DatabaseSync) {
		db.exec('DROP TABLE IF EXISTS widget_stocks_tickers;');
	}
};
