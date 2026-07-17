import * as sourcesDb from '../storage/db/sources.js';
import * as contentItemsDb from '../storage/db/contentItems.js';
import { logger } from '../storage/db/logs.js';
import { rssAdapter } from './adapters/rss.js';
import { telegramAdapter } from './adapters/telegram.js';
import { apiAdapter } from './adapters/api.js';
import { toContentItem, type SourceAdapter } from './adapters/base.js';
import type { Source } from '../storage/db/types.js';

const adapters: Record<Source['type'], SourceAdapter> = {
	rss: rssAdapter,
	telegram: telegramAdapter,
	api: apiAdapter,
	custom: apiAdapter
};

export async function pollDueSources(defaultIntervalMinutes: number): Promise<number> {
	const due = sourcesDb.sourcesDueForPoll(defaultIntervalMinutes);
	let ingested = 0;
	for (const source of due) {
		ingested += await pollOne(source);
	}
	return ingested;
}

/** Polls a single source immediately, bypassing its schedule — used right after a source is created. */
export async function pollSourceNow(source: Source): Promise<number> {
	return pollOne(source);
}

async function pollOne(source: Source): Promise<number> {
	const adapter = adapters[source.type];
	let ingested = 0;
	try {
		const fetched = await adapter.fetch(source);
		for (const item of fetched) {
			if (contentItemsDb.existsByLink(item.link)) continue;
			contentItemsDb.insertContentItem(toContentItem(source, item));
			ingested++;
		}
		sourcesDb.markPolled(source.id, null);
		logger.info('poller', `Polled "${source.name}" (${source.type}) — ${ingested} new item(s)`);
	} catch (err) {
		const message = (err as Error).message;
		logger.error('poller', `Source "${source.name}" failed: ${message}`);
		sourcesDb.markPolled(source.id, message);
	}
	return ingested;
}
