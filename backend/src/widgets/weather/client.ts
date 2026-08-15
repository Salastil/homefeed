// Open-Meteo (api.open-meteo.com / geocoding-api.open-meteo.com) — free, no account or API
// key required, which is why it was picked over any commercial weather provider. This is
// the only file that talks to it; poller.ts orchestrates when/how the result gets saved,
// same separation as backend/src/telegram/ keeps between the raw client and its callers.

export interface GeocodeResult {
	name: string;
	admin1: string | null;
	country: string | null;
	latitude: number;
	longitude: number;
}

export interface WeatherCondition {
	text: string;
	icon: string;
}

// WMO weather interpretation codes, as returned by Open-Meteo's weather_code field —
// https://open-meteo.com/en/docs lists the full table this summarizes.
const WMO_CONDITIONS: Record<number, WeatherCondition> = {
	0: { text: 'Clear sky', icon: '☀️' },
	1: { text: 'Mainly clear', icon: '🌤️' },
	2: { text: 'Partly cloudy', icon: '⛅' },
	3: { text: 'Overcast', icon: '☁️' },
	45: { text: 'Fog', icon: '🌫️' },
	48: { text: 'Depositing rime fog', icon: '🌫️' },
	51: { text: 'Light drizzle', icon: '🌦️' },
	53: { text: 'Moderate drizzle', icon: '🌦️' },
	55: { text: 'Dense drizzle', icon: '🌦️' },
	56: { text: 'Light freezing drizzle', icon: '🌧️' },
	57: { text: 'Dense freezing drizzle', icon: '🌧️' },
	61: { text: 'Slight rain', icon: '🌧️' },
	63: { text: 'Moderate rain', icon: '🌧️' },
	65: { text: 'Heavy rain', icon: '🌧️' },
	66: { text: 'Light freezing rain', icon: '🌧️' },
	67: { text: 'Heavy freezing rain', icon: '🌧️' },
	71: { text: 'Slight snow', icon: '🌨️' },
	73: { text: 'Moderate snow', icon: '🌨️' },
	75: { text: 'Heavy snow', icon: '❄️' },
	77: { text: 'Snow grains', icon: '❄️' },
	80: { text: 'Slight rain showers', icon: '🌦️' },
	81: { text: 'Moderate rain showers', icon: '🌦️' },
	82: { text: 'Violent rain showers', icon: '⛈️' },
	85: { text: 'Slight snow showers', icon: '🌨️' },
	86: { text: 'Heavy snow showers', icon: '🌨️' },
	95: { text: 'Thunderstorm', icon: '⛈️' },
	96: { text: 'Thunderstorm, slight hail', icon: '⛈️' },
	99: { text: 'Thunderstorm, heavy hail', icon: '⛈️' }
};

export function wmoToCondition(code: number): WeatherCondition {
	return WMO_CONDITIONS[code] ?? { text: 'Unknown', icon: '❔' };
}

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const COMPASS_FULL_NAMES: Record<string, string> = {
	N: 'north',
	NE: 'northeast',
	E: 'east',
	SE: 'southeast',
	S: 'south',
	SW: 'southwest',
	W: 'west',
	NW: 'northwest'
};

function degreesToCompass(degrees: number): string {
	return COMPASS_POINTS[Math.round(degrees / 45) % 8];
}

// WMO_CONDITIONS' text is a noun-phrase status label ("Clear sky", "Overcast") — good for
// a chip, but reads oddly after "will turn" ("will turn clear sky" isn't a sentence). Maps
// each one to a plain adjective for the day-summary sentence specifically; anything not
// listed (Unknown, an unmapped future code) just falls back to the lowercased label.
const CONDITION_ADJECTIVES: Record<string, string> = {
	'Clear sky': 'clear',
	'Mainly clear': 'mostly clear',
	'Partly cloudy': 'partly cloudy',
	Overcast: 'cloudy',
	Fog: 'foggy',
	'Depositing rime fog': 'foggy',
	'Light drizzle': 'drizzly',
	'Moderate drizzle': 'drizzly',
	'Dense drizzle': 'drizzly',
	'Light freezing drizzle': 'icy',
	'Dense freezing drizzle': 'icy',
	'Slight rain': 'rainy',
	'Moderate rain': 'rainy',
	'Heavy rain': 'rainy',
	'Light freezing rain': 'icy',
	'Heavy freezing rain': 'icy',
	'Slight snow': 'snowy',
	'Moderate snow': 'snowy',
	'Heavy snow': 'snowy',
	'Snow grains': 'snowy',
	'Slight rain showers': 'showery',
	'Moderate rain showers': 'showery',
	'Violent rain showers': 'stormy',
	'Slight snow showers': 'snowy',
	'Heavy snow showers': 'snowy',
	Thunderstorm: 'stormy',
	'Thunderstorm, slight hail': 'stormy',
	'Thunderstorm, heavy hail': 'stormy'
};

function conditionAdjective(conditionText: string): string {
	return CONDITION_ADJECTIVES[conditionText] ?? conditionText.toLowerCase();
}

function hPaToInHg(hpa: number): number {
	return hpa * 0.0295299830714;
}

/**
 * Open-Meteo's `&timezone=auto` returns every timestamp as a naive local-to-the-WEATHER-
 * LOCATION string with no UTC offset ("2026-08-15T18:00") — `new Date(...)` on a string
 * with no offset is parsed in the RUNTIME's own local timezone, not the location's. On a
 * dev machine whose timezone happens to match the weather location this silently works;
 * in production (a Docker container with no TZ set, so Node defaults to UTC) it doesn't —
 * every comparison against Date.now() ends up off by the location's UTC offset (4h for
 * Philadelphia in EDT), which is exactly why "today" was found to start hours later than
 * the real current hour. Open-Meteo also returns `utc_offset_seconds` for the requested
 * location — appending it as an explicit ISO-8601 offset makes every timestamp parse to
 * the same correct instant no matter which timezone the parsing runtime is in (this
 * backend's own code below, or a visitor's browser on the other side of the world).
 */
function withUtcOffset(naiveLocalTime: string, utcOffsetSeconds: number): string {
	const sign = utcOffsetSeconds < 0 ? '-' : '+';
	const abs = Math.abs(utcOffsetSeconds);
	const hours = String(Math.floor(abs / 3600)).padStart(2, '0');
	const minutes = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
	return `${naiveLocalTime}:00${sign}${hours}:${minutes}`;
}

export async function geocodeLocation(query: string): Promise<GeocodeResult[]> {
	const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Geocoding API returned ${res.status}`);
	const data = (await res.json()) as {
		results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[];
	};
	return (data.results ?? []).map((r) => ({
		name: r.name,
		admin1: r.admin1 ?? null,
		country: r.country ?? null,
		latitude: r.latitude,
		longitude: r.longitude
	}));
}

export interface CurrentConditions {
	temp: number;
	feelsLike: number;
	conditionText: string;
	icon: string;
	humidity: number;
	precipitationChance: number;
	windSpeed: number;
	windDirection: string;
	pressure: number;
	sunrise: string;
	sunset: string;
}

export interface ForecastResult {
	current: CurrentConditions;
	hourly: { time: string; temp: number; conditionText: string; icon: string }[];
	daily: { date: string; tempMax: number; tempMin: number; conditionText: string; icon: string }[];
	/** A plain-English wrap-up ("Current conditions in X are 86°F and sunny with a light northwest wind at 5 mph. Tonight will turn...") — composed from the same numbers above, not a separate API call. Null if there isn't enough data to build one (e.g. tomorrow's forecast missing). */
	summary: string | null;
}

/** date-only strings (e.g. "2026-08-16") parse as UTC midnight in JS — formatting that directly with a non-UTC locale method can silently roll the date back a day depending on the server's own timezone, unrelated to the weather location's. Splitting into components and constructing a local Date sidesteps that (same technique frontend/src/lib/format.ts's parseDateOnly uses). */
function parseDateOnly(dateOnly: string): Date {
	const [year, month, day] = dateOnly.split('-').map(Number);
	return new Date(year, month - 1, day);
}

function windDescriptor(speed: number, unit: 'mph' | 'kph'): string {
	const mph = unit === 'kph' ? speed * 0.621371 : speed;
	if (mph < 8) return 'light';
	if (mph < 20) return 'moderate';
	return 'strong';
}

/**
 * Deliberately template-composed, not model-generated — every value here is an exact
 * number already computed above, and there's exactly one correct way to state e.g. "75%
 * chance of rain"; an LLM asked to restate numbers it's already been given can still
 * transpose or invent one, which is a far worse failure mode for a weather report than
 * plain phrasing. Also avoids competing with actual article synthesis for the one Ollama
 * inference slot on every 45-minute poll cycle (see widgets/weather/plugin.ts).
 */
function buildDaySummary(
	locationName: string | null,
	current: CurrentConditions,
	todayRemaining: { temp: number; conditionText: string }[],
	tomorrow: { date: string; tempMax: number; precipitationChance: number } | undefined,
	windUnit: 'mph' | 'kph'
): string | null {
	if (!tomorrow || todayRemaining.length === 0) return null;

	const place = locationName ?? 'your area';
	const wind = windDescriptor(current.windSpeed, windUnit);
	const windDirectionFull = COMPASS_FULL_NAMES[current.windDirection] ?? current.windDirection;
	const humidityClause = current.humidity >= 60 ? ' and humid' : current.humidity <= 30 ? ' and dry' : '';
	const tonightLow = Math.round(Math.min(...todayRemaining.map((h) => h.temp)));
	const tonightCondition = conditionAdjective(todayRemaining[todayRemaining.length - 1].conditionText);
	const tomorrowDate = parseDateOnly(tomorrow.date);
	const tomorrowLabel = tomorrowDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

	return (
		`Current conditions in ${place} are ${Math.round(current.temp)}° and ` +
		`${conditionAdjective(current.conditionText)} with a ${wind} ${windDirectionFull} wind at ${Math.round(current.windSpeed)} ${windUnit}. ` +
		`Tonight will turn ${tonightCondition}${humidityClause} with a low around ${tonightLow}°, followed by a high of ` +
		`${Math.round(tomorrow.tempMax)}° and a ${Math.round(tomorrow.precipitationChance)}% chance of rain tomorrow, ${tomorrowLabel}.`
	);
}

export async function fetchForecast(
	latitude: number,
	longitude: number,
	unit: 'celsius' | 'fahrenheit',
	windUnit: 'mph' | 'kph',
	pressureUnit: 'inHg' | 'hPa',
	locationName: string | null
): Promise<ForecastResult> {
	const url =
		`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
		`&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl` +
		`&hourly=temperature_2m,weather_code,precipitation_probability` +
		`&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_probability_max` +
		`&temperature_unit=${unit}&wind_speed_unit=${windUnit === 'kph' ? 'kmh' : 'mph'}&timezone=auto&forecast_days=7`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Forecast API returned ${res.status}`);
	const data = (await res.json()) as {
		utc_offset_seconds: number;
		current: {
			temperature_2m: number;
			apparent_temperature: number;
			weather_code: number;
			relative_humidity_2m: number;
			wind_speed_10m: number;
			wind_direction_10m: number;
			pressure_msl: number;
		};
		hourly: { time: string[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability: number[] };
		daily: {
			time: string[];
			temperature_2m_max: number[];
			temperature_2m_min: number[];
			weather_code: number[];
			sunrise: string[];
			sunset: string[];
			precipitation_probability_max: number[];
		};
	};

	// Rewrite every naive local timestamp to an explicit-offset one up front (see
	// withUtcOffset) — everything below compares/returns these, never the raw strings.
	const hourlyTimes = data.hourly.time.map((t) => withUtcOffset(t, data.utc_offset_seconds));

	// hourly.time starts at today's midnight, not the current hour — find the first entry
	// at or after now so the strip shown to the user starts from "now", not from midnight,
	// and so the current hour's precipitation_probability can stand in for "right now"
	// (there's no true instantaneous "chance of rain" measurement, current forecasts don't have one).
	const now = Date.now();
	const startIdx = Math.max(
		0,
		hourlyTimes.findIndex((t) => new Date(t).getTime() >= now)
	);

	const currentCondition = wmoToCondition(data.current.weather_code);
	const pressure = pressureUnit === 'inHg' ? hPaToInHg(data.current.pressure_msl) : data.current.pressure_msl;
	const current: CurrentConditions = {
		temp: data.current.temperature_2m,
		feelsLike: data.current.apparent_temperature,
		conditionText: currentCondition.text,
		icon: currentCondition.icon,
		humidity: data.current.relative_humidity_2m,
		precipitationChance: data.hourly.precipitation_probability[startIdx] ?? 0,
		windSpeed: data.current.wind_speed_10m,
		windDirection: degreesToCompass(data.current.wind_direction_10m),
		pressure: pressureUnit === 'inHg' ? Math.round(pressure * 100) / 100 : Math.round(pressure),
		sunrise: withUtcOffset(data.daily.sunrise[0], data.utc_offset_seconds),
		sunset: withUtcOffset(data.daily.sunset[0], data.utc_offset_seconds)
	};

	// Through the end of TOMORROW (index 47 — hourly.time starts at today's midnight, so
	// 0-23 is today and 24-47 is tomorrow), not a rolling 24h window from now. A rolling
	// window meant "today" on the frontend's per-day grouping shrank to almost nothing
	// by late evening (e.g. just 10-11 PM) while tomorrow showed nothing at all — the
	// frontend now expects today's remaining hours plus the whole of tomorrow.
	const hourly = hourlyTimes.slice(startIdx, 48).map((time, i) => {
		const idx = startIdx + i;
		const condition = wmoToCondition(data.hourly.weather_code[idx]);
		return { time, temp: data.hourly.temperature_2m[idx], conditionText: condition.text, icon: condition.icon };
	});

	const daily = data.daily.time.map((date, i) => {
		const condition = wmoToCondition(data.daily.weather_code[i]);
		return {
			date,
			tempMax: data.daily.temperature_2m_max[i],
			tempMin: data.daily.temperature_2m_min[i],
			conditionText: condition.text,
			icon: condition.icon
		};
	});

	// "Today" means the weather LOCATION's calendar day, not the server's — new Date()
	// would answer that in the server's own local timezone (production runs the
	// container with no TZ set, so that's UTC, not wherever the location actually is).
	// data.hourly.time[0] (the raw, un-sliced array) is guaranteed by Open-Meteo to be
	// the location's own midnight today, so its date portion is exactly the string to
	// compare against — plain string prefix comparison, no Date/timezone math at all.
	const todayStr = data.hourly.time[0].slice(0, 10);
	const todayRemaining = hourly.filter((h) => h.time.slice(0, 10) === todayStr);
	const tomorrow =
		data.daily.time.length > 1
			? { date: data.daily.time[1], tempMax: data.daily.temperature_2m_max[1], precipitationChance: data.daily.precipitation_probability_max[1] }
			: undefined;
	const summary = buildDaySummary(locationName, current, todayRemaining, tomorrow, windUnit);

	return { current, hourly, daily, summary };
}

export interface WeatherAlertResult {
	id: string;
	event: string;
	headline: string;
	severity: string;
	expires: string;
}

// US National Weather Service — free, no key, no account, covers the US and territories
// only. A non-US location will reliably fail this call; that's expected, not an error
// (see poller.ts, which treats a failure here as "no alerts" rather than propagating it).
export async function fetchActiveAlerts(latitude: number, longitude: number): Promise<WeatherAlertResult[]> {
	const url = `https://api.weather.gov/alerts/active?point=${latitude},${longitude}`;
	const res = await fetch(url, {
		headers: {
			// NWS's API usage policy requires an identifying User-Agent on every request.
			'User-Agent': 'Homefeed/1.0 (self-hosted news aggregator)',
			Accept: 'application/geo+json'
		}
	});
	if (!res.ok) throw new Error(`NWS alerts API returned ${res.status}`);
	const data = (await res.json()) as {
		features: { id: string; properties: { event: string; headline: string; severity: string; expires: string } }[];
	};
	return data.features.map((f) => ({
		id: f.id,
		event: f.properties.event,
		headline: f.properties.headline,
		severity: f.properties.severity,
		expires: f.properties.expires
	}));
}
