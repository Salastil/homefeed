import { getKv, setKv } from '../../storage/db/widgetKv.js';

export interface WeatherHourEntry {
	time: string;
	temp: number;
	conditionText: string;
	icon: string;
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
		sunrise: string;
		sunset: string;
	} | null;
	hourly: WeatherHourEntry[];
	daily: WeatherDayEntry[];
	/** Active NWS alerts (flash flood, hurricane, blizzard, etc.) for the configured location — US-only, empty elsewhere. See client.ts's fetchActiveAlerts. */
	alerts: WeatherAlert[];
	updatedAt: string | null;
}

const WIDGET_ID = 'weather';

const DEFAULT_CONFIG: WeatherConfig = {
	locationName: null,
	latitude: null,
	longitude: null,
	unit: 'fahrenheit',
	windUnit: 'mph',
	pressureUnit: 'inHg'
};

const DEFAULT_CACHE: WeatherCache = {
	current: null,
	hourly: [],
	daily: [],
	alerts: [],
	updatedAt: null
};

// Config (admin-settable: location/units) and cache (poll-computed forecast) are stored as
// two separate widget_kv keys — mirrors the singleton-row split stock_tickers/bookmarks
// tables already had from global_settings, just via the generic kv store instead of a
// bespoke table (this widget has no data shaped like rows, so no dedicated table is needed).
export function getConfig(): WeatherConfig {
	return getKv<WeatherConfig>(WIDGET_ID, 'config') ?? DEFAULT_CONFIG;
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
