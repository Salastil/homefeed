// Persisted across restarts, not just generated once per process start. Resolution
// order: an explicit ADMIN_API_KEY env var (set directly, e.g. in Docker, where
// there's no local .env file to write back to) wins outright; otherwise an existing
// key already written to backend/.env from a previous launch is reused; only a truly
// first-ever launch (no env var, no key in .env yet) generates a new random one and
// writes it back so every later launch finds it via the second branch. Still
// console/log-only to *learn* the key (see index.ts's startup banner) — the
// difference from the old every-restart-regenerates design is durability across
// restarts, not how you retrieve it.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

// Matches where backend/.env.example already lives and where this app's own
// documented launch command (`node --env-file=.env dist/index.js`) reads from —
// process.cwd() is the backend project root in every deployment that has a .env
// file at all. A container without a mounted/writable .env at this path (the
// PRIVATE_ACCESS_PASSWORD-style Docker deployment, which sets ADMIN_API_KEY as a
// real environment variable instead) never reaches the write path below, since
// process.env.ADMIN_API_KEY is already set in that case.
const ENV_FILE = path.resolve(process.cwd(), '.env');
const KEY_LINE_RE = /^ADMIN_API_KEY=(.+)$/m;

function readExistingKey(): string | null {
	if (!existsSync(ENV_FILE)) return null;
	const match = readFileSync(ENV_FILE, 'utf8').match(KEY_LINE_RE);
	return match ? match[1].trim() : null;
}

function loadOrCreateAdminApiKey(): string {
	if (process.env.ADMIN_API_KEY) return process.env.ADMIN_API_KEY;

	const existing = readExistingKey();
	if (existing) return existing;

	const key = randomBytes(24).toString('hex');
	try {
		appendFileSync(ENV_FILE, `\nADMIN_API_KEY=${key}\n`);
	} catch (err) {
		// No writable .env here (e.g. a container without one mounted) — fall back to
		// the old behavior for this run rather than crashing startup over it, but say
		// so plainly since a silently-regenerating key is exactly what this exists to
		// avoid.
		console.warn(`[apiKey] Could not persist ADMIN_API_KEY to ${ENV_FILE} (${(err as Error).message}) — it will regenerate on next restart.`);
	}
	return key;
}

export const ADMIN_API_KEY = loadOrCreateAdminApiKey();
