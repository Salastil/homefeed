// Open-Meteo (api.open-meteo.com / geocoding-api.open-meteo.com) — free, no account or API
// key required, which is why it was picked over any commercial weather provider. This is
// the only file that talks to it; poller.ts orchestrates when/how the result gets saved,
// same separation as backend/src/telegram/ keeps between the raw client and its callers.

import type { ConditionDetails, ConditionKind } from './db.js';
import { logger } from '../../storage/db/logs.js';

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
	0: { text: 'Sunny', icon: '☀️' },
	1: { text: 'Mostly sunny', icon: '🌤️' },
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
	// WMO 68, "rain and snow mixed". Open-Meteo never emits it; the blended forecast does (see blendModels).
	68: { text: 'Wintry mix', icon: '🌨️' },
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

/**
 * After dark, every condition above whose label or icon implies sunshine is simply wrong —
 * "Sunny ☀️" at midnight being the obvious one, but 🌤️/⛅/🌦️ all draw a sun too. Only the
 * codes that actually change are listed; anything absent (rain, fog, snow, thunder) looks
 * and reads the same at any hour, so it falls through to WMO_CONDITIONS untouched.
 *
 * There is no widely-rendered "moon behind cloud" emoji, so partly-cloudy nights borrow
 * the plain cloud. That shares an icon with Overcast, but the label beside it still
 * distinguishes the two.
 */
const NIGHT_CONDITIONS: Record<number, WeatherCondition> = {
	0: { text: 'Clear', icon: '🌙' },
	1: { text: 'Mostly clear', icon: '🌙' },
	2: { text: 'Partly cloudy', icon: '☁️' },
	51: { text: 'Light drizzle', icon: '🌧️' },
	53: { text: 'Moderate drizzle', icon: '🌧️' },
	55: { text: 'Dense drizzle', icon: '🌧️' },
	80: { text: 'Slight rain showers', icon: '🌧️' },
	81: { text: 'Moderate rain showers', icon: '🌧️' }
};

/** See ConditionKind. Unknown codes read as cloudy, the safest neutral description. */
export function conditionKindOfCode(code: number): ConditionKind {
	if (code <= 1) return 'clear';
	if (code === 2) return 'partly';
	if (code === 45 || code === 48) return 'fog';
	if (code === 51 || code === 53 || code === 55 || code === 61 || code === 80) return 'light-rain';
	if (code === 63 || code === 65 || code === 81 || code === 82) return 'rain';
	if (code === 56 || code === 57 || code === 66 || code === 67) return 'freezing';
	if (code === 68) return 'mix';
	if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
	if (code === 95 || code === 96 || code === 99) return 'storm';
	return 'cloudy';
}

/**
 * `isDay` defaults to true so a caller with no day/night context — notably the daily
 * forecast, which summarises a whole day and should read "Sunny", never "Clear 🌙" —
 * keeps the daytime wording.
 */
export function wmoToCondition(code: number, isDay = true): WeatherCondition {
	if (!isDay) {
		const night = NIGHT_CONDITIONS[code];
		if (night) return night;
	}
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

// A condition's text is a noun-phrase status label ("Sunny", "Overcast") — good for
// a chip, but reads oddly after "will turn" ("will turn clear sky" isn't a sentence). Maps
// each one to a plain adjective for the day-summary sentence specifically; anything not
// listed (Unknown, an unmapped future code) just falls back to the lowercased label.
const CONDITION_ADJECTIVES: Record<string, string> = {
	Sunny: 'sunny',
	'Mostly sunny': 'mostly sunny',
	Clear: 'clear',
	'Mostly clear': 'mostly clear',
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
	'Wintry mix': 'icy',
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
	'Wintry mix': { rank: 3, noun: 'wintry mix', snow: false },
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
/**
 * Night's clear labels folded back to their daytime wording. A whole-DAY summary should
 * tally "Sunny" and "Clear" together — they are the same sky, split only by the clock —
 * and report the daytime word, since the phrase describes a day. Counting them separately
 * lets a half-cloudy day outvote a clear one. Per-SEGMENT callers must NOT fold, as that
 * is exactly what keeps "clear overnight" from becoming "sunny overnight".
 */
const DAY_FORM_SKY: Record<string, string> = {
	Clear: 'Sunny',
	'Mostly clear': 'Mostly sunny'
};

function dominantSky(hours: { conditionText: string }[], foldNightToDay = false): string {
	const counts = new Map<string, number>();
	for (const h of hours) {
		if (precipKind(h.conditionText)) continue;
		const text = foldNightToDay ? (DAY_FORM_SKY[h.conditionText] ?? h.conditionText) : h.conditionText;
		counts.set(text, (counts.get(text) ?? 0) + 1);
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

/**
 * "Sunny" is daytime-only, so a dry run that starts in daylight and continues past sunset
 * cannot carry it — "sunny this afternoon and into the overnight hours" is nonsense. Each
 * has a day-neutral equivalent that reads correctly either side of sunset, so a run whose
 * segments disagree only on that falls back to it. A run that stays in daylight keeps
 * "sunny", and genuinely different skies (clear vs cloudy) keep the existing first-segment
 * behaviour rather than being silently blended.
 */
const DAY_NEUTRAL_SKY: Record<string, string> = {
	sunny: 'clear',
	'mostly sunny': 'mostly clear'
};

function runSky(run: OutlookRun): string {
	const skies = run.segments.map((seg) => seg.sky);
	if (skies.every((sky) => sky === skies[0])) return skies[0];
	const neutral = skies.map((sky) => DAY_NEUTRAL_SKY[sky] ?? sky);
	// Falling back to skies[0] here would reintroduce the daytime-only word whenever the
	// run's segments disagree on more than day/night (clear vs mostly clear vs cloudy),
	// which is exactly the case this function exists to prevent. The first segment still
	// names the run, but always in a form that survives sunset.
	return neutral[0];
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
		const sky = runSky(run);
		const clearing = /clear|sunny/.test(sky);
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
function describeFuturePhrase(
	outlooks: SegmentOutlook[],
	allHours: { conditionText: string }[],
	totals: { rainTotal: number; snowTotal: number },
	precipUnit: PrecipUnit
): string {
	const wet = outlooks.filter((o) => o.isPrecip);
	const anySnow = wet.some((o) => o.snow);
	// Snow is called out by depth (what people actually plan around); rain only earns a
	// clause when no snow is expected, so the phrase never carries two amounts at once.
	const amountClause = anySnow
		? meetsPrecipFloor(totals.snowTotal, precipUnit, true)
			? `, with around ${precipPhrase(totals.snowTotal, precipUnit, true)} expected`
			: ''
		: meetsPrecipFloor(totals.rainTotal, precipUnit, false)
			? `, with around ${precipPhrase(totals.rainTotal, precipUnit, false)} expected`
			: '';
	const snowClause = amountClause;

	if (wet.length === 0) return `with ${dominantSky(allHours, true)} skies`;

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

export interface CurrentConditions extends ConditionDetails {
	temp: number;
	feelsLike: number;
	conditionText: string;
	icon: string;
	humidity: number;
	precipitationChance: number;
	windSpeed: number;
	windDirection: string;
	pressure: number;
	/** Accumulation in the hour just gone, in the caller's configured precipUnit (snow as depth). */
	precipAmount: number;
	/** True when precipAmount is snow depth rather than rainfall. */
	precipIsSnow: boolean;
	sunrise: string;
	sunset: string;
}

export interface ForecastResult {
	current: CurrentConditions;
	hourly: (ConditionDetails & {
		time: string;
		temp: number;
		/** Apparent temperature, in the caller's configured temperature unit. */
		feelsLike: number;
		conditionKind: ConditionKind;
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
		/** Accumulation during this hour, in the caller's configured precipUnit (snow as depth). */
		precipAmount: number;
		/** True when precipAmount is snow depth rather than rainfall. */
		precipIsSnow: boolean;
	})[];
	daily: {
		date: string;
		tempMax: number;
		/** The calendar day's minimum, kept as the fallback for nightLow when too little of the night is in the forecast. */
		tempMin: number;
		/** Short daytime description composed from the hourly series, e.g. "Mostly cloudy with a shower". */
		conditionText: string;
		icon: string;
		/** Short description of the night that FOLLOWS this day (dusk to the next dawn), e.g. "A couple of evening showers". */
		nightDescription: string;
		nightIcon: string;
		/** Lowest temperature of that night - AccuWeather's "low" - or null when under 6 night hours are in the forecast (the last day), in which case tempMin stands in. */
		nightLow: number | null;
		/** Percent, 0-100: the day's maximum hourly chance of precipitation. */
		precipitationChance: number | null;
		/** Same, over that night's hours alone - what a "Tonight" row shows once the day itself is over. */
		nightPrecipitationChance: number | null;
	}[];
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
export type PrecipUnit = 'in' | 'mm';

/**
 * Rain and snow diverge only on the metric side: depth of snow is conventionally reported
 * in centimetres while rainfall stays in millimetres. Open-Meteo already returns snowfall
 * in cm whenever precipitation_unit=mm, so this picks the label rather than converting.
 */
function precipUnitLabel(precipUnit: PrecipUnit, isSnow: boolean): string {
	if (precipUnit === 'in') return 'in';
	return isSnow ? 'cm' : 'mm';
}

/** Prose form for the summary sentence: "3 inches", "0.4 inches", "12 mm", "4.5 cm". */
function precipPhrase(amount: number, precipUnit: PrecipUnit, isSnow: boolean): string {
	if (precipUnit === 'mm' && !isSnow) return `${Math.round(amount)} mm`;
	const rounded = Math.round(amount * 10) / 10;
	const n = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
	if (precipUnit === 'mm') return `${n} cm`;
	return `${n} ${rounded === 1 ? 'inch' : 'inches'}`;
}

/**
 * Below these, an accumulation is a trace not worth a sentence — "rainfall will total
 * around 0 inches" is noise. Snow gets a lower bar relative to its unit because an inch of
 * snow matters in a way a hundredth of an inch of rain does not.
 */
function meetsPrecipFloor(amount: number, precipUnit: PrecipUnit, isSnow: boolean): boolean {
	if (precipUnit === 'in') return amount >= (isSnow ? 0.1 : 0.05);
	return amount >= (isSnow ? 0.5 : 1);
}

/**
 * The day's expected accumulation as its own sentence. Snow leads when both are present —
 * it is the one that changes plans — with rain trailing as a subordinate clause.
 * Returns null when neither clears its floor, so the caller can just filter it out.
 */
function describePrecipTotals(
	rainTotal: number,
	snowTotal: number,
	precipUnit: PrecipUnit,
	when: 'today' | 'tomorrow'
): string | null {
	const snow = meetsPrecipFloor(snowTotal, precipUnit, true);
	const rain = meetsPrecipFloor(rainTotal, precipUnit, false);
	const label = when === 'today' ? 'today' : 'tomorrow';
	if (snow && rain) {
		return `Snowfall ${label} will total around ${precipPhrase(snowTotal, precipUnit, true)}, with around ${precipPhrase(rainTotal, precipUnit, false)} of rain.`;
	}
	if (snow) return `Snowfall ${label} will total around ${precipPhrase(snowTotal, precipUnit, true)}.`;
	if (rain) return `Rainfall ${label} will total around ${precipPhrase(rainTotal, precipUnit, false)}.`;
	return null;
}

function buildDaySummary(
	locationName: string | null,
	current: CurrentConditions,
	todayRemaining: { time: string; temp: number; conditionText: string }[],
	tomorrow: { date: string; tempMax: number; precipitationChance: number; rainTotal: number; snowTotal: number } | undefined,
	tomorrowHourly: { time: string; temp: number; conditionText: string }[],
	windUnit: 'mph' | 'kph',
	currentHourOfDay: number,
	todayTotals: { rainTotal: number; snowTotal: number },
	precipUnit: PrecipUnit
): string | null {
	// Each sentence below is independently omitted when its own inputs are missing, rather
	// than one gap discarding the lot: with no hours left in today, current conditions and
	// tomorrow are still perfectly describable, and silently returning null blanked the
	// widget's entire synopsis.
	if (!tomorrow) return null;

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
	const todaySentence = restOfToday.length > 0 ? describeTodaySentence(segmentOutlooks(restOfToday), currentSegment) : null;

	// Genuinely the overnight low, not just the coldest remaining hour of today's calendar
	// day — those differ by several degrees whenever the temperature is still falling at
	// midnight, which is most nights.
	const overnightPool = restOfToday.filter((h) => segmentOfHour(Number(h.time.slice(11, 13))) === 'overnight');
	// Math.min of an empty list is Infinity, which would render as "Overnight lows near
	// Infinity°" — so an empty pool drops the sentence instead.
	const lowPool = overnightPool.length > 0 ? overnightPool : restOfToday;
	const tonightLow = lowPool.length > 0 ? Math.round(Math.min(...lowPool.map((h) => h.temp))) : null;

	// Tomorrow's own overnight hours belong to tonight (described above), so its outlook
	// covers the three daylight segments only.
	const tomorrowDaytime = tomorrowHourly.filter((h) => segmentOfHour(Number(h.time.slice(11, 13))) !== 'overnight');
	const tomorrowDate = parseDateOnly(tomorrow.date);
	const tomorrowLabel = tomorrowDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
	const outlook = describeFuturePhrase(segmentOutlooks(tomorrowDaytime), tomorrowDaytime, tomorrow, precipUnit);

	// Each sentence anchored to its own time up front — a single run-on sentence
	// ("...low around 73°, followed by a high of 79° and a 68% chance of rain tomorrow,
	// Sunday, August 16.") left "high of 79°" dangling with no stated time until the
	// sentence trailed off at the very end, reading as ambiguous ("tonight? tomorrow
	// morning?") even though the source data was never actually ambiguous.
	return [
		`Current conditions in ${place} are ${conditionsClause} a ${wind} ${windDirectionFull} wind at ${Math.round(current.windSpeed)} ${windUnit}.`,
		todaySentence,
		// Whole-day totals, not just the hours still to come: someone reading at 4 PM wants
		// the day's figure, and a part-day number would quietly understate it.
		describePrecipTotals(todayTotals.rainTotal, todayTotals.snowTotal, precipUnit, 'today'),
		tonightLow !== null ? `Overnight lows near ${tonightLow}°.` : null,
		`Tomorrow, ${tomorrowLabel}, expect a high of ${Math.round(tomorrow.tempMax)}° ${outlook}.`
	]
		.filter(Boolean)
		.join(' ');
}

// ---------------------------------------------------------------------------
// Indoor humidity
// ---------------------------------------------------------------------------
// AccuWeather shows an "Indoor Humidity" percentage and an 11-step description of it
// ("Dangerously Dry" ... "Ideal Humidity" ... "Dangerously Humid"), but publishes neither
// the thresholds nor the method. Both below were reverse-engineered from 28 live readings
// taken off their current-weather pages (Antarctica to Singapore) and then checked against
// 6 more cities that were NOT used in the fit: all 34 descriptions match and every
// percentage is within 2 points (33 of 34 within 1). Treat them as a close approximation of
// AccuWeather's, not a copy of it.
//
// What those readings showed:
//
// 1. The PERCENTAGE is the outdoor air brought to a fixed 68°F without gaining or losing
//    moisture. Outdoors already 68°F or warmer, indoor simply equals outdoor RH (all 20
//    warm readings matched exactly); colder, it is the RH that the outdoor dew point
//    implies at 68°F (Philadelphia 63%, Seattle 49%, Moscow 37%, Atlanta 72% - each within
//    a point). Below roughly a 34-39°F dew point the real figures run ~14 points HIGHER than
//    that, i.e. they allow for moisture people add indoors; INDOOR_MOISTURE_GAIN_* is an
//    empirical fit to the 8 readings in that regime (each within 2 points, and Calgary and
//    Edmonton, held out, within 1) and tapers to nothing by a 39°F dew point, because
//    readings at 41°F and up showed no allowance at all.
//
// 2. The DESCRIPTION is a function of the outdoor dew point alone - NOT of the percentage.
//    Minneapolis at 41% is "Ideal" while Reykjavik at 42% is "Slightly Dry"; sorting every
//    reading by dew point instead gives one clean monotonic ladder (see the scale below).

const INDOOR_TEMP_C = 20; // 68°F
const INDOOR_MOISTURE_GAIN_HPA = 3.3;
const INDOOR_GAIN_FULL_AT_DEW_C = 1.1; // 34°F
const INDOOR_GAIN_NONE_AT_DEW_C = 3.9; // 39°F
const INDOOR_GAIN_SATURATION_HPA = 1.4;

function toCelsius(value: number, unit: 'celsius' | 'fahrenheit'): number {
	return unit === 'celsius' ? value : ((value - 32) * 5) / 9;
}

/** Magnus approximation, in hPa. */
function saturationVaporPressure(tempC: number): number {
	return 6.112 * Math.exp((17.62 * tempC) / (243.12 + tempC));
}

export function estimateIndoorHumidity(outdoorTempC: number, dewPointC: number, outdoorRh: number): number {
	if (outdoorTempC >= INDOOR_TEMP_C) return Math.round(outdoorRh);
	const outdoorVapor = saturationVaporPressure(dewPointC);
	const taper = Math.min(
		1,
		Math.max(0, (INDOOR_GAIN_NONE_AT_DEW_C - dewPointC) / (INDOOR_GAIN_NONE_AT_DEW_C - INDOOR_GAIN_FULL_AT_DEW_C))
	);
	// The allowance also vanishes as the air gets bone dry (nothing to carry moisture through
	// to), which is what keeps Antarctic readings from being credited the full amount.
	const gain = INDOOR_MOISTURE_GAIN_HPA * taper * (1 - Math.exp(-outdoorVapor / INDOOR_GAIN_SATURATION_HPA));
	const percent = (100 * (outdoorVapor + gain)) / saturationVaporPressure(INDOOR_TEMP_C);
	return Math.round(Math.min(100, Math.max(0, percent)));
}

/**
 * Upper-exclusive cut points on the outdoor dew point in °F. Each cut sits inside the bracket
 * the live readings pinned it to: the narrow ones are good to about ±1°F (Slightly Dry/Ideal at
 * 39-41, Ideal/Slightly Humid at 55-57, Slightly Humid/Humid at 62-64, Very/Extremely Humid at
 * 71-72) and the wide ones are midpoints of their bracket (Dangerously/Extremely Dry between
 * -24 and -1, Extremely/Very Dry between -1 and 10, Very Dry/Dry between 18 and 27, Humid/Very
 * Humid between 64 and 67, Extremely/Dangerously Humid between 75 and 78).
 */
const INDOOR_HUMIDITY_SCALE: { belowDewF: number; label: string; level: number }[] = [
	{ belowDewF: -12, label: 'Dangerously Dry', level: -5 },
	{ belowDewF: 5, label: 'Extremely Dry', level: -4 },
	{ belowDewF: 23, label: 'Very Dry', level: -3 },
	{ belowDewF: 28.5, label: 'Dry', level: -2 },
	{ belowDewF: 40, label: 'Slightly Dry', level: -1 },
	{ belowDewF: 56, label: 'Ideal Humidity', level: 0 },
	{ belowDewF: 63, label: 'Slightly Humid', level: 1 },
	{ belowDewF: 66, label: 'Humid', level: 2 },
	{ belowDewF: 71.5, label: 'Very Humid', level: 3 },
	{ belowDewF: 76.5, label: 'Extremely Humid', level: 4 },
	{ belowDewF: Infinity, label: 'Dangerously Humid', level: 5 }
];

export function describeIndoorHumidity(dewPointC: number): { label: string; level: number } {
	const dewF = (dewPointC * 9) / 5 + 32;
	const step = INDOOR_HUMIDITY_SCALE.find((s) => dewF < s.belowDewF) ?? INDOOR_HUMIDITY_SCALE[INDOOR_HUMIDITY_SCALE.length - 1];
	return { label: step.label, level: step.level };
}

/** Open-Meteo reports metres; show miles for mph users and kilometres for kph users, one decimal while it's short enough to matter. */
function formatVisibility(meters: number | null | undefined, windUnit: 'mph' | 'kph'): number | null {
	if (meters === null || meters === undefined) return null;
	const value = windUnit === 'mph' ? meters / 1609.344 : meters / 1000;
	return value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
}

// ---------------------------------------------------------------------------
// Cloud ceiling
// ---------------------------------------------------------------------------
// Open-Meteo has a `cloud_base` variable but returns null for every model at every location
// (checked against 13 models), so there is no ceiling to be had from it. The National
// Weather Service's gridpoint forecast does carry a real ceilingHeight series, in coarse
// blocks (anywhere from 1 to 8 hours), US only. Used where it exists; elsewhere the
// ceiling is simply null and the page leaves the row out rather than guessing — the usual
// temperature/dew-point "lifting condensation level" estimate describes convective cloud
// bases and would contradict a real ceiling at higher altitudes (it works out to roughly 1,800 ft for a
// 63°F/55°F day where AccuWeather reported 26,700 ft under a high overcast).

interface CeilingBlock {
	startMs: number;
	endMs: number;
	feet: number | null;
}

const NWS_HEADERS = {
	// NWS's API usage policy requires an identifying User-Agent on every request.
	'User-Agent': 'Homefeed/1.0 (self-hosted news aggregator)',
	Accept: 'application/geo+json'
};

// A location's grid cell never changes, so the points lookup only needs doing once per process.
const nwsGridUrlCache = new Map<string, string>();

/** ISO-8601 duration limited to the day/hour/minute forms NWS actually emits (P1DT6H, PT8H, PT30M). */
function isoDurationMs(duration: string): number {
	const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(duration);
	if (!m) return 0;
	return (Number(m[1] ?? 0) * 24 * 60 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) * 60_000;
}

/**
 * Never throws: the ceiling is a nice-to-have, and NWS answering 404 for anywhere outside the
 * US is the normal case, not a fault. Any failure just yields no blocks, so every hour's
 * ceiling comes out null and the forecast itself is unaffected.
 */
async function fetchCeilingBlocks(latitude: number, longitude: number): Promise<CeilingBlock[]> {
	try {
		// NWS redirects coordinates with more than 4 decimal places, so trim them up front.
		const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
		let gridUrl = nwsGridUrlCache.get(key);
		if (!gridUrl) {
			const points = await fetch(`https://api.weather.gov/points/${key}`, {
				headers: NWS_HEADERS,
				signal: AbortSignal.timeout(8000)
			});
			if (!points.ok) return [];
			gridUrl = ((await points.json()) as { properties?: { forecastGridData?: string } }).properties?.forecastGridData;
			if (!gridUrl) return [];
			nwsGridUrlCache.set(key, gridUrl);
		}
		const grid = await fetch(gridUrl, { headers: NWS_HEADERS, signal: AbortSignal.timeout(8000) });
		if (!grid.ok) return [];
		const values = ((await grid.json()) as { properties?: { ceilingHeight?: { values?: { validTime: string; value: number | null }[] } } })
			.properties?.ceilingHeight?.values;
		return (values ?? []).flatMap((v) => {
			const [start, duration] = v.validTime.split('/');
			const startMs = new Date(start).getTime();
			if (Number.isNaN(startMs)) return [];
			return [
				{
					startMs,
					endMs: startMs + isoDurationMs(duration ?? ''),
					// metres -> feet, to the nearest 100: the source steps in coarse increments anyway
					feet: v.value === null ? null : Math.round((v.value * 3.28084) / 100) * 100
				}
			];
		});
	} catch {
		return [];
	}
}

function ceilingAt(blocks: CeilingBlock[], atMs: number): number | null {
	return blocks.find((b) => atMs >= b.startMs && atMs < b.endMs)?.feet ?? null;
}

// ---------------------------------------------------------------------------
// Day and night descriptions for the 7-day list
// ---------------------------------------------------------------------------
// AccuWeather describes each day in a short phrase ("Mostly cloudy with a shower", "A couple
// of morning showers") and each night separately ("Night: Cloudy, a couple of t-storms"). The
// daily weather_code can't say that - it names only the single worst condition of the whole
// 24 hours - so both phrases are composed from the hourly series for that period instead:
// cloud cover picks the sky word, and the wet hours decide whether, how much, and when.

type PrecipFamily =
	| 'drizzle'
	| 'freezing drizzle'
	| 'showers'
	| 'rain'
	| 'freezing rain'
	| 'wintry mix'
	| 'snow showers'
	| 'snow'
	| 'thunderstorms';

const WMO_PRECIP: Record<number, { family: PrecipFamily; heavy: boolean }> = {
	51: { family: 'drizzle', heavy: false },
	53: { family: 'drizzle', heavy: false },
	55: { family: 'drizzle', heavy: false },
	56: { family: 'freezing drizzle', heavy: false },
	57: { family: 'freezing drizzle', heavy: false },
	61: { family: 'rain', heavy: false },
	63: { family: 'rain', heavy: false },
	65: { family: 'rain', heavy: true },
	66: { family: 'freezing rain', heavy: false },
	67: { family: 'freezing rain', heavy: true },
	68: { family: 'wintry mix', heavy: false },
	71: { family: 'snow', heavy: false },
	73: { family: 'snow', heavy: false },
	75: { family: 'snow', heavy: true },
	77: { family: 'snow', heavy: false },
	80: { family: 'showers', heavy: false },
	81: { family: 'showers', heavy: false },
	82: { family: 'showers', heavy: true },
	85: { family: 'snow showers', heavy: false },
	86: { family: 'snow showers', heavy: true },
	95: { family: 'thunderstorms', heavy: false },
	96: { family: 'thunderstorms', heavy: false },
	99: { family: 'thunderstorms', heavy: false }
};

/**
 * `singular` is null for mass nouns ("rain", "snow"), which take "a little ..." / "periods of
 * ..." rather than "a ..." / "a couple of ...". `code` is the WMO code whose icon represents
 * the family (and `heavyCode` its heavy form), so the row's icon always agrees with its text.
 */
const PRECIP_NOUNS: Record<PrecipFamily, { singular: string | null; plural: string; code: number; heavyCode: number }> = {
	drizzle: { singular: null, plural: 'drizzle', code: 51, heavyCode: 51 },
	'freezing drizzle': { singular: null, plural: 'freezing drizzle', code: 56, heavyCode: 56 },
	showers: { singular: 'shower', plural: 'showers', code: 80, heavyCode: 82 },
	rain: { singular: null, plural: 'rain', code: 61, heavyCode: 65 },
	'freezing rain': { singular: null, plural: 'freezing rain', code: 66, heavyCode: 67 },
	'wintry mix': { singular: null, plural: 'wintry mix', code: 68, heavyCode: 68 },
	'snow showers': { singular: 'snow shower', plural: 'snow showers', code: 85, heavyCode: 86 },
	snow: { singular: null, plural: 'snow', code: 71, heavyCode: 75 },
	thunderstorms: { singular: 'thunderstorm', plural: 'thunderstorms', code: 95, heavyCode: 95 }
};

const SKY_WORDS_DAY = ['Sunny', 'Mostly sunny', 'Partly sunny', 'Mostly cloudy', 'Cloudy'];
const SKY_WORDS_NIGHT = ['Clear', 'Mostly clear', 'Partly cloudy', 'Mostly cloudy', 'Cloudy'];
// One WMO code per sky bucket, so the dry icon comes from the same lookup (and the same
// night variants) as everywhere else.
const SKY_BUCKET_CODES = [0, 1, 2, 3, 3];

interface PeriodHour {
	hourOfDay: number;
	code: number;
	cloud: number;
	/** Percent chance of precipitation this hour, when the forecast has one. */
	chance?: number | null;
}

/**
 * At or above this chance an hour is described as wet even when the model's single
 * deterministic run is dry there. AccuWeather's own wording follows the probability, not the
 * model run: its 10-day list says "an afternoon shower" at 55% and "a couple of morning
 * showers" at 72%, but plain sky wording at 25% and below. Without this, a row could read
 * "Partly sunny" right beside a 56% chance of precipitation.
 */
const LIKELY_PRECIP_CHANCE = 50;

function precipKindOf(hour: PeriodHour): { family: PrecipFamily; heavy: boolean } | null {
	const coded = WMO_PRECIP[hour.code];
	if (coded) return coded;
	return (hour.chance ?? 0) >= LIKELY_PRECIP_CHANCE ? { family: 'showers', heavy: false } : null;
}

const SEGMENT_ADJECTIVE: Record<DaySegment, string> = {
	overnight: 'overnight',
	morning: 'morning',
	afternoon: 'afternoon',
	evening: 'evening'
};
const SEGMENT_TRAILING: Record<DaySegment, string> = {
	overnight: 'overnight',
	morning: 'in the morning',
	afternoon: 'in the afternoon',
	evening: 'in the evening'
};

function withIndefiniteArticle(phrase: string): string {
	return /^[aeiou]/i.test(phrase) ? `an ${phrase}` : `a ${phrase}`;
}

/**
 * How much of the period was wet, said the way a forecaster would: a count of discrete
 * showers/storms for the countable families, a duration for the rest.
 */
function quantifyPrecip(family: PrecipFamily, wetHours: number, totalHours: number, heavy: boolean, timing: DaySegment | null): string {
	const noun = PRECIP_NOUNS[family];
	const heavyWord = heavy && family !== 'thunderstorms' ? 'heavy ' : '';
	const fraction = wetHours / totalHours;

	// One or two brief spells read best with the time folded in as an adjective:
	// "an afternoon shower", "a couple of morning showers", "a little overnight rain".
	if (timing && (noun.singular ? wetHours <= 3 : wetHours <= 2)) {
		const when = SEGMENT_ADJECTIVE[timing];
		if (noun.singular) {
			return wetHours === 1
				? withIndefiniteArticle(`${when} ${heavyWord}${noun.singular}`)
				: `a couple of ${when} ${heavyWord}${noun.plural}`;
		}
		return `a little ${when} ${heavyWord}${noun.plural}`;
	}

	let core: string;
	if (noun.singular) {
		core = wetHours === 1 ? `a ${heavyWord}${noun.singular}` : wetHours <= 3 ? `a couple of ${heavyWord}${noun.plural}` : `${heavyWord}${noun.plural}`;
	} else {
		core = wetHours <= 2 ? `a little ${heavyWord}${noun.plural}` : fraction < 0.6 ? `periods of ${heavyWord}${noun.plural}` : `${heavyWord}${noun.plural}`;
	}
	return timing ? `${core} ${SEGMENT_TRAILING[timing]}` : core;
}

function capitalizeFirst(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Null for an empty period. `isDay` only changes the vocabulary ("Sunny" vs "Clear") and which
 * icon variants are used; which hours belong to the period is the caller's decision.
 */
export function describePeriod(hours: PeriodHour[], isDay: boolean): { text: string; icon: string } | null {
	if (hours.length === 0) return null;
	const total = hours.length;

	const meanCloud = hours.reduce((sum, h) => sum + h.cloud, 0) / total;
	// Eighths of the sky, the same cut-points forecasters use for sunny/partly/mostly/cloudy.
	const bucket = meanCloud < 12.5 ? 0 : meanCloud < 37.5 ? 1 : meanCloud < 62.5 ? 2 : meanCloud < 87.5 ? 3 : 4;
	const sky = (isDay ? SKY_WORDS_DAY : SKY_WORDS_NIGHT)[bucket];

	const wet = hours.filter((h) => precipKindOf(h) !== null);
	if (wet.length === 0) {
		return { text: sky, icon: wmoToCondition(SKY_BUCKET_CODES[bucket], isDay).icon };
	}

	const counts = new Map<PrecipFamily, number>();
	let heavyHours = 0;
	for (const h of wet) {
		const kind = precipKindOf(h)!;
		counts.set(kind.family, (counts.get(kind.family) ?? 0) + 1);
		if (kind.heavy) heavyHours++;
	}
	const count = (family: PrecipFamily) => counts.get(family) ?? 0;

	// A day with both rain and snow in it is a mix, not whichever happened to win by an hour.
	const snowy = count('snow') + count('snow showers');
	const rainy = count('rain') + count('showers') + count('drizzle');
	// Rain and snow in one period, or hours the blend already called a wintry mix.
	const isMix = (snowy > 0 && rainy > 0) || count('wintry mix') > 0;

	// Models flip between drizzle, rain and showers codes hour to hour within one wet spell, so
	// how MUCH it rained comes from the whole class of like precipitation, not just the single
	// code that happened to be most common - otherwise 4 drizzle + 3 rain + 2 shower hours
	// would be described as "periods of drizzle" and undercounted at 4.
	const classOf: Record<PrecipFamily, string> = {
		drizzle: 'liquid',
		showers: 'liquid',
		rain: 'liquid',
		'snow showers': 'snow',
		snow: 'snow',
		'freezing drizzle': 'freezing',
		'freezing rain': 'freezing',
		'wintry mix': 'mix',
		thunderstorms: 'thunder'
	};
	const classHours = new Map<string, number>();
	for (const [family, n] of counts) classHours.set(classOf[family], (classHours.get(classOf[family]) ?? 0) + n);

	// Severity breaks ties, so a 50/50 day reads "thunderstorms", not "showers".
	const severity: PrecipFamily[] = ['drizzle', 'showers', 'rain', 'snow showers', 'snow', 'wintry mix', 'freezing drizzle', 'freezing rain', 'thunderstorms'];
	const bySize = (a: [PrecipFamily, number], b: [PrecipFamily, number]) =>
		(classHours.get(classOf[b[0]]) ?? 0) - (classHours.get(classOf[a[0]]) ?? 0) || b[1] - a[1] || severity.indexOf(b[0]) - severity.indexOf(a[0]);
	const primary = [...counts.entries()].sort(bySize)[0][0];
	const primaryHours = isMix ? wet.length : (classHours.get(classOf[primary]) ?? 0);
	const heavy = heavyHours / wet.length >= 0.4;

	// Timing is only worth stating when ALL the wet hours fall in one part of the day.
	const segments = new Set(wet.map((h) => segmentOfHour(h.hourOfDay)));
	const timing = segments.size === 1 ? [...segments][0] : null;

	const lead = isMix ? 'wintry mix' : null;
	let main: string;
	if (lead) {
		main = `${wet.length <= 2 ? 'a little ' : primaryHours / total < 0.6 ? 'periods of ' : ''}${lead}${timing ? ` ${SEGMENT_TRAILING[timing]}` : ''}`;
	} else {
		main = quantifyPrecip(primary, primaryHours, total, heavy, timing);
	}

	// Anything dangerous that isn't the headline still gets named.
	const extras: string[] = [];
	if (!isMix && primary !== 'thunderstorms' && count('thunderstorms') > 0) {
		const t = count('thunderstorms');
		extras.push(t === 1 ? 'a thunderstorm' : t <= 3 ? 'a couple of thunderstorms' : 'thunderstorms');
	}
	if (primary !== 'freezing rain' && primary !== 'freezing drizzle' && count('freezing rain') + count('freezing drizzle') > 0) {
		extras.push(count('freezing rain') + count('freezing drizzle') <= 2 ? 'a little freezing rain' : 'freezing rain');
	}
	const withExtras = [main, ...extras].join(' and ');

	// A spell that fills most of the period is the whole story - no sky word needed. A timed
	// one is too ("A couple of morning showers"). Otherwise it's weather laid over a sky.
	const steady = primaryHours / total >= 0.6;
	const text = timing || steady ? capitalizeFirst(withExtras) : `${sky} with ${withExtras}`;

	// Thunder trumps everything for the icon; otherwise the headline family, in its heavy
	// form when most of the wet hours were heavy.
	const iconCode = count('thunderstorms') > 0 ? 95 : isMix ? 68 : heavy ? PRECIP_NOUNS[primary].heavyCode : PRECIP_NOUNS[primary].code;
	return { text, icon: wmoToCondition(iconCode, isDay).icon };
}

// The forecast is the AVERAGE of four global models rather than Open-Meteo's default pick.
// The default ("best_match") is NOAA's GFS for most of the US, and on 2026-11-13 GFS alone
// forecast snow for Philadelphia while ECMWF, ICON and GEM all said rain - one outlier ran
// cold and the widget printed it as fact. Averaging the numbers (temperature, precipitation,
// cloud, wind...) lets a lone model be outvoted. A weather *code* can't be averaged, so each
// hour's condition is re-derived from the averaged numbers (see blendedCode).
const FORECAST_MODELS = ['gfs_seamless', 'ecmwf_ifs025', 'icon_seamless', 'gem_seamless'] as const;

const CURRENT_VARS =
	'temperature_2m,apparent_temperature,weather_code,is_day,precipitation,snowfall,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,cloud_cover,visibility';

type Series = (number | string | null | undefined)[];
type ModelResponse = { error?: boolean; reason?: string; utc_offset_seconds: number; hourly: Record<string, Series>; daily: Record<string, Series> };

async function getJson<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Forecast API returned ${res.status}`);
	return (await res.json()) as T;
}

/** Mean of the models that reported a value; null when none did (a model's range can end before the others'). */
function meanOf(values: (number | string | null | undefined)[], digits = 1): number | null {
	const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
	if (!nums.length) return null;
	const scale = 10 ** digits;
	return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * scale) / scale;
}

/** Average of compass bearings - 350 and 10 degrees are 20 apart, not 180. */
function meanBearing(values: (number | string | null | undefined)[]): number | null {
	const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
	if (!nums.length) return null;
	const x = nums.reduce((a, d) => a + Math.cos((d * Math.PI) / 180), 0);
	const y = nums.reduce((a, d) => a + Math.sin((d * Math.PI) / 180), 0);
	return (Math.round((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/**
 * One WMO code for an hour, from the models' averaged numbers.
 *  - Wet when the averaged precipitation is at least 0.1 mm/h, so one wet model among
 *    three dry ones doesn't make rain, but an average of real rain does.
 *  - What falls depends on the averaged temperature: at or below 0.5C snow; up to 4C a
 *    "wintry mix" if ANY model has snow (the models disagree on snow-versus-rain, which is
 *    what a mix is); warmer is rain or drizzle (drizzle when most wet models say drizzle).
 *  - Thunder and fog need half the models to agree.
 *  - Dry hours take their sky from the averaged cloud cover.
 */
function blendedCode(h: {
	tempC: number;
	precipMm: number;
	cloud: number;
	codes: (number | null)[];
	anySnow: boolean;
}): number {
	const codes = h.codes.filter((c): c is number => c !== null);
	const half = codes.length / 2;
	const votes = (pred: (c: number) => boolean) => codes.filter(pred).length;

	if (h.precipMm >= 0.1) {
		if (votes((c) => c === 95 || c === 96 || c === 99) >= half && half > 0) return 95;
		if (h.tempC <= 0.5) return h.precipMm < 0.5 ? 71 : h.precipMm < 1.5 ? 73 : 75;
		if (h.tempC <= 4 && h.anySnow) return 68;
		const drizzle = votes((c) => c >= 51 && c <= 57) > votes((c) => (c >= 61 && c <= 67) || (c >= 80 && c <= 82));
		if (drizzle) return h.precipMm < 0.3 ? 51 : h.precipMm < 0.6 ? 53 : 55;
		return h.precipMm < 1 ? 61 : h.precipMm < 4 ? 63 : 65;
	}
	if (half > 0 && votes((c) => c === 45 || c === 48) >= half) return 45;
	return h.cloud < 12.5 ? 0 : h.cloud < 37.5 ? 1 : h.cloud < 62.5 ? 2 : 3;
}

/**
 * Folds a multi-model response (every variable repeated once per model, suffixed with the
 * model's name) into the single-model shape the rest of fetchForecast reads, including a
 * `current` block taken from the blended hour we are in. Throws when fewer than two models
 * came back with data, so the caller falls back to the plain default model.
 */
function blendModels(raw: ModelResponse, unit: 'celsius' | 'fahrenheit', precipUnit: PrecipUnit): unknown {
	if (raw.error) throw new Error(raw.reason ?? 'forecast error');
	const col = (group: 'hourly' | 'daily', name: string): Series[] =>
		FORECAST_MODELS.map((m) => raw[group][`${name}_${m}`]).filter((s): s is Series => Array.isArray(s));
	const live = col('hourly', 'temperature_2m').filter((s) => s.some((v) => typeof v === 'number'));
	if (live.length < 2) throw new Error(`only ${live.length} forecast model(s) returned data`);

	const times = raw.hourly.time as string[];
	const n = times.length;
	const mean = (name: string, digits = 1) => {
		const cols = col('hourly', name);
		return Array.from({ length: n }, (_, i) => meanOf(cols.map((c) => c[i]), digits));
	};

	const temp = mean('temperature_2m');
	const precip = mean('precipitation', 3);
	const cloud = mean('cloud_cover', 0);
	const codeCols = col('hourly', 'weather_code');
	const snowCols = col('hourly', 'snowfall');
	const mmPerUnit = precipUnit === 'in' ? 25.4 : 1;
	// 10:1 snow-to-liquid, the usual rule of thumb - 1 in of water is 10 in of snow, 1 mm is 1 cm.
	const snowRatio = precipUnit === 'in' ? 10 : 1;

	const weather_code: number[] = [];
	const snowfall: number[] = [];
	for (let i = 0; i < n; i++) {
		const codes = codeCols.map((c) => (typeof c[i] === 'number' ? (c[i] as number) : null));
		const anySnow =
			snowCols.some((c) => typeof c[i] === 'number' && (c[i] as number) > 0) ||
			codes.some((c) => c !== null && ((c >= 71 && c <= 77) || c === 85 || c === 86));
		const code = blendedCode({
			tempC: toCelsius(temp[i] ?? 0, unit),
			precipMm: (precip[i] ?? 0) * mmPerUnit,
			cloud: cloud[i] ?? 0,
			codes,
			anySnow
		});
		weather_code.push(code);
		snowfall.push(code >= 71 && code <= 75 ? (precip[i] ?? 0) * snowRatio : 0);
	}

	const hourly: Record<string, Series> = {
		time: times,
		temperature_2m: temp,
		apparent_temperature: mean('apparent_temperature'),
		weather_code,
		is_day: (col('hourly', 'is_day')[0] ?? []) as Series,
		precipitation: precip.map((v) => v ?? 0),
		snowfall,
		precipitation_probability: mean('precipitation_probability', 0),
		relative_humidity_2m: mean('relative_humidity_2m', 0),
		dew_point_2m: mean('dew_point_2m'),
		wind_speed_10m: mean('wind_speed_10m'),
		wind_gusts_10m: mean('wind_gusts_10m'),
		wind_direction_10m: Array.from({ length: n }, (_, i) => meanBearing(col('hourly', 'wind_direction_10m').map((c) => c[i]))),
		pressure_msl: mean('pressure_msl'),
		cloud_cover: cloud,
		visibility: mean('visibility')
	};

	// Daily: extremes and chances are averaged across models; rain and snow totals are summed
	// from the blended hours so they always agree with what the hourly strip shows.
	const dayTimes = raw.daily.time as string[];
	const dailyMean = (name: string, digits = 1) => {
		const cols = col('daily', name);
		return dayTimes.map((_, d) => meanOf(cols.map((c) => c[d]), digits));
	};
	const first = (name: string) => (col('daily', name)[0] ?? []) as Series;
	const sums = (pick: (i: number) => number) =>
		dayTimes.map((day) => {
			let total = 0;
			for (let i = 0; i < n; i++) if (times[i].startsWith(day)) total += pick(i);
			return Math.round(total * 1000) / 1000;
		});
	const daily: Record<string, Series> = {
		time: dayTimes,
		temperature_2m_max: dailyMean('temperature_2m_max'),
		temperature_2m_min: dailyMean('temperature_2m_min'),
		// Only the fallback when a day has too few hours; midday of the blend stands in.
		weather_code: dayTimes.map((day) => weather_code[times.findIndex((t) => t.startsWith(`${day}T12`))] ?? 3),
		sunrise: first('sunrise'),
		sunset: first('sunset'),
		precipitation_probability_max: dailyMean('precipitation_probability_max', 0),
		rain_sum: sums((i) => (snowfall[i] > 0 ? 0 : (precip[i] ?? 0))),
		showers_sum: dayTimes.map(() => 0),
		snowfall_sum: sums((i) => snowfall[i])
	};

	// "Now" is the blended hour we are in, so right-now conditions can't contradict the strip.
	const nowMs = Date.now();
	let cur = 0;
	for (let i = 0; i < n; i++) if (new Date(withUtcOffset(times[i], raw.utc_offset_seconds)).getTime() <= nowMs) cur = i;
	const current = Object.fromEntries(Object.entries(hourly).map(([k, v]) => [k, v[cur] ?? null]));

	return { ...raw, hourly, daily, current };
}

/**
 * The forecast response for the whole widget: the four-model blend, or - when that can't be
 * built (a model unreachable for the location, the request failing) - Open-Meteo's own
 * default model, so the widget never goes blank over it.
 */
async function fetchForecastJson(baseUrl: string, unit: 'celsius' | 'fahrenheit', precipUnit: PrecipUnit): Promise<unknown> {
	try {
		return blendModels(await getJson<ModelResponse>(`${baseUrl}&models=${FORECAST_MODELS.join(',')}`), unit, precipUnit);
	} catch (err) {
		logger.error('weather', `Four-model blend unavailable (${(err as Error).message}); using Open-Meteo's default model`);
		const data = await getJson<{ error?: boolean; reason?: string }>(`${baseUrl}&current=${CURRENT_VARS}`);
		if (data.error) throw new Error(`Forecast API error: ${data.reason ?? 'unknown'}`);
		return data;
	}
}

export async function fetchForecast(
	latitude: number,
	longitude: number,
	unit: 'celsius' | 'fahrenheit',
	windUnit: 'mph' | 'kph',
	pressureUnit: 'inHg' | 'hPa',
	precipUnit: PrecipUnit,
	locationName: string | null
): Promise<ForecastResult> {
	const baseUrl =
		`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
		// humidity/wind/pressure are per-hour duplicates of what `current` already reports for
		// right now — the weather page's stat panel swaps to the hovered hour's values, so it
		// needs the whole series, not just the current hour's.
		`&hourly=temperature_2m,apparent_temperature,weather_code,is_day,precipitation,snowfall,precipitation_probability,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,cloud_cover,visibility` +
		`&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_probability_max,rain_sum,showers_sum,snowfall_sum` +
		// precipitation_unit affects amount-based fields (snowfall_sum) — precipitation_probability_max is a
		// percentage either way, unaffected. "inch" here regardless of the admin's chosen temperature/wind
		// units — amounts follow the admin's precipUnit, snowfall arriving as cm when metric.
		`&precipitation_unit=${precipUnit === 'in' ? 'inch' : 'mm'}` +
		`&temperature_unit=${unit}&wind_speed_unit=${windUnit === 'kph' ? 'kmh' : 'mph'}&timezone=auto&forecast_days=8`;
	// The ceiling lookup never throws (see fetchCeilingBlocks), so it can't fail the forecast
	// it is fetched alongside.
	const [forecastJson, ceilingBlocks] = await Promise.all([fetchForecastJson(baseUrl, unit, precipUnit), fetchCeilingBlocks(latitude, longitude)]);
	const data = forecastJson as {
		utc_offset_seconds: number;
		current: {
			temperature_2m: number;
			apparent_temperature: number;
			weather_code: number;
			is_day: number;
			precipitation: number;
			snowfall: number;
			relative_humidity_2m: number;
			dew_point_2m: number;
			wind_speed_10m: number;
			wind_gusts_10m: number;
			wind_direction_10m: number;
			pressure_msl: number;
			cloud_cover: number;
			visibility: number | null;
		};
		hourly: {
			time: string[];
			temperature_2m: number[];
			apparent_temperature: number[];
			weather_code: number[];
			is_day: number[];
			precipitation: number[];
			snowfall: number[];
			precipitation_probability: number[];
			relative_humidity_2m: number[];
			dew_point_2m: number[];
			wind_speed_10m: number[];
			wind_gusts_10m: number[];
			wind_direction_10m: number[];
			pressure_msl: number[];
			cloud_cover: number[];
			visibility: (number | null)[];
		};
		daily: {
			time: string[];
			temperature_2m_max: number[];
			temperature_2m_min: number[];
			weather_code: number[];
			sunrise: string[];
			sunset: string[];
			precipitation_probability_max: number[];
			rain_sum: number[];
			showers_sum: number[];
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

	// Open-Meteo anchors its arrays to the day the response was generated for, which can
	// still be YESTERDAY in the location's own timezone during the first hour(s) after local
	// midnight — Glasgow at 00:55 BST was served daily[0] = the previous date. Anchoring on
	// the first hour actually being shown keeps "today", today's totals and today's
	// sunrise/sunset on the day the reader is living in. indexOf returning -1 (a date the
	// daily array doesn't carry) falls back to 0, i.e. the old behaviour.
	const todayStr = (hourlyTimes[startIdx] ?? data.hourly.time[0]).slice(0, 10);
	const todayIdx = Math.max(0, data.daily.time.indexOf(todayStr));
	const tomorrowIdx = todayIdx + 1;

	// One builder for both "right now" and each hour, so the two can never drift apart — the
	// weather page renders whichever one is being pointed at through a single code path.
	const detailsFor = (
		tempValue: number,
		dewValue: number,
		humidity: number,
		windGust: number,
		cloudCover: number,
		visibilityMeters: number | null | undefined,
		atMs: number
	): ConditionDetails => {
		const dewC = toCelsius(dewValue, unit);
		const indoor = describeIndoorHumidity(dewC);
		return {
			windGust,
			cloudCover,
			visibility: formatVisibility(visibilityMeters, windUnit),
			dewPoint: dewValue,
			indoorHumidity: estimateIndoorHumidity(toCelsius(tempValue, unit), dewC, humidity),
			indoorHumidityLabel: indoor.label,
			indoorHumidityLevel: indoor.level,
			cloudCeilingFt: ceilingAt(ceilingBlocks, atMs)
		};
	};

	const currentCondition = wmoToCondition(data.current.weather_code, data.current.is_day === 1);
	const pressure = pressureUnit === 'inHg' ? hPaToInHg(data.current.pressure_msl) : data.current.pressure_msl;
	const current: CurrentConditions = {
		temp: data.current.temperature_2m,
		feelsLike: data.current.apparent_temperature,
		conditionText: currentCondition.text,
		icon: currentCondition.icon,
		humidity: data.current.relative_humidity_2m,
		precipitationChance: data.hourly.precipitation_probability[startIdx] ?? 0,
		// Snow is reported as depth and rain as liquid, so they can't simply be added — the
		// flag says which number this is, and whichever is falling wins.
		precipAmount: (data.current.snowfall ?? 0) > 0 ? data.current.snowfall : (data.current.precipitation ?? 0),
		precipIsSnow: (data.current.snowfall ?? 0) > 0,
		windSpeed: data.current.wind_speed_10m,
		windDirection: degreesToCompass(data.current.wind_direction_10m),
		pressure: pressureUnit === 'inHg' ? Math.round(pressure * 100) / 100 : Math.round(pressure),
		...detailsFor(
			data.current.temperature_2m,
			data.current.dew_point_2m,
			data.current.relative_humidity_2m,
			data.current.wind_gusts_10m,
			data.current.cloud_cover,
			data.current.visibility,
			now
		),
		sunrise: withUtcOffset(data.daily.sunrise[todayIdx], data.utc_offset_seconds),
		sunset: withUtcOffset(data.daily.sunset[todayIdx], data.utc_offset_seconds)
	};

	// Through the end of TOMORROW (index 47 — hourly.time starts at today's midnight, so
	// 0-23 is today and 24-47 is tomorrow), not a rolling 24h window from now. A rolling
	// window meant "today" on the frontend's per-day grouping shrank to almost nothing
	// by late evening (e.g. just 10-11 PM) while tomorrow showed nothing at all — the
	// frontend now expects today's remaining hours plus the whole of tomorrow.
	const hourly = hourlyTimes.slice(startIdx, 48).map((time, i) => {
		const idx = startIdx + i;
		const condition = wmoToCondition(data.hourly.weather_code[idx], data.hourly.is_day[idx] === 1);
		const hourPressure = pressureUnit === 'inHg' ? hPaToInHg(data.hourly.pressure_msl[idx]) : data.hourly.pressure_msl[idx];
		return {
			time,
			temp: data.hourly.temperature_2m[idx],
			feelsLike: data.hourly.apparent_temperature[idx],
			conditionKind: conditionKindOfCode(data.hourly.weather_code[idx]),
			conditionText: condition.text,
			icon: condition.icon,
			humidity: data.hourly.relative_humidity_2m[idx],
			precipitationChance: data.hourly.precipitation_probability[idx] ?? 0,
			precipAmount: (data.hourly.snowfall[idx] ?? 0) > 0 ? data.hourly.snowfall[idx] : (data.hourly.precipitation[idx] ?? 0),
			precipIsSnow: (data.hourly.snowfall[idx] ?? 0) > 0,
			windSpeed: data.hourly.wind_speed_10m[idx],
			windDirection: degreesToCompass(data.hourly.wind_direction_10m[idx]),
			pressure: pressureUnit === 'inHg' ? Math.round(hourPressure * 100) / 100 : Math.round(hourPressure),
			...detailsFor(
				data.hourly.temperature_2m[idx],
				data.hourly.dew_point_2m[idx],
				data.hourly.relative_humidity_2m[idx],
				data.hourly.wind_gusts_10m[idx],
				data.hourly.cloud_cover[idx],
				data.hourly.visibility[idx],
				new Date(time).getTime()
			)
		};
	});

	// Per-day descriptions come from the hourly series, split into the day proper (daylight hours)
	// and the night that follows it (last light to the next first light). Daylight comes from
	// Open-Meteo's own is_day flag, so the split tracks the season and latitude by itself.
	const hourDates = hourlyTimes.map((t) => t.slice(0, 10));
	const hourOfDayAt = (i: number) => Number(hourlyTimes[i].slice(11, 13));
	const indicesForDate = (date: string) => hourDates.flatMap((d, i) => (d === date ? [i] : []));
	const periodHours = (indices: number[]): PeriodHour[] =>
		indices.map((i) => ({
			hourOfDay: hourOfDayAt(i),
			code: data.hourly.weather_code[i],
			cloud: data.hourly.cloud_cover[i] ?? 0,
			chance: data.hourly.precipitation_probability[i] ?? null
		}));

	// Starts at TODAY in the location's own calendar (todayIdx), not at whatever day the API
	// anchored to, and runs seven days from there.
	const daily = data.daily.time.slice(todayIdx, todayIdx + 7).map((date, k) => {
		const d = todayIdx + k;
		const dateIdxs = indicesForDate(date);
		const nextDate = data.daily.time[d + 1];
		const nextIdxs = nextDate ? indicesForDate(nextDate) : [];

		let dayIdxs = dateIdxs.filter((i) => data.hourly.is_day[i] === 1);
		// Polar night has no daylight hours at all; fall back to the middle of the day so the
		// row still describes something rather than going blank.
		if (dayIdxs.length === 0) dayIdxs = dateIdxs.filter((i) => hourOfDayAt(i) >= 9 && hourOfDayAt(i) <= 16);

		const nightStart = dayIdxs.length > 0 ? dayIdxs[dayIdxs.length - 1] + 1 : (dateIdxs[0] ?? 0);
		const nextFirstLight = nextIdxs.find((i) => data.hourly.is_day[i] === 1);
		const nightEnd = nextFirstLight ?? (nextIdxs.length > 0 ? nextIdxs[0] + 6 : data.hourly.time.length);
		let nightIdxs = Array.from({ length: Math.max(0, Math.min(nightEnd, data.hourly.time.length) - nightStart) }, (_, n) => nightStart + n);
		// Midnight sun: it never gets dark, so the "night" would be empty. Use late evening to
		// early morning instead.
		if (nightIdxs.length === 0) {
			nightIdxs = [...dateIdxs.filter((i) => hourOfDayAt(i) >= 22), ...nextIdxs.filter((i) => hourOfDayAt(i) <= 5)];
		}

		const fallback = wmoToCondition(data.daily.weather_code[d]);
		const day = describePeriod(periodHours(dayIdxs), true) ?? fallback;
		const night = describePeriod(periodHours(nightIdxs), false);
		return {
			date,
			tempMax: data.daily.temperature_2m_max[d],
			tempMin: data.daily.temperature_2m_min[d],
			conditionText: day.text,
			icon: day.icon,
			nightDescription: night?.text ?? '',
			nightIcon: night?.icon ?? '',
			// A night cut short by the end of the forecast would report a low that's too high
			// (the cold hours are the ones after midnight), so it isn't claimed.
			nightLow: nightIdxs.length >= 6 ? Math.min(...nightIdxs.map((i) => data.hourly.temperature_2m[i])) : null,
			precipitationChance: data.daily.precipitation_probability_max[d] ?? null,
			nightPrecipitationChance: (() => {
				const chances = nightIdxs.map((i) => data.hourly.precipitation_probability[i]).filter((c): c is number => c !== null && c !== undefined);
				return chances.length > 0 ? Math.max(...chances) : null;
			})()
		};
	});

	// "Today" means the weather LOCATION's calendar day, not the server's — new Date()
	// would answer that in the server's own local timezone (production runs the
	// container with no TZ set, so that's UTC, not wherever the location actually is).
	// todayStr/todayIdx were resolved up front against the first hour being shown — see
	// the comment there for why hourly.time[0] alone is not a safe anchor.
	const todayRemaining = hourly.filter((h) => h.time.slice(0, 10) === todayStr);
	const tomorrowDateStr = data.daily.time.length > tomorrowIdx ? data.daily.time[tomorrowIdx] : undefined;
	const tomorrow = tomorrowDateStr
		? {
				date: tomorrowDateStr,
				tempMax: data.daily.temperature_2m_max[tomorrowIdx],
				precipitationChance: data.daily.precipitation_probability_max[tomorrowIdx],
				// rain_sum excludes showers, which Open-Meteo counts separately — summing both
				// is what makes a shower-driven day report any rain at all.
				rainTotal: (data.daily.rain_sum[tomorrowIdx] ?? 0) + (data.daily.showers_sum[tomorrowIdx] ?? 0),
				snowTotal: data.daily.snowfall_sum[tomorrowIdx] ?? 0
			}
		: undefined;
	const tomorrowHourly = tomorrowDateStr ? hourly.filter((h) => h.time.slice(0, 10) === tomorrowDateStr) : [];
	// The location's own current hour, read off the timestamp Open-Meteo already resolved
	// for it — new Date().getHours() would answer in the server's timezone (UTC in
	// production), putting "this afternoon" several segments off for anyone west of it.
	const currentHourOfDay = Number((hourlyTimes[startIdx] ?? data.hourly.time[0]).slice(11, 13));
	const todayTotals = {
		rainTotal: (data.daily.rain_sum[todayIdx] ?? 0) + (data.daily.showers_sum[todayIdx] ?? 0),
		snowTotal: data.daily.snowfall_sum[todayIdx] ?? 0
	};
	const summary = buildDaySummary(
		locationName,
		current,
		todayRemaining,
		tomorrow,
		tomorrowHourly,
		windUnit,
		currentHourOfDay,
		todayTotals,
		precipUnit
	);

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
