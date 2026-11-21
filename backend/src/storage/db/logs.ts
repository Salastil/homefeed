import { db } from './index.js';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
	id: number;
	timestamp: string;
	level: LogLevel;
	source: string;
	message: string;
	/** The feed (source name, or tracked item) the line is about, when it is about one. */
	feed: string | null;
	/** That source's id, so the admin log can open it. */
	sourceId: string | null;
	/** The article the line is about (published, failed, re-embedded...), so the admin log can link it. */
	articleId: string | null;
}

/** What a log line is about. Every field is optional; lines about nothing in particular pass none. */
export interface LogContext {
	feed?: string | null;
	sourceId?: string | null;
	articleId?: string | null;
}

const MAX_LOGS = 2000;
let sinceLastPrune = 0;

function insertLog(level: LogLevel, source: string, message: string, ctx: LogContext = {}) {
	db.prepare('INSERT INTO logs (timestamp, level, source, message, feed, source_id, article_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
		new Date().toISOString(),
		level,
		source,
		message,
		ctx.feed ?? null,
		ctx.sourceId ?? null,
		ctx.articleId ?? null
	);

	// Cheap periodic prune rather than checking row count on every insert.
	sinceLastPrune++;
	if (sinceLastPrune >= 100) {
		sinceLastPrune = 0;
		db.prepare(
			'DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT ?)'
		).run(MAX_LOGS);
	}
}

const line = (source: string, message: string, ctx?: LogContext) => `[${source}] ${message}${ctx?.feed ? ` · ${ctx.feed}` : ''}`;

/** Writes to both the logs table (for the admin panel) and the console (for the terminal). */
export const logger = {
	info(source: string, message: string, ctx?: LogContext) {
		console.log(line(source, message, ctx));
		insertLog('info', source, message, ctx);
	},
	warn(source: string, message: string, ctx?: LogContext) {
		console.warn(line(source, message, ctx));
		insertLog('warn', source, message, ctx);
	},
	error(source: string, message: string, ctx?: LogContext) {
		console.error(line(source, message, ctx));
		insertLog('error', source, message, ctx);
	}
};

/** Log context for an item or article from one source: its feed name and id. */
export function feedOf(sourceId: string | null | undefined): LogContext {
	if (!sourceId) return {};
	const row = db.prepare('SELECT name FROM sources WHERE id = ?').get(sourceId) as { name: string } | undefined;
	return { feed: row?.name ?? 'deleted source', sourceId };
}

/** Log context for something built from several sources' items: every feed, by name; the id only when there is one. */
export function feedsOf(sourceIds: (string | null | undefined)[]): LogContext {
	const ids = [...new Set(sourceIds.filter((x): x is string => !!x))];
	if (ids.length === 1) return feedOf(ids[0]);
	const names = ids.map((id) => (db.prepare('SELECT name FROM sources WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? 'deleted source');
	return names.length ? { feed: names.join(', ') } : {};
}

export function listLogs(filters: { level?: LogLevel; limit?: number } = {}): LogEntry[] {
	const limit = Math.min(filters.limit ?? 200, 1000);
	let sql = 'SELECT * FROM logs';
	const params: unknown[] = [];
	if (filters.level) {
		sql += ' WHERE level = ?';
		params.push(filters.level);
	}
	sql += ' ORDER BY id DESC LIMIT ?';
	params.push(limit);
	const rows = db.prepare(sql).all(...(params as any[])) as any[];
	return rows.map((r) => ({
		id: r.id,
		timestamp: r.timestamp,
		level: r.level,
		source: r.source,
		message: r.message,
		feed: r.feed ?? null,
		sourceId: r.source_id ?? null,
		articleId: r.article_id ?? null
	}));
}
