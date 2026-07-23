import { getBackendUrl } from './config';
import type { MergedArticle, Tag, TrackedEventPublic, Category } from './types';

async function get<T>(path: string, fetchFn: typeof fetch = fetch): Promise<T> {
	// credentials: 'include' so the private-access cookie (see lib/privateAccess.ts)
	// is sent cross-origin to the backend, revealing private categories/articles to
	// anyone who's logged in — without it every request would look unauthenticated.
	const res = await fetchFn(`${getBackendUrl()}${path}`, { credentials: 'include' });
	if (!res.ok) throw new Error(`Request failed: ${path} (${res.status})`);
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

export function getEvents(fetchFn?: typeof fetch): Promise<TrackedEventPublic[]> {
	return get<TrackedEventPublic[]>('/api/events', fetchFn);
}

export function getCategories(fetchFn?: typeof fetch): Promise<Category[]> {
	return get<Category[]>('/api/categories', fetchFn);
}
