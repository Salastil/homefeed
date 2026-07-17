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
}

export interface AdminSettings {
	mergeStrictness: 1 | 2 | 3 | 4 | 5;
	defaultPollIntervalMinutes: number;
	holdBeforePublishMinutes: number;
	tagDedupThreshold: number;
	tagExpiryDays: number;
	followUpMinHoursSinceLast: number;
	followUpMinNewSources: number;
	aiServiceHost: string;
	aiServicePort: number;
	selectedModels: { embedding: string; image: string; synthesis: string };
	retention: RetentionSettings;
	categoryPriority: CategoryPriority[];
}

export interface AdminSource {
	id: string;
	name: string;
	type: 'rss' | 'api' | 'telegram' | 'custom';
	category: string[];
	url: string;
	pollIntervalMinutes: number;
	enabled: boolean;
	lastPolledAt: string | null;
	lastError: string | null;
}

export interface AdminTrackedEvent {
	id: string;
	name: string;
	description: string;
	sourceIds: string[];
	cadence: 'continuous' | 'daily' | 'hourly' | 'custom';
	cadenceTime: string | null;
	active: boolean;
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

export interface LogEntry {
	id: number;
	timestamp: string;
	level: 'info' | 'warn' | 'error';
	source: string;
	message: string;
}
