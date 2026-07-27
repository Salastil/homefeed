import type { WidgetPlugin } from '../widgets/types.js';
import * as stocksDb from '../storage/db/stocks.js';
import { logger } from '../storage/db/logs.js';
import { pollStocksNow } from './poller.js';

// Built-in sidebar "Stocks" widget — thin wrapper so it funnels into the same
// scheduler/route-registration loop as pluggable widgets (see widgets/registry.ts); its
// tickers stay in the dedicated stock_tickers table exactly as before. Not going through
// the upload/delete lifecycle — see widgets/types.ts; no migrate()/uninstall() since its
// schema isn't moving.
export const stocksPlugin: WidgetPlugin = {
	id: 'stocks',
	displayName: 'Stocks',
	version: '1.0.0',

	poll: {
		// Per admin spec — stock prices move faster than weather.
		intervalMs: 15 * 60_000,
		run: pollStocksNow
	},

	registerPublicRoutes(app) {
		app.get('/api/stocks', async () => stocksDb.listStockTickers());
	},

	registerAdminRoutes(app) {
		app.get('/api/admin/stocks', async () => stocksDb.listStockTickers());

		app.post('/api/admin/stocks', async (req, reply) => {
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

		app.patch('/api/admin/stocks/:id', async (req, reply) => {
			const { id } = req.params as { id: string };
			const updated = stocksDb.updateStockTicker(id, req.body as any);
			if (!updated) return reply.code(404).send({ error: 'not found' });
			return updated;
		});

		app.delete('/api/admin/stocks/:id', async (req, reply) => {
			const { id } = req.params as { id: string };
			stocksDb.deleteStockTicker(id);
			return reply.code(204).send();
		});
	}
};
