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
	cadence: string;
}

export interface Category {
	id: string;
	name: string;
	priorityRank: number;
	isDefault: boolean;
	isPrivate: boolean;
}
