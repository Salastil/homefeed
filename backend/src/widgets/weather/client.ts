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

/**
 * Precipitation intensity, keyed by the exact WMO_CONDITIONS label rather than matched by
 * regex — the label set is a fixed table right above, so an exact map can't misclassify
 * ("Heavy freezing rain" vs "Light freezing drizzle" both contain "freezing", and a
 * regex ordered wrong silently downgrades one of them). `rank` drives which condition
 * represents a whole segment when several occur in it; `noun` is what the summary calls
 * it, so intensity survives into the prose ("heavy rain", not just "rain").
 */
interface PrecipKind {
	rank: number;
	noun: string;
	snow: boolean;
}

const PRECIP_KINDS: Record<string, PrecipKind> = {
	'Light drizzle': { rank: 1, noun: 'light drizzle', snow: false },
	'Moderate drizzle': { rank: 2, noun: 'drizzle', snow: false },
	'Dense drizzle': { rank: 3, noun: 'heavy drizzle', snow: false },
	'Light freezing drizzle': { rank: 3, noun: 'freezing drizzle', snow: false },
	'Dense freezing drizzle': { rank: 4, noun: 'heavy freezing drizzle', snow: false },
	'Slight rain': { rank: 2, noun: 'light rain', snow: false },
	'Moderate rain': { rank: 3, noun: 'rain', snow: false },
	'Heavy rain': { rank: 4, noun: 'heavy rain', snow: false },
	'Light freezing rain': { rank: 3, noun: 'freezing rain', snow: false },
	'Heavy freezing rain': { rank: 4, noun: 'heavy freezing rain', snow: false },
	'Slight snow': { rank: 2, noun: 'light snow', snow: true },
	'Moderate snow': { rank: 3, noun: 'snow', snow: true },
	'Heavy snow': { rank: 4, noun: 'heavy snow', snow: true },
	'Snow grains': { rank: 2, noun: 'snow grains', snow: true },
	'Slight rain showers': { rank: 2, noun: 'light showers', snow: false },
	'Moderate rain showers': { rank: 3, noun: 'showers', snow: false },
	'Violent rain showers': { rank: 5, noun: 'heavy downpours', snow: false },
	'Slight snow showers': { rank: 2, noun: 'light snow showers', snow: true },
	'Heavy snow showers': { rank: 4, noun: 'heavy snow showers', snow: true },
	Thunderstorm: { rank: 5, noun: 'thunderstorms', snow: false },
	'Thunderstorm, slight hail': { rank: 5, noun: 'thunderstorms', snow: false },
	'Thunderstorm, heavy hail': { rank: 5, noun: 'thunderstorms with hail', snow: false }
};

function precipKind(conditionText: string): PrecipKind | null {
	return PRECIP_KINDS[conditionText] ?? null;
}

/** "thunderstorms are" / "rain is" — plural nouns need a plural verb in every generated clause. */
function isPluralNoun(noun: string): boolean {
	return noun.endsWith('s') && !noun.endsWith('ss');
}

type DaySegment = 'overnight' | 'morning' | 'afternoon' | 'evening';

/** Every hour belongs to a segment — unlike the earlier 3-segment version, overnight (0-5) is a real part of the outlook, since after ~6 PM it's the only thing left to describe. */
function segmentOfHour(hourOfDay: number): DaySegment {
	if (hourOfDay <= 5) return 'overnight';
	if (hourOfDay <= 11) return 'morning';
	if (hourOfDay <= 17) return 'afternoon';
	return 'evening';
}

/**
 * The sky a segment shows when it ISN'T precipitating — the mode of its non-precip hours.
 * Exists because "no rain in the forecast" and "clear skies" are not the same claim: a
 * fully overcast day with one drizzle hour has no segment above the wet threshold, and
 * the previous version reported that as "with clear skies" while the 7-day row for the
 * same day read "Light drizzle". Falls back to overcast when every hour is wet (the
 * caller only uses this for dry segments, so that's a formality).
 */
function dominantSky(hours: { conditionText: string }[]): string {
	const counts = new Map<string, number>();
	for (const h of hours) {
		if (precipKind(h.conditionText)) continue;
		counts.set(h.conditionText, (counts.get(h.conditionText) ?? 0) + 1);
	}
	let best: string | null = null;
	let bestCount = 0;
	for (const [text, n] of counts) {
		if (n > bestCount) {
			best = text;
			bestCount = n;
		}
	}
	return best ? conditionAdjective(best) : 'cloudy';
}

interface SegmentOutlook {
	segment: DaySegment;
	isPrecip: boolean;
	/** Strongest precipitation noun in the segment, e.g. "heavy rain" — empty when dry. */
	noun: string;
	/** That noun's PrecipKind.rank, carried through so segments can be compared without re-deriving it from the noun (PRECIP_KINDS is keyed by condition label, not by noun). */
	rank: number;
	snow: boolean;
	/** Adjective for the segment's non-precip sky, e.g. "cloudy". */
	sky: string;
}

/**
 * Collapses hour-by-hour data into one verdict per named part of the day. A segment counts
 * as precipitating when at least a third of its hours are wet, OR when any single hour is
 * heavy/stormy (rank >= 4) — one thunderstorm hour is the most important thing to say
 * about that stretch even when the other five are dry, which a pure ratio test would
 * discard.
 *
 * Groups by walking `hours` in chronological order rather than iterating a fixed segment
 * list, which is what keeps tonight's overnight stretch at the END of the outlook where it
 * belongs. Selecting segments out of a canonical overnight→evening array instead put
 * "cloudy skies overnight" ahead of "this afternoon" in the finished sentence, and would
 * also have merged two different nights into one segment when called after midnight.
 */
function segmentOutlooks(hours: { time: string; conditionText: string }[]): SegmentOutlook[] {
	// String-sliced, not new Date(h.time).getHours() — that reads the LOCAL hour of
	// whichever timezone the parsing runtime happens to be in, the exact bug already
	// fixed once for startIdx (see withUtcOffset's comment above).
	const groups: { segment: DaySegment; hours: { time: string; conditionText: string }[] }[] = [];
	for (const h of hours) {
		const segment = segmentOfHour(Number(h.time.slice(11, 13)));
		const last = groups[groups.length - 1];
		if (last && last.segment === segment) last.hours.push(h);
		else groups.push({ segment, hours: [h] });
	}

	return groups.map(({ segment, hours: segHours }) => {
		const kinds = segHours.map((h) => precipKind(h.conditionText)).filter((k): k is PrecipKind => k !== null);
		const strongest = kinds.reduce<PrecipKind | null>((a, b) => (a && a.rank >= b.rank ? a : b), null);
		const isPrecip = kinds.length > 0 && (kinds.length / segHours.length >= 1 / 3 || kinds.some((k) => k.rank >= 4));
		return {
			segment,
			isPrecip,
			noun: strongest?.noun ?? '',
			rank: strongest?.rank ?? 0,
			snow: !!strongest?.snow,
			sky: dominantSky(segHours)
		};
	});
}

/** "this afternoon" / "overnight" for today; "in the afternoon" for a future day, where "this" would be wrong. */
function segmentLabel(segment: DaySegment, when: 'today' | 'future'): string {
	if (segment === 'overnight') return 'overnight';
	return when === 'today' ? `this ${segment}` : `in the ${segment}`;
}

/** Bare form for the tail of a multi-segment run ("...and into the evening"). "into overnight" is missing a noun, hence the longer form for that one. */
function bareSegment(segment: DaySegment): string {
	return segment === 'overnight' ? 'the overnight hours' : `the ${segment}`;
}

interface OutlookRun {
	noun: string | null;
	segments: SegmentOutlook[];
}

/** Merges neighbouring segments that share a verdict, so three wet segments read as one span rather than three repetitive clauses. */
function groupRuns(outlooks: SegmentOutlook[]): OutlookRun[] {
	const runs: OutlookRun[] = [];
	for (const o of outlooks) {
		const key = o.isPrecip ? o.noun : null;
		const last = runs[runs.length - 1];
		if (last && last.noun === key) last.segments.push(o);
		else runs.push({ noun: key, segments: [o] });
	}
	return runs;
}

function runLabel(run: OutlookRun, when: 'today' | 'future'): string {
	const first = run.segments[0].segment;
	const last = run.segments[run.segments.length - 1].segment;
	if (first === last) return segmentLabel(first, when);
	return `${segmentLabel(first, when)} and into ${bareSegment(last)}`;
}

function joinClauses(clauses: string[]): string {
	if (clauses.length === 1) return clauses[0];
	const head = clauses.slice(0, -1).join(', ');
	return `${head}, then ${clauses[clauses.length - 1]}`;
}

/**
 * Same as joinClauses, but a trailing DRY clause gets "before" rather than ", then" —
 * those clauses are participles ("easing off overnight"), and ", then easing off" reads
 * as a broken parallel against the finite verbs in the clauses ahead of it.
 */
function joinOutlookClauses(clauses: { text: string; dry: boolean }[]): string {
	if (clauses.length === 1) return clauses[0].text;
	const last = clauses[clauses.length - 1];
	const head = clauses.slice(0, -1).map((c) => c.text).join(', ');
	return last.dry ? `${head} before ${last.text}` : `${head}, then ${last.text}`;
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The rest of today, one clause per run, with the run containing the CURRENT segment in
 * present tense ("heavy rain is moving through this afternoon") and everything after it in
 * future tense ("then easing off overnight") — a forecast that describes the hour you're
 * living in as something that "will" happen reads as wrong even when the data is right.
 * Segments already past are never passed in, so no clause is ever wasted on them.
 */
function describeTodaySentence(outlooks: SegmentOutlook[], currentSegment: DaySegment): string | null {
	if (outlooks.length === 0) return null;
	const runs = groupRuns(outlooks);
	const clauses = runs.map((run, i) => {
		const isCurrent = run.segments.some((s) => s.segment === currentSegment);
		const label = runLabel(run, 'today');
		if (run.noun) {
			const text = isCurrent
				? `${run.noun} ${isPluralNoun(run.noun) ? 'are' : 'is'} moving through ${label}`
				: `${run.noun} ${isPluralNoun(run.noun) ? 'move' : 'moves'} in ${label}`;
			return { text, dry: false };
		}
		const sky = run.segments[0].sky;
		const clearing = /clear/.test(sky);
		if (isCurrent) return { text: `skies are ${sky} ${label}`, dry: false };
		// Only a run that FOLLOWS wet weather is "easing off"/"clearing" — a dry run in
		// first position has nothing to have eased from.
		if (i > 0) return { text: clearing ? `clearing ${label}` : `easing off ${label}`, dry: true };
		return { text: `${sky} skies ${label}`, dry: false };
	});
	return `${capitalize(joinOutlookClauses(clauses))}.`;
}

/**
 * A future day, as a trailing "with ..." phrase after "expect a high of 75°". Always future
 * tense (nothing about tomorrow is happening now), and reports actual sky cover when
 * nothing is falling rather than assuming dry means clear.
 */
function describeFuturePhrase(outlooks: SegmentOutlook[], allHours: { conditionText: string }[], snowfallInches: number): string {
	const wet = outlooks.filter((o) => o.isPrecip);
	const anySnow = wet.some((o) => o.snow);
	const snowClause = anySnow && snowfallInches >= 0.1 ? `, with around ${snowfallInches.toFixed(1)} inches expected` : '';

	if (wet.length === 0) return `with ${dominantSky(allHours)} skies`;

	if (wet.length === outlooks.length) {
		const strongest = wet.reduce((a, b) => (a.rank >= b.rank ? a : b));
		return `with ${strongest.noun} on and off throughout the day${snowClause}`;
	}

	const clauses = groupRuns(outlooks)
		.filter((run) => run.noun)
		.map((run) => `${run.noun} ${runLabel(run, 'future')}`);
	return `with ${joinClauses(clauses)}${snowClause}`;
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
	hourly: {
		time: string;
		temp: number;
		conditionText: string;
		icon: string;
		/** Percent, 0-100. */
		humidity: number;
		/** Percent, 0-100. */
		precipitationChance: number;
		/** Already in the caller's configured windUnit. */
		windSpeed: number;
		/** 8-point compass abbreviation, e.g. "NW". */
		windDirection: string;
		/** Already in the caller's configured pressureUnit. */
		pressure: number;
	}[];
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
	todayRemaining: { time: string; temp: number; conditionText: string }[],
	tomorrow: { date: string; tempMax: number; precipitationChance: number; snowfallInches: number } | undefined,
	tomorrowHourly: { time: string; temp: number; conditionText: string }[],
	windUnit: 'mph' | 'kph',
	currentHourOfDay: number
): string | null {
	if (!tomorrow || todayRemaining.length === 0) return null;

	const place = locationName ?? 'your area';
	const wind = windDescriptor(current.windSpeed, windUnit);
	const windDirectionFull = COMPASS_FULL_NAMES[current.windDirection] ?? current.windDirection;
	const humidityWord = current.humidity >= 60 ? 'humid' : current.humidity <= 30 ? 'dry' : null;
	const skyAdjective = conditionAdjective(current.conditionText);
	// "81° and cloudy and humid" — appending a second " and ..." to a clause that already
	// used one reads as a run-on, so the two-adjective form gets commas instead.
	const conditionsClause = humidityWord
		? `${Math.round(current.temp)}°, ${skyAdjective} and ${humidityWord}, with`
		: `${Math.round(current.temp)}° and ${skyAdjective} with`;

	// "The rest of today" runs past midnight — the overnight stretch a visitor reads as
	// "tonight" is tomorrow's 0-5 hours, not any part of today's own calendar day (whose
	// 0-5 is long past). Pulling those in is what lets the outlook end on "overnight"
	// instead of stopping dead at 11 PM. Skipped when it's ALREADY the small hours, where
	// today's own remaining overnight is the night in question and tomorrow's would be the
	// next one entirely.
	const currentSegment = segmentOfHour(currentHourOfDay);
	const tomorrowOvernight = tomorrowHourly.filter((h) => segmentOfHour(Number(h.time.slice(11, 13))) === 'overnight');
	const restOfToday = currentSegment === 'overnight' ? todayRemaining : [...todayRemaining, ...tomorrowOvernight];
	const todaySentence = describeTodaySentence(segmentOutlooks(restOfToday), currentSegment);

	// Genuinely the overnight low, not just the coldest remaining hour of today's calendar
	// day — those differ by several degrees whenever the temperature is still falling at
	// midnight, which is most nights.
	const overnightPool = restOfToday.filter((h) => segmentOfHour(Number(h.time.slice(11, 13))) === 'overnight');
	const tonightLow = Math.round(Math.min(...(overnightPool.length > 0 ? overnightPool : todayRemaining).map((h) => h.temp)));

	// Tomorrow's own overnight hours belong to tonight (described above), so its outlook
	// covers the three daylight segments only.
	const tomorrowDaytime = tomorrowHourly.filter((h) => segmentOfHour(Number(h.time.slice(11, 13))) !== 'overnight');
	const tomorrowDate = parseDateOnly(tomorrow.date);
	const tomorrowLabel = tomorrowDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
	const outlook = describeFuturePhrase(segmentOutlooks(tomorrowDaytime), tomorrowDaytime, tomorrow.snowfallInches);

	// Each sentence anchored to its own time up front — a single run-on sentence
	// ("...low around 73°, followed by a high of 79° and a 68% chance of rain tomorrow,
	// Sunday, August 16.") left "high of 79°" dangling with no stated time until the
	// sentence trailed off at the very end, reading as ambiguous ("tonight? tomorrow
	// morning?") even though the source data was never actually ambiguous.
	return [
		`Current conditions in ${place} are ${conditionsClause} a ${wind} ${windDirectionFull} wind at ${Math.round(current.windSpeed)} ${windUnit}.`,
		todaySentence,
		`Overnight lows near ${tonightLow}°.`,
		`Tomorrow, ${tomorrowLabel}, expect a high of ${Math.round(tomorrow.tempMax)}° ${outlook}.`
	]
		.filter(Boolean)
		.join(' ');
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
		// humidity/wind/pressure are per-hour duplicates of what `current` already reports for
		// right now — the weather page's stat panel swaps to the hovered hour's values, so it
		// needs the whole series, not just the current hour's.
		`&hourly=temperature_2m,weather_code,precipitation_probability,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl` +
		`&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_probability_max,snowfall_sum` +
		// precipitation_unit affects amount-based fields (snowfall_sum) — precipitation_probability_max is a
		// percentage either way, unaffected. "inch" here regardless of the admin's chosen temperature/wind
		// units — the day summary always states snowfall in inches (see describeTomorrowOutlook).
		`&precipitation_unit=inch` +
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
		hourly: {
			time: string[];
			temperature_2m: number[];
			weather_code: number[];
			precipitation_probability: number[];
			relative_humidity_2m: number[];
			wind_speed_10m: number[];
			wind_direction_10m: number[];
			pressure_msl: number[];
		};
		daily: {
			time: string[];
			temperature_2m_max: number[];
			temperature_2m_min: number[];
			weather_code: number[];
			sunrise: string[];
			sunset: string[];
			precipitation_probability_max: number[];
			snowfall_sum: number[];
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
		const hourPressure = pressureUnit === 'inHg' ? hPaToInHg(data.hourly.pressure_msl[idx]) : data.hourly.pressure_msl[idx];
		return {
			time,
			temp: data.hourly.temperature_2m[idx],
			conditionText: condition.text,
			icon: condition.icon,
			humidity: data.hourly.relative_humidity_2m[idx],
			precipitationChance: data.hourly.precipitation_probability[idx] ?? 0,
			windSpeed: data.hourly.wind_speed_10m[idx],
			windDirection: degreesToCompass(data.hourly.wind_direction_10m[idx]),
			pressure: pressureUnit === 'inHg' ? Math.round(hourPressure * 100) / 100 : Math.round(hourPressure)
		};
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
	const tomorrowDateStr = data.daily.time.length > 1 ? data.daily.time[1] : undefined;
	const tomorrow = tomorrowDateStr
		? {
				date: tomorrowDateStr,
				tempMax: data.daily.temperature_2m_max[1],
				precipitationChance: data.daily.precipitation_probability_max[1],
				snowfallInches: data.daily.snowfall_sum[1]
			}
		: undefined;
	const tomorrowHourly = tomorrowDateStr ? hourly.filter((h) => h.time.slice(0, 10) === tomorrowDateStr) : [];
	// The location's own current hour, read off the timestamp Open-Meteo already resolved
	// for it — new Date().getHours() would answer in the server's timezone (UTC in
	// production), putting "this afternoon" several segments off for anyone west of it.
	const currentHourOfDay = Number((hourlyTimes[startIdx] ?? data.hourly.time[0]).slice(11, 13));
	const summary = buildDaySummary(locationName, current, todayRemaining, tomorrow, tomorrowHourly, windUnit, currentHourOfDay);

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
