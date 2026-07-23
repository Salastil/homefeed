// Backs the "proxy" Nitter media mode (see Retention tab / GlobalSettings.nitterMediaMode):
// the visitor's browser requests media from this route instead of directly from
// Twitter/the Nitter instance's CDN, so only this server's IP is ever exposed to the
// remote host — the media itself is streamed straight through, never written to disk.
//
// Since this route fetches whatever URL it's given, it's a textbook SSRF vector unless
// tightly restricted: only twimg.com (Twitter's media CDN), the configured
// fxtwitterBaseUrl's host, and the hostnames of the admin's own configured Nitter
// sources are allowed — and even an allowed hostname is rejected if it resolves to a
// private/loopback/link-local address (defends against DNS rebinding, not just a
// hostname string check).

import type { FastifyInstance } from 'fastify';
import dns from 'node:dns/promises';
import { Readable } from 'node:stream';
import * as sourcesDb from '../storage/db/sources.js';
import { getSettings } from '../storage/db/settings.js';
import { logger } from '../storage/db/logs.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; HomefeedBot/1.0; self-hosted RSS reader)';
const FETCH_TIMEOUT_MS = 15_000;
const TWITTER_MEDIA_HOST_RE = /(^|\.)twimg\.com$/i;

function hostnameOf(rawUrl: string | null): string | null {
	if (!rawUrl) return null;
	try {
		return new URL(rawUrl).hostname.toLowerCase();
	} catch {
		return null;
	}
}

function isAllowedHost(hostname: string): boolean {
	const lower = hostname.toLowerCase();
	if (TWITTER_MEDIA_HOST_RE.test(lower)) return true;

	const settings = getSettings();
	if (hostnameOf(settings.fxtwitterBaseUrl) === lower) return true;

	const nitterHosts = sourcesDb
		.listSources()
		.filter((s) => s.type === 'nitter')
		.map((s) => hostnameOf(s.url))
		.filter((h): h is string => !!h);
	return nitterHosts.includes(lower);
}

function isPrivateOrReservedIp(ip: string, family: number): boolean {
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

export async function registerMediaProxy(app: FastifyInstance) {
	app.get('/media/proxy', async (req, reply) => {
		const { url } = req.query as { url?: string };
		if (!url) return reply.code(400).send({ error: 'url required' });

		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return reply.code(400).send({ error: 'invalid url' });
		}

		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return reply.code(400).send({ error: 'unsupported scheme' });
		}

		if (!isAllowedHost(parsed.hostname)) {
			logger.warn('media-proxy', `Blocked proxy request to disallowed host: ${parsed.hostname}`);
			return reply.code(403).send({ error: 'host not allowed' });
		}

		let addresses: { address: string; family: number }[];
		try {
			addresses = await dns.lookup(parsed.hostname, { all: true });
		} catch {
			return reply.code(502).send({ error: 'DNS resolution failed' });
		}
		if (addresses.some((a) => isPrivateOrReservedIp(a.address, a.family))) {
			logger.warn('media-proxy', `Blocked proxy request resolving to a private/reserved address: ${parsed.hostname}`);
			return reply.code(403).send({ error: 'host not allowed' });
		}

		try {
			const res = await fetch(parsed.toString(), {
				headers: { 'User-Agent': USER_AGENT },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
			});
			if (!res.ok || !res.body) {
				return reply.code(502).send({ error: `upstream responded ${res.status}` });
			}
			reply.header('content-type', res.headers.get('content-type') ?? 'application/octet-stream');
			reply.header('cache-control', res.headers.get('cache-control') ?? 'public, max-age=3600');
			return reply.send(Readable.fromWeb(res.body as any));
		} catch (err) {
			logger.warn('media-proxy', `Proxy fetch failed for ${parsed.toString()}: ${(err as Error).message}`);
			return reply.code(502).send({ error: 'fetch failed' });
		}
	});
}
