import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { WidgetPlugin } from '../types.js';

const TABLE = 'widget_searchbar_engines';

// Search box in the top bar. It started life as an uploaded widget (widgets/searchbar);
// since it's part of the header it is now built in (issue #3) - same id, same table and
// routes, so engines the admin added before carry over. The box itself is
// frontend/src/lib/components/shell/SearchBar.svelte.
let db: DatabaseSync;

interface EngineRow {
	id: string;
	name: string;
	url_template: string;
	priority_rank: number;
	created_at: string;
}

function listEngines() {
	return (db.prepare(`SELECT * FROM ${TABLE} ORDER BY priority_rank`).all() as unknown as EngineRow[]).map((row) => ({
		id: row.id,
		name: row.name,
		urlTemplate: row.url_template,
		priorityRank: row.priority_rank,
		createdAt: row.created_at
	}));
}

function isValidUrlTemplate(urlTemplate: string) {
	try {
		new URL(urlTemplate.replace('%s', 'test'));
		return true;
	} catch {
		return false;
	}
}

export const searchbarPlugin: WidgetPlugin = {
	id: 'searchbar',
	displayName: 'Search',
	version: '2.0.0',
	ownedTables: [TABLE],

	migrate(_db) {
		db = _db;
		db.exec(`
			CREATE TABLE IF NOT EXISTS ${TABLE} (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				url_template TEXT NOT NULL,
				priority_rank INTEGER NOT NULL,
				created_at TEXT NOT NULL
			);
		`);
	},

	// The search box reads the admin's extra engines from here for its dropdown.
	registerPublicRoutes(app) {
		app.get('/api/widget/searchbar/engines', async () => listEngines());
	},

	registerAdminRoutes(app) {
		app.get('/api/admin/widget/searchbar/engines', async () => listEngines());

		app.post('/api/admin/widget/searchbar/engines', async (req, reply) => {
			const { name, urlTemplate } = (req.body ?? {}) as { name?: unknown; urlTemplate?: unknown };
			if (typeof name !== 'string' || !name.trim() || typeof urlTemplate !== 'string' || !urlTemplate.trim()) {
				return reply.code(400).send({ error: 'name and urlTemplate are required' });
			}
			if (!urlTemplate.includes('%s')) {
				return reply.code(400).send({ error: 'urlTemplate must contain %s where the search query goes' });
			}
			if (!isValidUrlTemplate(urlTemplate)) {
				return reply.code(400).send({ error: 'urlTemplate is not a valid URL' });
			}
			const id = randomUUID();
			const maxRank = (db.prepare(`SELECT COALESCE(MAX(priority_rank), 0) as m FROM ${TABLE}`).get() as { m: number }).m;
			const createdAt = new Date().toISOString();
			db.prepare(`INSERT INTO ${TABLE} (id, name, url_template, priority_rank, created_at) VALUES (?, ?, ?, ?, ?)`).run(
				id,
				name.trim(),
				urlTemplate.trim(),
				maxRank + 1,
				createdAt
			);
			return reply.code(201).send({ id, name: name.trim(), urlTemplate: urlTemplate.trim(), priorityRank: maxRank + 1, createdAt });
		});

		app.delete('/api/admin/widget/searchbar/engines/:id', async (req, reply) => {
			const { id } = req.params as { id: string };
			db.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).run(id);
			return reply.code(204).send();
		});
	}
};
