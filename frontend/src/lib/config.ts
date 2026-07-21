// The frontend->backend address is deliberately NOT a backend-stored setting
// (see project-structure.md "Frontend → backend address"). It's read here from:
//   1. a deploy-time env var (VITE_BACKEND_URL), or
//   2. a value saved in the browser via the connection setup screen, or
//   3. a localhost fallback for local dev against the mock backend.

const STORAGE_KEY = 'homefeed:backendUrl';
const DEFAULT_URL = 'http://localhost:4000';

export function getBackendUrl(): string {
	if (typeof localStorage !== 'undefined') {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) return stored;
	}
	return import.meta.env.VITE_BACKEND_URL || DEFAULT_URL;
}

export function setBackendUrl(url: string) {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(STORAGE_KEY, url);
	}
}

/**
 * Media served by the backend (see storage/media in the backend) comes back as a
 * relative path like "/media/abc.jpg" — deliberately, since the backend doesn't need
 * to know its own externally-reachable URL. The frontend does know it (this is exactly
 * what getBackendUrl() is for), so relative media paths get resolved against it here.
 * Anything already absolute (e.g. a hotlinked fallback URL) passes through unchanged.
 */
export function resolveMediaUrl(url: string): string {
	if (/^https?:\/\//i.test(url)) return url;
	return `${getBackendUrl()}${url}`;
}
