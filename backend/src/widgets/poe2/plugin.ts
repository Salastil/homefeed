import type { DatabaseSync } from 'node:sqlite';
import type { WidgetPlugin } from '../types.js';
import { deleteAllKv } from '../../storage/db/widgetKv.js';
import { logger } from '../../storage/db/logs.js';
import * as poe2Db from './db.js';
import { browseCurrencies, fetchCurrentLeague } from './client.js';
import { pollPoe2Now, getLeagueCache } from './poll.js';

const OWNED_TABLES = ['widget_poe2_watchlist', 'widget_poe2_rate_history'];

// Sidebar "PoE2" widget — tracks exchange rates between arbitrary currency pairs, always
// against the current challenge league (auto-detected, no admin config). The pilot
// implementation of the pluggable-widget system (see widgets/types.ts) — every other
// widget still ships in-process, but this one exercises the full migrate/poll/routes/
// uninstall lifecycle a live-uploaded widget would also go through.
export const poe2Plugin: WidgetPlugin = {
	id: 'poe2',
	displayName: 'PoE2',
	version: '1.0.0',
	ownedTables: OWNED_TABLES,

	migrate(db: DatabaseSync) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS widget_poe2_watchlist (
				id TEXT PRIMARY KEY,
				base_currency_id TEXT NOT NULL,
				base_name TEXT NOT NULL,
				quote_currency_id TEXT NOT NULL,
				quote_name TEXT NOT NULL,
				priority_rank INTEGER NOT NULL,
				last_rate REAL,
				last_change_24h REAL,
				last_polled_at TEXT,
				last_error TEXT,
				created_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS widget_poe2_rate_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				watchlist_id TEXT NOT NULL,
				rate REAL NOT NULL,
				recorded_at TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_widget_poe2_rate_history_watchlist ON widget_poe2_rate_history(watchlist_id, recorded_at);
		`);
	},

	poll: {
		// poe.ninja's own overview data doesn't refresh faster than hourly, so polling
		// more often than this just re-fetches the same numbers.
		intervalMs: 60 * 60_000,
		run: pollPoe2Now
	},

	registerPublicRoutes(app) {
		app.get('/api/poe2', async () => {
			const { leagueName, updatedAt } = getLeagueCache();
			return { leagueName, updatedAt, entries: poe2Db.listWatchlist() };
		});
	},

	registerAdminRoutes(app) {
		// League is always auto-detected, never admin-set.
		app.get('/api/admin/poe2/browse', async (_req, reply) => {
			try {
				const league = await fetchCurrentLeague();
				return await browseCurrencies(league.id);
			} catch (err) {
				return reply.code(502).send({ error: `poe.ninja unreachable: ${(err as Error).message}` });
			}
		});

		app.get('/api/admin/poe2/watchlist', async () => poe2Db.listWatchlist());

		app.post('/api/admin/poe2/watchlist', async (req, reply) => {
			const { base, quote } = req.body as {
				base?: { currencyId?: string; name?: string };
				quote?: { currencyId?: string; name?: string };
			};
			if (!base?.currencyId || !base?.name || !quote?.currencyId || !quote?.name) {
				return reply.code(400).send({ error: 'base and quote currencies (currencyId, name) are required' });
			}
			if (base.currencyId === quote.currencyId) {
				return reply.code(400).send({ error: 'Base and quote currencies must be different' });
			}
			const created = poe2Db.addWatchlistEntry(
				{ currencyId: base.currencyId, name: base.name },
				{ currencyId: quote.currencyId, name: quote.name }
			);
			// Poll immediately rather than waiting for the next tick (up to 1 hour) — cheap,
			// and refreshes every existing entry's rate too.
			pollPoe2Now().catch((err) => logger.error('poe2', `Immediate poll failed: ${err.message}`));
			return reply.code(201).send(created);
		});

		app.delete('/api/admin/poe2/watchlist/:id', async (req, reply) => {
			const { id } = req.params as { id: string };
			poe2Db.removeWatchlistEntry(id);
			return reply.code(204).send();
		});
	},

	uninstall(db: DatabaseSync) {
		db.exec('DROP TABLE IF EXISTS widget_poe2_rate_history;');
		db.exec('DROP TABLE IF EXISTS widget_poe2_watchlist;');
		deleteAllKv('poe2');
	}
};
