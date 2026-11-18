import { db } from './index.js';
import { DEFAULT_BOARD_LAYOUT, DEFAULT_STORYLINE_SETTINGS, type GlobalSettings } from './types.js';
import * as installedWidgetsDb from './installedWidgets.js';

const BUILTIN_WIDGET_IDS = ['weather', 'stocks', 'bookmarks', 'poe2'] as const;

// widgets/widgetOrder are computed from the installed_widgets registry (see
// storage/db/installedWidgets.ts, widgets/registry.ts) rather than stored as their own
// global_settings columns — the registry is the single source of truth for enable state
// and ordering for every widget, built-in or uploaded. `widgets` stays a closed union
// (only the 4 built-ins ever gate a backend poller via scheduler.ts); `widgetOrder`
// includes every installed widget's id, built-in or uploaded, in priority_rank order —
// this is what lets a pluggable widget be positioned anywhere relative to the built-ins
// via the Widgets tab's up/down arrows, rather than always rendering after them.
function widgetsAndOrder(): Pick<GlobalSettings, 'widgets' | 'widgetOrder'> {
	const installed = installedWidgetsDb.listInstalled();
	const byId = new Map(installed.map((w) => [w.id, w]));
	const widgets = {
		weather: !!byId.get('weather')?.enabled,
		stocks: !!byId.get('stocks')?.enabled,
		bookmarks: !!byId.get('bookmarks')?.enabled,
		poe2: !!byId.get('poe2')?.enabled
	};
	const widgetOrder = installed.map((w) => w.id);
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
		embeddingServiceHost: row.embedding_service_host,
		embeddingServicePort: row.embedding_service_port,
		synthesisServiceHost: row.synthesis_service_host,
		synthesisServicePort: row.synthesis_service_port,
		selectedModels: JSON.parse(row.selected_models),
		nitterMediaMode: row.nitter_media_mode,
		fxtwitterBaseUrl: row.fxtwitter_base_url,
		nitterInstanceUrl: row.nitter_instance_url,
		telegramMediaMode: row.telegram_media_mode,
		synthesisStylePreset: row.synthesis_style_preset,
		synthesisCustomInstructions: row.synthesis_custom_instructions,
		synthesisNumCtx: row.synthesis_num_ctx,
		synthesisNumPredict: row.synthesis_num_predict,
		synthesisDisableThinking: !!row.synthesis_disable_thinking,
		synthesisLanguage: row.synthesis_language,
		...widgetsAndOrder(),
		widgetSlots: parseJson(row.widget_slots, []),
		storylines: { ...DEFAULT_STORYLINE_SETTINGS, ...parseJson(row.storyline_settings, {}) },
		boardLayout: cleanBoardLayout({ ...DEFAULT_BOARD_LAYOUT, ...parseJson(row.board_layout, {}) }),
		retention: {
			publishedArticleMaxAgeDays: row.published_article_max_age_days,
			rawItemMaxAgeDays: row.raw_item_max_age_days,
			storageCapEnabled: !!row.storage_cap_enabled,
			storageCapValue: row.storage_cap_value,
			storageCapUnit: row.storage_cap_unit
		}
	};
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Keeps admin input inside ranges the engine and the board can actually use. */
function clampStorylines(s: GlobalSettings['storylines']): GlobalSettings['storylines'] {
	const d = DEFAULT_STORYLINE_SETTINGS;
	return {
		rows: clamp(s.rows, 1, 3, d.rows) as 1 | 2 | 3,
		hybrid: s.hybrid === undefined ? d.hybrid : !!s.hybrid,
		hybridSwitchAt: Math.round(clamp(s.hybridSwitchAt, 3, 30, d.hybridSwitchAt)),
		rotateSeconds: clamp(s.rotateSeconds, 5, 120, d.rotateSeconds),
		includeEvents: !!s.includeEvents,
		jumpOnUpdate: !!s.jumpOnUpdate,
		pauseOnHover: !!s.pauseOnHover,
		joinSimilarity: clamp(s.joinSimilarity, 0.5, 0.95, d.joinSimilarity),
		minItems: clamp(s.minItems, 2, 10, d.minItems),
		minSources: clamp(s.minSources, 1, 10, d.minSources),
		seedWindowHours: clamp(s.seedWindowHours, 1, 24, d.seedWindowHours),
		nameGuard: !!s.nameGuard,
		coolingHours: clamp(s.coolingHours, 0.5, 24, d.coolingHours),
		closeHours: clamp(s.closeHours, 1, 48, d.closeHours),
		maxLifetimeHours: clamp(s.maxLifetimeHours, 2, 168, d.maxLifetimeHours),
		eventJoinSimilarity: clamp(s.eventJoinSimilarity, 0.5, 0.95, d.eventJoinSimilarity),
		eventMaxHours: clamp(s.eventMaxHours, 1, 24, d.eventMaxHours),
		eventCloseHours: clamp(s.eventCloseHours, 0.5, 24, d.eventCloseHours)
	};
}

/** Widget slots from the admin panel: each a non-empty list of widget ids, no id twice. */
function cleanSlots(slots: unknown): GlobalSettings['widgetSlots'] {
	if (!Array.isArray(slots)) return [];
	const seen = new Set<string>();
	const out: GlobalSettings['widgetSlots'] = [];
	for (const slot of slots) {
		const ids: string[] = [];
		for (const id of Array.isArray(slot?.widgets) ? slot.widgets : []) {
			if (typeof id !== 'string' || !id || seen.has(id)) continue;
			seen.add(id);
			ids.push(id);
		}
		if (ids.length) out.push({ widgets: ids, rotateSeconds: clamp(slot.rotateSeconds, 5, 300, 20) });
	}
	return out;
}

const COLUMN_KEY = /^(cat:[\w.-]+|wire|general)$/;
// A theme colour token (c-news, c-local, ...) so light and dark each get their own shade, or a hex colour.
const COLOR = /^(#[0-9a-fA-F]{6}|c-[a-z]+)$/;

/** Board layout from the admin panel: known key shapes only, no column twice, sane timers. */
function cleanBoardLayout(raw: unknown): GlobalSettings['boardLayout'] {
	const r = (raw ?? {}) as Partial<GlobalSettings['boardLayout']>;
	const seen = new Set<string>();
	const take = (k: unknown): k is string => typeof k === 'string' && COLUMN_KEY.test(k) && !seen.has(k) && (seen.add(k), true);
	const slots: GlobalSettings['boardLayout']['slots'] = [];
	for (const slot of Array.isArray(r.slots) ? r.slots : []) {
		const cols = (Array.isArray(slot?.columns) ? slot.columns : []).filter(take);
		if (cols.length) slots.push({ columns: cols, rotateSeconds: clamp(slot.rotateSeconds, 5, 300, 20) });
	}
	const hidden = (Array.isArray(r.hidden) ? r.hidden : []).filter(take);
	const colors: Record<string, string> = {};
	for (const [k, v] of Object.entries(r.colors ?? {})) if (COLUMN_KEY.test(k) && typeof v === 'string' && COLOR.test(v)) colors[k] = v;
	return {
		slots,
		hidden,
		colors,
		autoRotateQuiet: r.autoRotateQuiet !== false,
		autoFold: r.autoFold !== false
	};
}

function parseJson<T>(text: string | null | undefined, fallback: T): T {
	if (!text) return fallback;
	try {
		return JSON.parse(text) as T;
	} catch {
		return fallback;
	}
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
		widgets: { ...current.widgets, ...(patch.widgets ?? {}) },
		storylines: clampStorylines({ ...current.storylines, ...(patch.storylines ?? {}) }),
		widgetSlots: patch.widgetSlots !== undefined ? cleanSlots(patch.widgetSlots) : current.widgetSlots,
		boardLayout: patch.boardLayout !== undefined ? cleanBoardLayout({ ...current.boardLayout, ...patch.boardLayout }) : current.boardLayout
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
			embedding_service_host=$embedding_service_host, embedding_service_port=$embedding_service_port,
				synthesis_service_host=$synthesis_service_host, synthesis_service_port=$synthesis_service_port,
				selected_models=$selected_models,
			nitter_media_mode=$nitter_media_mode, fxtwitter_base_url=$fxtwitter_base_url, nitter_instance_url=$nitter_instance_url,
			telegram_media_mode=$telegram_media_mode,
			synthesis_style_preset=$synthesis_style_preset, synthesis_custom_instructions=$synthesis_custom_instructions,
			synthesis_num_ctx=$synthesis_num_ctx, synthesis_num_predict=$synthesis_num_predict,
			synthesis_disable_thinking=$synthesis_disable_thinking, synthesis_language=$synthesis_language,
			published_article_max_age_days=$published_article_max_age_days, raw_item_max_age_days=$raw_item_max_age_days,
			storage_cap_enabled=$storage_cap_enabled, storage_cap_value=$storage_cap_value, storage_cap_unit=$storage_cap_unit,
			storyline_settings=$storyline_settings, widget_slots=$widget_slots, board_layout=$board_layout
		 WHERE id = 1`
	).run({
		$merge_strictness: merged.mergeStrictness,
		$hold_before_publish_minutes: merged.holdBeforePublishMinutes,
		$tag_dedup_threshold: merged.tagDedupThreshold,
		$tag_expiry_days: merged.tagExpiryDays,
		$follow_up_min_hours_since_last: merged.followUpMinHoursSinceLast,
		$follow_up_min_new_sources: merged.followUpMinNewSources,
		$embedding_service_host: merged.embeddingServiceHost,
		$embedding_service_port: merged.embeddingServicePort,
		$synthesis_service_host: merged.synthesisServiceHost,
		$synthesis_service_port: merged.synthesisServicePort,
		$selected_models: JSON.stringify(merged.selectedModels),
		$nitter_media_mode: merged.nitterMediaMode,
		$fxtwitter_base_url: merged.fxtwitterBaseUrl,
		$nitter_instance_url: merged.nitterInstanceUrl,
		$telegram_media_mode: merged.telegramMediaMode,
		$synthesis_style_preset: merged.synthesisStylePreset,
		$synthesis_custom_instructions: merged.synthesisCustomInstructions,
		$synthesis_num_ctx: merged.synthesisNumCtx,
		$synthesis_num_predict: merged.synthesisNumPredict,
		$synthesis_disable_thinking: merged.synthesisDisableThinking ? 1 : 0,
		$synthesis_language: merged.synthesisLanguage,
		$published_article_max_age_days: merged.retention.publishedArticleMaxAgeDays,
		$raw_item_max_age_days: merged.retention.rawItemMaxAgeDays,
		$storage_cap_enabled: merged.retention.storageCapEnabled ? 1 : 0,
		$storage_cap_value: merged.retention.storageCapValue,
		$storage_cap_unit: merged.retention.storageCapUnit,
		$storyline_settings: JSON.stringify(merged.storylines),
		$widget_slots: JSON.stringify(merged.widgetSlots),
		$board_layout: JSON.stringify(merged.boardLayout)
	});
	return getSettings();
}
