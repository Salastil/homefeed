import type { FastifyInstance } from 'fastify';
import * as articlesDb from '../storage/db/articles.js';
import * as tagsDb from '../storage/db/tags.js';
import * as eventsDb from '../storage/db/events.js';
import * as categoriesDb from '../storage/db/categories.js';
import * as settingsDb from '../storage/db/settings.js';
import * as installedWidgetsDb from '../storage/db/installedWidgets.js';
import { getKv } from '../storage/db/widgetKv.js';
import type { WidgetReport } from '../widgets/report.js';
import { hasPrivateAccess } from './privateAccess.js';

export async function registerPublicRoutes(app: FastifyInstance) {
	app.get('/api/feed', async (req) => {
		const { category, geo, eventId, tag, before, limit } = req.query as Record<string, string | undefined>;
		return articlesDb.queryFeed(
			{
				category,
				geo,
				eventId,
				tag,
				before,
				limit: limit ? Number(limit) : undefined
			},
			hasPrivateAccess(req)
		);
	});

	app.get('/api/article/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		const article = articlesDb.getArticle(id);
		if (!article) return reply.code(404).send({ error: 'not found' });
		// 404 rather than 403 for a private article behind a paywall of sorts — an
		// unauthenticated visitor shouldn't be able to tell the difference between
		// "doesn't exist" and "exists but is private."
		if (!hasPrivateAccess(req)) {
			const privateNames = new Set(categoriesDb.listPrivateCategoryNames());
			if (article.category.some((c) => privateNames.has(c))) {
				return reply.code(404).send({ error: 'not found' });
			}
		}
		return article;
	});

	app.get('/api/tags', async () => {
		return tagsDb.listActiveTags();
	});

	app.get('/api/events', async () => {
		// Public fields only — sourceIds, keywords etc. stay admin-only.
		return eventsDb
			.listEvents()
			.map((e) => ({ id: e.id, name: e.name, active: e.active, recapIntervalHours: e.recapIntervalHours, isSpillover: e.isSpillover }));
	});

	// Drives the site nav — admin-editable (add/remove/reorder) via /api/admin/categories,
	// per the "user may have no interest in Business or Culture" requirement. Private
	// categories are omitted entirely for anyone without a valid private-access cookie,
	// so they don't even show up as a nav tab to unlock.
	app.get('/api/categories', async (req) => {
		const categories = categoriesDb.listCategories();
		if (hasPrivateAccess(req)) return categories;
		return categories.filter((c) => !c.isPrivate);
	});

	// Per-widget enable flags + display order for the 4 built-ins — see the admin panel's
	// consolidated "Widgets" tab. Weather/Stocks/PoE2's backend pollers are also gated on
	// these flags (see scheduler.ts); Sidebar.svelte renders in exactly this order. The
	// `pluggable` array lists enabled *uploaded* widgets separately (their ids aren't part
	// of the closed weather|stocks|bookmarks|poe2 union `order` uses) — see
	// widgets/registry.ts, Sidebar.svelte's GenericWidgetCard/DynamicWidgetSlot.
	app.get('/api/widgets', async () => {
		const { widgets, widgetOrder } = settingsDb.getSettings();
		const pluggable = installedWidgetsDb
			.listInstalled()
			.filter((w) => w.source === 'uploaded' && w.enabled)
			.map((w) => ({ id: w.id, displayName: w.displayName, frontendEntry: w.frontendEntry }));
		return { ...widgets, order: widgetOrder, pluggable };
	});

	// Generic live-data feed any widget (built-in or uploaded) can publish to via
	// setKv(id, 'report', ...) in its own poll.run() — see widgets/report.ts. Registered
	// once here rather than per-widget, so it works for a widget uploaded after this
	// process started, with zero new route registration (Fastify refuses routes added
	// after app.listen(), so this is what makes "poll live -> sidebar shows it live" work
	// for an uploaded widget without a restart).
	app.get('/api/widget/:id/report', async (req, reply) => {
		const { id } = req.params as { id: string };
		if (!installedWidgetsDb.getInstalled(id)?.enabled) return reply.code(404).send();
		return { data: getKv<WidgetReport>(id, 'report') };
	});

	// Per-widget public routes (GET /api/widget/weather, /stocks, /bookmarks, /poe2) are
	// registered by each widget's own plugin — see widgets/registry.ts's generic
	// registerPublicRoutes loop in index.ts.
}
