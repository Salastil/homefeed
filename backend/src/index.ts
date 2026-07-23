import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from './storage/db/index.js';
import { ADMIN_API_KEY } from './api/apiKey.js';
import { registerAuth } from './api/auth.js';
import { registerPublicRoutes } from './api/public.js';
import { registerAdminRoutes } from './api/admin.js';
import { registerMediaProxy } from './api/mediaProxy.js';
import { registerTelegramMediaProxy } from './api/telegramMediaProxy.js';
import { registerPrivateAccess, privateAccessConfigured } from './api/privateAccess.js';
import { startScheduler } from './queue/scheduler.js';
import { initFromSavedSession } from './telegram/client.js';
import { logger } from './storage/db/logs.js';

const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const MEDIA_DIR = process.env.MEDIA_DIR || './data/media';

function printApiKeyBanner() {
	const line = '='.repeat(64);
	// Deliberately console.log, not the DB-backed logger — the Logs tab in the admin
	// panel is itself behind this key, so printing there would be unreachable until
	// you already have the key. This is the one and only place it's ever surfaced.
	console.log(`\n${line}`);
	console.log('  Homefeed admin API key (required for every /api/admin/* request)');
	console.log(`  ${ADMIN_API_KEY}`);
	console.log('  This key is generated fresh on every restart — it will not be the same next time.');
	console.log(`${line}\n`);
}

async function main() {
	migrate();
	printApiKeyBanner();
	await initFromSavedSession();

	const app = Fastify({ logger: false });

	// Cross-origin is expected — see project-structure.md "Cross-origin and security
	// implications". Not a wildcard: only the configured frontend origin is allowed.
	// @fastify/cors defaults to GET/HEAD/POST only — without an explicit methods list,
	// every PATCH (settings saves) and DELETE (removing sources/events) gets silently
	// blocked by the browser at the CORS preflight stage, before the request ever
	// reaches a route handler.
	// credentials: true is required for the browser to send/accept the private-category
	// login cookie cross-origin — safe only because origin is a specific value above,
	// never a wildcard (the two are mutually exclusive per the CORS spec anyway).
	await app.register(cors, {
		origin: FRONTEND_ORIGIN,
		credentials: true,
		methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS']
	});

	await app.register(cookie);

	// Overrides Fastify's default JSON body parser, which throws "Body cannot be empty
	// when content-type is set to 'application/json'" for any bodyless request (DELETE,
	// or POST with no payload) that still carries a Content-Type header — exactly what
	// browsers' fetch() does when a client sets that header unconditionally. An empty
	// body is just as valid as `{}` for routes that don't read req.body at all.
	app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
		if (typeof body !== 'string' || body.trim() === '') return done(null, {});
		try {
			done(null, JSON.parse(body));
		} catch (err) {
			done(err as Error, undefined);
		}
	});

	await registerAuth(app);
	await registerPublicRoutes(app);
	await registerAdminRoutes(app);
	await registerPrivateAccess(app);

	// Fastify's own logger is off (see below) — without this, an unhandled exception
	// in any route handler produces a bare 500 with zero trace anywhere, including the
	// admin panel's own Logs tab. This is what "Save failed" with no log entry was.
	app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
		logger.error('server', `${req.method} ${req.url} failed: ${err.message}`);
		reply.code(err.statusCode ?? 500).send({ error: err.message });
	});

	// Locally hosted media (see storage/media) — served directly rather than via a
	// heavier static-file plugin, since this is a small, flat directory.
	app.get('/media/:filename', async (req, reply) => {
		const { filename } = req.params as { filename: string };
		if (filename.includes('..') || filename.includes('/')) return reply.code(400).send();
		const filePath = path.join(MEDIA_DIR, filename);
		if (!fs.existsSync(filePath)) return reply.code(404).send();
		return reply.send(fs.createReadStream(filePath));
	});

	// Static "/media/proxy" and "/media/telegram-proxy" take priority over the
	// "/media/:filename" param route above regardless of registration order
	// (find-my-way, Fastify's router, always prefers a static segment over a parametric
	// one at the same depth).
	await registerMediaProxy(app);
	await registerTelegramMediaProxy(app);

	app.get('/health', async () => ({ ok: true }));

	await app.listen({ port: PORT, host: '0.0.0.0' });
	logger.info('server', `Listening on :${PORT} (frontend origin: ${FRONTEND_ORIGIN})`);
	if (!privateAccessConfigured()) {
		logger.info('server', 'Private categories disabled — set PRIVATE_ACCESS_PASSWORD to enable');
	}

	startScheduler();
}

main().catch((err) => {
	console.error('[server] Fatal startup error:', err);
	process.exit(1);
});
