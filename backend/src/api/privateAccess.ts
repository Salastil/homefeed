// Gates "private" categories (see storage/db/categories.ts's is_private column) behind a
// single shared password configured in the backend's own .env — deliberately separate
// from the admin API key (that's a header-based credential for the admin SPA only; this
// is a cookie so a plain visitor's browser can carry it across ordinary page loads).
//
// There's no per-visitor session store: the cookie's value is a deterministic hash of the
// configured password, so any request can be checked statelessly by recomputing that same
// hash and comparing — same "no session table" philosophy as the admin API key.

import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { logger } from '../storage/db/logs.js';

const PRIVATE_ACCESS_PASSWORD = process.env.PRIVATE_ACCESS_PASSWORD || '';
export const PRIVATE_ACCESS_COOKIE = 'hf_private';
// Browsers cap persistent cookies at ~400 days regardless of what's requested (Chrome,
// Firefox, Safari all enforce this) — asking for 10 years just means "the maximum they'll
// actually allow," which is as close to "retained indefinitely" as a cookie can get.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10;

function expectedToken(): string {
	return crypto.createHash('sha256').update(PRIVATE_ACCESS_PASSWORD).digest('hex');
}

/** Feature is off entirely (no visitor can ever unlock private categories) until a password is configured. */
export function privateAccessConfigured(): boolean {
	return PRIVATE_ACCESS_PASSWORD.length > 0;
}

export function hasPrivateAccess(req: { cookies?: Record<string, string | undefined> }): boolean {
	if (!privateAccessConfigured()) return false;
	const token = req.cookies?.[PRIVATE_ACCESS_COOKIE];
	if (!token) return false;
	const expected = expectedToken();
	// Buffers must be equal length for timingSafeEqual — a mismatched length (e.g. a
	// tampered/truncated cookie) would throw rather than just failing the comparison.
	if (token.length !== expected.length) return false;
	try {
		return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
	} catch {
		return false;
	}
}

export async function registerPrivateAccess(app: FastifyInstance) {
	app.post('/api/private-access/login', async (req, reply) => {
		if (!privateAccessConfigured()) {
			return reply.code(503).send({ error: 'Private categories are not configured on this server' });
		}
		const { password } = req.body as { password?: string };
		const attempt = Buffer.from(password ?? '');
		const expected = Buffer.from(PRIVATE_ACCESS_PASSWORD);
		const valid = attempt.length === expected.length && crypto.timingSafeEqual(attempt, expected);
		if (!valid) {
			logger.warn('private-access', 'Rejected private-category login attempt with wrong password');
			return reply.code(401).send({ error: 'Incorrect password' });
		}
		reply.setCookie(PRIVATE_ACCESS_COOKIE, expectedToken(), {
			httpOnly: true,
			sameSite: 'lax',
			path: '/',
			maxAge: COOKIE_MAX_AGE_SECONDS
		});
		return { ok: true };
	});

	app.post('/api/private-access/logout', async (_req, reply) => {
		reply.clearCookie(PRIVATE_ACCESS_COOKIE, { path: '/' });
		return { ok: true };
	});

	app.get('/api/private-access/status', async (req) => {
		return { authenticated: hasPrivateAccess(req as any), configured: privateAccessConfigured() };
	});
}
