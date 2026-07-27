import { db } from './index.js';
import type { GlobalSettings } from './types.js';
import * as installedWidgetsDb from './installedWidgets.js';

const BUILTIN_WIDGET_IDS = ['weather', 'stocks', 'bookmarks', 'poe2'] as const;

// widgets/widgetOrder are computed from the installed_widgets registry (see
// storage/db/installedWidgets.ts, widgets/registry.ts) rather than stored as their own
// global_settings columns — the registry is the single source of truth for enable state
// and ordering for every widget, built-in or uploaded. Only the four built-in ids are
// reflected here since GlobalSettings.widgets/widgetOrder are closed unions the frontend
// depends on (uploaded widgets have no frontend representation yet).
function widgetsAndOrder(): Pick<GlobalSettings, 'widgets' | 'widgetOrder'> {
	const installed = installedWidgetsDb.listInstalled();
	const byId = new Map(installed.map((w) => [w.id, w]));
	const widgets = {
		weather: !!byId.get('weather')?.enabled,
		stocks: !!byId.get('stocks')?.enabled,
		bookmarks: !!byId.get('bookmarks')?.enabled,
		poe2: !!byId.get('poe2')?.enabled
	};
	const widgetOrder = installed.map((w) => w.id).filter((id): id is (typeof BUILTIN_WIDGET_IDS)[number] =>
		(BUILTIN_WIDGET_IDS as readonly string[]).includes(id)
	);
	return { widgets, widgetOrder };
}

// Every widget's own config/data now lives behind its own /api/widget/<id> routes (see
// widgets/weather/db.ts, widgets/poe2/poll.ts's league cache, etc.) — this settings blob
// is just the scalar pipeline knobs plus the 4 builtins' enable/order flags.
function rowToSettings(row: any): GlobalSettings {
	return {
		mergeStrictness: row.merge_strictness,
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
		nitterInstanceUrl: row.nitter_instance_url,
		telegramMediaMode: row.telegram_media_mode,
		synthesisStylePreset: row.synthesis_style_preset,
		synthesisCustomInstructions: row.synthesis_custom_instructions,
		...widgetsAndOrder(),
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
		selectedModels: { ...current.selectedModels, ...(patch.selectedModels ?? {}) },
		widgets: { ...current.widgets, ...(patch.widgets ?? {}) }
	};

	if (patch.widgets) {
		for (const id of BUILTIN_WIDGET_IDS) {
			if (patch.widgets[id] !== undefined) installedWidgetsDb.setEnabled(id, patch.widgets[id]);
		}
	}
	if (patch.widgetOrder) {
		installedWidgetsDb.reorder(patch.widgetOrder);
	}

	// Named params (rather than positional `?`) so this list can be reordered or
	// extended without the column list and the bound-values list silently drifting
	// out of sync — node:sqlite binds each by its `$name` key, not position.
	db.prepare(
		`UPDATE global_settings SET
			merge_strictness=$merge_strictness,
			hold_before_publish_minutes=$hold_before_publish_minutes,
			tag_dedup_threshold=$tag_dedup_threshold, tag_expiry_days=$tag_expiry_days,
			follow_up_min_hours_since_last=$follow_up_min_hours_since_last, follow_up_min_new_sources=$follow_up_min_new_sources,
			ai_service_host=$ai_service_host, ai_service_port=$ai_service_port, selected_models=$selected_models,
			nitter_media_mode=$nitter_media_mode, fxtwitter_base_url=$fxtwitter_base_url, nitter_instance_url=$nitter_instance_url,
			telegram_media_mode=$telegram_media_mode,
			synthesis_style_preset=$synthesis_style_preset, synthesis_custom_instructions=$synthesis_custom_instructions,
			published_article_max_age_days=$published_article_max_age_days, raw_item_max_age_days=$raw_item_max_age_days,
			storage_cap_enabled=$storage_cap_enabled, storage_cap_value=$storage_cap_value, storage_cap_unit=$storage_cap_unit
		 WHERE id = 1`
	).run({
		$merge_strictness: merged.mergeStrictness,
		$hold_before_publish_minutes: merged.holdBeforePublishMinutes,
		$tag_dedup_threshold: merged.tagDedupThreshold,
		$tag_expiry_days: merged.tagExpiryDays,
		$follow_up_min_hours_since_last: merged.followUpMinHoursSinceLast,
		$follow_up_min_new_sources: merged.followUpMinNewSources,
		$ai_service_host: merged.aiServiceHost,
		$ai_service_port: merged.aiServicePort,
		$selected_models: JSON.stringify(merged.selectedModels),
		$nitter_media_mode: merged.nitterMediaMode,
		$fxtwitter_base_url: merged.fxtwitterBaseUrl,
		$nitter_instance_url: merged.nitterInstanceUrl,
		$telegram_media_mode: merged.telegramMediaMode,
		$synthesis_style_preset: merged.synthesisStylePreset,
		$synthesis_custom_instructions: merged.synthesisCustomInstructions,
		$published_article_max_age_days: merged.retention.publishedArticleMaxAgeDays,
		$raw_item_max_age_days: merged.retention.rawItemMaxAgeDays,
		$storage_cap_enabled: merged.retention.storageCapEnabled ? 1 : 0,
		$storage_cap_value: merged.retention.storageCapValue,
		$storage_cap_unit: merged.retention.storageCapUnit
	});
	return getSettings();
}
