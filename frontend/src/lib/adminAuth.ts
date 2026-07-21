// The admin API key isn't a backend-issued session — it lives entirely in this
// browser's localStorage, attached as an X-Api-Key header on every /api/admin/*
// request (see adminApi.ts). There's nothing to invalidate server-side on "logout";
// clearing it here is the whole operation.

const STORAGE_KEY = 'homefeed:adminApiKey';

export function getApiKey(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(STORAGE_KEY);
}

export function setApiKey(key: string) {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(STORAGE_KEY, key);
	}
}

export function clearApiKey() {
	if (typeof localStorage !== 'undefined') {
		localStorage.removeItem(STORAGE_KEY);
	}
}
