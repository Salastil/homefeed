import { getBackendUrl } from './config';
import type { MergedArticle, Tag, TrackedEventPublic } from './types';

async function get<T>(path: string, fetchFn: typeof fetch = fetch): Promise<T> {
	const res = await fetchFn(`${getBackendUrl()}${path}`);
	if (!res.ok) throw new Error(`Request failed: ${path} (${res.status})`);
	return res.json();
}

export function getFeed(
	params: { category?: string; geo?: string; eventId?: string; tag?: string } = {},
	fetchFn?: typeof fetch
): Promise<MergedArticle[]> {
	const qs = new URLSearchParams(params as Record<string, string>).toString();
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
