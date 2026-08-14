// Backs regular-article video (an RSS <enclosure>, e.g. a direct .mp4 from a source's
// own CDN) — the visitor's browser requests the video from this route instead of
// hotlinking the source's CDN directly, so only this server's IP is exposed to it, the
// same anonymity goal as the "proxy" Nitter/Telegram media modes but with no mode
// toggle (always on) since there's no self-hosting option for video yet.
//
// Unlike media/proxy.ts, the client never supplies the upstream URL — only an
// already-published articleId, whose video.url this server itself stored during
// ingestion. That's what keeps this safe from being an open SSRF proxy despite having
// no hostname allowlist: the only URLs ever fetched are ones our own ingestion already
// wrote to the DB, not anything a request can point at directly. The private/reserved-IP
// check still applies as defense in depth — a malicious source's RSS feed could still
// have put an internal URL in that field in the first place.

import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import * as articlesDb from '../storage/db/articles.js';
import { logger } from '../storage/db/logs.js';
import { isPublicHost } from './ssrfGuard.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; HomefeedBot/1.0; self-hosted RSS reader)';
const FETCH_TIMEOUT_MS = 20_000;

export async function registerVideoProxy(app: FastifyInstance) {
	app.get('/media/video-proxy', async (req, reply) => {
		const { articleId } = req.query as { articleId?: string };
		if (!articleId) return reply.code(400).send({ error: 'articleId required' });

		const videoUrl = articlesDb.getArticle(articleId)?.video?.url;
		if (!videoUrl) return reply.code(404).send();

		let parsed: URL;
		try {
			parsed = new URL(videoUrl);
		} catch {
			return reply.code(502).send();
		}
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return reply.code(502).send();
		}

		if (!(await isPublicHost(parsed.hostname))) {
			logger.warn('video-proxy', `Blocked proxy request resolving to a private/reserved/unresolvable address: ${parsed.hostname}`);
			return reply.code(502).send();
		}

		try {
			// Forwarded so the browser can seek/scrub — without passing through Range
			// requests and the upstream's 206/Content-Range response, the player would
			// only ever be able to buffer and play from the very start.
			const range = req.headers.range;
			const res = await fetch(parsed.toString(), {
				headers: { 'User-Agent': USER_AGENT, ...(range ? { Range: range } : {}) },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
			});
			if (!res.ok || !res.body) {
				return reply.code(502).send({ error: `upstream responded ${res.status}` });
			}
			reply.code(res.status);
			reply.header('content-type', res.headers.get('content-type') ?? 'video/mp4');
			reply.header('accept-ranges', res.headers.get('accept-ranges') ?? 'bytes');
			const contentRange = res.headers.get('content-range');
			if (contentRange) reply.header('content-range', contentRange);
			const contentLength = res.headers.get('content-length');
			if (contentLength) reply.header('content-length', contentLength);
			reply.header('cache-control', res.headers.get('cache-control') ?? 'public, max-age=3600');
			return reply.send(Readable.fromWeb(res.body as any));
		} catch (err) {
			logger.warn('video-proxy', `Proxy fetch failed for ${parsed.toString()}: ${(err as Error).message}`);
			return reply.code(502).send({ error: 'fetch failed' });
		}
	});
}
