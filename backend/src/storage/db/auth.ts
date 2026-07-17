import { randomUUID } from 'node:crypto';
import { db } from './index.js';
import { hashPassword } from '../../api/password.js';
import { logger } from './logs.js';

const SESSION_TTL_HOURS = 24;

export function ensureAdminUserSeeded(defaultUsername: string, defaultPassword: string) {
	const existing = db.prepare('SELECT id FROM admin_users LIMIT 1').get();
	if (existing) return;
	db.prepare('INSERT INTO admin_users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
		randomUUID(),
		defaultUsername,
		hashPassword(defaultPassword),
		new Date().toISOString()
	);
	logger.warn('auth', `Seeded initial admin user "${defaultUsername}". Change this password after first login.`);
}

export function getAdminUserByUsername(username: string) {
	return db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username) as
		| { id: string; username: string; password_hash: string }
		| undefined;
}

export function createSession(ip: string | null): { id: string; expiresAt: string } {
	const id = randomUUID();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 3600_000).toISOString();
	db.prepare('INSERT INTO sessions (id, created_at, expires_at, ip) VALUES (?, ?, ?, ?)').run(
		id,
		now.toISOString(),
		expiresAt,
		ip
	);
	return { id, expiresAt };
}

export function isSessionValid(id: string): boolean {
	const row = db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(id) as
		| { expires_at: string }
		| undefined;
	if (!row) return false;
	return new Date(row.expires_at).getTime() > Date.now();
}

export function deleteSession(id: string) {
	db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function pruneExpiredSessions() {
	db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}
