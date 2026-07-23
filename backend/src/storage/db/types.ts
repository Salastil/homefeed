export interface Source {
	id: string;
	name: string;
	type: 'rss' | 'api' | 'telegram' | 'youtube' | 'nitter' | 'custom';
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

/** A single photo/video/gif attached to a tweet, in the tweet's own display order — fxtwitter caps this at 4. */
export interface TweetMediaItem {
	type: 'photo' | 'video' | 'gif';
	url: string;
	/** Video/gif poster frame — null for photos. */
	thumbnailUrl: string | null;
	width: number | null;
	height: number | null;
}

/** Same shape as TweetMediaItem — distinct name for readability at Telegram call sites. */
export type TelegramMediaItem = TweetMediaItem;

/**
 * A raw reference to a single message's attached media, captured at ingestion time —
 * deliberately NOT a URL, since Telegram has no public hotlinkable media URL the way
 * Twitter does; media bytes only ever come from the authenticated MTProto session.
 * publish.ts resolves this into a real TelegramMediaItem (a servable url) according to
 * the admin's configured telegramMediaMode, at publish time — mirroring how Nitter's
 * tweet media URLs are resolved at publish time too, just starting from a message
 * reference here instead of an already-public CDN URL.
 */
export interface TelegramMediaRef {
	type: 'photo' | 'video' | 'gif';
	/** This media's own message id (a grouped album's items are separate messages, each individually re-fetchable). */
	messageId: string;
	mimeType: string | null;
	width: number | null;
	height: number | null;
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
	/** Nitter-sourced items only — null for everything else. */
	tweet: { id: string; authorName: string; authorHandle: string; avatarUrl: string | null; media: TweetMediaItem[] } | null;
	/** Telegram-sourced items only — null for everything else. Media is unresolved refs (see TelegramMediaRef); publish.ts resolves them (and the channel avatar) per the admin's configured media mode. */
	telegramMessage: {
		channelName: string;
		channelUsername: string;
		messageId: string;
		media: TelegramMediaRef[];
	} | null;
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
	/** Nitter-sourced articles only — the embed card's author info and attached media (see TweetCard.svelte). Never set alongside video. */
	tweet: { authorName: string; authorHandle: string; avatarUrl: string | null; sourceItemId: string; media: TweetMediaItem[] } | null;
	/** Telegram-sourced articles only — the embed card's channel info and attached media (see TelegramCard.svelte). Never set alongside video. */
	telegramMessage: {
		channelName: string;
		channelUsername: string;
		channelAvatarUrl: string | null;
		sourceItemId: string;
		media: TelegramMediaItem[];
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
	/** Hidden from /api/categories, /api/feed, and article detail for anyone without a valid private-access cookie. */
	isPrivate: boolean;
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
	/** How tweet media (attached photos, avatars) is served — see pipeline/publish.ts's resolveTweetMedia. */
	nitterMediaMode: 'self-host' | 'proxy' | 'direct';
	/** Base URL of the fxtwitter-compatible enrichment API — defaults to the public instance, overridable for a self-hosted FixTweet mirror. */
	fxtwitterBaseUrl: string;
	/** How Telegram message media (attached photos/videos, channel avatars) is served — see pipeline/publish.ts's resolveTelegramMedia. No "direct" option: Telegram has no public hotlinkable media URL, bytes only come from the authenticated MTProto session. */
	telegramMediaMode: 'self-host' | 'proxy';
	retention: {
		publishedArticleMaxAgeDays: number | null;
		rawItemMaxAgeDays: number | null;
		storageCapEnabled: boolean;
		storageCapValue: number;
		storageCapUnit: 'MB' | 'GB';
	};
}
