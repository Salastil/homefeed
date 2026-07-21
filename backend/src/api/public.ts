import type { FastifyInstance } from 'fastify';
import * as articlesDb from '../storage/db/articles.js';
import * as tagsDb from '../storage/db/tags.js';
import * as eventsDb from '../storage/db/events.js';
import * as categoriesDb from '../storage/db/categories.js';

export async function registerPublicRoutes(app: FastifyInstance) {
	app.get('/api/feed', async (req) => {
		const { category, geo, eventId, tag, before, limit } = req.query as Record<string, string | undefined>;
		return articlesDb.queryFeed({
			category,
			geo,
			eventId,
			tag,
			before,
			limit: limit ? Number(limit) : undefined
		});
	});

	app.get('/api/article/:id', async (req, reply) => {
		const { id } = req.params as { id: string };
		const article = articlesDb.getArticle(id);
		if (!article) return reply.code(404).send({ error: 'not found' });
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
	// per the "user may have no interest in Business or Culture" requirement.
	app.get('/api/categories', async () => {
		return categoriesDb.listCategories();
	});
}
