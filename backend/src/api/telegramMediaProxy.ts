// Backs the "proxy" Telegram media mode (see Retention tab / GlobalSettings.telegramMediaMode).
// Unlike media/proxy.ts (which forwards a plain HTTP request to an already-public CDN
// URL), Telegram media has no public URL at all — every request here re-authenticates
// to Telegram via the logged-in account (telegram/client.ts) and streams the result, so
// nothing is written to disk and only this server ever touches Telegram's servers. A
// small time-boxed in-memory cache absorbs repeat views of the same message/avatar
// without hitting Telegram (and its rate limits) on every single page load.

import type { FastifyInstance } from 'fastify';
import { downloadMessageMedia, downloadChannelAvatar } from '../telegram/client.js';
import { logger } from '../storage/db/logs.js';

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;

interface CacheEntry {
	buffer: Buffer;
	contentType: string;
	expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | null {
	const entry = cache.get(key);
	if (!entry) return null;
	if (entry.expiresAt < Date.now()) {
		cache.delete(key);
		return null;
	}
	return entry;
}

function cacheSet(key: string, entry: CacheEntry) {
	if (cache.size >= CACHE_MAX_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(key, entry);
}

function contentTypeFor(type: string | undefined): string {
	if (type === 'video' || type === 'gif') return 'video/mp4';
	return 'image/jpeg';
}

export async function registerTelegramMediaProxy(app: FastifyInstance) {
	app.get('/media/telegram-proxy', async (req, reply) => {
		const { channel, message, avatar, type } = req.query as {
			channel?: string;
			message?: string;
			avatar?: string;
			type?: string;
		};
		if (!channel) return reply.code(400).send({ error: 'channel required' });
		if (!avatar && !message) return reply.code(400).send({ error: 'message or avatar required' });

		const cacheKey = avatar ? `avatar:${channel}` : `message:${channel}:${message}`;
		const cached = cacheGet(cacheKey);
		if (cached) {
			reply.header('content-type', cached.contentType);
			reply.header('cache-control', 'private, max-age=300');
			return reply.send(cached.buffer);
		}

		try {
			const buffer = avatar ? await downloadChannelAvatar(channel) : await downloadMessageMedia(channel, message!);
			if (!buffer) return reply.code(404).send();

			const contentType = contentTypeFor(type);
			cacheSet(cacheKey, { buffer, contentType, expiresAt: Date.now() + CACHE_TTL_MS });

			reply.header('content-type', contentType);
			reply.header('cache-control', 'private, max-age=300');
			return reply.send(buffer);
		} catch (err) {
			logger.error('telegram', `Proxy fetch failed for channel=${channel} message=${message ?? 'avatar'}: ${(err as Error).message}`);
			return reply.code(502).send();
		}
	});
}
