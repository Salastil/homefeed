// Mirrors homefeed-data-schema.md — the frontend's view of MergedArticle etc.
// Kept minimal to only what the frontend actually renders.

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
	video: { url: string; provider?: string; sourceItemId: string } | null;
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
