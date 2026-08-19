import { randomUUID } from 'node:crypto';

// migrate(db) is the only hook that receives the DB handle directly — registerPublicRoutes/
// registerAdminRoutes don't (see backend/src/widgets/types.ts), so it's captured here in
// closure for the route handlers below to reuse. Safe because migrate() always runs before
// either route-registration hook, both at boot and on a live install (see registry.ts).
let db;

const TABLE = 'widget_searchbar_engines';

function rowToEngine(row) {
	return {
		id: row.id,
		name: row.name,
		urlTemplate: row.url_template,
		priorityRank: row.priority_rank,
		createdAt: row.created_at
	};
}

function listEngines() {
	return db
		.prepare(`SELECT * FROM ${TABLE} ORDER BY priority_rank`)
		.all()
		.map(rowToEngine);
}

function isValidUrlTemplate(urlTemplate) {
	try {
		new URL(urlTemplate.replace('%s', 'test'));
		return true;
	} catch {
		return false;
	}
}

export default {
	id: 'searchbar',
	displayName: 'Search',
	version: '1.1.0',
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

	// Read-only and unauthenticated — the widget itself (frontend.mjs, rendered on the
	// public sidebar) fetches the engine list from here to populate its dropdown.
	registerPublicRoutes(app) {
		app.get('/api/widget/searchbar/engines', async () => listEngines());
	},

	// Add/remove — gated by the existing X-Api-Key preHandler on every /api/admin/* path,
	// same as every other widget's admin routes (see poe2/plugin.ts for the reference
	// pattern this follows).
	registerAdminRoutes(app) {
		app.get('/api/admin/widget/searchbar/engines', async () => listEngines());

		app.post('/api/admin/widget/searchbar/engines', async (req, reply) => {
			const { name, urlTemplate } = req.body ?? {};
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
			const maxRank = db.prepare(`SELECT COALESCE(MAX(priority_rank), 0) as m FROM ${TABLE}`).get().m;
			const priorityRank = maxRank + 1;
			const createdAt = new Date().toISOString();
			db.prepare(`INSERT INTO ${TABLE} (id, name, url_template, priority_rank, created_at) VALUES (?, ?, ?, ?, ?)`).run(
				id,
				name.trim(),
				urlTemplate.trim(),
				priorityRank,
				createdAt
			);
			return reply.code(201).send({ id, name: name.trim(), urlTemplate: urlTemplate.trim(), priorityRank, createdAt });
		});

		app.delete('/api/admin/widget/searchbar/engines/:id', async (req, reply) => {
			const { id } = req.params;
			db.prepare(`DELETE FROM ${TABLE} WHERE id = ?`).run(id);
			return reply.code(204).send();
		});
	},

	uninstall(_db) {
		_db.exec(`DROP TABLE IF EXISTS ${TABLE};`);
	}
};
