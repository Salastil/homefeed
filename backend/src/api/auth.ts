import type { FastifyInstance } from 'fastify';
import { getAdminUserByUsername, createSession, isSessionValid, deleteSession } from '../storage/db/auth.js';
import { verifyPassword } from './password.js';

const SESSION_COOKIE = 'homefeed_session';

export async function registerAuth(app: FastifyInstance) {
	app.post('/api/admin/login', async (req, reply) => {
		const { username, password } = req.body as { username?: string; password?: string };
		if (!username || !password) return reply.code(400).send({ error: 'username and password required' });

		const user = getAdminUserByUsername(username);
		if (!user || !verifyPassword(password, user.password_hash)) {
			// Deliberately generic — doesn't reveal whether the username exists.
			return reply.code(401).send({ error: 'invalid credentials' });
		}

		const session = createSession(req.ip ?? null);
		reply.setCookie(SESSION_COOKIE, session.id, {
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
			path: '/',
			expires: new Date(session.expiresAt)
		});
		return { ok: true };
	});

	app.post('/api/admin/logout', async (req, reply) => {
		const sessionId = req.cookies[SESSION_COOKIE];
		if (sessionId) deleteSession(sessionId);
		reply.clearCookie(SESSION_COOKIE, { path: '/' });
		return { ok: true };
	});

	// Guards every /api/admin/* route except login itself.
	app.addHook('preHandler', async (req, reply) => {
		if (!req.url.startsWith('/api/admin/') || req.url === '/api/admin/login') return;

		const sessionId = req.cookies[SESSION_COOKIE];
		if (!sessionId || !isSessionValid(sessionId)) {
			return reply.code(401).send({ error: 'unauthorized' });
		}
	});
}
