import type { FastifyInstance } from 'fastify';
import * as settingsDb from '../storage/db/settings.js';
import * as sourcesDb from '../storage/db/sources.js';
import * as eventsDb from '../storage/db/events.js';
import * as categoriesDb from '../storage/db/categories.js';
import * as installedWidgetsDb from '../storage/db/installedWidgets.js';
import { clearSourceContent, reissueSourceContent, clearAllArticles, clearAllMedia } from '../storage/contentCascade.js';
import { totalStorageBytes } from '../storage/media/index.js';
import { OllamaProvider } from '../inference/ollama-provider.js';
import { pollSourceNow } from '../ingestion/poller.js';
import { logger, listLogs } from '../storage/db/logs.js';
import * as telegramClient from '../telegram/client.js';
import { loadedWidgets } from '../widgets/registry.js';
import { installUploadedWidget } from '../widgets/install.js';
import { uninstallWidget } from '../widgets/uninstall.js';
import { swapLiveServer } from '../server.js';
import type { GlobalSettings } from '../storage/db/types.js';

// Rebuilds and swaps in the live Fastify instance to pick up a widget's newly
// (de)registered routes — MUST run after the triggering request has already sent its
// response, never awaited inline in that handler, since the swap closes the very
// instance serving it (see widgets/install.ts's and uninstall.ts's doc comments for
// why — this dropped the response entirely when tried inline during testing).
function scheduleServerSwap(context: string) {
	setImmediate(() => {
		swapLiveServer().catch((err) => logger.error('server', `Route swap after ${context} failed: ${(err as Error).message}`));
	});
}

// Not part of GlobalSettings itself (nothing to persist) — computed fresh on every
// settings read/write so the Retention tab's "currently using" line and usage bar
// always reflect the real total, not whatever was true when the row was last saved.
function withStorageUsed(settings: ReturnType<typeof settingsDb.getSettings>) {
	return { ...settings, retention: { ...settings.retention, storageUsedMB: Math.round(totalStorageBytes() / (1024 * 1024)) } };
}

export async function registerAdminRoutes(app: FastifyInstance) {
	// --- Settings ---
	app.get('/api/admin/settings', async () => {
		const settings = withStorageUsed(settingsDb.getSettings());
		return { ...settings, categoryPriority: categoriesDb.listCategories() };
	});

	app.patch('/api/admin/settings', async (req) => {
		const body = req.body as any;
		if (body.categoryPriority) {
			categoriesDb.setCategoryOrder(body.categoryPriority);
			delete body.categoryPriority;
		}
		const before = settingsDb.getSettings();
		const settings = withStorageUsed(settingsDb.updateSettings(body));
		if (body.widgets) {
			// Re-enabling a widget (see the Widgets tab) should show fresh data right away
			// instead of waiting out its normal cadence — scheduler.ts skips polling
			// entirely while a widget is disabled, so there's nothing recent to fall back
			// on otherwise. Generic over every loaded widget with a poll hook, rather than
			// one hardcoded branch per widget.
			for (const id of Object.keys(body.widgets) as (keyof GlobalSettings['widgets'])[]) {
				if (body.widgets[id] && !before.widgets[id]) {
					loadedWidgets
						.get(id)
						?.poll?.run()
						.catch((err) => logger.error(id, `Immediate poll failed: ${err.message}`));
				}
			}
		}
		return { ...settings, categoryPriority: categoriesDb.listCategories() };
	});

	// --- Categories (add/remove — reordering/privacy is via PATCH /settings above) ---
	app.post('/api/admin/categories', async (req, reply) => {
		const { name, isPrivate, isSpillover, disableAi } = req.body as {
			name?: string;
			isPrivate?: boolean;
			isSpillover?: boolean;
			disableAi?: boolean;
		};
		if (!name || !name.trim()) return reply.code(400).send({ error: 'name required' });
		const created = categoriesDb.createCategory(name.trim(), !!isPrivate, !!isSpillover, !!disableAi);
		return reply.code(201).send(created);
	});

	app.delete('/api/admin/categories/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		categoriesDb.deleteCategory(id);
		return reply.code(204).send();
	});

	// --- Sources ---
	app.get('/api/admin/sources', async () => sourcesDb.listSources());

	app.post('/api/admin/sources', async (req, reply) => {
		const created = sourcesDb.createSource(req.body as any);
		// Poll immediately rather than waiting for the next scheduler tick (up to 1 minute)
		// — the admin adding a feed expects to see it start working right away.
		pollSourceNow(created).catch((err) => logger.error('poller', `Immediate poll failed for "${created.name}": ${err.message}`));
		return reply.code(201).send(created);
	});

	app.patch('/api/admin/sources/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		const updated = sourcesDb.updateSource(id, req.body as any);
		if (!updated) return reply.code(404).send({ error: 'not found' });
		return updated;
	});

	app.delete('/api/admin/sources/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		// Deleting a source deletes its raw content and any article composed entirely
		// from it too — otherwise stale articles from a source the admin just removed
		// keep showing up on the site pointing at nothing.
		clearSourceContent(id);
		sourcesDb.deleteSource(id);
		return reply.code(204).send();
	});

	// --- Content clearing (re-populate a source, or the whole site, from scratch) ---
	app.delete('/api/admin/content/sources/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		const result = clearSourceContent(id);
		return reply.code(200).send(result);
	});

	app.delete('/api/admin/content/articles', async (_req, reply) => {
		const deleted = clearAllArticles();
		return reply.code(200).send({ deleted });
	});

	app.delete('/api/admin/content/media', async (_req, reply) => {
		const deleted = clearAllMedia();
		return reply.code(200).send({ deleted });
	});

	// Manual "poll now" — the refresh icon on each source in the admin panel.
	app.post('/api/admin/sources/:id/poll', async (req, reply) => {
		const { id } = req.params as { id: string };
		const source = sourcesDb.getSource(id);
		if (!source) return reply.code(404).send({ error: 'not found' });

		const ingested = await pollSourceNow(source);
		logger.info('poller', `Manual poll of "${source.name}" — ${ingested} new item(s)`);
		return { ingested, source: sourcesDb.getSource(id) };
	});

	// Deletes this source's already-published articles and requeues their raw items for
	// re-publish (see contentCascade.reissueSourceContent) — for picking up pipeline
	// changes (e.g. a new tweet card layout) without waiting on the feed to resurface
	// the same items again.
	app.post('/api/admin/sources/:id/reissue', async (req, reply) => {
		const { id } = req.params as { id: string };
		const source = sourcesDb.getSource(id);
		if (!source) return reply.code(404).send({ error: 'not found' });
		return reissueSourceContent(id);
	});

	// --- Tracked events ---
	app.get('/api/admin/events', async () => eventsDb.listEvents());

	app.post('/api/admin/events', async (req, reply) => {
		const created = eventsDb.createEvent(req.body as any);
		return reply.code(201).send(created);
	});

	app.patch('/api/admin/events/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		const updated = eventsDb.updateEvent(id, req.body as any);
		if (!updated) return reply.code(404).send({ error: 'not found' });
		return updated;
	});

	app.delete('/api/admin/events/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		eventsDb.deleteEvent(id);
		return reply.code(204).send();
	});

	// --- Models / AI service (fetched live from the configured Ollama host) ---
	app.get('/api/admin/models', async (_req, reply) => {
		const settings = settingsDb.getSettings();
		const provider = new OllamaProvider(settings.aiServiceHost, settings.aiServicePort);
		try {
			const models = await provider.listModels();
			// Ollama doesn't distinguish task type, so the catalog surfaces the full list
			// for each dropdown — the admin picks which installed model to use for what.
			return { embedding: models, image: models, synthesis: models };
		} catch (err) {
			return reply.code(502).send({ error: `AI service unreachable: ${(err as Error).message}` });
		}
	});

	app.get('/api/admin/ai-status', async () => {
		const settings = settingsDb.getSettings();
		const provider = new OllamaProvider(settings.aiServiceHost, settings.aiServicePort);
		const connected = await provider.isReachable();
		return { connected, host: settings.aiServiceHost, port: settings.aiServicePort, ramGB: null, gpu: null };
	});

	// --- Telegram account (Connections tab — see telegram/client.ts and credentials.ts.
	// API ID/hash and the resulting login session are stored encrypted at rest; none of
	// these routes ever echo them back to the client.) ---
	app.get('/api/admin/telegram/status', async () => telegramClient.getStatus());

	app.post('/api/admin/telegram/credentials', async (req, reply) => {
		const { apiId, apiHash } = req.body as { apiId?: number; apiHash?: string };
		if (!apiId || !apiHash) return reply.code(400).send({ error: 'apiId and apiHash are required' });
		telegramClient.saveApiCredentials(apiId, apiHash);
		return { credentialsConfigured: true };
	});

	app.post('/api/admin/telegram/login/start', async (req, reply) => {
		const { phoneNumber } = req.body as { phoneNumber?: string };
		if (!phoneNumber) return reply.code(400).send({ error: 'phoneNumber is required' });
		try {
			await telegramClient.startLogin(phoneNumber);
			return { phase: 'code-sent' };
		} catch (err) {
			return reply.code(400).send({ error: (err as Error).message });
		}
	});

	app.post('/api/admin/telegram/login/verify', async (req, reply) => {
		const { code, password } = req.body as { code?: string; password?: string };
		try {
			if (password !== undefined) {
				await telegramClient.verifyPassword(password);
				return { phase: 'connected', ...telegramClient.getStatus() };
			}
			if (code !== undefined) {
				const phase = await telegramClient.verifyCode(code);
				return phase === 'connected' ? { phase, ...telegramClient.getStatus() } : { phase };
			}
			return reply.code(400).send({ error: 'code or password is required' });
		} catch (err) {
			return reply.code(400).send({ error: (err as Error).message });
		}
	});

	app.post('/api/admin/telegram/logout', async (_req, reply) => {
		await telegramClient.logout();
		return reply.code(200).send(telegramClient.getStatus());
	});

	// Per-widget routes (weather geocode, stocks CRUD, bookmarks CRUD, poe2 browse/
	// watchlist) are registered by each widget's own plugin — see widgets/registry.ts's
	// generic registerAdminRoutes loop in index.ts. What's left here is the
	// upload/delete lifecycle for pluggable widgets themselves.

	// --- Pluggable widgets (upload/list/delete — see widgets/install.ts, uninstall.ts) ---
	app.get('/api/admin/widgets', async () => installedWidgetsDb.listInstalled());

	app.post('/api/admin/widgets', async (req, reply) => {
		const { manifest, files } = req.body as { manifest?: unknown; files?: unknown };
		const result = await installUploadedWidget(manifest, files);
		if (!result.ok) return reply.code(400).send({ error: result.error });
		reply.code(201).send({ id: result.id });
		if (result.needsServerSwap) scheduleServerSwap(`installing "${result.id}"`);
	});

	app.patch('/api/admin/widgets/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		const { enabled } = req.body as { enabled?: boolean };
		const widget = installedWidgetsDb.getInstalled(id);
		if (!widget) return reply.code(404).send({ error: 'not found' });
		if (typeof enabled === 'boolean') {
			installedWidgetsDb.setEnabled(id, enabled);
			// Re-enabling should show fresh data right away rather than waiting out the
			// widget's own poll interval — same "immediate poll on enable" behavior the
			// 4 built-ins get via PATCH /api/admin/settings above.
			if (enabled && !widget.enabled) {
				loadedWidgets
					.get(id)
					?.poll?.run()
					.catch((err) => logger.error(id, `Immediate poll failed: ${err.message}`));
			}
		}
		return installedWidgetsDb.getInstalled(id);
	});

	app.delete('/api/admin/widgets/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		const widget = installedWidgetsDb.getInstalled(id);
		if (!widget) return reply.code(404).send({ error: 'not found' });
		if (widget.source === 'builtin') return reply.code(400).send({ error: 'built-in widgets cannot be deleted' });
		const hadRoutes = await uninstallWidget(id);
		reply.code(204).send();
		if (hadRoutes) scheduleServerSwap(`deleting "${id}"`);
	});

	// --- Logs ---
	app.get('/api/admin/logs', async (req) => {
		const { level, limit } = req.query as { level?: string; limit?: string };
		return listLogs({
			level: level === 'info' || level === 'warn' || level === 'error' ? level : undefined,
			limit: limit ? Number(limit) : undefined
		});
	});
}
