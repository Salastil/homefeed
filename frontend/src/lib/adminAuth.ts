// The admin API key isn't a backend-issued session — it lives entirely in this
// browser's localStorage, attached as an X-Api-Key header on every /api/admin/*
// request (see adminApi.ts). There's nothing to invalidate server-side on "logout";
// clearing it here is the whole operation.

const STORAGE_KEY = 'homefeed:adminApiKey';

// localStorage access can throw even when the API exists — a full quota, a browser's
// strict privacy/storage-partitioning mode, or just corrupted site data (seen for real:
// a stuck "Signing in…" button that turned out to be exactly this, fixed by clearing
// Firefox's site data for the domain). Read/clear fail quietly to "not logged in" since
// that's a safe default either way; save surfaces a real, catchable error instead of
// throwing raw storage internals at whatever called it, so the login form can show it
// instead of leaving the submit button stuck forever.

export function getApiKey(): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

export function setApiKey(key: string) {
	if (typeof localStorage === 'undefined') {
		throw new Error("This browser has no storage available, so the admin key can't be saved.");
	}
	try {
		localStorage.setItem(STORAGE_KEY, key);
	} catch {
		throw new Error('Could not save the admin key in this browser (storage may be full or blocked). Try clearing site data for this domain and signing in again.');
	}
}

export function clearApiKey() {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Best-effort — nothing more to do if storage itself is inaccessible.
	}
}
