import type { FastifyInstance } from 'fastify';
import * as stl from '../storage/db/storylines.js';
import { engineStatus } from '../pipeline/storylines.js';
import { boardCategories, resolveBoardLayout } from './storylines.js';
import * as settingsDb from '../storage/db/settings.js';
import * as sourcesDb from '../storage/db/sources.js';
import * as eventsDb from '../storage/db/events.js';
import * as articlesDb from '../storage/db/articles.js';
import * as categoriesDb from '../storage/db/categories.js';
import * as installedWidgetsDb from '../storage/db/installedWidgets.js';
import { clearSourceContent, reissueSourceContent, reissueArticle, clearAllArticles, clearAllMedia } from '../storage/contentCascade.js';
import { totalStorageBytes } from '../storage/media/index.js';
import { OllamaProvider } from '../inference/ollama-provider.js';
import { publishEventRecap } from '../pipeline/publish.js';
import { pollSourceNow } from '../ingestion/poller.js';
import { logger, listLogs } from '../storage/db/logs.js';
import { listSynthesisRuns } from '../storage/db/synthesisRuns.js';
import * as backlogStats from '../queue/backlogStats.js';
import * as ollamaStats from '../inference/stats.js';
import * as telegramClient from '../telegram/client.js';
import { loadedWidgets } from '../widgets/registry.js';
import { installUploadedWidget } from '../widgets/install.js';
import { uninstallWidget } from '../widgets/uninstall.js';
import { buildExportZip, applyImportZip } from './backup.js';
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

/**
 * The board order is also the AI writer's queue order (it used to be the category priority
 * list): ranks follow the board left to right, then hidden columns; "Top stories" stays
 * first. A category that shares a rotating column is marked spillover, which the More page
 * still uses.
 */
function syncCategoriesToBoard(saved: GlobalSettings['boardLayout']) {
	const cats = boardCategories();
	const layout = resolveBoardLayout(saved, cats);
	const ids = (keys: string[]) => keys.filter((k) => k.startsWith('cat:')).map((k) => k.slice(4));
	const top = categoriesDb.listCategories().filter((c) => c.name.toLowerCase() === 'top stories').map((c) => c.id);
	categoriesDb.setPriorityOrder([...top, ...ids(layout.slots.flatMap((s) => s.columns)), ...ids(layout.hidden)]);
	const rotating = new Set(ids(layout.slots.filter((s) => s.columns.length > 1).flatMap((s) => s.columns)));
	for (const c of cats) if (c.isSpillover !== rotating.has(c.id)) categoriesDb.updateCategory(c.id, { isSpillover: rotating.has(c.id) });
}

function boardOverview() {
	const settings = settingsDb.getSettings();
	const cats = boardCategories();
	const layout = resolveBoardLayout(settings.boardLayout, cats);
	const sources = sourcesDb.listSources();
	const named = new Set(cats.map((c) => c.name));
	const columns = [
		...cats.map((c) => ({
			key: `cat:${c.id}`,
			kind: 'category' as const,
			id: c.id,
			name: c.name,
			isPrivate: c.isPrivate,
			disableAi: c.disableAi,
			sources: sources.filter((s) => s.category.includes(c.name)).map((s) => s.name)
		})),
		{
			key: 'wire',
			kind: 'wire' as const,
			id: null,
			name: 'Wire',
			isPrivate: false,
			disableAi: false,
			sources: sources.filter((s) => (s.type === 'nitter' || s.type === 'telegram') && !s.category.some((c) => named.has(c))).map((s) => s.name)
		},
		{
			key: 'general',
			kind: 'general' as const,
			id: null,
			name: 'General',
			isPrivate: false,
			disableAi: false,
			sources: sources.filter((s) => s.type !== 'nitter' && s.type !== 'telegram' && !s.category.some((c) => named.has(c))).map((s) => s.name)
		}
	];
	return {
		layout,
		saved: settings.boardLayout.slots.length > 0,
		columns,
		sources: sources.map((s) => ({ id: s.id, name: s.name, type: s.type, category: s.category, enabled: s.enabled }))
	};
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
		if (body.boardLayout) syncCategoriesToBoard(settings.boardLayout);
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

	// Storyline engine status for the admin Storylines tab: whether the embedder is reachable,
	// what's waiting, and how the historical pass is going.
	app.get('/api/admin/storylines/status', async () => {
		const pending = stl.pendingCounts();
		const counts = stl.storylineCounts();
		const rate = engineStatus.backfillRatePerMin;
		return {
			reachable: engineStatus.reachable,
			lastTickAt: engineStatus.lastTickAt,
			recentPending: pending.recent,
			backfillPending: pending.backfill,
			backfillOldest: pending.backfillOldest,
			backfillDone: pending.backfillDone,
			backfillRatePerMin: rate,
			backfillEtaMinutes: rate && pending.backfill ? Math.ceil(pending.backfill / rate) : null,
			storylines: counts.news,
			developments: counts.developments
		};
	});

	// The Board tab: the resolved layout (hidden columns included), every column with what
	// feeds it, and the sources list for assigning sources from a column's panel.
	app.get('/api/admin/board', async () => boardOverview());

	app.patch('/api/admin/categories/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		const { name, isPrivate, disableAi } = req.body as { name?: string; isPrivate?: boolean; disableAi?: boolean };
		const r = categoriesDb.updateCategory(id, { name, isPrivate, disableAi });
		if (r === null) return reply.code(404).send({ error: 'not found' });
		if (r === 'taken') return reply.code(409).send({ error: 'Another category already has that name' });
		return boardOverview();
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

	// Fixes one specific bad article (e.g. a degenerate/empty AI synthesis — see
	// synthesis.ts's assertNonEmpty) by deleting it and requeuing every item it merged,
	// regardless of how many different sources contributed — reissueSourceContent above
	// deliberately won't touch a multi-source article at all.
	app.post('/api/admin/articles/:id/reissue', async (req, reply) => {
		const { id } = req.params as { id: string };
		const result = reissueArticle(id);
		if (!result) return reply.code(404).send({ error: 'not found' });
		return result;
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

	// Forces one tracked item's recap to run right now, ignoring its recapIntervalHours
	// cadence entirely (even if recaps are turned off for it) — for "I want a wrap-up
	// right now" rather than waiting out the timer. Still summarizes the same real
	// window eventsRecap.ts would (everything published since lastRecapAt, or the last
	// 24h if it's never recapped) rather than some arbitrary admin-chosen range, and
	// still requires that window to actually contain something — an AI call with zero
	// source material to summarize would just hallucinate content it wasn't given.
	app.post('/api/admin/events/:id/recap-now', async (req, reply) => {
		const { id } = req.params as { id: string };
		const event = eventsDb.getEvent(id);
		if (!event) return reply.code(404).send({ error: 'not found' });
		if (event.sourceIds.length === 0) {
			return { published: false, reason: 'No sources assigned to this item yet.' };
		}

		const since = event.lastRecapAt ?? new Date(Date.now() - 24 * 3600_000).toISOString();
		const constituents = articlesDb.articlesForEventSince(event.id, since);
		if (constituents.length === 0) {
			return { published: false, reason: 'Nothing new published under this item since its last recap.' };
		}

		const settings = settingsDb.getSettings();
		const providers = {
			embedding: new OllamaProvider(settings.embeddingServiceHost, settings.embeddingServicePort),
			synthesis: new OllamaProvider(settings.synthesisServiceHost, settings.synthesisServicePort)
		};
		try {
			const article = await publishEventRecap(providers, settings, event, constituents);
			eventsDb.markRecapped(event.id);
			logger.info('events', `Manually forced recap for "${event.name}" from ${constituents.length} article(s)`);
			return { published: true, title: article.title };
		} catch (err) {
			return reply.code(502).send({ error: `Recap failed: ${(err as Error).message}` });
		}
	});

	// --- Models / AI service (fetched live from the two independently-configured Ollama
	// hosts — embedding/clustering and synthesis each have their own connection now, so
	// listing/status checks run against both rather than one shared provider). ---
	app.get('/api/admin/models', async () => {
		const settings = settingsDb.getSettings();
		const embeddingProvider = new OllamaProvider(settings.embeddingServiceHost, settings.embeddingServicePort);
		const synthesisProvider = new OllamaProvider(settings.synthesisServiceHost, settings.synthesisServicePort);
		// allSettled rather than all — one connection being unreachable shouldn't blank
		// out the other slot's (working) model list.
		const [embeddingResult, synthesisResult] = await Promise.allSettled([
			embeddingProvider.listModels(),
			synthesisProvider.listModels()
		]);
		return {
			embedding: embeddingResult.status === 'fulfilled' ? embeddingResult.value : [],
			synthesis: synthesisResult.status === 'fulfilled' ? synthesisResult.value : []
		};
	});

	app.get('/api/admin/ai-status', async () => {
		const settings = settingsDb.getSettings();
		const embeddingProvider = new OllamaProvider(settings.embeddingServiceHost, settings.embeddingServicePort);
		const synthesisProvider = new OllamaProvider(settings.synthesisServiceHost, settings.synthesisServicePort);
		const [embeddingConnected, synthesisConnected] = await Promise.all([
			embeddingProvider.isReachable(),
			synthesisProvider.isReachable()
		]);
		return {
			embedding: {
				connected: embeddingConnected,
				host: settings.embeddingServiceHost,
				port: settings.embeddingServicePort,
				ramGB: null,
				gpu: null
			},
			synthesis: {
				connected: synthesisConnected,
				host: settings.synthesisServiceHost,
				port: settings.synthesisServicePort,
				ramGB: null,
				gpu: null
			}
		};
	});

	// Ad-hoc reachability check for whatever host/port is currently typed into a Models-tab
	// connection panel — deliberately independent of the saved setting (unlike
	// /api/admin/ai-status above), so clicking "Test" checks the value on screen right now,
	// not whatever was last saved. Nothing here is persisted.
	app.get('/api/admin/ai-status/test', async (req, reply) => {
		const { host, port } = req.query as { host?: string; port?: string };
		if (!host || !port) return reply.code(400).send({ error: 'host and port query params required' });
		const portNum = Number(port);
		if (!Number.isFinite(portNum)) return reply.code(400).send({ error: 'port must be a number' });
		const provider = new OllamaProvider(host, portNum);
		const connected = await provider.isReachable();
		return { connected, host, port: portNum, ramGB: null, gpu: null };
	});

	// Detects the selected synthesis model's own max context length (when Ollama exposes
	// it) so the Models tab's num_ctx/num_predict sliders can be bounded by what the
	// model actually supports, instead of an arbitrary fixed cap. contextLength is null
	// when undetectable (older Ollama version, unusual model format, unreachable) — the
	// frontend falls back to a generous default range in that case rather than blocking.
	app.get('/api/admin/model-context', async (req, reply) => {
		const { model } = req.query as { model?: string };
		if (!model) return reply.code(400).send({ error: 'model query param required' });
		const settings = settingsDb.getSettings();
		const provider = new OllamaProvider(settings.synthesisServiceHost, settings.synthesisServicePort);
		const contextLength = await provider.getModelContextLength(model);
		return { contextLength };
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

	// --- Config export/import (see api/backup.ts for what's included/excluded) ---
	app.get('/api/admin/backup/export', async (_req, reply) => {
		const zip = buildExportZip();
		const filename = `homefeed-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
		reply.header('Content-Type', 'application/zip');
		reply.header('Content-Disposition', `attachment; filename="${filename}"`);
		return reply.send(zip);
	});

	app.post('/api/admin/backup/import', async (req, reply) => {
		const file = await req.file();
		if (!file) return reply.code(400).send({ error: 'no file uploaded' });
		const buffer = await file.toBuffer();
		const result = applyImportZip(buffer);
		if (!result.ok) return reply.code(400).send({ error: result.error });
		return { ok: true, warnings: result.warnings };
	});

	// --- Logs ---
	app.get('/api/admin/logs', async (req) => {
		const { level, limit } = req.query as { level?: string; limit?: string };
		return listLogs({
			level: level === 'info' || level === 'warn' || level === 'error' ? level : undefined,
			limit: limit ? Number(limit) : undefined
		});
	});

	// Backlog/throughput dashboard for the Logs tab — backlog counts are recomputed live
	// from the DB on every request (cheap: no AI calls, see backlogStats.ts), while Ollama
	// throughput/in-flight status comes from a rolling in-memory sample of recent
	// generate() calls (see inference/stats.ts) since that can only be observed as calls
	// actually happen, not recomputed on demand.
	app.get('/api/admin/pipeline-stats', async () => {
		const settings = settingsDb.getSettings();
		const backlog = backlogStats.getBacklogSnapshot(settings);
		const throughput = ollamaStats.getThroughput();
		const inFlight = ollamaStats.getInFlight();
		const { lastDirectCycle, lastSynthesisCycle } = backlogStats.getLastCycles();

		// Estimate is deliberately conservative: only clusters that actually need an LLM
		// call (2+ items — see backlogStats.ts) count toward it, and it's null (rather than
		// a misleading guess) until at least one real generate() call has completed, since
		// there's no token-speed data to estimate from yet.
		const estimatedMinutesToClear =
			backlog.clusters.readyNowNeedingSynthesis === 0
				? 0
				: throughput.avgGenerateDurationMs !== null
					? Math.ceil((backlog.clusters.readyNowNeedingSynthesis * throughput.avgGenerateDurationMs) / 60_000)
					: null;

		return {
			timestamp: new Date().toISOString(),
			ollama: { inFlight, ...throughput },
			backlog,
			estimatedMinutesToClear,
			lastDirectCycle,
			lastSynthesisCycle
		};
	});

	// Persisted per-article synthesis benchmark history (tokens/sec, duration, model) —
	// see storage/db/synthesisRuns.ts for why this is a separate table from `logs`.
	app.get('/api/admin/synthesis-runs', async (req) => {
		const { limit } = req.query as { limit?: string };
		return listSynthesisRuns({ limit: limit ? Number(limit) : undefined });
	});

	// Ollama serves one request at a time — a stuck generation (a recap that keeps
	// producing malformed output and retrying, or one that's just going to take far
	// longer than expected) blocks every other merge/recap until it finishes, with no
	// way to intervene short of restarting the whole process. This aborts the in-flight
	// fetch to Ollama (see inference/stats.ts's cancelInFlight), which drops the
	// connection and stops the underlying generation server-side. The caller that issued
	// it (synthesizeArticle/synthesizeRecap) sees this as an ordinary failed generate()
	// call and is handled by its existing catch-and-log/retry-next-cycle logic — no
	// special-casing needed there.
	app.post('/api/admin/synthesis/cancel', async (_req, reply) => {
		const canceled = ollamaStats.cancelInFlight();
		if (!canceled) return reply.code(404).send({ error: 'nothing in flight' });
		return { ok: true };
	});
}
