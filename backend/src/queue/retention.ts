import * as articlesDb from '../storage/db/articles.js';
import * as contentItemsDb from '../storage/db/contentItems.js';
import * as tagsDb from '../storage/db/tags.js';
import * as eventsDb from '../storage/db/events.js';
import {
	articleAttachedBytes,
	deleteCandidateMediaOlderThan,
	deleteMediaByArticleId,
	deleteOrphanedMedia,
	totalStorageBytes
} from '../storage/media/index.js';
import { logger } from '../storage/db/logs.js';
import { inTransaction } from '../storage/db/index.js';
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
			inTransaction(() => contentItemsDb.deleteContentItems(stale.map((i) => i.id)));
			logger.info('retention', `Pruned ${stale.length} raw item(s) older than ${retention.rawItemMaxAgeDays}d`);
		}
	}

	if (retention.publishedArticleMaxAgeDays != null) {
		const eventOverrides = new Map(eventsDb.listEvents().map((e) => [e.id, e.retentionOverrideDays]));
		const stale = articlesDb.articlesOlderThan(retention.publishedArticleMaxAgeDays);
		// One transaction for the whole pass: one disk sync rather than two per article, and
		// the server isn't held up between them (see inTransaction).
		const pruned = inTransaction(() => {
			let pruned = 0;
			for (const article of stale) {
				const override = article.eventId ? eventOverrides.get(article.eventId) : undefined;
				if (override === null) continue; // explicit "Forever" override
				if (override !== undefined) {
					const overrideCutoff = Date.now() - override * 86_400_000;
					if (new Date(article.publishedAt).getTime() > overrideCutoff) continue;
				}
				// Media first, always — merged_articles has no FK to media_assets, so a bare
				// deleteArticle() strands the asset and its bytes keep counting against the
				// storage cap for good (see contentCascade.ts, which pairs these everywhere else).
				deleteMediaByArticleId(article.id);
				articlesDb.deleteArticle(article.id);
				pruned++;
			}
			return pruned;
		});
		if (pruned > 0) {
			logger.info('retention', `Pruned ${pruned} published article(s) older than ${retention.publishedArticleMaxAgeDays}d`);
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

	// Free first, delete second: orphaned assets are bytes nobody is reading, so
	// reclaiming them may put us back under the cap at no cost to published content.
	const orphans = deleteOrphanedMedia();
	if (orphans.count > 0) {
		logger.info('retention', `Reclaimed ${orphans.count} orphaned media file(s) (${formatBytes(orphans.bytes)})`);
	}

	let used = totalStorageBytes();
	if (used <= capBytes) return;

	// Only media an existing article owns can be freed by deleting articles. Whatever
	// remains below that is a floor the FIFO pass cannot get under — and walking the
	// loop anyway would delete every article on the site while the total never moved,
	// which is precisely what a cap set under the floor used to do, silently.
	const floorBytes = used - articleAttachedBytes();
	if (floorBytes > capBytes) {
		logger.error(
			'retention',
			`Storage cap of ${capValue}${unit} is below the ${formatBytes(floorBytes)} of media no article owns — ` +
				`deleting articles cannot get under it, so no articles were removed. Raise the cap or clear media in the Retention tab.`
		);
		return;
	}

	// FIFO: oldest published articles go first, each with its own media, until the total
	// is back under the cap. Guaranteed to stop before running out of articles, since
	// floorBytes <= capBytes above.
	const oldest = articlesDb.allArticlesNewestFirst().reverse(); // oldest first — retention needs everything, not the feed's page size
	const deleted = inTransaction(() => {
		let n = 0;
		for (const article of oldest) {
			if (used <= capBytes) break;
			deleteMediaByArticleId(article.id);
			articlesDb.deleteArticle(article.id);
			n++;
			used = totalStorageBytes();
		}
		return n;
	});
	if (deleted > 0) {
		logger.info('retention', `Storage cap (${capValue}${unit}) exceeded — removed ${deleted} oldest article(s), now at ${formatBytes(used)}`);
	}
}

function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
	if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
	return `${Math.round(bytes / 1024)}KB`;
}
