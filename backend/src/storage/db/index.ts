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

	// PoE2 watchlist model changed from "value quoted in one primary currency" to arbitrary
	// currency pairs (base/quote) — the old single-currency rows can't be mapped onto a pair,
	// so the table is dropped and rebuilt fresh below rather than migrated column-by-column.
	const poe2WatchlistCols = db.prepare(`PRAGMA table_info(poe2_watchlist)`).all() as { name: string }[];
	if (poe2WatchlistCols.some((c) => c.name === 'currency_id')) {
		db.exec('DROP TABLE IF EXISTS poe2_watchlist;');
	}

	db.exec(`
		CREATE TABLE IF NOT EXISTS sources (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			type TEXT NOT NULL, -- rss | api | telegram | youtube | nitter
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
			recap_interval_hours INTEGER, -- hours between AI recaps; NULL = recaps off for this item
			active INTEGER NOT NULL DEFAULT 1,
			is_spillover INTEGER NOT NULL DEFAULT 0,
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
			telegram_media_mode TEXT NOT NULL DEFAULT 'self-host', -- self-host | proxy (no "direct" — Telegram has no public hotlinkable media URL)
			widget_weather_enabled INTEGER NOT NULL DEFAULT 1,
			widget_stocks_enabled INTEGER NOT NULL DEFAULT 1,
			widget_bookmarks_enabled INTEGER NOT NULL DEFAULT 1,
			widget_poe2_enabled INTEGER NOT NULL DEFAULT 1,
			weather_location_name TEXT,
			weather_latitude REAL,
			weather_longitude REAL,
			weather_unit TEXT NOT NULL DEFAULT 'fahrenheit', -- celsius | fahrenheit
			weather_wind_unit TEXT NOT NULL DEFAULT 'mph', -- mph | kph
			weather_pressure_unit TEXT NOT NULL DEFAULT 'inHg', -- inHg | hPa
			-- JSON {temp, feelsLike, conditionText, icon, humidity, precipitationChance,
			-- windSpeed, windDirection, pressure, sunrise, sunset}, NULL pre-first-poll
			weather_current TEXT,
			weather_hourly TEXT NOT NULL DEFAULT '[]', -- JSON array
			weather_daily TEXT NOT NULL DEFAULT '[]', -- JSON array
			weather_alerts TEXT NOT NULL DEFAULT '[]', -- JSON array — active NWS alerts for the configured location, US-only (see weather/client.ts)
			weather_updated_at TEXT, -- ISO timestamp, NULL pre-first-poll
			poe2_league_id TEXT,
			poe2_league_name TEXT,
			poe2_updated_at TEXT
		);

		-- Sidebar "Stocks" widget — polled every 15 minutes from Yahoo Finance (see
		-- stocks/poller.ts). Price/change/poll-state live directly on the row, same as
		-- sources.last_polled_at, rather than a separate quote-cache table.
		CREATE TABLE IF NOT EXISTS stock_tickers (
			id TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			symbol TEXT NOT NULL, -- Yahoo symbol syntax, e.g. "^DJI", "AAPL", "BTC-USD"
			priority_rank INTEGER NOT NULL,
			last_price REAL,
			last_change_percent REAL,
			last_polled_at TEXT,
			last_error TEXT,
			created_at TEXT NOT NULL
		);

		-- Sidebar "PoE2" widget — tracks exchange rates between arbitrary currency pairs
		-- (see poe2/poller.ts), always against the current challenge league (auto-detected,
		-- no admin config). Rate is "1 base = last_rate quote"; both currencies' names are
		-- captured at add-time from the browse picker, not re-resolved. No icon columns —
		-- the UI doesn't display them.
		CREATE TABLE IF NOT EXISTS poe2_watchlist (
			id TEXT PRIMARY KEY,
			base_currency_id TEXT NOT NULL, -- opaque id from the exchange overview's lines[].id, e.g. "exalted"
			base_name TEXT NOT NULL,
			quote_currency_id TEXT NOT NULL,
			quote_name TEXT NOT NULL,
			priority_rank INTEGER NOT NULL,
			last_rate REAL,
			last_change_24h REAL,
			last_polled_at TEXT,
			last_error TEXT,
			created_at TEXT NOT NULL
		);

		-- Per-poll rate snapshots for the pairs above — poe.ninja doesn't expose a matching
		-- 24h change window, so it's computed ourselves from this history (see
		-- poe2/poller.ts). Pruned to the last 2 days on every poll.
		CREATE TABLE IF NOT EXISTS poe2_rate_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			watchlist_id TEXT NOT NULL,
			rate REAL NOT NULL,
			recorded_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_poe2_rate_history_watchlist ON poe2_rate_history(watchlist_id, recorded_at);

		-- Sidebar "Bookmarks" widget — admin-curated links, each independently hidden/public
		-- via is_private (same private-access lock feature as categories.is_private).
		CREATE TABLE IF NOT EXISTS bookmarks (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			url TEXT NOT NULL,
			priority_rank INTEGER NOT NULL,
			is_private INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL
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
	if (!hasColumn('tracked_events', 'is_spillover')) {
		db.exec('ALTER TABLE tracked_events ADD COLUMN is_spillover INTEGER NOT NULL DEFAULT 0');
	}
	if (!hasColumn('tracked_events', 'recap_interval_hours')) {
		db.exec('ALTER TABLE tracked_events ADD COLUMN recap_interval_hours INTEGER');
	}
	if (!hasColumn('merged_articles', 'is_recap')) {
		db.exec('ALTER TABLE merged_articles ADD COLUMN is_recap INTEGER NOT NULL DEFAULT 0');
	}
	if (!hasColumn('global_settings', 'weather_unit')) {
		db.exec('ALTER TABLE global_settings ADD COLUMN weather_location_name TEXT');
		db.exec('ALTER TABLE global_settings ADD COLUMN weather_latitude REAL');
		db.exec('ALTER TABLE global_settings ADD COLUMN weather_longitude REAL');
		db.exec("ALTER TABLE global_settings ADD COLUMN weather_unit TEXT NOT NULL DEFAULT 'fahrenheit'");
		db.exec('ALTER TABLE global_settings ADD COLUMN weather_current TEXT');
		db.exec("ALTER TABLE global_settings ADD COLUMN weather_hourly TEXT NOT NULL DEFAULT '[]'");
		db.exec("ALTER TABLE global_settings ADD COLUMN weather_daily TEXT NOT NULL DEFAULT '[]'");
		db.exec('ALTER TABLE global_settings ADD COLUMN weather_updated_at TEXT');
	}
	if (!hasColumn('global_settings', 'weather_wind_unit')) {
		db.exec("ALTER TABLE global_settings ADD COLUMN weather_wind_unit TEXT NOT NULL DEFAULT 'mph'");
		db.exec("ALTER TABLE global_settings ADD COLUMN weather_pressure_unit TEXT NOT NULL DEFAULT 'inHg'");
		db.exec("ALTER TABLE global_settings ADD COLUMN weather_alerts TEXT NOT NULL DEFAULT '[]'");
	}
	if (!hasColumn('global_settings', 'poe2_league_id')) {
		db.exec('ALTER TABLE global_settings ADD COLUMN poe2_league_id TEXT');
		db.exec('ALTER TABLE global_settings ADD COLUMN poe2_league_name TEXT');
		db.exec('ALTER TABLE global_settings ADD COLUMN poe2_updated_at TEXT');
	}
	if (!hasColumn('global_settings', 'widget_weather_enabled')) {
		db.exec('ALTER TABLE global_settings ADD COLUMN widget_weather_enabled INTEGER NOT NULL DEFAULT 1');
		db.exec('ALTER TABLE global_settings ADD COLUMN widget_stocks_enabled INTEGER NOT NULL DEFAULT 1');
		db.exec('ALTER TABLE global_settings ADD COLUMN widget_bookmarks_enabled INTEGER NOT NULL DEFAULT 1');
		db.exec('ALTER TABLE global_settings ADD COLUMN widget_poe2_enabled INTEGER NOT NULL DEFAULT 1');
	}

	// Seed a handful of sensible default tickers so the Stocks widget isn't empty on a
	// fresh install — the admin can remove/replace any of them via the Stocks tab.
	const tickerCount = db.prepare('SELECT COUNT(*) as c FROM stock_tickers').get() as { c: number };
	if (tickerCount.c === 0) {
		const defaults: [string, string][] = [
			['Dow Jones', '^DJI'],
			['S&P 500', '^GSPC'],
			['Bitcoin', 'BTC-USD']
		];
		const stmt = db.prepare(
			'INSERT INTO stock_tickers (id, label, symbol, priority_rank, created_at) VALUES (?, ?, ?, ?, ?)'
		);
		defaults.forEach(([label, symbol], i) => {
			stmt.run(`stk-${symbol.replace(/[^a-z0-9]+/gi, '-')}`, label, symbol, i + 1, new Date().toISOString());
		});
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
