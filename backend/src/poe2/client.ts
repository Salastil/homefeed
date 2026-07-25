// poe.ninja's public PoE2 economy API — free, no account or API key required. This is the
// only file that talks to it; poller.ts orchestrates when/how results get saved, same
// separation as backend/src/telegram/ and backend/src/weather/ keep between the raw client
// and their callers.
//
// Response shape confirmed against real requests (not just the published docs, which were
// imprecise on two points): currency name/icon metadata lives in a top-level `items[]` array
// on the overview response, NOT `core.items` (that only holds the handful of currencies used
// for `core.rates`/`primary`/`secondary`). The icon field is `image` (a path relative to this
// same host), not `icon`. Confirmed `sparkline.totalChange` always equals the last entry of
// `sparkline.data`, and every observed `data` array has exactly 7 entries — so this is a
// 7-day cumulative % change, not some other window.
const BASE_URL = 'https://poe.ninja';

export interface LeagueInfo {
	id: string;
	name: string;
}

export interface CurrencyBrowseEntry {
	id: string;
	name: string;
	icon: string | null;
}

export interface CurrencyQuote {
	value: number;
	/** 7-day cumulative % change (see file header) — null if this line had no sparkline data. */
	changePercent: number | null;
}

interface RawCurrencyItem {
	id: string;
	name: string;
	image?: string;
}

interface RawCurrencyLine {
	id: string;
	primaryValue: number;
	sparkline?: { totalChange: number; data: number[] } | null;
}

interface RawCurrencyOverview {
	core: { primary: string };
	lines: RawCurrencyLine[];
	items: RawCurrencyItem[]; // top-level, not core.items — see file header
}

function resolveIcon(image: string | undefined): string | null {
	return image ? `${BASE_URL}${image}` : null;
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
// api/admin.ts's GET /api/admin/poe2/browse) — only currencies that actually have a `lines`
// entry (i.e. are currently traded), not every currency poe.ninja has ever known about.
export async function browseCurrencies(leagueId: string): Promise<CurrencyBrowseEntry[]> {
	const { lines, items } = await fetchCurrencyOverview(leagueId);
	const metaById = new Map(items.map((item) => [item.id, item]));
	return lines
		.map((line) => {
			const meta = metaById.get(line.id);
			return { id: line.id, name: meta?.name ?? line.id, icon: resolveIcon(meta?.image) };
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

// One overview fetch covers every watchlisted currency regardless of list size — unlike
// Stocks, which needs one request per ticker (Yahoo has no equivalent single "give me all of
// these" endpoint without a cookie/crumb handshake).
export async function fetchWatchlistQuotes(
	leagueId: string,
	currencyIds: string[]
): Promise<{ quotes: Map<string, CurrencyQuote | Error>; primaryCurrencyName: string | null }> {
	const { lines, items, core } = await fetchCurrencyOverview(leagueId);
	const lineById = new Map(lines.map((line) => [line.id, line]));
	const nameById = new Map(items.map((item) => [item.id, item.name]));

	const quotes = new Map<string, CurrencyQuote | Error>();
	for (const id of currencyIds) {
		const line = lineById.get(id);
		if (!line) {
			quotes.set(id, new Error('No longer traded in this league'));
			continue;
		}
		quotes.set(id, { value: line.primaryValue, changePercent: line.sparkline?.totalChange ?? null });
	}

	const primaryCurrencyName = nameById.get(core.primary) ?? core.primary;
	return { quotes, primaryCurrencyName };
}
