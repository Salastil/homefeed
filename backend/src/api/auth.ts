import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { ADMIN_API_KEY } from './apiKey.js';

function isValidKey(provided: string | undefined): boolean {
	if (!provided) return false;
	// Buffers of mismatched length would make timingSafeEqual throw rather than
	// return false — checking length first keeps this a normal "wrong key" case for
	// any header of a different length rather than a runtime error.
	const providedBuf = Buffer.from(provided);
	const expectedBuf = Buffer.from(ADMIN_API_KEY);
	if (providedBuf.length !== expectedBuf.length) return false;
	return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Guards every /api/admin/* route with the process's current API key (see
 * api/apiKey.ts) — there's no session or login endpoint anymore: the key itself is
 * the credential, checked on every single request, exactly the way a bot or curl
 * script hitting these routes unauthenticated is meant to be stopped cold.
 */
export async function registerAuth(app: FastifyInstance) {
	app.addHook('preHandler', async (req, reply) => {
		if (!req.url.startsWith('/api/admin/')) return;

		const header = req.headers['x-api-key'];
		const provided = Array.isArray(header) ? header[0] : header;
		if (!isValidKey(provided)) {
			return reply.code(401).send({ error: 'unauthorized' });
		}
	});
}
