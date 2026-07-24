import * as stocksDb from '../storage/db/stocks.js';
import { logger } from '../storage/db/logs.js';
import { fetchQuotes } from './client.js';

// Called on a schedule (see queue/scheduler.ts) and immediately after the admin adds a
// ticker (see api/admin.ts) — one batched Stooq request for every configured ticker. A
// symbol Stooq can't resolve gets its own lastError, it never aborts the whole batch.
export async function pollStocksNow(): Promise<void> {
	const tickers = stocksDb.listStockTickers();
	if (tickers.length === 0) return;

	let quotes: Map<string, { price: number; changePercent: number } | Error>;
	try {
		quotes = await fetchQuotes(tickers.map((t) => t.symbol));
	} catch (err) {
		logger.error('stocks', `Poll failed: ${(err as Error).message}`);
		return;
	}

	for (const ticker of tickers) {
		const quote = quotes.get(ticker.symbol);
		if (!quote) {
			stocksDb.markStockPolled(ticker.id, null, null, 'No quote returned');
		} else if (quote instanceof Error) {
			stocksDb.markStockPolled(ticker.id, null, null, quote.message);
		} else {
			stocksDb.markStockPolled(ticker.id, quote.price, quote.changePercent, null);
		}
	}
}
