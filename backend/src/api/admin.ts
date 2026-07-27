import type { FastifyInstance } from 'fastify';
import * as settingsDb from '../storage/db/settings.js';
import * as sourcesDb from '../storage/db/sources.js';
import * as eventsDb from '../storage/db/events.js';
import * as categoriesDb from '../storage/db/categories.js';
import * as stocksDb from '../storage/db/stocks.js';
import * as bookmarksDb from '../storage/db/bookmarks.js';
import * as poe2WatchlistDb from '../storage/db/poe2Watchlist.js';
import { clearSourceContent, reissueSourceContent, clearAllArticles, clearAllMedia } from '../storage/contentCascade.js';
import { totalStorageBytes } from '../storage/media/index.js';
import { OllamaProvider } from '../inference/ollama-provider.js';
import { pollSourceNow } from '../ingestion/poller.js';
import { logger, listLogs } from '../storage/db/logs.js';
import * as telegramClient from '../telegram/client.js';
import { geocodeLocation } from '../weather/client.js';
import { pollWeatherNow } from '../weather/poller.js';
import { pollStocksNow } from '../stocks/poller.js';
import { browseCurrencies, fetchCurrentLeague } from '../poe2/client.js';
import { pollPoe2Now } from '../poe2/poller.js';

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
		if (body.weather) {
			// Poll immediately rather than waiting for the next scheduler tick (up to 45
			// minutes) — the admin just changed the location/unit and expects to see it reflected.
			pollWeatherNow().catch((err) => logger.error('weather', `Immediate poll failed: ${err.message}`));
		}
		if (body.widgets) {
			// Re-enabling a widget (see the Widgets tab) should show fresh data right away
			// instead of waiting out its normal cadence (up to 45m/15m/1h) — scheduler.ts
			// skips polling entirely while a widget is disabled, so there's nothing recent
			// to fall back on otherwise.
			if (body.widgets.weather && !before.widgets.weather) {
				pollWeatherNow().catch((err) => logger.error('weather', `Immediate poll failed: ${err.message}`));
			}
			if (body.widgets.stocks && !before.widgets.stocks) {
				pollStocksNow().catch((err) => logger.error('stocks', `Immediate poll failed: ${err.message}`));
			}
			if (body.widgets.poe2 && !before.widgets.poe2) {
				pollPoe2Now().catch((err) => logger.error('poe2', `Immediate poll failed: ${err.message}`));
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

	// --- Weather (config lives in global_settings — see PATCH /api/admin/settings above) ---
	app.get('/api/admin/weather/geocode', async (req, reply) => {
		const { query } = req.query as { query?: string };
		if (!query || !query.trim()) return reply.code(400).send({ error: 'query required' });
		try {
			return await geocodeLocation(query.trim());
		} catch (err) {
			return reply.code(502).send({ error: `Geocoding service unreachable: ${(err as Error).message}` });
		}
	});

	// --- Stocks ---
	app.get('/api/admin/stocks', async () => stocksDb.listStockTickers());

	app.post('/api/admin/stocks', async (req, reply) => {
		const { label, symbol } = req.body as { label?: string; symbol?: string };
		if (!label || !label.trim() || !symbol || !symbol.trim()) {
			return reply.code(400).send({ error: 'label and symbol are required' });
		}
		const created = stocksDb.createStockTicker(label.trim(), symbol.trim());
		// Poll immediately rather than waiting for the next tick (up to 15 minutes) — cheap,
		// and refreshes every existing ticker's price too.
		pollStocksNow().catch((err) => logger.error('stocks', `Immediate poll failed: ${err.message}`));
		return reply.code(201).send(created);
	});

	app.patch('/api/admin/stocks/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		const updated = stocksDb.updateStockTicker(id, req.body as any);
		if (!updated) return reply.code(404).send({ error: 'not found' });
		return updated;
	});

	app.delete('/api/admin/stocks/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		stocksDb.deleteStockTicker(id);
		return reply.code(204).send();
	});

	// --- Bookmarks ---
	app.get('/api/admin/bookmarks', async () => bookmarksDb.listBookmarks());

	app.post('/api/admin/bookmarks', async (req, reply) => {
		const { name, url, isPrivate } = req.body as { name?: string; url?: string; isPrivate?: boolean };
		if (!name || !name.trim() || !url || !url.trim()) {
			return reply.code(400).send({ error: 'name and url are required' });
		}
		const created = bookmarksDb.createBookmark(name.trim(), url.trim(), !!isPrivate);
		return reply.code(201).send(created);
	});

	app.patch('/api/admin/bookmarks/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		const updated = bookmarksDb.updateBookmark(id, req.body as any);
		if (!updated) return reply.code(404).send({ error: 'not found' });
		return updated;
	});

	app.delete('/api/admin/bookmarks/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		bookmarksDb.deleteBookmark(id);
		return reply.code(204).send();
	});

	// --- PoE2 (league is always auto-detected, never admin-set — see poe2/poller.ts) ---
	app.get('/api/admin/poe2/browse', async (_req, reply) => {
		try {
			const league = await fetchCurrentLeague();
			return await browseCurrencies(league.id);
		} catch (err) {
			return reply.code(502).send({ error: `poe.ninja unreachable: ${(err as Error).message}` });
		}
	});

	app.get('/api/admin/poe2/watchlist', async () => poe2WatchlistDb.listWatchlist());

	app.post('/api/admin/poe2/watchlist', async (req, reply) => {
		const { base, quote } = req.body as {
			base?: { currencyId?: string; name?: string };
			quote?: { currencyId?: string; name?: string };
		};
		if (!base?.currencyId || !base?.name || !quote?.currencyId || !quote?.name) {
			return reply.code(400).send({ error: 'base and quote currencies (currencyId, name) are required' });
		}
		if (base.currencyId === quote.currencyId) {
			return reply.code(400).send({ error: 'Base and quote currencies must be different' });
		}
		const created = poe2WatchlistDb.addWatchlistEntry(
			{ currencyId: base.currencyId, name: base.name },
			{ currencyId: quote.currencyId, name: quote.name }
		);
		// Poll immediately rather than waiting for the next tick (up to 1 hour) — cheap,
		// and refreshes every existing entry's rate too.
		pollPoe2Now().catch((err) => logger.error('poe2', `Immediate poll failed: ${err.message}`));
		return reply.code(201).send(created);
	});

	app.delete('/api/admin/poe2/watchlist/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		poe2WatchlistDb.removeWatchlistEntry(id);
		return reply.code(204).send();
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
