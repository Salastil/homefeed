import { getBackendUrl } from './config';
import type {
	AdminSettings,
	AdminSource,
	AdminTrackedEvent,
	ModelCatalog,
	AiStatus,
	LogEntry
} from './adminTypes';

async function request<T>(path: string, options: RequestInit = {}, fetchFn: typeof fetch = fetch): Promise<T> {
	const res = await fetchFn(`${getBackendUrl()}${path}`, {
		...options,
		credentials: 'include',
		headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
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

// Auth
export async function login(username: string, password: string, fetchFn: typeof fetch = fetch): Promise<void> {
	const res = await fetchFn(`${getBackendUrl()}/api/admin/login`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password })
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.error || `Login failed (${res.status})`);
	}
}

export async function logout(fetchFn: typeof fetch = fetch): Promise<void> {
	await fetchFn(`${getBackendUrl()}/api/admin/logout`, { method: 'POST', credentials: 'include' });
}

// Settings
export const getSettings = (fetchFn?: typeof fetch) =>
	request<AdminSettings>('/api/admin/settings', {}, fetchFn);

export const updateSettings = (patch: Partial<AdminSettings>, fetchFn?: typeof fetch) =>
	request<AdminSettings>('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) }, fetchFn);

// Categories
export const createCategory = (name: string, fetchFn?: typeof fetch) =>
	request<{ id: string; name: string; priorityRank: number; isDefault: boolean }>(
		'/api/admin/categories',
		{ method: 'POST', body: JSON.stringify({ name }) },
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
