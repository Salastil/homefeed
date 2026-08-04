// poe.ninja's public PoE2 economy API — free, no account or API key required. This is the
// only file that talks to it; poll.ts orchestrates when/how results get saved, same
// separation as backend/src/telegram/ and backend/src/weather/ keep between the raw client
// and their callers.
//
// Response shape confirmed against real requests (not just the published docs, which were
// imprecise on this point): currency name metadata lives in a top-level `items[]` array on
// the overview response, NOT `core.items` (that only holds the handful of currencies used
// for `core.rates`/`primary`/`secondary`).
//
// Deliberately not using poe.ninja's own `core` (reference currency) or `sparkline` (a fixed
// 7-day window) fields at all — the watchlist tracks arbitrary currency pairs with 24h
// change, which poe.ninja's overview doesn't expose directly. Every line's `primaryValue` is
// expressed in the same (unspecified, and irrelevant) reference currency, so any pair's rate
// is just baseValue / quoteValue with the reference cancelling out — see fetchCurrencyValues
// below and poll.ts, which self-computes change from its own polling history instead.
const BASE_URL = 'https://poe.ninja';

export interface LeagueInfo {
	id: string;
	name: string;
}

export interface CurrencyBrowseEntry {
	id: string;
	name: string;
}

interface RawCurrencyItem {
	id: string;
	name: string;
}

interface RawCurrencyLine {
	id: string;
	primaryValue: number;
}

interface RawCurrencyOverview {
	lines: RawCurrencyLine[];
	items: RawCurrencyItem[]; // top-level, not core.items — see file header
}

export async function fetchCurrentLeague(): Promise<LeagueInfo> {
	const res = await fetch(`${BASE_URL}/poe2/api/economy/leagues`);
	if (!res.ok) throw new Error(`poe.ninja leagues returned ${res.status}`);
	const leagues = (await res.json()) as LeagueInfo[];
	if (leagues.length === 0) throw new Error('No active leagues returned');
	return leagues[0];
}

async function fetchCurrencyOverview(leagueId: string): Promise<RawCurrencyOverview> {
	const url = `${BASE_URL}/poe2/api/economy/exchange/current/overview?league=${encodeURIComponent(leagueId)}&type=Currency`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`poe.ninja currency overview returned ${res.status}`);
	return res.json();
}

// Fetches the whole traded-currency list for the admin's search-and-pick UI (see
// widgets/poe2/plugin.ts's GET /api/admin/poe2/browse) — only currencies that actually have
// a `lines` entry (i.e. are currently traded), not every currency poe.ninja has ever known
// about.
export async function browseCurrencies(leagueId: string): Promise<CurrencyBrowseEntry[]> {
	const { lines, items } = await fetchCurrencyOverview(leagueId);
	const nameById = new Map(items.map((item) => [item.id, item.name]));
	return lines
		.map((line) => ({ id: line.id, name: nameById.get(line.id) ?? line.id }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

// One overview fetch covers every watchlisted pair regardless of list size — unlike
// Stocks, which needs one request per ticker (Yahoo has no equivalent single "give me all of
// these" endpoint without a cookie/crumb handshake). Every line's primaryValue is expressed
// in the same reference currency, so any pair's rate is just baseValue / quoteValue — the
// reference currency itself cancels out, meaning this same one fetch works for arbitrary
// pairs without needing to know or care what poe.ninja's own reference currency is.
export async function fetchCurrencyValues(leagueId: string): Promise<Map<string, number>> {
	const { lines } = await fetchCurrencyOverview(leagueId);
	return new Map(lines.map((line) => [line.id, line.primaryValue]));
}
