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

function degreesToCompass(degrees: number): string {
	return COMPASS_POINTS[Math.round(degrees / 45) % 8];
}

function hPaToInHg(hpa: number): number {
	return hpa * 0.0295299830714;
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
}

export async function fetchForecast(
	latitude: number,
	longitude: number,
	unit: 'celsius' | 'fahrenheit',
	windUnit: 'mph' | 'kph',
	pressureUnit: 'inHg' | 'hPa'
): Promise<ForecastResult> {
	const url =
		`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
		`&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl` +
		`&hourly=temperature_2m,weather_code,precipitation_probability` +
		`&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset` +
		`&temperature_unit=${unit}&wind_speed_unit=${windUnit === 'kph' ? 'kmh' : 'mph'}&timezone=auto&forecast_days=7`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Forecast API returned ${res.status}`);
	const data = (await res.json()) as {
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
		};
	};

	// hourly.time starts at today's midnight, not the current hour — find the first entry
	// at or after now so the strip shown to the user starts from "now", not from midnight,
	// and so the current hour's precipitation_probability can stand in for "right now"
	// (there's no true instantaneous "chance of rain" measurement, current forecasts don't have one).
	const now = Date.now();
	const startIdx = Math.max(
		0,
		data.hourly.time.findIndex((t) => new Date(t).getTime() >= now)
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
		sunrise: data.daily.sunrise[0],
		sunset: data.daily.sunset[0]
	};

	const hourly = data.hourly.time.slice(startIdx, startIdx + 24).map((time, i) => {
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

	return { current, hourly, daily };
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
