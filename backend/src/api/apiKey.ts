// The admin API key is the only credential protecting /api/admin/*. Resolution order:
//
//   1. An explicit ADMIN_API_KEY environment variable wins outright. This is how you pick
//      your own password - set it in docker-compose/.env (or Compose Manager) to any string
//      and that is the key, unchanged across restarts and recreates. In Docker there is no
//      local .env to write back to, so this is the only way the key can survive a recreate.
//   2. Otherwise a key already written to backend/.env by a previous launch is reused.
//   3. Only a truly first-ever launch (neither of the above) generates a random one and
//      writes it back, so every later launch finds it via branch 2.
//
// Branches 2 and 3 still print the key at startup (see index.ts's banner) - that is the only
// way to learn a key you didn't choose. Branch 1 doesn't: you already know it, and echoing a
// password into the container log would just leave a copy in `docker logs`.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

// Matches where backend/.env.example already lives and where this app's own
// documented launch command (`node --env-file=.env dist/index.js`) reads from -
// process.cwd() is the backend project root in every deployment that has a .env
// file at all. A container without a mounted/writable .env at this path never reaches
// the write path below when ADMIN_API_KEY is supplied as a real environment variable.
const ENV_FILE = path.resolve(process.cwd(), '.env');
const KEY_LINE_RE = /^ADMIN_API_KEY=(.+)$/m;

export type AdminApiKeySource = 'environment' | 'env-file' | 'generated';

function readExistingKey(): string | null {
	if (!existsSync(ENV_FILE)) return null;
	const match = readFileSync(ENV_FILE, 'utf8').match(KEY_LINE_RE);
	return match ? match[1].trim() : null;
}

function loadOrCreateAdminApiKey(): { key: string; source: AdminApiKeySource } {
	// Trimmed because a value pasted into a compose or env editor routinely picks up a
	// trailing space or newline, and then the password you typed never matches the one the
	// server holds - which looks exactly like the server ignoring the setting. A password
	// that genuinely starts or ends with whitespace isn't something worth supporting.
	const fromEnvironment = process.env.ADMIN_API_KEY?.trim();
	if (fromEnvironment) return { key: fromEnvironment, source: 'environment' };

	const existing = readExistingKey();
	if (existing) return { key: existing, source: 'env-file' };

	const key = randomBytes(24).toString('hex');
	try {
		appendFileSync(ENV_FILE, `\nADMIN_API_KEY=${key}\n`);
	} catch (err) {
		// No writable .env here (e.g. a container without one mounted) - fall back to
		// the old behavior for this run rather than crashing startup over it, but say
		// so plainly since a silently-regenerating key is exactly what this exists to
		// avoid.
		console.warn(`[apiKey] Could not persist ADMIN_API_KEY to ${ENV_FILE} (${(err as Error).message}) - it will regenerate on next restart. Set the ADMIN_API_KEY environment variable to pin it.`);
	}
	return { key, source: 'generated' };
}

const loaded = loadOrCreateAdminApiKey();
export const ADMIN_API_KEY = loaded.key;
export const ADMIN_API_KEY_SOURCE = loaded.source;

/**
 * Nothing limits repeated wrong guesses on /api/admin/*, so a key someone chose by hand and
 * keeps short is genuinely guessable. Only a startup warning - it's their call - but a
 * random key from this file is 48 characters, which is the bar worth comparing against.
 */
export const MIN_RECOMMENDED_KEY_LENGTH = 16;
