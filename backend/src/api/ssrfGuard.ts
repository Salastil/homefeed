// Shared private/reserved-IP check used by every proxy route that fetches a
// server-controlled but externally-sourced URL (media/proxy, video-proxy). Guards
// against DNS rebinding, not just a hostname string check — the URL's hostname might
// resolve to a private/loopback/link-local address even if the hostname itself looks
// like an ordinary public domain.

import dns from 'node:dns/promises';

export function isPrivateOrReservedIp(ip: string, family: number): boolean {
	if (family === 4) {
		const [a, b] = ip.split('.').map(Number);
		if (a === 10 || a === 127 || a === 0) return true;
		if (a === 169 && b === 254) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT range
		return false;
	}
	const lower = ip.toLowerCase();
	if (lower === '::1') return true;
	if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
	if (lower.startsWith('fe80')) return true; // link-local
	if (lower.startsWith('::ffff:')) {
		const v4 = lower.split(':').pop();
		if (v4?.includes('.')) return isPrivateOrReservedIp(v4, 4);
	}
	return false;
}

/** Resolves `hostname` and returns true only if every address it resolves to is public. */
export async function isPublicHost(hostname: string): Promise<boolean> {
	let addresses: { address: string; family: number }[];
	try {
		addresses = await dns.lookup(hostname, { all: true });
	} catch {
		return false;
	}
	return !addresses.some((a) => isPrivateOrReservedIp(a.address, a.family));
}
