import { db } from './index.js';
import type { GlobalSettings } from './types.js';

function rowToSettings(row: any): GlobalSettings {
	return {
		mergeStrictness: row.merge_strictness,
		defaultPollIntervalMinutes: row.default_poll_interval_minutes,
		holdBeforePublishMinutes: row.hold_before_publish_minutes,
		tagDedupThreshold: row.tag_dedup_threshold,
		tagExpiryDays: row.tag_expiry_days,
		followUpMinHoursSinceLast: row.follow_up_min_hours_since_last,
		followUpMinNewSources: row.follow_up_min_new_sources,
		aiServiceHost: row.ai_service_host,
		aiServicePort: row.ai_service_port,
		selectedModels: JSON.parse(row.selected_models),
		nitterMediaMode: row.nitter_media_mode,
		fxtwitterBaseUrl: row.fxtwitter_base_url,
		telegramMediaMode: row.telegram_media_mode,
		retention: {
			publishedArticleMaxAgeDays: row.published_article_max_age_days,
			rawItemMaxAgeDays: row.raw_item_max_age_days,
			storageCapEnabled: !!row.storage_cap_enabled,
			storageCapValue: row.storage_cap_value,
			storageCapUnit: row.storage_cap_unit
		}
	};
}

export function getSettings(): GlobalSettings {
	const row = db.prepare('SELECT * FROM global_settings WHERE id = 1').get();
	return rowToSettings(row);
}

export function updateSettings(patch: Partial<GlobalSettings>): GlobalSettings {
	const current = getSettings();
	const merged: GlobalSettings = {
		...current,
		...patch,
		retention: { ...current.retention, ...(patch.retention ?? {}) },
		selectedModels: { ...current.selectedModels, ...(patch.selectedModels ?? {}) }
	};
	db.prepare(
		`UPDATE global_settings SET
			merge_strictness=?, default_poll_interval_minutes=?, hold_before_publish_minutes=?,
			tag_dedup_threshold=?, tag_expiry_days=?, follow_up_min_hours_since_last=?, follow_up_min_new_sources=?,
			ai_service_host=?, ai_service_port=?, selected_models=?,
			nitter_media_mode=?, fxtwitter_base_url=?, telegram_media_mode=?,
			published_article_max_age_days=?, raw_item_max_age_days=?,
			storage_cap_enabled=?, storage_cap_value=?, storage_cap_unit=?
		 WHERE id = 1`
	).run(
		merged.mergeStrictness,
		merged.defaultPollIntervalMinutes,
		merged.holdBeforePublishMinutes,
		merged.tagDedupThreshold,
		merged.tagExpiryDays,
		merged.followUpMinHoursSinceLast,
		merged.followUpMinNewSources,
		merged.aiServiceHost,
		merged.aiServicePort,
		JSON.stringify(merged.selectedModels),
		merged.nitterMediaMode,
		merged.fxtwitterBaseUrl,
		merged.telegramMediaMode,
		merged.retention.publishedArticleMaxAgeDays,
		merged.retention.rawItemMaxAgeDays,
		merged.retention.storageCapEnabled ? 1 : 0,
		merged.retention.storageCapValue,
		merged.retention.storageCapUnit
	);
	return getSettings();
}
