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

export interface AdminWidgetsEnabled {
	weather: boolean;
	stocks: boolean;
	bookmarks: boolean;
	poe2: boolean;
}

/** A row from the installed_widgets registry — see backend/src/storage/db/installedWidgets.ts. */
export interface InstalledWidget {
	id: string;
	displayName: string;
	source: 'builtin' | 'uploaded';
	enabled: boolean;
	priorityRank: number;
	version: string;
	frontendEntry: string | null;
	installedAt: string;
}

/** Body for POST /api/admin/widgets — see backend/src/widgets/manifest.ts. */
export interface WidgetUploadManifest {
	id: string;
	displayName: string;
	version: string;
	entry: string;
	frontendEntry?: string;
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
	/** Total context window (prompt + response) requested from Ollama for every synthesis/recap/tag-extraction call. */
	synthesisNumCtx: number;
	/** Max tokens the model may generate per call — too low silently truncates output mid-sentence. */
	synthesisNumPredict: number;
	widgets: AdminWidgetsEnabled;
	widgetOrder: ('weather' | 'stocks' | 'bookmarks' | 'poe2')[];
	retention: RetentionSettings;
	categoryPriority: CategoryPriority[];
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
	/** This item's own recap tone, independent of the global Merge-tab synthesis style. */
	recapStylePreset: 'default' | 'casual' | 'formal';
	/** Free-text instructions appended to this item's recap prompt specifically. */
	recapCustomInstructions: string;
}

/** Response from POST /api/admin/events/:id/recap-now. */
export interface ForceRecapResult {
	published: boolean;
	/** Set when published is true. */
	title?: string;
	/** Set when published is false — why nothing was generated (no sources assigned, nothing new since last recap). */
	reason?: string;
}

export interface ModelCatalog {
	embedding: string[];
	image: string[];
	synthesis: string[];
}

/** Response from GET /api/admin/model-context — the selected model's own reported max context length, or null if Ollama doesn't expose it for this model/version. */
export interface ModelContextInfo {
	contextLength: number | null;
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

export interface PipelineStats {
	timestamp: string;
	ollama: {
		inFlight: { label: string; elapsedMs: number } | null;
		sampleCount: number;
		avgGenTokensPerSec: number | null;
		avgPromptTokensPerSec: number | null;
		avgGenerateDurationMs: number | null;
	};
	backlog: {
		totalUnclusteredItems: number;
		directEligibleItems: number;
		awaitingEmbeddingItems: number;
		clusters: {
			total: number;
			readyNow: number;
			readyNowNeedingSynthesis: number;
			onHold: number;
			itemsOnHold: number;
			earliestHoldRemainingMs: number | null;
		};
	};
	estimatedMinutesToClear: number | null;
	lastDirectCycle: { at: string; published: number } | null;
	lastSynthesisCycle: { at: string; published: number } | null;
}

export interface LogEntry {
	id: number;
	timestamp: string;
	level: 'info' | 'warn' | 'error';
	source: string;
	message: string;
}
