// Client for the "private categories" cookie login (see backend/src/api/privateAccess.ts).
// Deliberately separate from adminAuth.ts/adminApi.ts: that's a header-based API key for
// the admin SPA only, while this is a plain cookie so an ordinary visitor's browser
// carries it across normal page loads with no localStorage/header plumbing needed.

import { getBackendUrl } from './config';

export interface PrivateAccessStatus {
	authenticated: boolean;
	configured: boolean;
}

export async function getPrivateAccessStatus(fetchFn: typeof fetch = fetch): Promise<PrivateAccessStatus> {
	const res = await fetchFn(`${getBackendUrl()}/api/private-access/status`, { credentials: 'include' });
	if (!res.ok) return { authenticated: false, configured: false };
	return res.json();
}

/** Throws with a user-facing message on failure (wrong password, or the feature isn't configured). */
export async function loginPrivateAccess(password: string): Promise<void> {
	const res = await fetch(`${getBackendUrl()}/api/private-access/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ password })
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.error ?? `Login failed (${res.status})`);
	}
}

export async function logoutPrivateAccess(): Promise<void> {
	await fetch(`${getBackendUrl()}/api/private-access/logout`, { method: 'POST', credentials: 'include' });
}
