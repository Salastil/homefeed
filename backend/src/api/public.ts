import type { FastifyInstance } from 'fastify';
import * as articlesDb from '../storage/db/articles.js';
import * as tagsDb from '../storage/db/tags.js';
import * as eventsDb from '../storage/db/events.js';

export async function registerPublicRoutes(app: FastifyInstance) {
	app.get('/api/feed', async (req) => {
		const { category, geo, eventId, tag } = req.query as Record<string, string | undefined>;
		return articlesDb.queryFeed({ category, geo, eventId, tag });
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
}
