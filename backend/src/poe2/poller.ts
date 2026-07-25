import * as poe2WatchlistDb from '../storage/db/poe2Watchlist.js';
import * as settingsDb from '../storage/db/settings.js';
import { logger } from '../storage/db/logs.js';
import { fetchCurrentLeague, fetchCurrencyValues } from './client.js';

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

function pctChange(current: number, past: number | null): number | null {
	if (past === null || past === 0) return null;
	return ((current - past) / past) * 100;
}

// Called on a schedule (see queue/scheduler.ts) and immediately after the admin adds a pair
// (see api/admin.ts) — always re-detects the current challenge league fresh (cheap, guarantees
// correctness across league rotations with no separate staleness logic), then one overview
// request covers the whole watchlist. A pair whose base or quote currency is no longer traded
// this league gets its own lastError, it never aborts the rest of the batch.
export async function pollPoe2Now(): Promise<void> {
	let league;
	try {
		league = await fetchCurrentLeague();
	} catch (err) {
		logger.error('poe2', `League lookup failed: ${(err as Error).message}`);
		return;
	}

	const entries = poe2WatchlistDb.listWatchlist();
	if (entries.length === 0) {
		const { poe2 } = settingsDb.getSettings();
		settingsDb.updateSettings({
			poe2: { ...poe2, leagueId: league.id, leagueName: league.name, updatedAt: new Date().toISOString() }
		});
		return;
	}

	try {
		const valuesById = await fetchCurrencyValues(league.id);
		const now = new Date();
		const nowIso = now.toISOString();
		const cutoff1h = new Date(now.getTime() - HOUR_MS).toISOString();
		const cutoff24h = new Date(now.getTime() - DAY_MS).toISOString();
		const cutoff7d = new Date(now.getTime() - 7 * DAY_MS).toISOString();

		for (const entry of entries) {
			const baseValue = valuesById.get(entry.baseCurrencyId);
			const quoteValue = valuesById.get(entry.quoteCurrencyId);
			if (baseValue === undefined || quoteValue === undefined) {
				poe2WatchlistDb.markPolled(entry.id, null, null, null, null, 'One or both currencies no longer traded in this league');
				continue;
			}

			const rate = baseValue / quoteValue;
			const change1h = pctChange(rate, poe2WatchlistDb.rateAtOrBefore(entry.id, cutoff1h));
			const change24h = pctChange(rate, poe2WatchlistDb.rateAtOrBefore(entry.id, cutoff24h));
			const change7d = pctChange(rate, poe2WatchlistDb.rateAtOrBefore(entry.id, cutoff7d));
			poe2WatchlistDb.recordRate(entry.id, rate, nowIso);
			poe2WatchlistDb.markPolled(entry.id, rate, change1h, change24h, change7d, null);
		}

		poe2WatchlistDb.pruneOldHistory();
		settingsDb.updateSettings({
			poe2: { leagueId: league.id, leagueName: league.name, updatedAt: nowIso }
		});
	} catch (err) {
		logger.error('poe2', `Watchlist poll failed: ${(err as Error).message}`);
	}
}
