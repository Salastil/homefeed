import type { DatabaseSync } from 'node:sqlite';
import type { WidgetPlugin } from '../types.js';
import * as bookmarksDb from './db.js';
import { hasPrivateAccess } from '../../api/privateAccess.js';

const OWNED_TABLES = ['widget_bookmarks_items'];

// Sidebar "Bookmarks" widget — admin-curated links, each independently hidden/public via
// is_private (same private-access lock feature as categories.is_private). No poll (purely
// admin-curated, no external fetch). Built-in and non-deletable, but otherwise a full
// WidgetPlugin like an uploaded one.
export const bookmarksPlugin: WidgetPlugin = {
	id: 'bookmarks',
	displayName: 'Bookmarks',
	version: '1.0.0',
	ownedTables: OWNED_TABLES,

	migrate(db: DatabaseSync) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS widget_bookmarks_items (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				url TEXT NOT NULL,
				priority_rank INTEGER NOT NULL,
				is_private INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL
			);
		`);
	},

	registerPublicRoutes(app) {
		app.get('/api/widget/bookmarks', async (req) => {
			const bookmarks = bookmarksDb.listBookmarks();
			const items = hasPrivateAccess(req) ? bookmarks : bookmarks.filter((b) => !b.isPrivate);
			return { items, columns: bookmarksDb.getColumns() };
		});
	},

	registerAdminRoutes(app) {
		app.get('/api/admin/widget/bookmarks', async () => bookmarksDb.listBookmarks());

		app.get('/api/admin/widget/bookmarks/config', async () => ({ columns: bookmarksDb.getColumns() }));

		app.patch('/api/admin/widget/bookmarks/config', async (req, reply) => {
			const { columns } = req.body as { columns?: number };
			if (columns !== 1 && columns !== 2 && columns !== 3) {
				return reply.code(400).send({ error: 'columns must be 1, 2, or 3' });
			}
			bookmarksDb.setColumns(columns);
			return { columns };
		});

		app.post('/api/admin/widget/bookmarks', async (req, reply) => {
			const { name, url, isPrivate } = req.body as { name?: string; url?: string; isPrivate?: boolean };
			if (!name || !name.trim() || !url || !url.trim()) {
				return reply.code(400).send({ error: 'name and url are required' });
			}
			const created = bookmarksDb.createBookmark(name.trim(), url.trim(), !!isPrivate);
			return reply.code(201).send(created);
		});

		app.patch('/api/admin/widget/bookmarks/:id', async (req, reply) => {
			const { id } = req.params as { id: string };
			const updated = bookmarksDb.updateBookmark(id, req.body as any);
			if (!updated) return reply.code(404).send({ error: 'not found' });
			return updated;
		});

		app.delete('/api/admin/widget/bookmarks/:id', async (req, reply) => {
			const { id } = req.params as { id: string };
			bookmarksDb.deleteBookmark(id);
			return reply.code(204).send();
		});
	},

	uninstall(db: DatabaseSync) {
		db.exec('DROP TABLE IF EXISTS widget_bookmarks_items;');
	}
};
