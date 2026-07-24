// Uses Node's built-in node:sqlite (experimental as of Node 22) — no native dependency
// to compile, which matters on the target hardware (i5-6600K, no GPU) as much as it
// matters for keeping the backend lightweight in general.
//
// If node:sqlite's API changes in a future Node version, `better-sqlite3` is a drop-in
// alternative with a near-identical synchronous API — see project-structure.md.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = process.env.DB_PATH || './data/homefeed.db';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function migrate() {
	// Admin auth moved from username/password + sessions to a per-launch API key (see
	// api/apiKey.ts, api/auth.ts) — these tables, and any stored password hash or live
	// session in them, have no further purpose and are dropped rather than left as
	// orphaned schema/data.
	db.exec('DROP TABLE IF EXISTS admin_users;');
	db.exec('DROP TABLE IF EXISTS sessions;');

	db.exec(`
		CREATE TABLE IF NOT EXISTS sources (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			type TEXT NOT NULL, -- rss | api | telegram | custom
			category TEXT NOT NULL DEFAULT '[]', -- JSON array
			url TEXT,
			config TEXT NOT NULL DEFAULT '{}', -- JSON: apiKey, telegramChannelId, authHeaders
			poll_interval_minutes INTEGER NOT NULL DEFAULT 15,
			enabled INTEGER NOT NULL DEFAULT 1,
			push_to_top_stories INTEGER NOT NULL DEFAULT 0, -- opt-in: keeps the homepage from being flooded by every ingested source
			last_polled_at TEXT,
			last_error TEXT,
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS content_items (
			id TEXT PRIMARY KEY,
			source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
			type TEXT NOT NULL DEFAULT 'article',
			title TEXT NOT NULL,
			summary TEXT NOT NULL DEFAULT '',
			body TEXT,
			images TEXT NOT NULL DEFAULT '[]', -- JSON
			videos TEXT NOT NULL DEFAULT '[]', -- JSON
			link TEXT NOT NULL,
			published_at TEXT NOT NULL,
			fetched_at TEXT NOT NULL,
			tags TEXT NOT NULL DEFAULT '[]', -- JSON, raw extracted tag labels pre-dedup
			geo TEXT,
			embedding TEXT, -- JSON float array
			event_id TEXT,
			cluster_id TEXT, -- set once assigned to a cluster awaiting synthesis
			tweet TEXT, -- JSON {id, authorName, authorHandle, avatarUrl}, nitter-sourced items only
			telegram_message TEXT, -- JSON {channelName, channelUsername, channelAvatarUrl, messageId, media}, telegram-sourced items only
			raw TEXT -- JSON, original payload
		);
		CREATE INDEX IF NOT EXISTS idx_content_items_source ON content_items(source_id);
		CREATE INDEX IF NOT EXISTS idx_content_items_cluster ON content_items(cluster_id);
		CREATE INDEX IF NOT EXISTS idx_content_items_published ON content_items(published_at);

		CREATE TABLE IF NOT EXISTS merged_articles (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			body TEXT NOT NULL,
			hero_image TEXT, -- JSON {url, sourceItemId, selectionReason}
			video TEXT, -- JSON
			category TEXT NOT NULL DEFAULT '[]', -- JSON
			geo TEXT,
			event_id TEXT,
			source_count INTEGER NOT NULL DEFAULT 1,
			sources TEXT NOT NULL DEFAULT '[]', -- JSON, copied at publish time (see schema doc)
			published_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			merge_confidence REAL NOT NULL DEFAULT 1.0,
			tags TEXT NOT NULL DEFAULT '[]', -- JSON tag ids
			thread_id TEXT NOT NULL,
			previous_article_id TEXT,
			next_article_id TEXT,
			top_stories INTEGER NOT NULL DEFAULT 0, -- true if any contributing source opted into "Push to Top Stories?"
			tweet TEXT, -- JSON {authorName, authorHandle, avatarUrl, sourceItemId}, nitter-sourced articles only
			telegram_message TEXT, -- JSON {channelName, channelUsername, channelAvatarUrl, sourceItemId, media}, telegram-sourced articles only
			is_recap INTEGER NOT NULL DEFAULT 0 -- true only for the AI-written periodic summary of a tracked event, see eventsRecap.ts
		);
		CREATE INDEX IF NOT EXISTS idx_articles_published ON merged_articles(published_at);
		CREATE INDEX IF NOT EXISTS idx_articles_thread ON merged_articles(thread_id);

		CREATE TABLE IF NOT EXISTS media_assets (
			id TEXT PRIMARY KEY,
			source_url TEXT NOT NULL,
			local_path TEXT NOT NULL,
			size_bytes INTEGER NOT NULL,
			downloaded_at TEXT NOT NULL,
			tier TEXT NOT NULL, -- candidate | published
			content_item_id TEXT,
			article_id TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_media_tier ON media_assets(tier);

		CREATE TABLE IF NOT EXISTS tags (
			id TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			aliases TEXT NOT NULL DEFAULT '[]', -- JSON
			slug TEXT NOT NULL UNIQUE,
			embedding TEXT NOT NULL DEFAULT '[]', -- JSON
			first_seen_at TEXT NOT NULL,
			last_seen_at TEXT NOT NULL,
			article_count INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'active' -- active | expired
		);

		CREATE TABLE IF NOT EXISTS tracked_events (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			source_ids TEXT NOT NULL DEFAULT '[]', -- JSON
			keywords TEXT NOT NULL DEFAULT '[]', -- JSON string array — empty means "match everything from source_ids"
			cadence TEXT NOT NULL DEFAULT 'continuous',
			cadence_time TEXT,
			active INTEGER NOT NULL DEFAULT 1,
			retention_override_days INTEGER,
			last_recap_at TEXT,
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS local_regions (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			source_ids TEXT NOT NULL DEFAULT '[]', -- JSON
			seasonal INTEGER NOT NULL DEFAULT 0,
			active_months TEXT, -- JSON int array or null
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS categories (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			priority_rank INTEGER NOT NULL,
			is_default INTEGER NOT NULL DEFAULT 0,
			is_private INTEGER NOT NULL DEFAULT 0,
			is_spillover INTEGER NOT NULL DEFAULT 0 -- collapsed into the nav's "More »" overflow page instead of its own tab
		);

		CREATE TABLE IF NOT EXISTS logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp TEXT NOT NULL,
			level TEXT NOT NULL, -- info | warn | error
			source TEXT NOT NULL, -- e.g. 'poller', 'scheduler', 'synthesis', 'retention'
			message TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);

		CREATE TABLE IF NOT EXISTS global_settings (
			id INTEGER PRIMARY KEY CHECK (id = 1), -- singleton row
			merge_strictness INTEGER NOT NULL DEFAULT 3,
			default_poll_interval_minutes INTEGER NOT NULL DEFAULT 15,
			hold_before_publish_minutes INTEGER NOT NULL DEFAULT 30,
			tag_dedup_threshold REAL NOT NULL DEFAULT 0.82,
			tag_expiry_days INTEGER NOT NULL DEFAULT 21,
			follow_up_min_hours_since_last INTEGER NOT NULL DEFAULT 6,
			follow_up_min_new_sources INTEGER NOT NULL DEFAULT 2,
			ai_service_host TEXT NOT NULL DEFAULT 'http://localhost',
			ai_service_port INTEGER NOT NULL DEFAULT 11434,
			selected_models TEXT NOT NULL DEFAULT '{}', -- JSON {embedding, image, synthesis}
			published_article_max_age_days INTEGER,
			raw_item_max_age_days INTEGER DEFAULT 7,
			storage_cap_enabled INTEGER NOT NULL DEFAULT 1,
			storage_cap_value INTEGER NOT NULL DEFAULT 500,
			storage_cap_unit TEXT NOT NULL DEFAULT 'GB',
			nitter_media_mode TEXT NOT NULL DEFAULT 'proxy', -- self-host | proxy | direct
			fxtwitter_base_url TEXT NOT NULL DEFAULT 'https://api.fxtwitter.com',
			telegram_media_mode TEXT NOT NULL DEFAULT 'self-host' -- self-host | proxy (no "direct" — Telegram has no public hotlinkable media URL)
		);

		-- Singleton row (see storage/crypto.ts) — encrypted Telegram API credentials and
		-- the resulting login session. Deliberately its own table, not part of
		-- global_settings, so these encrypted blobs never ride along in the generic
		-- GET /api/admin/settings payload.
		CREATE TABLE IF NOT EXISTS telegram_credentials (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			api_id_enc TEXT,
			api_hash_enc TEXT,
			session_enc TEXT,
			phone_enc TEXT
		);
	`);

	const existingTelegramCreds = db.prepare('SELECT id FROM telegram_credentials WHERE id = 1').get();
	if (!existingTelegramCreds) {
		db.prepare('INSERT INTO telegram_credentials (id) VALUES (1)').run();
	}

	// Seed the singleton settings row if it doesn't exist yet.
	const existing = db.prepare('SELECT id FROM global_settings WHERE id = 1').get();
	if (!existing) {
		db.prepare(
			`INSERT INTO global_settings (id, selected_models) VALUES (1, '{"embedding":"nomic-embed-text","image":"","synthesis":"qwen2.5:7b-instruct-q4_K_M"}')`
		).run();
	}

	// Backfill new columns for installs seeded before they existed — node:sqlite's
	// CREATE TABLE IF NOT EXISTS doesn't add columns to an already-existing table.
	const hasColumn = (table: string, column: string) =>
		(db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
	if (!hasColumn('sources', 'push_to_top_stories')) {
		db.exec('ALTER TABLE sources ADD COLUMN push_to_top_stories INTEGER NOT NULL DEFAULT 0');
	}
	if (!hasColumn('merged_articles', 'top_stories')) {
		db.exec('ALTER TABLE merged_articles ADD COLUMN top_stories INTEGER NOT NULL DEFAULT 0');
	}
	if (!hasColumn('content_items', 'tweet')) {
		db.exec('ALTER TABLE content_items ADD COLUMN tweet TEXT');
	}
	if (!hasColumn('merged_articles', 'tweet')) {
		db.exec('ALTER TABLE merged_articles ADD COLUMN tweet TEXT');
	}
	if (!hasColumn('global_settings', 'nitter_media_mode')) {
		db.exec("ALTER TABLE global_settings ADD COLUMN nitter_media_mode TEXT NOT NULL DEFAULT 'proxy'");
	}
	if (!hasColumn('global_settings', 'fxtwitter_base_url')) {
		db.exec("ALTER TABLE global_settings ADD COLUMN fxtwitter_base_url TEXT NOT NULL DEFAULT 'https://api.fxtwitter.com'");
	}
	if (!hasColumn('categories', 'is_private')) {
		db.exec('ALTER TABLE categories ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0');
	}
	if (!hasColumn('categories', 'is_spillover')) {
		db.exec('ALTER TABLE categories ADD COLUMN is_spillover INTEGER NOT NULL DEFAULT 0');
	}
	if (!hasColumn('content_items', 'telegram_message')) {
		db.exec('ALTER TABLE content_items ADD COLUMN telegram_message TEXT');
	}
	if (!hasColumn('merged_articles', 'telegram_message')) {
		db.exec('ALTER TABLE merged_articles ADD COLUMN telegram_message TEXT');
	}
	if (!hasColumn('global_settings', 'telegram_media_mode')) {
		db.exec("ALTER TABLE global_settings ADD COLUMN telegram_media_mode TEXT NOT NULL DEFAULT 'self-host'");
	}
	if (!hasColumn('tracked_events', 'keywords')) {
		db.exec("ALTER TABLE tracked_events ADD COLUMN keywords TEXT NOT NULL DEFAULT '[]'");
	}
	if (!hasColumn('merged_articles', 'is_recap')) {
		db.exec('ALTER TABLE merged_articles ADD COLUMN is_recap INTEGER NOT NULL DEFAULT 0');
	}

	// Seed default categories if none exist yet. "News" sits right under "Top stories" —
	// general news sources belong here, not on "Top stories" itself, which isn't a real
	// filterable tag: it's the homepage view, now scoped to only the articles whose
	// sources opted into "Push to Top Stories?" (see sources.push_to_top_stories and
	// articles.queryFeed's isHomepage gate) rather than every ingested article.
	const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number };
	if (catCount.c === 0) {
		const defaults = ['Top stories', 'News', 'Local', 'World', 'Business', 'Tech', 'Culture'];
		const stmt = db.prepare(
			'INSERT INTO categories (id, name, priority_rank, is_default) VALUES (?, ?, ?, 1)'
		);
		defaults.forEach((name, i) => {
			stmt.run(`cat-${name.toLowerCase().replace(/\s+/g, '-')}`, name, i + 1);
		});
	} else {
		// Backfill for installs seeded before "News" existed.
		const hasNews = db.prepare("SELECT id FROM categories WHERE lower(name) = 'news'").get();
		if (!hasNews) {
			const maxRank = db.prepare('SELECT COALESCE(MAX(priority_rank), 0) as m FROM categories').get() as { m: number };
			db.prepare('INSERT INTO categories (id, name, priority_rank, is_default) VALUES (?, ?, ?, 1)').run(
				'cat-news',
				'News',
				maxRank.m + 1
			);
		}
	}
}
