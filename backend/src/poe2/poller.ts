import * as poe2WatchlistDb from '../storage/db/poe2Watchlist.js';
import * as settingsDb from '../storage/db/settings.js';
import { logger } from '../storage/db/logs.js';
import { fetchCurrentLeague, fetchWatchlistQuotes } from './client.js';

// Called on a schedule (see queue/scheduler.ts) and immediately after the admin adds a
// currency (see api/admin.ts) — always re-detects the current challenge league fresh (cheap,
// guarantees correctness across league rotations with no separate staleness logic), then one
// overview request covers the whole watchlist. A currency no longer traded this league gets
// its own lastError, it never aborts the rest of the batch.
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
		const { quotes, primaryCurrencyName } = await fetchWatchlistQuotes(
			league.id,
			entries.map((e) => e.currencyId)
		);
		for (const entry of entries) {
			const quote = quotes.get(entry.currencyId);
			if (!quote) {
				poe2WatchlistDb.markPolled(entry.id, null, null, 'No quote returned');
			} else if (quote instanceof Error) {
				poe2WatchlistDb.markPolled(entry.id, null, null, quote.message);
			} else {
				poe2WatchlistDb.markPolled(entry.id, quote.value, quote.changePercent, null);
			}
		}
		settingsDb.updateSettings({
			poe2: { leagueId: league.id, leagueName: league.name, primaryCurrencyName, updatedAt: new Date().toISOString() }
		});
	} catch (err) {
		logger.error('poe2', `Watchlist poll failed: ${(err as Error).message}`);
	}
}
