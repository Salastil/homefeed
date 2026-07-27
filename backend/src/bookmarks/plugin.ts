import type { WidgetPlugin } from '../widgets/types.js';
import * as bookmarksDb from '../storage/db/bookmarks.js';
import { hasPrivateAccess } from '../api/privateAccess.js';

// Built-in sidebar "Bookmarks" widget — thin wrapper so it funnels into the same
// route-registration loop as pluggable widgets (see widgets/registry.ts); no poll (purely
// admin-curated links) and no migrate()/uninstall() since its schema isn't moving. Not
// going through the upload/delete lifecycle — see widgets/types.ts.
export const bookmarksPlugin: WidgetPlugin = {
	id: 'bookmarks',
	displayName: 'Bookmarks',
	version: '1.0.0',

	registerPublicRoutes(app) {
		app.get('/api/bookmarks', async (req) => {
			const bookmarks = bookmarksDb.listBookmarks();
			if (hasPrivateAccess(req)) return bookmarks;
			return bookmarks.filter((b) => !b.isPrivate);
		});
	},

	registerAdminRoutes(app) {
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
	}
};
