// Yahoo Finance's unofficial chart endpoint — free, no account or API key required.
// This is the only file that talks to it; poller.ts orchestrates when/how results get
// saved, same separation as backend/src/telegram/ keeps between the raw client and its
// callers.
//
// Previously used Stooq's CSV quote endpoint, which started gating every request behind
// a client-side proof-of-work challenge (compute a SHA-256 hashcash puzzle in JS, POST it
// to /__verify) — not something a plain server-side fetch can pass, and not worth running
// a headless browser to poll ticker prices. Confirmed via manual curl testing that Yahoo's
// /v8/finance/chart/<symbol> endpoint still works with a plain fetch, but ONLY with a
// browser-like User-Agent header — bare `curl`/`fetch` UAs get a 429 on the very first
// request, before any real volume. This is an undocumented, unofficial API Yahoo could
// change or wall off without notice, same caveat as Stooq — if it goes the same way,
// there's no realistic simple-fetch alternative left; the fallback would be a provider
// requiring a free API key.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export interface StockQuote {
	price: number;
	changePercent: number;
}

export async function fetchQuotes(symbols: string[]): Promise<Map<string, StockQuote | Error>> {
	const results = new Map<string, StockQuote | Error>();
	if (symbols.length === 0) return results;

	// No batch endpoint used here — Yahoo's multi-symbol /v7/finance/quote requires a
	// cookie+crumb handshake first, while /v8/finance/chart/<symbol> (single symbol, no
	// crumb needed) is the one confirmed to work with just a User-Agent. One request per
	// ticker per poll is trivial at the scale of a sidebar widget (a handful of tickers,
	// polled every 15 minutes).
	await Promise.all(
		symbols.map(async (symbol) => {
			try {
				const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, {
					headers: { 'User-Agent': USER_AGENT }
				});
				if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);
				const data = (await res.json()) as {
					chart: {
						result: { meta: { regularMarketPrice: number; previousClose?: number; chartPreviousClose?: number } }[] | null;
						error: { description: string } | null;
					};
				};
				if (data.chart.error) throw new Error(data.chart.error.description);
				const meta = data.chart.result?.[0]?.meta;
				if (!meta) throw new Error('No data returned for this symbol');
				const previousClose = meta.previousClose ?? meta.chartPreviousClose;
				if (previousClose === undefined) throw new Error('No previous close available for this symbol');
				results.set(symbol, {
					price: meta.regularMarketPrice,
					changePercent: ((meta.regularMarketPrice - previousClose) / previousClose) * 100
				});
			} catch (err) {
				results.set(symbol, err instanceof Error ? err : new Error(String(err)));
			}
		})
	);

	return results;
}
