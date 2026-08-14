import { migrate } from './storage/db/index.js';
import { ADMIN_API_KEY } from './api/apiKey.js';
import { privateAccessConfigured } from './api/privateAccess.js';
import { startScheduler } from './queue/scheduler.js';
import { initFromSavedSession } from './telegram/client.js';
import { logger } from './storage/db/logs.js';
import { loadAllWidgets } from './widgets/registry.js';
import { reloadServerRoutes } from './server.js';

function printApiKeyBanner() {
	const line = '='.repeat(64);
	// Deliberately console.log, not the DB-backed logger — the Logs tab in the admin
	// panel is itself behind this key, so printing there would be unreachable until
	// you already have the key. This is the one and only place it's ever surfaced.
	console.log(`\n${line}`);
	console.log('  Homefeed admin API key (required for every /api/admin/* request)');
	console.log(`  ${ADMIN_API_KEY}`);
	console.log('  Generated once and persisted to backend/.env — it stays the same across');
	console.log('  restarts. Delete the ADMIN_API_KEY line from .env to force a new one.');
	console.log(`${line}\n`);
}

async function main() {
	migrate();
	printApiKeyBanner();
	await initFromSavedSession();
	await loadAllWidgets();
	await reloadServerRoutes();
	if (!privateAccessConfigured()) {
		logger.info('server', 'Private categories disabled — set PRIVATE_ACCESS_PASSWORD to enable');
	}

	startScheduler();
}

main().catch((err) => {
	console.error('[server] Fatal startup error:', err);
	process.exit(1);
});
