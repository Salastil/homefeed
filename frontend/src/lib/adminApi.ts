import { getBackendUrl } from './config';
import { getApiKey, setApiKey, clearApiKey } from './adminAuth';
import type {
	AdminSettings,
	AdminSource,
	AdminTrackedEvent,
	ModelCatalog,
	AiStatus,
	LogEntry
} from './adminTypes';

async function request<T>(path: string, options: RequestInit = {}, fetchFn: typeof fetch = fetch): Promise<T> {
	// Fastify's default JSON body parser rejects an empty body when Content-Type is
	// application/json ("Body cannot be empty when content-type is set to
	// 'application/json'") — so this header is only attached when there's actually a
	// body to send (PATCH/POST with a JSON payload), never for bodyless DELETE/POST calls.
	const headers: Record<string, string> = { ...(options.headers as Record<string, string> | undefined) };
	if (options.body) headers['Content-Type'] = 'application/json';
	const apiKey = getApiKey();
	if (apiKey) headers['X-Api-Key'] = apiKey;

	const res = await fetchFn(`${getBackendUrl()}${path}`, {
		...options,
		headers
	});
	if (res.status === 401) {
		const err = new Error('unauthorized') as Error & { status?: number };
		err.status = 401;
		throw err;
	}
	if (!res.ok) throw new Error(`Admin request failed: ${path} (${res.status})`);
	if (res.status === 204) return undefined as T;
	return res.json();
}

// Auth — there's no backend session to create; "logging in" means storing the
// entered key locally and confirming it actually works with one real authenticated
// call (getSettings has no side effects), and "logging out" is just discarding it.
export async function login(apiKey: string, fetchFn: typeof fetch = fetch): Promise<void> {
	setApiKey(apiKey);
	try {
		await getSettings(fetchFn);
	} catch (err) {
		clearApiKey();
		if ((err as { status?: number }).status === 401) throw new Error('Invalid API key');
		throw err;
	}
}

export async function logout(): Promise<void> {
	clearApiKey();
}

// Settings
export const getSettings = (fetchFn?: typeof fetch) =>
	request<AdminSettings>('/api/admin/settings', {}, fetchFn);

export const updateSettings = (patch: Partial<AdminSettings>, fetchFn?: typeof fetch) =>
	request<AdminSettings>('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) }, fetchFn);

// Categories
export const createCategory = (name: string, isPrivate = false, fetchFn?: typeof fetch) =>
	request<{ id: string; name: string; priorityRank: number; isDefault: boolean; isPrivate: boolean }>(
		'/api/admin/categories',
		{ method: 'POST', body: JSON.stringify({ name, isPrivate }) },
		fetchFn
	);

export const deleteCategory = (id: string, fetchFn?: typeof fetch) =>
	request<void>(`/api/admin/categories/${id}`, { method: 'DELETE' }, fetchFn);

// Sources
export const getSources = (fetchFn?: typeof fetch) =>
	request<AdminSource[]>('/api/admin/sources', {}, fetchFn);

export const addSource = (source: Partial<AdminSource>, fetchFn?: typeof fetch) =>
	request<AdminSource>('/api/admin/sources', { method: 'POST', body: JSON.stringify(source) }, fetchFn);

export const updateSource = (id: string, patch: Partial<AdminSource>, fetchFn?: typeof fetch) =>
	request<AdminSource>(`/api/admin/sources/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }, fetchFn);

export const deleteSource = (id: string, fetchFn?: typeof fetch) =>
	request<void>(`/api/admin/sources/${id}`, { method: 'DELETE' }, fetchFn);

export const pollSourceNow = (id: string, fetchFn?: typeof fetch) =>
	request<{ ingested: number; source: AdminSource }>(`/api/admin/sources/${id}/poll`, { method: 'POST' }, fetchFn);

// Content clearing — wipe articles/media/a source's raw items so they can be repopulated fresh.
export const clearSourceContent = (id: string, fetchFn?: typeof fetch) =>
	request<{ itemsDeleted: number; articlesDeleted: number }>(`/api/admin/content/sources/${id}`, { method: 'DELETE' }, fetchFn);

export const clearAllArticles = (fetchFn?: typeof fetch) =>
	request<{ deleted: number }>('/api/admin/content/articles', { method: 'DELETE' }, fetchFn);

export const clearAllMedia = (fetchFn?: typeof fetch) =>
	request<{ deleted: number }>('/api/admin/content/media', { method: 'DELETE' }, fetchFn);

// Tracked events
export const getEvents = (fetchFn?: typeof fetch) =>
	request<AdminTrackedEvent[]>('/api/admin/events', {}, fetchFn);

export const addEvent = (event: Partial<AdminTrackedEvent>, fetchFn?: typeof fetch) =>
	request<AdminTrackedEvent>('/api/admin/events', { method: 'POST', body: JSON.stringify(event) }, fetchFn);

export const updateEvent = (id: string, patch: Partial<AdminTrackedEvent>, fetchFn?: typeof fetch) =>
	request<AdminTrackedEvent>(`/api/admin/events/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }, fetchFn);

export const deleteEvent = (id: string, fetchFn?: typeof fetch) =>
	request<void>(`/api/admin/events/${id}`, { method: 'DELETE' }, fetchFn);

// Models / AI service
export const getModels = (fetchFn?: typeof fetch) =>
	request<ModelCatalog>('/api/admin/models', {}, fetchFn);

export const getAiStatus = (fetchFn?: typeof fetch) =>
	request<AiStatus>('/api/admin/ai-status', {}, fetchFn);

// Logs
export const getLogs = (filters: { level?: 'info' | 'warn' | 'error'; limit?: number } = {}, fetchFn?: typeof fetch) => {
	const qs = new URLSearchParams(filters as Record<string, string>).toString();
	return request<LogEntry[]>(`/api/admin/logs${qs ? `?${qs}` : ''}`, {}, fetchFn);
};
