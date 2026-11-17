// Mirrors homefeed-data-schema.md — the frontend's view of MergedArticle etc.
// Kept minimal to only what the frontend actually renders.

export interface ArticleSource {
	itemId: string;
	sourceName: string;
	link: string;
	publishedAt: string;
}

/** A single photo/video/gif attached to a tweet, in the tweet's own display order — capped at 4. */
export interface TweetMediaItem {
	type: 'photo' | 'video' | 'gif';
	url: string;
	thumbnailUrl: string | null;
	width: number | null;
	height: number | null;
}

/** The tweet embedded in a quote-tweet's own preview — rendered as a smaller nested frame. */
export interface QuotedTweet {
	authorName: string;
	authorHandle: string;
	text: string;
	imageUrl: string | null;
	link: string;
}

/** Same shape as TweetMediaItem — distinct name for readability at Telegram call sites. */
export type TelegramMediaItem = TweetMediaItem;

export interface MergedArticle {
	id: string;
	title: string;
	body: string;
	heroImage: { url: string; sourceItemId: string; selectionReason: string } | null;
	video: { url: string; provider?: string; embedUrl?: string; sourceItemId: string } | null;
	tweet: {
		authorName: string;
		authorHandle: string;
		avatarUrl: string | null;
		sourceItemId: string;
		media: TweetMediaItem[];
		repostedByHandle: string | null;
		quotedTweet: QuotedTweet | null;
	} | null;
	telegramMessage: {
		channelName: string;
		channelUsername: string | null;
		channelAvatarUrl: string | null;
		sourceItemId: string;
		media: TelegramMediaItem[];
		repostedByHandle: string | null;
	} | null;
	category: string[];
	geo: string | null;
	eventId: string | null;
	sourceCount: number;
	sources: ArticleSource[];
	publishedAt: string;
	updatedAt: string;
	mergeConfidence: number;
	tags: string[];
	threadId: string;
	previousArticleId: string | null;
	nextArticleId: string | null;
	/** True only for the AI-written periodic summary of a tracked event — see the /event/[id] page. */
	isRecap: boolean;
}

export interface Tag {
	id: string;
	label: string;
	slug: string;
	articleCount: number;
	status: 'active' | 'expired';
}

export interface TrackedEventPublic {
	id: string;
	name: string;
	active: boolean;
	recapIntervalHours: number | null;
	/** Timestamp of the last AI recap, or null if none has run yet — used to compute "next recap" on the /event/[id] page. */
	lastRecapAt: string | null;
	isSpillover: boolean;
}

export interface Category {
	id: string;
	name: string;
	priorityRank: number;
	isDefault: boolean;
	isPrivate: boolean;
	isSpillover: boolean;
}

/**
 * The at-a-glance conditions an hour and "right now" both carry, so the weather page's
 * header card can render either through one code path (see backend widgets/weather/db.ts).
 */
export interface WeatherConditionDetails {
	/** Already in the feed's configured windUnit. */
	windGust: number;
	/** Percent, 0-100. */
	cloudCover: number;
	/** Miles when windUnit is mph, kilometres when kph. Null when the forecast model has none. */
	visibility: number | null;
	/** In the feed's configured temperature unit. */
	dewPoint: number;
	/** Estimated indoor relative humidity, percent. */
	indoorHumidity: number;
	/** "Ideal Humidity", "Slightly Dry", "Dangerously Humid", ... — one of AccuWeather's 11 descriptions. */
	indoorHumidityLabel: string;
	/** -5 (dangerously dry) .. 0 (ideal) .. +5 (dangerously humid). */
	indoorHumidityLevel: number;
	/** Feet; null when unknown. NWS data, so US only — see the backend's fetchCeilingBlocks. At or above 25,000 means "no ceiling below that". */
	cloudCeilingFt: number | null;
}

/** See the backend's ConditionKind: a coarse look for one hour, so neighbouring hours can merge into one stretch of the timeline bar. */
export type WeatherConditionKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'light-rain' | 'rain' | 'freezing' | 'sleet' | 'mix' | 'snow' | 'storm' | 'hail';

export interface WeatherHourEntry extends WeatherConditionDetails {
	/** Absent on a forecast cached before the field existed - until the next poll, a few seconds after a deploy. */
	conditionKind?: WeatherConditionKind;
	/** Apparent temperature, in the feed's configured temperature unit. */
	feelsLike: number;
	time: string;
	temp: number;
	conditionText: string;
	icon: string;
	/** Percent, 0-100. */
	humidity: number;
	/** Percent, 0-100. */
	precipitationChance: number;
	/** Already in the feed's configured windUnit. */
	windSpeed: number;
	/** 8-point compass abbreviation, e.g. "NW". */
	windDirection: string;
	/** Already in the feed's configured pressureUnit. */
	pressure: number;
	/** Accumulation during this hour, already in the feed's configured precipUnit. Snow is DEPTH, not liquid equivalent — precipIsSnow says which, and picks the label (in / mm for rain / cm for snow). */
	precipAmount: number;
	precipIsSnow: boolean;
}

export interface WeatherDayEntry {
	date: string;
	tempMax: number;
	/** The calendar day's minimum - the fallback for nightLow. */
	tempMin: number;
	/** Short daytime description composed from the hourly forecast, e.g. "Mostly cloudy with a shower". */
	conditionText: string;
	icon: string;
	/** Short description of the night that follows this day, e.g. "A couple of evening showers". */
	nightDescription: string;
	nightIcon: string;
	/** That night's low - what AccuWeather shows as the day's "low". Null when too little of the night is in the forecast. */
	nightLow: number | null;
	/** Percent, 0-100: the day's highest hourly chance of precipitation. */
	precipitationChance: number | null;
	/** Same, for that night alone — what a "Tonight" row shows. */
	nightPrecipitationChance: number | null;
}

export interface WeatherCurrentConditions extends WeatherConditionDetails {
	temp: number;
	feelsLike: number;
	conditionText: string;
	icon: string;
	humidity: number;
	precipitationChance: number;
	windSpeed: number;
	windDirection: string;
	pressure: number;
	precipAmount: number;
	precipIsSnow: boolean;
	sunrise: string;
	sunset: string;
}

export interface WeatherAlert {
	id: string;
	event: string;
	headline: string;
	severity: string;
	expires: string;
	/** NWS fields the page can show when the backend sends them (older backends don't). */
	onset?: string | null;
	ends?: string | null;
	description?: string | null;
	instruction?: string | null;
	areaDesc?: string | null;
	senderName?: string | null;
}

export interface Weather {
	locationName: string | null;
	unit: 'celsius' | 'fahrenheit';
	windUnit: 'mph' | 'kph';
	pressureUnit: 'inHg' | 'hPa';
	/** 'mm' means millimetres for rain but centimetres for snow depth — see precipUnitLabel. */
	precipUnit: 'in' | 'mm';
	current: WeatherCurrentConditions | null;
	hourly: WeatherHourEntry[];
	daily: WeatherDayEntry[];
	alerts: WeatherAlert[];
	/** Plain-English wrap-up, e.g. "Current conditions in X are 86° and sunny with a light northwest wind at 5 mph. Tonight will turn..." — null until the first successful poll. */
	summary: string | null;
	updatedAt: string | null;
}

export interface StockTicker {
	id: string;
	label: string;
	symbol: string;
	lastPrice: number | null;
	lastChangePercent: number | null;
}

/** Tickers plus the cadence they're refreshed on — the sidebar states the interval so a price that looks stale can be read as "polled every N minutes" rather than "broken". */
export interface StocksFeed {
	tickers: StockTicker[];
	pollIntervalMinutes: number;
}

export interface Bookmark {
	id: string;
	name: string;
	url: string;
	isPrivate: boolean;
}

/** Response from GET /api/widget/bookmarks — items plus the admin-configured sidebar layout width. */
export interface BookmarksFeed {
	items: Bookmark[];
	columns: 1 | 2 | 3;
}

export interface Poe2WatchlistEntry {
	id: string;
	baseName: string;
	quoteName: string;
	/** 1 base = lastRate quote. */
	lastRate: number | null;
	/** 24h % change, self-computed from our own poll history — null if not enough history yet. */
	lastChange24h: number | null;
}

export interface Poe2Data {
	leagueName: string | null;
	updatedAt: string | null;
	entries: Poe2WatchlistEntry[];
}

/** An uploaded (non-core) widget the sidebar renders generically — see GenericWidgetCard.svelte / DynamicWidgetSlot.svelte. */
export interface PluggableWidgetSummary {
	id: string;
	displayName: string;
	/** Relative path under /widget-assets/<id>/ to a custom mount() bundle — null means render the generic report card instead. */
	frontendEntry: string | null;
}

/** Generic live-data shape a widget publishes via its own poll — see GET /api/widget/:id/report. */
export interface WidgetReport {
	title: string;
	headline?: { value: string; delta?: string } | null;
	rows?: { label: string; value: string }[];
	updatedAt: string | null;
}

/** Per-widget sidebar visibility + display order, admin-set from the consolidated "Widgets" tab. */
export interface WidgetsEnabled {
	weather: boolean;
	stocks: boolean;
	bookmarks: boolean;
	poe2: boolean;
	/** Every installed widget's id (built-in or uploaded), in display order — a pluggable widget can be positioned anywhere relative to the built-ins. */
	order: string[];
	/** Enabled uploaded widgets — a lookup Sidebar.svelte uses for any `order` entry that isn't one of the 4 built-in keys; missing = disabled, skip it. */
	pluggable: PluggableWidgetSummary[];
	/** The widget row: one entry per position; more than one widget in a slot rotates on a timer. */
	slots: WidgetSlot[];
	/** Plug-in widgets shown in the top bar instead of the widget row (the search widget). */
	topBar: string[];
	/** Built-in widgets shown in the ticker strip under the widget row ('stocks', 'poe2'). Absent from older backends. */
	ticker?: string[];
}

export interface WidgetSlot {
	widgets: string[];
	rotateSeconds: number;
}

// ---------- storylines / board (see backend api/storylines.ts) ----------

/** An article as the board polls it: no full body, an excerpt instead. */
export interface LiteArticle {
	id: string;
	title: string;
	excerpt: string;
	heroImage: MergedArticle['heroImage'];
	hasVideo: boolean;
	tweet: MergedArticle['tweet'];
	telegramMessage: MergedArticle['telegramMessage'];
	category: string[];
	eventId: string | null;
	sourceName: string;
	sourceKey: string;
	sourceLink: string | null;
	sourceCount: number;
	publishedAt: string;
	isRecap: boolean;
}

export interface StoryImage {
	url: string;
	credit: string;
	at: string;
}

export interface Storyline {
	id: string;
	scope: string;
	tag: string;
	label: string;
	labelArticleId: string | null;
	state: 'live' | 'cooling' | 'closed';
	closesAt: string;
	firstItemAt: string;
	lastItemAt: string;
	itemCount: number;
	sourceCount: number;
	continuesId: string | null;
	image: StoryImage | null;
	score: number;
	members: LiteArticle[];
}

export interface EventStoryline {
	id: string;
	name: string;
	recapIntervalHours: number | null;
	postCount: number;
	channelCount: number;
	developmentCount: number;
	developments: Storyline[];
	image: StoryImage | null;
	score: number;
}

export interface StorylinesResponse {
	settings: { rows: 1 | 2 | 3; rotateSeconds: number; jumpOnUpdate: boolean; pauseOnHover: boolean; closeHours: number };
	storylines: Storyline[];
	events: EventStoryline[];
	closedToday: number;
	/** False while the embedding service is unreachable - storylines can't form or grow. Absent from older backends. */
	grouping?: boolean;
}

export interface BoardColumn {
	key: string;
	kind: 'category' | 'wire' | 'general';
	name: string;
	categoryId: string | null;
	/** The admin's colour (theme token like 'c-news', or hex); null = the default for the name. */
	color?: string | null;
	isSpillover: boolean;
	isPrivate: boolean;
	count24h: number;
	items: LiteArticle[];
}

/** The admin's Board layout as the board applies it: positions left to right; several keys = one rotating column. */
export interface BoardLayout {
	slots: { columns: string[]; rotateSeconds: number }[];
	autoRotateQuiet: boolean;
	autoFold: boolean;
}

export interface BoardResponse {
	columns: BoardColumn[];
	/** Absent from older backends - the board then uses its built-in arrangement. */
	layout?: BoardLayout;
}

export interface EventTimeline {
	event: { id: string; name: string; recapIntervalHours: number | null; lastRecapAt: string | null };
	hours: number;
	developments: Storyline[];
	singles: LiteArticle[];
	postCount: number;
	channelCount: number;
}

export interface ArticleContext {
	storyline: Storyline | null;
	related: LiteArticle[];
}
