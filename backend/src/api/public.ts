import type { FastifyInstance } from 'fastify';
import * as articlesDb from '../storage/db/articles.js';
import * as tagsDb from '../storage/db/tags.js';
import * as eventsDb from '../storage/db/events.js';
import * as categoriesDb from '../storage/db/categories.js';
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
		// Public fields only — sourceIds, cadenceTime etc. stay admin-only.
		return eventsDb.listEvents().map((e) => ({ id: e.id, name: e.name, active: e.active, cadence: e.cadence }));
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
}
