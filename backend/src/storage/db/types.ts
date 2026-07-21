export interface Source {
	id: string;
	name: string;
	type: 'rss' | 'api' | 'telegram' | 'youtube' | 'custom';
	category: string[];
	url: string | null;
	config: Record<string, unknown>;
	pollIntervalMinutes: number;
	enabled: boolean;
	/** Opt-in — default false, so the homepage ("Top stories") isn't flooded by every ingested source. */
	pushToTopStories: boolean;
	lastPolledAt: string | null;
	lastError: string | null;
	createdAt: string;
}

export interface ContentItem {
	id: string;
	sourceId: string;
	type: 'article' | 'social_post' | 'alert' | 'other';
	title: string;
	summary: string;
	body: string | null;
	images: { url: string; caption?: string; width?: number; height?: number }[];
	videos: { url: string; provider?: string; embedHtml?: string }[];
	link: string;
	publishedAt: string;
	fetchedAt: string;
	tags: string[];
	geo: string | null;
	embedding: number[] | null;
	eventId: string | null;
	clusterId: string | null;
	raw: unknown;
}

export interface ArticleSource {
	itemId: string;
	sourceName: string;
	link: string;
	publishedAt: string;
}

export interface MergedArticle {
	id: string;
	title: string;
	body: string;
	heroImage: { url: string; sourceItemId: string; selectionReason: string } | null;
	video: { url: string; provider?: string; embedUrl?: string; sourceItemId: string } | null;
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
	/** True if any contributing source opted into "Push to Top Stories?" — gates the homepage feed, see articles.queryFeed. */
	topStories: boolean;
}

export interface Tag {
	id: string;
	label: string;
	aliases: string[];
	slug: string;
	embedding: number[];
	firstSeenAt: string;
	lastSeenAt: string;
	articleCount: number;
	status: 'active' | 'expired';
}

export interface TrackedEvent {
	id: string;
	name: string;
	description: string;
	sourceIds: string[];
	cadence: 'continuous' | 'daily' | 'hourly' | 'custom';
	cadenceTime: string | null;
	active: boolean;
	retentionOverrideDays: number | null;
	lastRecapAt: string | null;
	createdAt: string;
}

export interface LocalRegion {
	id: string;
	name: string;
	sourceIds: string[];
	seasonal: boolean;
	activeMonths: number[] | null;
	createdAt: string;
}

export interface Category {
	id: string;
	name: string;
	priorityRank: number;
	isDefault: boolean;
}

export interface GlobalSettings {
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
	retention: {
		publishedArticleMaxAgeDays: number | null;
		rawItemMaxAgeDays: number | null;
		storageCapEnabled: boolean;
		storageCapValue: number;
		storageCapUnit: 'MB' | 'GB';
	};
}
