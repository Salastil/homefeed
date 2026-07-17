import * as articlesDb from '../storage/db/articles.js';
import * as contentItemsDb from '../storage/db/contentItems.js';
import * as tagsDb from '../storage/db/tags.js';
import * as eventsDb from '../storage/db/events.js';
import { deleteCandidateMediaOlderThan, totalStorageBytes } from '../storage/media/index.js';
import { logger } from '../storage/db/logs.js';
import type { GlobalSettings } from '../storage/db/types.js';

/**
 * One sweep, evaluating both dimensions from the schema doc: age-based limits and the
 * size-based FIFO cap. Whichever fires, oldest-first. Tracked events can override the
 * published-article age limit (e.g. "Iran war" recaps kept forever) — see EventsTab.
 */
export function runRetentionSweep(settings: GlobalSettings) {
	const { retention } = settings;

	if (retention.rawItemMaxAgeDays != null) {
		const stale = contentItemsDb.itemsOlderThan(retention.rawItemMaxAgeDays);
		if (stale.length > 0) {
			contentItemsDb.deleteContentItems(stale.map((i) => i.id));
			logger.info('retention', `Pruned ${stale.length} raw item(s) older than ${retention.rawItemMaxAgeDays}d`);
		}
	}

	if (retention.publishedArticleMaxAgeDays != null) {
		const eventOverrides = new Map(eventsDb.listEvents().map((e) => [e.id, e.retentionOverrideDays]));
		const stale = articlesDb.articlesOlderThan(retention.publishedArticleMaxAgeDays);
		for (const article of stale) {
			const override = article.eventId ? eventOverrides.get(article.eventId) : undefined;
			if (override === null) continue; // explicit "Forever" override
			if (override !== undefined) {
				const overrideCutoff = Date.now() - override * 86_400_000;
				if (new Date(article.publishedAt).getTime() > overrideCutoff) continue;
			}
			articlesDb.deleteArticle(article.id);
		}
	}

	deleteCandidateMediaOlderThan(retention.rawItemMaxAgeDays ?? 7);

	if (retention.storageCapEnabled) {
		enforceStorageCap(retention.storageCapValue, retention.storageCapUnit);
	}

	const expiredTags = tagsDb.expireStaleTags(settings.tagExpiryDays);
	if (expiredTags > 0) logger.info('retention', `Expired ${expiredTags} stale tag(s)`);
}

function enforceStorageCap(capValue: number, unit: 'MB' | 'GB') {
	const capBytes = capValue * (unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024);
	let used = totalStorageBytes();
	if (used <= capBytes) return;

	// FIFO: delete oldest published articles (and their media, via cascade at the DB
	// level being absent here — media rows are cleaned up by the candidate sweep above;
	// published-tier media tied to a deleted article becomes orphaned and is swept next
	// cycle once its downloaded_at also ages past raw-item retention as a backstop).
	const oldest = articlesDb.queryFeed({}).reverse(); // oldest first
	for (const article of oldest) {
		if (used <= capBytes) break;
		articlesDb.deleteArticle(article.id);
		used = totalStorageBytes();
	}
}
