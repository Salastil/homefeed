// Export/import of this instance's own CONFIGURATION — Sources, Tracked Items,
// Categories, Settings/Connections, Telegram credentials, and every widget's own
// settings/data — as a single zip. Deliberately excludes bulk content
// (content_items/merged_articles/media_assets), derived data (tags), and operational
// history (logs/synthesis_runs): none of that is "how this instance is configured",
// and re-ingesting/re-publishing on a fresh instance is expected and cheap. See the
// project plan (config export/import) for the full design rationale.
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { db } from '../storage/db/index.js';
import { KEY_PATH } from '../storage/crypto.js';
import * as installedWidgetsDb from '../storage/db/installedWidgets.js';
import { ownedTablesForId } from '../widgets/sweep.js';

const WIDGETS_INSTALLED_DIR = process.env.WIDGETS_INSTALLED_DIR || './data/widgets-installed';

// Bumped whenever the shape of what's exported changes — import refuses a mismatched
// zip outright (see applyImportZip) rather than attempting a lossy/partial import
// against a schema it wasn't written for.
const SCHEMA_VERSION = 1;

// Every one of these gets DELETE FROM + bulk-reinserted on import, inside the same
// PRAGMA-foreign_keys-off transaction (see applyImportZip) — order doesn't matter
// among these since none of them reference each other via a real FK (sources.category
// and merged_articles.category are denormalized JSON name arrays, not ids).
const CONFIG_TABLES = ['sources', 'local_regions', 'categories', 'tracked_events', 'global_settings', 'telegram_credentials'] as const;

function readAppVersion(): string {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
		return typeof pkg.version === 'string' ? pkg.version : 'unknown';
	} catch {
		return 'unknown';
	}
}

function dumpTable(table: string): unknown[] {
	return db.prepare(`SELECT * FROM "${table}"`).all();
}

function tableExists(table: string): boolean {
	return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
}

/**
 * Every table any widget currently owns, keyed by table name — spans every installed
 * widget, not just one. ownedTablesForId's `extraOwnedTables` param (here, the
 * self-reported list from each installed_widgets row) can legitimately name a table
 * that doesn't exist yet — a widget row gets seeded before its own migrate() has ever
 * run (see storage/db/index.ts's one-time installed_widgets backfill) — so this must
 * check existence itself rather than assume every name it's handed is real.
 */
function allWidgetOwnedTables(): Map<string, unknown[]> {
	const tables = new Map<string, unknown[]>();
	for (const widget of installedWidgetsDb.listInstalled()) {
		for (const table of ownedTablesForId(db, widget.id, widget.ownedTables)) {
			if (!tables.has(table) && tableExists(table)) tables.set(table, dumpTable(table));
		}
	}
	return tables;
}

/** Reads an uploaded widget's on-disk install directory back into the exact { manifest, files } shape widgets/install.ts's installUploadedWidget() accepts, so import can hand it straight back to that same function. */
function readUploadedWidgetPackage(codePath: string): { manifest: unknown; files: Record<string, string> } | null {
	const manifestPath = path.join(codePath, 'manifest.json');
	if (!fs.existsSync(manifestPath)) return null;
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	const files: Record<string, string> = {};
	const walk = (dir: string, relPrefix: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				walk(path.join(dir, entry.name), rel);
			} else if (rel !== 'manifest.json') {
				files[rel] = fs.readFileSync(path.join(dir, entry.name), 'utf8');
			}
		}
	};
	walk(codePath, '');
	return { manifest, files };
}

export function buildExportZip(): Buffer {
	const zip = new AdmZip();

	zip.addFile(
		'manifest.json',
		Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), appVersion: readAppVersion(), schemaVersion: SCHEMA_VERSION }, null, 2))
	);

	for (const table of CONFIG_TABLES) {
		zip.addFile(`${table}.json`, Buffer.from(JSON.stringify(dumpTable(table))));
	}

	zip.addFile('installed_widgets.json', Buffer.from(JSON.stringify(dumpTable('installed_widgets'))));
	zip.addFile('widget_kv.json', Buffer.from(JSON.stringify(dumpTable('widget_kv'))));

	for (const [table, rows] of allWidgetOwnedTables()) {
		zip.addFile(`widget_tables/${table}.json`, Buffer.from(JSON.stringify(rows)));
	}

	for (const widget of installedWidgetsDb.listInstalled()) {
		if (widget.source !== 'uploaded') continue;
		const pkg = readUploadedWidgetPackage(widget.codePath);
		if (!pkg) continue;
		zip.addFile(`widgets/${widget.id}/manifest.json`, Buffer.from(JSON.stringify(pkg.manifest)));
		for (const [relPath, content] of Object.entries(pkg.files)) {
			zip.addFile(`widgets/${widget.id}/files/${relPath}`, Buffer.from(content, 'utf8'));
		}
	}

	if (fs.existsSync(KEY_PATH)) {
		zip.addFile('encryption-key.bin', fs.readFileSync(KEY_PATH));
	}

	return zip.toBuffer();
}

function readZipJson<T>(zip: AdmZip, entryName: string): T | null {
	const entry = zip.getEntry(entryName);
	if (!entry) return null;
	return JSON.parse(entry.getData().toString('utf8')) as T;
}

/** Column names come straight from each row's own keys (SELECT * output) — every row in a given table dump shares the same shape, so the first row's keys are representative for building the INSERT's column list. */
function bulkInsert(table: string, rows: Record<string, unknown>[]) {
	if (rows.length === 0) return;
	const columns = Object.keys(rows[0]);
	const placeholders = columns.map(() => '?').join(', ');
	const stmt = db.prepare(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`);
	for (const row of rows) {
		// Every value here is JSON-round-tripped from this exact app's own SELECT * dump
		// (see dumpTable) — already a plain primitive matching the column's real SQLite
		// affinity (node:sqlite's SQLInputValue isn't an exported type to narrow against).
		stmt.run(...(columns.map((c) => row[c]) as any[]));
	}
}

export function applyImportZip(buffer: Buffer): { ok: true; warnings: string[] } | { ok: false; error: string } {
	let zip: AdmZip;
	try {
		zip = new AdmZip(buffer);
	} catch (err) {
		return { ok: false, error: `not a valid zip file: ${(err as Error).message}` };
	}

	const manifest = readZipJson<{ schemaVersion: number }>(zip, 'manifest.json');
	if (!manifest) return { ok: false, error: 'missing manifest.json — not a Homefeed config export' };
	if (manifest.schemaVersion !== SCHEMA_VERSION) {
		return { ok: false, error: `export schema v${manifest.schemaVersion} is incompatible with this instance's v${SCHEMA_VERSION}` };
	}

	const widgetTableEntries = zip.getEntries().filter((e) => e.entryName.startsWith('widget_tables/') && e.entryName.endsWith('.json'));
	const widgetTables = widgetTableEntries.map((e) => ({
		table: e.entryName.slice('widget_tables/'.length, -'.json'.length),
		rows: JSON.parse(e.getData().toString('utf8')) as Record<string, unknown>[]
	}));

	// A widget's own tables (e.g. widget_stocks_tickers) are created by that widget's own
	// migrate(), which only runs when it loads at process startup — not by this import.
	// On a genuinely fresh instance that's never been started yet, they won't exist.
	// Rather than fabricate a CREATE TABLE from row data alone (we don't actually know
	// the real column types/constraints), skip that table's data for now and say so —
	// the admin restarts (letting the widget's migrate() create it), then re-imports.
	const skippedWidgetTables = widgetTables.filter(({ table }) => !tableExists(table)).map(({ table }) => table);
	const importableWidgetTables = widgetTables.filter(({ table }) => tableExists(table));

	// PRAGMA foreign_keys only takes effect outside an active transaction — must be set
	// before BEGIN, not inside it. Off for the duration of the replace so DELETE FROM
	// sources never cascade-deletes content_items (the one real FK in the schema); the
	// finally block guarantees it's always turned back on, success or failure.
	db.exec('PRAGMA foreign_keys = OFF');
	try {
		db.exec('BEGIN');
		try {
			for (const table of CONFIG_TABLES) {
				const rows = readZipJson<Record<string, unknown>[]>(zip, `${table}.json`);
				if (rows === null) continue; // an older/partial export simply omitting a table — leave it untouched rather than wiping it for nothing
				db.exec(`DELETE FROM "${table}"`);
				bulkInsert(table, rows);
			}

			const installedWidgets = readZipJson<Record<string, unknown>[]>(zip, 'installed_widgets.json');
			if (installedWidgets !== null) {
				db.exec('DELETE FROM installed_widgets');
				bulkInsert('installed_widgets', installedWidgets);
			}

			const widgetKv = readZipJson<Record<string, unknown>[]>(zip, 'widget_kv.json');
			if (widgetKv !== null) {
				db.exec('DELETE FROM widget_kv');
				bulkInsert('widget_kv', widgetKv);
			}

			for (const { table, rows } of importableWidgetTables) {
				db.exec(`DELETE FROM "${table}"`);
				bulkInsert(table, rows);
			}
			db.exec('COMMIT');
		} catch (err) {
			db.exec('ROLLBACK');
			throw err;
		}
	} finally {
		db.exec('PRAGMA foreign_keys = ON');
	}

	for (const entry of zip.getEntries()) {
		const match = entry.entryName.match(/^widgets\/([^/]+)\/manifest\.json$/);
		if (!match) continue;
		const id = match[1];
		const dir = path.join(WIDGETS_INSTALLED_DIR, id);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'manifest.json'), entry.getData());
	}
	for (const entry of zip.getEntries()) {
		const match = entry.entryName.match(/^widgets\/([^/]+)\/files\/(.+)$/);
		if (!match) continue;
		const [, id, relPath] = match;
		const filePath = path.join(WIDGETS_INSTALLED_DIR, id, relPath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, entry.getData());
	}

	const keyEntry = zip.getEntry('encryption-key.bin');
	if (keyEntry) {
		fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
		fs.writeFileSync(KEY_PATH, keyEntry.getData(), { mode: 0o600 });
	}

	const warnings = skippedWidgetTables.map(
		(table) => `"${table}" doesn't exist on this instance yet (its widget hasn't started once to create it) — restart, then re-import to pick up its data.`
	);
	warnings.push('A process restart is required to fully apply this import — widget code/registry changes only take effect on the next start.');
	return { ok: true, warnings };
}
