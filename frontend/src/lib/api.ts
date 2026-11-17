import { getBackendUrl } from './config';
import type { MergedArticle, Tag, TrackedEventPublic, Category, Weather, StockTicker, StocksFeed, BookmarksFeed, Poe2Data, WidgetsEnabled, BoardColumn, StorylinesResponse, Storyline, EventTimeline, ArticleContext } from './types';

async function get<T>(path: string, fetchFn: typeof fetch = fetch): Promise<T> {
	// credentials: 'include' so the private-access cookie (see lib/privateAccess.ts)
	// is sent cross-origin to the backend, revealing private categories/articles to
	// anyone who's logged in — without it every request would look unauthenticated.
	const res = await fetchFn(`${getBackendUrl()}${path}`, { credentials: 'include' });
	if (!res.ok) {
		// Carries the status the way adminApi's request() does, so a caller can tell a
		// genuinely-missing resource apart from a backend that's down — an article that
		// aged out of retention should render as 404, not as a 500 "Internal Error".
		const err = new Error(`Request failed: ${path} (${res.status})`) as Error & { status?: number };
		err.status = res.status;
		throw err;
	}
	return res.json();
}

export interface FeedParams {
	category?: string;
	geo?: string;
	eventId?: string;
	tag?: string;
	before?: string;
	limit?: number;
}

export function getFeed(params: FeedParams = {}, fetchFn?: typeof fetch): Promise<MergedArticle[]> {
	const qs = new URLSearchParams(
		Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
	).toString();
	return get<MergedArticle[]>(`/api/feed${qs ? `?${qs}` : ''}`, fetchFn);
}

export function getArticle(id: string, fetchFn?: typeof fetch): Promise<MergedArticle> {
	return get<MergedArticle>(`/api/article/${id}`, fetchFn);
}

export function getTags(fetchFn?: typeof fetch): Promise<Tag[]> {
	return get<Tag[]>('/api/tags', fetchFn);
}

export function getTagBySlug(slug: string, fetchFn?: typeof fetch): Promise<Tag> {
	return get<Tag>(`/api/tag/${slug}`, fetchFn);
}

export function getEvents(fetchFn?: typeof fetch): Promise<TrackedEventPublic[]> {
	return get<TrackedEventPublic[]>('/api/events', fetchFn);
}

export function getCategories(fetchFn?: typeof fetch): Promise<Category[]> {
	return get<Category[]>('/api/categories', fetchFn);
}

export function getWeather(fetchFn?: typeof fetch): Promise<Weather> {
	return get<Weather>('/api/widget/weather', fetchFn);
}

export function getStocks(fetchFn?: typeof fetch): Promise<StocksFeed> {
	return get<StocksFeed>('/api/widget/stocks', fetchFn);
}

export function getBookmarks(fetchFn?: typeof fetch): Promise<BookmarksFeed> {
	return get<BookmarksFeed>('/api/widget/bookmarks', fetchFn);
}

export function getPoe2(fetchFn?: typeof fetch): Promise<Poe2Data> {
	return get<Poe2Data>('/api/widget/poe2', fetchFn);
}

export function getWidgetsEnabled(fetchFn?: typeof fetch): Promise<WidgetsEnabled> {
	return get<WidgetsEnabled>('/api/widgets', fetchFn);
}

export function getBoard(fetchFn?: typeof fetch): Promise<{ columns: BoardColumn[] }> {
	return get<{ columns: BoardColumn[] }>('/api/board', fetchFn);
}

export function getStorylines(fetchFn?: typeof fetch): Promise<StorylinesResponse> {
	return get<StorylinesResponse>('/api/storylines', fetchFn);
}

export function getStoryline(id: string, fetchFn?: typeof fetch): Promise<Storyline> {
	return get<Storyline>(`/api/storylines/${id}`, fetchFn);
}

export function getEventTimeline(id: string, hours = 12, fetchFn?: typeof fetch): Promise<EventTimeline> {
	return get<EventTimeline>(`/api/events/${id}/timeline?hours=${hours}`, fetchFn);
}

export function getArticleContext(id: string, fetchFn?: typeof fetch): Promise<ArticleContext> {
	return get<ArticleContext>(`/api/article/${id}/context`, fetchFn);
}
