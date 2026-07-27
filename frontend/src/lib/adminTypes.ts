export interface RetentionSettings {
	publishedArticleMaxAgeDays: number | null;
	rawItemMaxAgeDays: number | null;
	storageCapEnabled: boolean;
	storageCapValue: number;
	storageCapUnit: 'MB' | 'GB';
	storageUsedMB: number;
}

export interface CategoryPriority {
	id: string;
	name: string;
	priorityRank: number;
	isDefault: boolean;
	isPrivate: boolean;
	isSpillover: boolean;
	disableAi: boolean;
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

export interface AdminWeatherSettings {
	locationName: string | null;
	latitude: number | null;
	longitude: number | null;
	unit: 'celsius' | 'fahrenheit';
	windUnit: 'mph' | 'kph';
	pressureUnit: 'inHg' | 'hPa';
	current: WeatherCurrentConditions | null;
	hourly: WeatherHourEntry[];
	daily: WeatherDayEntry[];
	alerts: WeatherAlert[];
	updatedAt: string | null;
}

export interface GeocodeResult {
	name: string;
	admin1: string | null;
	country: string | null;
	latitude: number;
	longitude: number;
}

export interface AdminStockTicker {
	id: string;
	label: string;
	symbol: string;
	priorityRank: number;
	lastPrice: number | null;
	lastChangePercent: number | null;
	lastPolledAt: string | null;
	lastError: string | null;
}

export interface AdminBookmark {
	id: string;
	name: string;
	url: string;
	priorityRank: number;
	isPrivate: boolean;
}

export interface Poe2BrowseEntry {
	id: string;
	name: string;
}

export interface AdminPoe2Entry {
	id: string;
	baseCurrencyId: string;
	baseName: string;
	quoteCurrencyId: string;
	quoteName: string;
	priorityRank: number;
	lastRate: number | null;
	lastChange24h: number | null;
	lastPolledAt: string | null;
	lastError: string | null;
}

export interface AdminPoe2Settings {
	leagueId: string | null;
	leagueName: string | null;
	updatedAt: string | null;
}

export interface AdminWidgetsEnabled {
	weather: boolean;
	stocks: boolean;
	bookmarks: boolean;
	poe2: boolean;
}

export interface AdminSettings {
	mergeStrictness: 1 | 2 | 3 | 4 | 5;
	holdBeforePublishMinutes: number;
	tagDedupThreshold: number;
	tagExpiryDays: number;
	followUpMinHoursSinceLast: number;
	followUpMinNewSources: number;
	aiServiceHost: string;
	aiServicePort: number;
	selectedModels: { embedding: string; image: string; synthesis: string };
	nitterMediaMode: 'self-host' | 'proxy' | 'direct';
	fxtwitterBaseUrl: string;
	nitterInstanceUrl: string;
	telegramMediaMode: 'self-host' | 'proxy';
	synthesisStylePreset: 'default' | 'casual' | 'formal';
	synthesisCustomInstructions: string;
	widgets: AdminWidgetsEnabled;
	widgetOrder: ('weather' | 'stocks' | 'bookmarks' | 'poe2')[];
	retention: RetentionSettings;
	categoryPriority: CategoryPriority[];
	weather: AdminWeatherSettings;
	poe2: AdminPoe2Settings;
}

export interface AdminSource {
	id: string;
	name: string;
	type: 'rss' | 'api' | 'telegram' | 'youtube' | 'nitter';
	category: string[];
	url: string;
	config?: Record<string, unknown>;
	pollIntervalMinutes: number;
	enabled: boolean;
	pushToTopStories: boolean;
	lastPolledAt: string | null;
	lastError: string | null;
}

export interface AdminTrackedEvent {
	id: string;
	name: string;
	description: string;
	sourceIds: string[];
	/** Only items whose title/summary/body contain at least one of these (case-insensitive) qualify for this event — empty means "match everything from sourceIds". */
	keywords: string[];
	/** Hours between AI recaps, or null to turn recaps off entirely for this item. */
	recapIntervalHours: 1 | 3 | 6 | 12 | 24 | null;
	active: boolean;
	isSpillover: boolean;
	retentionOverrideDays: number | null;
}

export interface ModelCatalog {
	embedding: string[];
	image: string[];
	synthesis: string[];
}

export interface AiStatus {
	connected: boolean;
	host: string;
	port: number;
	ramGB: number;
	gpu: string;
}

export interface TelegramStatus {
	credentialsConfigured: boolean;
	connected: boolean;
	phone: string | null;
}

export interface LogEntry {
	id: number;
	timestamp: string;
	level: 'info' | 'warn' | 'error';
	source: string;
	message: string;
}
