import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fs from 'node:fs';
import path from 'node:path';
import { registerAuth } from './api/auth.js';
import { registerPublicRoutes } from './api/public.js';
import { registerAdminRoutes } from './api/admin.js';
import { registerMediaProxy } from './api/mediaProxy.js';
import { registerTelegramMediaProxy } from './api/telegramMediaProxy.js';
import { registerPrivateAccess } from './api/privateAccess.js';
import { loadedWidgets } from './widgets/registry.js';
import { logger } from './storage/db/logs.js';

const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const MEDIA_DIR = process.env.MEDIA_DIR || './data/media';
const WIDGETS_INSTALLED_DIR = process.env.WIDGETS_INSTALLED_DIR || './data/widgets-installed';

let currentApp: FastifyInstance | null = null;

async function buildApp(): Promise<FastifyInstance> {
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

	// Each loaded widget (built-in or uploaded — see widgets/registry.ts) registers its
	// own routes here rather than being hardcoded into public.ts/admin.ts. Runs after
	// registerAuth so any /api/admin/* route a widget registers is gated by the same
	// X-Api-Key preHandler automatically.
	for (const plugin of loadedWidgets.values()) {
		plugin.registerPublicRoutes?.(app);
		plugin.registerAdminRoutes?.(app);
	}

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

	// A widget's optional pre-built frontend bundle (see widgets/manifest.ts's
	// frontendEntry) — one generic wildcard route rather than one per widget, so it works
	// for a widget uploaded after this process started, with no restart (unlike a
	// widget's own custom API routes, which need reloadServerRoutes() below to activate).
	// Explicit Content-Type is required here (unlike /media/:filename above) — browsers
	// reject a dynamically-imported module whose response isn't served as a JS MIME
	// type. The wildcard also lets a bundle's own relative imports (e.g. `import
	// './helper.mjs'`) resolve automatically, since the browser requests those against
	// this same route.
	app.get('/widget-assets/:id/*', async (req, reply) => {
		const { id } = req.params as { id: string };
		const rel = (req.params as { '*': string })['*'];
		if (rel.includes('..')) return reply.code(400).send();
		const filePath = path.join(WIDGETS_INSTALLED_DIR, id, rel);
		if (!fs.existsSync(filePath)) return reply.code(404).send();
		if (rel.endsWith('.mjs') || rel.endsWith('.js')) reply.type('text/javascript');
		else if (rel.endsWith('.css')) reply.type('text/css');
		return reply.send(fs.createReadStream(filePath));
	});

	// Static "/media/proxy" and "/media/telegram-proxy" take priority over the
	// "/media/:filename" param route above regardless of registration order
	// (find-my-way, Fastify's router, always prefers a static segment over a parametric
	// one at the same depth).
	await registerMediaProxy(app);
	await registerTelegramMediaProxy(app);

	app.get('/health', async () => ({ ok: true }));

	return app;
}

/**
 * Builds a fresh Fastify instance with every currently loaded widget's routes and swaps
 * it in for the running one — the only way to pick up a route a live-uploaded widget
 * declares, since Fastify refuses to add routes to an already-listening instance (throws
 * "instance is already listening" synchronously). Called once at process startup (with no
 * previous instance to close) and again after any widget install/uninstall that changes
 * the route set (see widgets/install.ts, uninstall.ts).
 *
 * Deliberately reuses everything else already live in this process — the DB connection,
 * the in-memory widget registry, the scheduler's setInterval loops, the Telegram client's
 * session, and the admin API key all stay untouched. Only the HTTP server + its router are
 * rebuilt, which is what makes this meaningfully better than a full process restart: none
 * of that state is lost, and in particular the admin API key (regenerated only on true
 * process start) stays valid, so installing a widget never logs the admin out.
 *
 * Split into two steps rather than one, because of a real deadlock/dropped-response bug
 * hit in testing: the install/delete admin routes that trigger a reload are themselves
 * served BY the live app instance. Awaiting the full swap (which closes that very instance)
 * from inside its own still-executing request handler closed the connection before the
 * response could be flushed — the client saw a bare connection reset, not a 204/201.
 *
 * validateRoutesBuildable() never touches the live server at all (builds on an OS-assigned
 * ephemeral port and closes it again), so it's safe to await synchronously inside a
 * request handler — that's what lets a broken widget's install be rejected/rolled back in
 * the same response. swapLiveServer() is the part that actually closes the current
 * instance; callers that are themselves inside a request handler for the live instance
 * MUST defer this past sending their response (e.g. via setImmediate — see
 * api/admin.ts's widget install/delete routes). Boot-time startup (see index.ts) has no
 * in-flight request to worry about, so it just awaits both in sequence via
 * reloadServerRoutes() below.
 */
export async function validateRoutesBuildable(): Promise<void> {
	const candidate = await buildApp();
	await candidate.listen({ port: 0, host: '127.0.0.1' });
	await candidate.close();
}

export async function swapLiveServer(): Promise<void> {
	const oldApp = currentApp;
	// The new instance binds the same fixed PORT the old one holds, so the old one has to
	// let go of it first — there's a brief window (typically well under a second) where
	// nothing is listening on PORT. Acceptable for a self-hosted single-admin tool where
	// this only fires right after an admin's own widget install/delete action.
	if (oldApp) await oldApp.close();
	const newApp = await buildApp();
	await newApp.listen({ port: PORT, host: '0.0.0.0' });
	currentApp = newApp;

	logger.info(
		'server',
		`Listening on :${PORT} (frontend origin: ${FRONTEND_ORIGIN}) — ${loadedWidgets.size} widget(s) registered`
	);
}

/** Boot-time convenience — validate then swap in one call. Only safe when there's no in-flight request being served by the instance being replaced (i.e. process startup). */
export async function reloadServerRoutes(): Promise<void> {
	await validateRoutesBuildable();
	await swapLiveServer();
}
