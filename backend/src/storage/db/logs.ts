import { db } from './index.js';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
	id: number;
	timestamp: string;
	level: LogLevel;
	source: string;
	message: string;
}

const MAX_LOGS = 2000;
let sinceLastPrune = 0;

function insertLog(level: LogLevel, source: string, message: string) {
	db.prepare('INSERT INTO logs (timestamp, level, source, message) VALUES (?, ?, ?, ?)').run(
		new Date().toISOString(),
		level,
		source,
		message
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

/** Writes to both the logs table (for the admin panel) and the console (for the terminal). */
export const logger = {
	info(source: string, message: string) {
		console.log(`[${source}] ${message}`);
		insertLog('info', source, message);
	},
	warn(source: string, message: string) {
		console.warn(`[${source}] ${message}`);
		insertLog('warn', source, message);
	},
	error(source: string, message: string) {
		console.error(`[${source}] ${message}`);
		insertLog('error', source, message);
	}
};

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
	return rows.map((r) => ({ id: r.id, timestamp: r.timestamp, level: r.level, source: r.source, message: r.message }));
}
