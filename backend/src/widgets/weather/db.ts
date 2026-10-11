import { getKv, setKv } from '../../storage/db/widgetKv.js';

export interface WeatherHourEntry {
	time: string;
	temp: number;
	conditionText: string;
	icon: string;
	/** Percent, 0-100. */
	humidity: number;
	/** Percent, 0-100. */
	precipitationChance: number;
	/** Already in the admin's configured windUnit. */
	windSpeed: number;
	/** 8-point compass abbreviation, e.g. "NW". */
	windDirection: string;
	/** Already in the admin's configured pressureUnit. */
	pressure: number;
	/** Precipitation accumulated during this hour, already in the admin's configured precipUnit — inches, or mm for rain / cm for snow when metric. Snow is reported as DEPTH, not liquid equivalent, which is why precipIsSnow has to travel with it to pick the right label. */
	precipAmount: number;
	/** True when this hour's accumulation is snow depth rather than rainfall. */
	precipIsSnow: boolean;
}

export interface WeatherDayEntry {
	date: string;
	tempMax: number;
	tempMin: number;
	conditionText: string;
	icon: string;
}

export interface WeatherAlert {
	id: string;
	event: string;
	headline: string;
	severity: string;
	expires: string;
}

export interface WeatherConfig {
	locationName: string | null;
	latitude: number | null;
	longitude: number | null;
	unit: 'celsius' | 'fahrenheit';
	windUnit: 'mph' | 'kph';
	pressureUnit: 'inHg' | 'hPa';
	/** 'in' reports both rain and snow in inches. 'mm' follows the metric convention of millimetres for rain but CENTIMETRES for snow depth, which is what Open-Meteo returns and what forecasters actually use. */
	precipUnit: 'in' | 'mm';
}

export interface WeatherCache {
	current: {
		temp: number;
		/** Apparent temperature (Open-Meteo's own heat-index/wind-chill blend) — "Feels like". */
		feelsLike: number;
		conditionText: string;
		icon: string;
		/** Percent, 0-100. */
		humidity: number;
		/** Percent, 0-100 — the current hour's forecast precipitation probability (there's no true instantaneous "chance of rain" measurement). */
		precipitationChance: number;
		/** Already in the admin's configured windUnit. */
		windSpeed: number;
		/** 8-point compass abbreviation, e.g. "NW". */
		windDirection: string;
		/** Already in the admin's configured pressureUnit. */
		pressure: number;
		/** Precipitation in the hour just gone, in the configured precipUnit — see WeatherHourEntry.precipAmount. */
		precipAmount: number;
		/** True when that accumulation is snow depth rather than rainfall. */
		precipIsSnow: boolean;
		sunrise: string;
		sunset: string;
	} | null;
	hourly: WeatherHourEntry[];
	daily: WeatherDayEntry[];
	/** Active NWS alerts (flash flood, hurricane, blizzard, etc.) for the configured location — US-only, empty elsewhere. See client.ts's fetchActiveAlerts. */
	alerts: WeatherAlert[];
	/** Plain-English wrap-up composed from the fields above (see client.ts's buildDaySummary) — null until the first successful poll, or if there wasn't enough data (e.g. tomorrow's forecast missing). */
	summary: string | null;
	updatedAt: string | null;
}

const WIDGET_ID = 'weather';

const DEFAULT_CONFIG: WeatherConfig = {
	locationName: null,
	latitude: null,
	longitude: null,
	unit: 'fahrenheit',
	windUnit: 'mph',
	pressureUnit: 'inHg',
	precipUnit: 'in'
};

const DEFAULT_CACHE: WeatherCache = {
	current: null,
	hourly: [],
	daily: [],
	alerts: [],
	summary: null,
	updatedAt: null
};

// Config (admin-settable: location/units) and cache (poll-computed forecast) are stored as
// two separate widget_kv keys — mirrors the singleton-row split stock_tickers/bookmarks
// tables already had from global_settings, just via the generic kv store instead of a
// bespoke table (this widget has no data shaped like rows, so no dedicated table is needed).
export function getConfig(): WeatherConfig {
	// Spread over the defaults rather than falling back to them wholesale: a config saved
	// before a field existed is a stored object MISSING that key, not an absent row, so
	// `?? DEFAULT_CONFIG` alone would hand back `undefined` for every newer setting.
	return { ...DEFAULT_CONFIG, ...(getKv<Partial<WeatherConfig>>(WIDGET_ID, 'config') ?? {}) };
}

export function setConfig(patch: Partial<WeatherConfig>): WeatherConfig {
	const merged = { ...getConfig(), ...patch };
	setKv(WIDGET_ID, 'config', merged);
	return merged;
}

export function getCache(): WeatherCache {
	return getKv<WeatherCache>(WIDGET_ID, 'cache') ?? DEFAULT_CACHE;
}

export function setCache(patch: Partial<WeatherCache>): WeatherCache {
	const merged = { ...getCache(), ...patch };
	setKv(WIDGET_ID, 'cache', merged);
	return merged;
}
