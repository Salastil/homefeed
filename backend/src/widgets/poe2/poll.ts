import * as poe2Db from './db.js';
import { getKv, setKv } from '../../storage/db/widgetKv.js';
import { logger } from '../../storage/db/logs.js';
import { fetchCurrentLeague, fetchCurrencyValues } from './client.js';

const DAY_MS = 24 * 60 * 60_000;
const WIDGET_ID = 'poe2';

interface LeagueCache {
	leagueId: string | null;
	leagueName: string | null;
	updatedAt: string | null;
}

// Cache of what the last poll learned about the current league — no admin-set config
// (unlike weather): the league is always auto-detected, so this is purely a cache. Lives
// in the generic widget_kv store (see storage/db/widgetKv.ts) so it's prunable via the
// same deleteAllKv('poe2') path as everything else this widget owns.
export function getLeagueCache(): LeagueCache {
	return getKv<LeagueCache>(WIDGET_ID, 'leagueCache') ?? { leagueId: null, leagueName: null, updatedAt: null };
}

function pctChange(current: number, past: number | null): number | null {
	if (past === null || past === 0) return null;
	return ((current - past) / past) * 100;
}

// Called on a schedule (see queue/scheduler.ts, via plugin.poll) and immediately after the
// admin adds a pair (see plugin.ts's admin routes) — always re-detects the current
// challenge league fresh (cheap, guarantees correctness across league rotations with no
// separate staleness logic), then one overview request covers the whole watchlist. A pair
// whose base or quote currency is no longer traded this league gets its own lastError, it
// never aborts the rest of the batch.
export async function pollPoe2Now(): Promise<void> {
	let league;
	try {
		league = await fetchCurrentLeague();
	} catch (err) {
		logger.error('poe2', `League lookup failed: ${(err as Error).message}`);
		return;
	}

	const entries = poe2Db.listWatchlist();
	if (entries.length === 0) {
		setKv(WIDGET_ID, 'leagueCache', { leagueId: league.id, leagueName: league.name, updatedAt: new Date().toISOString() });
		return;
	}

	try {
		const valuesById = await fetchCurrencyValues(league.id);
		const now = new Date();
		const nowIso = now.toISOString();
		const cutoff24h = new Date(now.getTime() - DAY_MS).toISOString();

		for (const entry of entries) {
			const baseValue = valuesById.get(entry.baseCurrencyId);
			const quoteValue = valuesById.get(entry.quoteCurrencyId);
			if (baseValue === undefined || quoteValue === undefined) {
				poe2Db.markPolled(entry.id, null, null, 'One or both currencies no longer traded in this league');
				continue;
			}

			const rate = baseValue / quoteValue;
			const change24h = pctChange(rate, poe2Db.rateAtOrBefore(entry.id, cutoff24h));
			poe2Db.recordRate(entry.id, rate, nowIso);
			poe2Db.markPolled(entry.id, rate, change24h, null);
		}

		poe2Db.pruneOldHistory();
		setKv(WIDGET_ID, 'leagueCache', { leagueId: league.id, leagueName: league.name, updatedAt: nowIso });
	} catch (err) {
		logger.error('poe2', `Watchlist poll failed: ${(err as Error).message}`);
	}
}
