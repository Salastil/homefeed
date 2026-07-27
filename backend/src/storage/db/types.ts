export interface Source {
	id: string;
	name: string;
	type: 'rss' | 'api' | 'telegram' | 'youtube' | 'nitter';
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

/**
 * The tweet embedded inside a quote-tweet's own <blockquote> — Nitter's RSS carries this
 * fully inline (author, text, one image, permalink), so no extra fxtwitter call is needed
 * to render it. Rendered as a smaller frame nested inside the quoting tweet's card.
 */
export interface QuotedTweet {
	authorName: string;
	authorHandle: string;
	text: string;
	imageUrl: string | null;
	link: string;
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
	tweet: {
		id: string;
		authorName: string;
		authorHandle: string;
		avatarUrl: string | null;
		media: TweetMediaItem[];
		/** Set when this item is a bare retweet — the retweeter's handle, e.g. from RSS "RT by @X:". */
		repostedByHandle: string | null;
		/** Set when this item is a quote-tweet — the tweet embedded in its <blockquote>. */
		quotedTweet: QuotedTweet | null;
	} | null;
	/**
	 * Telegram-sourced items only — null for everything else. channelName/channelUsername
	 * describe whoever should be *displayed* as the author — the original channel when
	 * this message is a forward (same as tweet.authorName always being the original
	 * tweet's author, not the retweeter), or the polled channel itself otherwise.
	 * channelUsername is null when a forward's origin has no public handle. Media is
	 * unresolved refs (see TelegramMediaRef); publish.ts resolves them (and the display
	 * avatar) per the admin's configured media mode.
	 */
	telegramMessage: {
		channelName: string;
		channelUsername: string | null;
		/** The channel actually polled — always non-null, used to re-fetch this message's media (attached media lives on the polled channel's own copy of the message, forward or not). */
		sourceChannelUsername: string;
		messageId: string;
		media: TelegramMediaRef[];
		/** Set when this message is a forward — the polled channel's own handle, e.g. "Forwarded by @X". */
		repostedByHandle: string | null;
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
	tweet: {
		authorName: string;
		authorHandle: string;
		avatarUrl: string | null;
		sourceItemId: string;
		media: TweetMediaItem[];
		repostedByHandle: string | null;
		quotedTweet: QuotedTweet | null;
	} | null;
	/** Telegram-sourced articles only — the embed card's channel info and attached media (see TelegramCard.svelte). Never set alongside video. */
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
	/** True if any contributing source opted into "Push to Top Stories?" — gates the homepage feed, see articles.queryFeed. */
	topStories: boolean;
	/** True only for the AI-written periodic summary of a tracked event (see eventsRecap.ts) — distinguishes it from the individual articles published under the same eventId. */
	isRecap: boolean;
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
	/** Only items whose title/summary/body contain at least one of these (case-insensitive) qualify for this event — empty means "match everything from sourceIds", the original behavior. */
	keywords: string[];
	/** Hours between AI recaps, or null to turn recaps off entirely — e.g. an item that's just organizing a commit or torrent RSS feed under one nav entry, with nothing that needs periodically summarizing. Individual articles still publish immediately either way (see priorityQueue.ts); this only gates eventsRecap.ts's periodic wrap-up. */
	recapIntervalHours: 1 | 3 | 6 | 12 | 24 | null;
	active: boolean;
	/** Collapses into the "More »" nav tab instead of getting its own top-level tab — same idea as Category.isSpillover. */
	isSpillover: boolean;
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
	/** Grouped into the nav's "More »" overflow page instead of getting its own top-level tab — see +layout.svelte and /more. */
	isSpillover: boolean;
	/** Skips clustering/AI synthesis for this category's items — each one publishes directly (own article, own source's text), same as YouTube/Nitter/Telegram items always do. See priorityQueue.ts's runSynthesisCycle. */
	disableAi: boolean;
}

export interface StockTicker {
	id: string;
	label: string;
	symbol: string;
	priorityRank: number;
	lastPrice: number | null;
	lastChangePercent: number | null;
	lastPolledAt: string | null;
	lastError: string | null;
	createdAt: string;
}

export interface Poe2WatchlistEntry {
	id: string;
	/** Opaque id from poe.ninja's exchange overview, e.g. "exalted" — not a display name. */
	baseCurrencyId: string;
	baseName: string;
	quoteCurrencyId: string;
	quoteName: string;
	priorityRank: number;
	/** 1 base = lastRate quote. */
	lastRate: number | null;
	/**
	 * % change over the last 24h, self-computed from poe2_rate_history since poe.ninja
	 * doesn't expose a matching change window (see poe2/poller.ts) — null when there
	 * isn't yet 24h of history (e.g. a pair just added).
	 */
	lastChange24h: number | null;
	lastPolledAt: string | null;
	lastError: string | null;
	createdAt: string;
}

/** A row in `installed_widgets` — the registry of both built-in and uploaded sidebar widgets (see widgets/registry.ts). */
export interface InstalledWidget {
	id: string;
	displayName: string;
	source: 'builtin' | 'uploaded';
	/** Builtin: the module's identifying path segment (e.g. 'weather', 'widgets/poe2'). Uploaded: the on-disk install directory, e.g. './data/widgets-installed/<id>'. */
	codePath: string;
	enabled: boolean;
	priorityRank: number;
	version: string;
	/** Self-reported by the plugin (WidgetPlugin.ownedTables) at install/load time — used by the uninstall safety-net sweep. */
	ownedTables: string[];
	/** Relative path (within the widget's install dir) to an optional pre-built browser JS bundle, served from /widget-assets/<id>/* and dynamic-import()ed by the sidebar's DynamicWidgetSlot. Null for a widget with no custom frontend (falls back to the generic report card). */
	frontendEntry: string | null;
	installedAt: string;
}

export interface Bookmark {
	id: string;
	name: string;
	url: string;
	priorityRank: number;
	isPrivate: boolean;
	createdAt: string;
}

export interface GlobalSettings {
	mergeStrictness: 1 | 2 | 3 | 4 | 5;
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
	/** Preferred Nitter instance, admin-set in Connections — prefills new Nitter sources' feed URL (SourcesTab.svelte) rather than being fetched from directly; each source's own URL is still what's actually polled. Defaults to the public nitter.net instance. */
	nitterInstanceUrl: string;
	/** How Telegram message media (attached photos/videos, channel avatars) is served — see pipeline/publish.ts's resolveTelegramMedia. No "direct" option: Telegram has no public hotlinkable media URL, bytes only come from the authenticated MTProto session. */
	telegramMediaMode: 'self-host' | 'proxy';
	/** Tone preset applied to every AI-synthesized article/recap (see pipeline/synthesis.ts's STYLE_PRESETS) — 'default' is the original neutral wire-service tone with no addendum. Never applies to single-source items, which always publish verbatim without going through the AI at all. */
	synthesisStylePreset: 'default' | 'casual' | 'formal';
	/** Free-text instructions appended to the synthesis system prompt alongside the style preset — e.g. "keep it under 3 sentences per paragraph". Empty string means no addendum. */
	synthesisCustomInstructions: string;
	/** Per-widget enable flags — see admin/settings' consolidated "Widgets" tab. Weather/Stocks/PoE2's backend pollers (scheduler.ts) are gated on these too, not just sidebar visibility; Bookmarks has no poller so its flag only affects the sidebar. */
	widgets: {
		weather: boolean;
		stocks: boolean;
		bookmarks: boolean;
		poe2: boolean;
	};
	/** Sidebar widget display order, admin-sortable via the Widgets tab's up/down arrows — mirrored exactly by Sidebar.svelte. */
	widgetOrder: ('weather' | 'stocks' | 'bookmarks' | 'poe2')[];
	retention: {
		publishedArticleMaxAgeDays: number | null;
		rawItemMaxAgeDays: number | null;
		storageCapEnabled: boolean;
		storageCapValue: number;
		storageCapUnit: 'MB' | 'GB';
	};
}
