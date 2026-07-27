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

export interface WeatherCurrentConditions {
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

export interface WeatherAlert {
	id: string;
	event: string;
	headline: string;
	severity: string;
	expires: string;
}

export interface Weather {
	locationName: string | null;
	unit: 'celsius' | 'fahrenheit';
	windUnit: 'mph' | 'kph';
	pressureUnit: 'inHg' | 'hPa';
	current: WeatherCurrentConditions | null;
	hourly: WeatherHourEntry[];
	daily: WeatherDayEntry[];
	alerts: WeatherAlert[];
	updatedAt: string | null;
}

export interface StockTicker {
	id: string;
	label: string;
	symbol: string;
	lastPrice: number | null;
	lastChangePercent: number | null;
}

export interface Bookmark {
	id: string;
	name: string;
	url: string;
	isPrivate: boolean;
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
	order: ('weather' | 'stocks' | 'bookmarks' | 'poe2')[];
	/** Enabled uploaded widgets, in their own priority order — rendered after the 4 built-ins (see Sidebar.svelte). */
	pluggable: PluggableWidgetSummary[];
}
