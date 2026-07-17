import type { Source } from '../../storage/db/types.js';
import type { SourceAdapter, FetchedItem } from './base.js';
import { logger } from '../../storage/db/logs.js';

/**
 * TODO: real implementation. Telegram channels are read via the Bot API (grammY,
 * per project-structure.md) using `getUpdates` or a channel-history fetch, keyed by
 * `source.config.telegramChannelId`. Left as a stub — satisfies the SourceAdapter
 * interface so the poller and admin panel can already list/configure Telegram sources
 * (e.g. for the "Iran war" tracked event example) before this is filled in.
 */
export const telegramAdapter: SourceAdapter = {
	async fetch(source: Source): Promise<FetchedItem[]> {
		logger.warn('telegram', `Adapter not yet implemented — skipping source "${source.name}"`);
		return [];
	}
};
