import { getKv, setKv } from '../../storage/db/widgetKv.js';

/**
 * The at-a-glance conditions an hour (or "right now") carries beyond temperature and
 * wind — the same fields on both, so the weather page's header card can show either the
 * live reading or whichever hour is being hovered with one rendering path.
 */
export interface ConditionDetails {
	/** Already in the admin's configured windUnit. */
	windGust: number;
	/** Percent, 0-100. */
	cloudCover: number;
	/** Miles when windUnit is mph, kilometres when kph — so imperial and metric users each get the distance unit their wind speed already implies. */
	visibility: number | null;
	/** In the admin's configured temperature unit. */
	dewPoint: number;
	/** Estimated relative humidity indoors, percent — see indoorHumidity() in client.ts for how and how closely it tracks AccuWeather's figure. */
	indoorHumidity: number;
	/** One of the 11 descriptions from "Dangerously Dry" through "Ideal Humidity" to "Dangerously Humid". Driven by the outdoor DEW POINT, not by indoorHumidity — see INDOOR_HUMIDITY_SCALE. */
	indoorHumidityLabel: string;
	/** -5 (dangerously dry) .. 0 (ideal) .. +5 (dangerously humid), for colouring the label without the frontend re-deriving the scale. */
	indoorHumidityLevel: number;
	/** Lowest-cloud-layer height in feet, or null when unknown. NWS gridpoint data, so US locations only — Open-Meteo has no cloud-base field for any model. Values at or above NWS's 25,000 ft cap mean "no ceiling". */
	cloudCeilingFt: number | null;
}

/**
 * What an hour looks like at a glance, coarse enough to merge neighbouring hours into one
 * labelled stretch on the weather page's timeline bar. Derived from the WMO weather code
 * rather than from the display text, so rewording a label can never silently reclassify
 * an hour. Rain is split into light and heavier because that is the distinction the bar
 * draws; the rest of the precipitation types are one colour each.
 */
export type ConditionKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'light-rain' | 'rain' | 'freezing' | 'snow' | 'storm';

export interface WeatherHourEntry extends ConditionDetails {
	conditionKind: ConditionKind;
	time: string;
	temp: number;
	/** Apparent temperature (Open-Meteo's heat-index/wind-chill blend), in the configured temperature unit. */
	feelsLike: number;
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
	/** The calendar day's minimum - the fallback for nightLow when too little of the night is in the forecast. */
	tempMin: number;
	/** Short daytime description composed from the hourly series (see describePeriod in client.ts), e.g. "Mostly cloudy with a shower". */
	conditionText: string;
	icon: string;
	/** Short description of the night that follows this day (dusk to the next dawn). Empty when there were no hours to describe. */
	nightDescription: string;
	nightIcon: string;
	/** That night's lowest temperature - what AccuWeather shows as the day's "low". Null when under 6 night hours are in the forecast. */
	nightLow: number | null;
	/** Percent, 0-100: the day's maximum hourly chance of precipitation. */
	precipitationChance: number | null;
	/** Same, over that night's hours alone - what a "Tonight" row shows once the day itself is over. */
	nightPrecipitationChance: number | null;
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
	current: (ConditionDetails & {
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
	}) | null;
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
