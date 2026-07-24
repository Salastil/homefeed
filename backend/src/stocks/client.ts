// Stooq (stooq.com) — free CSV quote endpoint, no account or API key required, and it
// accepts multiple symbols batched into one request. This is the only file that talks to
// it; poller.ts orchestrates when/how results get saved, same separation as
// backend/src/telegram/ keeps between the raw client and its callers.
//
// Stooq's quote line has no prior-close field, so "change %" here is computed as
// (close - open) / open * 100 — an intraday-vs-open approximation, not a true
// prior-day change. Accepted simplification for a basic ticker widget.

export interface StockQuote {
	price: number;
	changePercent: number;
}

export async function fetchQuotes(symbols: string[]): Promise<Map<string, StockQuote | Error>> {
	const results = new Map<string, StockQuote | Error>();
	if (symbols.length === 0) return results;

	const url = `https://stooq.com/q/l/?s=${symbols.map(encodeURIComponent).join(',')}&f=sd2t2ohlcv&h&e=csv`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Stooq returned ${res.status}`);
	const text = await res.text();

	// Header: Symbol,Date,Time,Open,High,Low,Close,Volume — no quoted/embedded-comma
	// fields in this format, so a plain split is sufficient (no CSV library needed).
	const lines = text.trim().split('\n').slice(1);
	const bySymbol = new Map<string, string[]>();
	for (const line of lines) {
		const cols = line.split(',');
		if (cols.length < 7) continue;
		bySymbol.set(cols[0].toLowerCase(), cols);
	}

	for (const symbol of symbols) {
		const cols = bySymbol.get(symbol.toLowerCase());
		if (!cols) {
			results.set(symbol, new Error('Symbol not found in Stooq response'));
			continue;
		}
		const open = Number(cols[3]);
		const close = Number(cols[6]);
		if (cols[3] === 'N/D' || cols[6] === 'N/D' || !Number.isFinite(open) || !Number.isFinite(close) || open === 0) {
			results.set(symbol, new Error('Stooq has no data for this symbol'));
			continue;
		}
		results.set(symbol, { price: close, changePercent: ((close - open) / open) * 100 });
	}

	return results;
}
