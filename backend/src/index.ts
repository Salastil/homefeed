import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from './storage/db/index.js';
import { ensureAdminUserSeeded } from './storage/db/auth.js';
import { registerAuth } from './api/auth.js';
import { registerPublicRoutes } from './api/public.js';
import { registerAdminRoutes } from './api/admin.js';
import { startScheduler } from './queue/scheduler.js';
import { logger } from './storage/db/logs.js';

const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const MEDIA_DIR = process.env.MEDIA_DIR || './data/media';

async function main() {
	migrate();
	ensureAdminUserSeeded(
		process.env.ADMIN_USERNAME || 'admin',
		process.env.ADMIN_PASSWORD || 'change-me-immediately'
	);

	const app = Fastify({ logger: false });

	// Cross-origin is expected — see project-structure.md "Cross-origin and security
	// implications". Not a wildcard: only the configured frontend origin is allowed.
	await app.register(cors, { origin: FRONTEND_ORIGIN, credentials: true });
	await app.register(cookie);

	await registerAuth(app);
	await registerPublicRoutes(app);
	await registerAdminRoutes(app);

	// Locally hosted media (see storage/media) — served directly rather than via a
	// heavier static-file plugin, since this is a small, flat directory.
	app.get('/media/:filename', async (req, reply) => {
		const { filename } = req.params as { filename: string };
		if (filename.includes('..') || filename.includes('/')) return reply.code(400).send();
		const filePath = path.join(MEDIA_DIR, filename);
		if (!fs.existsSync(filePath)) return reply.code(404).send();
		return reply.send(fs.createReadStream(filePath));
	});

	app.get('/health', async () => ({ ok: true }));

	await app.listen({ port: PORT, host: '0.0.0.0' });
	logger.info('server', `Listening on :${PORT} (frontend origin: ${FRONTEND_ORIGIN})`);

	startScheduler();
}

main().catch((err) => {
	console.error('[server] Fatal startup error:', err);
	process.exit(1);
});
