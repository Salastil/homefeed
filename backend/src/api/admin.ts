import type { FastifyInstance } from 'fastify';
import * as settingsDb from '../storage/db/settings.js';
import * as sourcesDb from '../storage/db/sources.js';
import * as eventsDb from '../storage/db/events.js';
import * as categoriesDb from '../storage/db/categories.js';
import { OllamaProvider } from '../inference/ollama-provider.js';
import { pollSourceNow } from '../ingestion/poller.js';
import { logger, listLogs } from '../storage/db/logs.js';

export async function registerAdminRoutes(app: FastifyInstance) {
	// --- Settings ---
	app.get('/api/admin/settings', async () => {
		const settings = settingsDb.getSettings();
		return { ...settings, categoryPriority: categoriesDb.listCategories() };
	});

	app.patch('/api/admin/settings', async (req) => {
		const body = req.body as any;
		if (body.categoryPriority) {
			categoriesDb.setCategoryOrder(body.categoryPriority);
			delete body.categoryPriority;
		}
		const settings = settingsDb.updateSettings(body);
		return { ...settings, categoryPriority: categoriesDb.listCategories() };
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
		sourcesDb.deleteSource(id);
		return reply.code(204).send();
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

	// --- Logs ---
	app.get('/api/admin/logs', async (req) => {
		const { level, limit } = req.query as { level?: string; limit?: string };
		return listLogs({
			level: level === 'info' || level === 'warn' || level === 'error' ? level : undefined,
			limit: limit ? Number(limit) : undefined
		});
	});
}
