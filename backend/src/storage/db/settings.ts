import { db } from './index.js';
import type { GlobalSettings } from './types.js';

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
		synthesisNumCtx: row.synthesis_num_ctx,
		synthesisNumPredict: row.synthesis_num_predict,
		widgets: {
			weather: !!row.widget_weather_enabled,
			stocks: !!row.widget_stocks_enabled,
			bookmarks: !!row.widget_bookmarks_enabled,
			poe2: !!row.widget_poe2_enabled
		},
		widgetOrder: JSON.parse(row.widget_order),
		retention: {
			publishedArticleMaxAgeDays: row.published_article_max_age_days,
			rawItemMaxAgeDays: row.raw_item_max_age_days,
			storageCapEnabled: !!row.storage_cap_enabled,
			storageCapValue: row.storage_cap_value,
			storageCapUnit: row.storage_cap_unit
		},
		weather: {
			locationName: row.weather_location_name,
			latitude: row.weather_latitude,
			longitude: row.weather_longitude,
			unit: row.weather_unit,
			windUnit: row.weather_wind_unit,
			pressureUnit: row.weather_pressure_unit,
			// Unlike retention, this is genuinely absent pre-first-poll (and pre-location-config) — null-safe parse.
			current: row.weather_current ? JSON.parse(row.weather_current) : null,
			hourly: JSON.parse(row.weather_hourly),
			daily: JSON.parse(row.weather_daily),
			alerts: JSON.parse(row.weather_alerts),
			updatedAt: row.weather_updated_at
		},
		poe2: {
			leagueId: row.poe2_league_id,
			leagueName: row.poe2_league_name,
			updatedAt: row.poe2_updated_at
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
		weather: { ...current.weather, ...(patch.weather ?? {}) },
		poe2: { ...current.poe2, ...(patch.poe2 ?? {}) },
		widgets: { ...current.widgets, ...(patch.widgets ?? {}) }
	};
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
			synthesis_num_ctx=$synthesis_num_ctx, synthesis_num_predict=$synthesis_num_predict,
			widget_weather_enabled=$widget_weather_enabled, widget_stocks_enabled=$widget_stocks_enabled,
			widget_bookmarks_enabled=$widget_bookmarks_enabled, widget_poe2_enabled=$widget_poe2_enabled,
			widget_order=$widget_order,
			published_article_max_age_days=$published_article_max_age_days, raw_item_max_age_days=$raw_item_max_age_days,
			storage_cap_enabled=$storage_cap_enabled, storage_cap_value=$storage_cap_value, storage_cap_unit=$storage_cap_unit,
			weather_location_name=$weather_location_name, weather_latitude=$weather_latitude, weather_longitude=$weather_longitude,
			weather_unit=$weather_unit, weather_wind_unit=$weather_wind_unit, weather_pressure_unit=$weather_pressure_unit,
			weather_current=$weather_current, weather_hourly=$weather_hourly, weather_daily=$weather_daily,
			weather_alerts=$weather_alerts, weather_updated_at=$weather_updated_at,
			poe2_league_id=$poe2_league_id, poe2_league_name=$poe2_league_name, poe2_updated_at=$poe2_updated_at
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
		$synthesis_num_ctx: merged.synthesisNumCtx,
		$synthesis_num_predict: merged.synthesisNumPredict,
		$widget_weather_enabled: merged.widgets.weather ? 1 : 0,
		$widget_stocks_enabled: merged.widgets.stocks ? 1 : 0,
		$widget_bookmarks_enabled: merged.widgets.bookmarks ? 1 : 0,
		$widget_poe2_enabled: merged.widgets.poe2 ? 1 : 0,
		$widget_order: JSON.stringify(merged.widgetOrder),
		$published_article_max_age_days: merged.retention.publishedArticleMaxAgeDays,
		$raw_item_max_age_days: merged.retention.rawItemMaxAgeDays,
		$storage_cap_enabled: merged.retention.storageCapEnabled ? 1 : 0,
		$storage_cap_value: merged.retention.storageCapValue,
		$storage_cap_unit: merged.retention.storageCapUnit,
		$weather_location_name: merged.weather.locationName,
		$weather_latitude: merged.weather.latitude,
		$weather_longitude: merged.weather.longitude,
		$weather_unit: merged.weather.unit,
		$weather_wind_unit: merged.weather.windUnit,
		$weather_pressure_unit: merged.weather.pressureUnit,
		$weather_current: merged.weather.current ? JSON.stringify(merged.weather.current) : null,
		$weather_hourly: JSON.stringify(merged.weather.hourly),
		$weather_daily: JSON.stringify(merged.weather.daily),
		$weather_alerts: JSON.stringify(merged.weather.alerts),
		$weather_updated_at: merged.weather.updatedAt,
		$poe2_league_id: merged.poe2.leagueId,
		$poe2_league_name: merged.poe2.leagueName,
		$poe2_updated_at: merged.poe2.updatedAt
	});
	return getSettings();
}
