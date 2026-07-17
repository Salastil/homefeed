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
			next_article_id TEXT
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
			is_default INTEGER NOT NULL DEFAULT 0
		);

		CREATE TABLE IF NOT EXISTS admin_users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			created_at TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			ip TEXT
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
			storage_cap_unit TEXT NOT NULL DEFAULT 'GB'
		);
	`);

	// Seed the singleton settings row if it doesn't exist yet.
	const existing = db.prepare('SELECT id FROM global_settings WHERE id = 1').get();
	if (!existing) {
		db.prepare(
			`INSERT INTO global_settings (id, selected_models) VALUES (1, '{"embedding":"nomic-embed-text","image":"","synthesis":"qwen2.5:7b-instruct-q4_K_M"}')`
		).run();
	}

	// Seed default categories if none exist yet.
	const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number };
	if (catCount.c === 0) {
		const defaults = ['Top stories', 'Local', 'World', 'Business', 'Tech', 'Culture'];
		const stmt = db.prepare(
			'INSERT INTO categories (id, name, priority_rank, is_default) VALUES (?, ?, ?, 1)'
		);
		defaults.forEach((name, i) => {
			stmt.run(`cat-${name.toLowerCase().replace(/\s+/g, '-')}`, name, i + 1);
		});
	}
}
