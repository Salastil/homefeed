import fs from 'node:fs';
import path from 'node:path';
import * as installedWidgetsDb from '../storage/db/installedWidgets.js';
import { loadUploadedWidget, loadedWidgets } from './registry.js';
import { startWidgetPolling } from '../queue/scheduler.js';
import { validateManifest, type WidgetManifest } from './manifest.js';
import { validateRoutesBuildable } from '../server.js';
import { logger } from '../storage/db/logs.js';

const WIDGETS_INSTALLED_DIR = process.env.WIDGETS_INSTALLED_DIR || './data/widgets-installed';

export type InstallResult =
	| { ok: true; id: string; needsServerSwap: boolean }
	| { ok: false; error: string };

// Installs and hot-loads a widget uploaded live to the running backend (see
// api/admin.ts's POST /api/admin/widgets) — writes its files under ./data/, never
// dist/ or src/, so it survives a rebuild/redeploy of the core app. Its migrate()
// runs and its poll interval (if declared) starts immediately. If it declares
// registerPublicRoutes/registerAdminRoutes, `needsServerSwap` comes back true — the
// caller (api/admin.ts's POST route) must call server.ts's swapLiveServer() itself,
// AFTER sending its own response, never inline here: this function runs inside the
// very request handler whose underlying Fastify instance a swap would close, so
// awaiting the swap here would drop the response before the client ever sees it (hit
// this for real in testing). validateRoutesBuildable() is safe to await here — it
// never touches the live server, only a throwaway instance on an ephemeral port — so
// a widget whose routes are actually broken (e.g. a path collision) is still caught
// and rolled back within this same call, before anything user-visible commits.
//
// Either way this is a full HTTP-server rebuild within the running process, not a
// process restart — the DB connection, scheduler intervals, Telegram session, and
// (critically) the admin API key all survive; a process restart would regenerate the
// key and log the admin out.
export async function installUploadedWidget(manifest: unknown, files: unknown): Promise<InstallResult> {
	const validationError = validateManifest(manifest, files);
	if (validationError) return { ok: false, error: validationError };
	const m = manifest as WidgetManifest;
	const f = files as Record<string, string>;

	if (installedWidgetsDb.getInstalled(m.id)) {
		return { ok: false, error: `widget "${m.id}" is already installed` };
	}

	const dir = path.join(WIDGETS_INSTALLED_DIR, m.id);
	fs.mkdirSync(dir, { recursive: true });
	for (const [relPath, content] of Object.entries(f)) {
		const filePath = path.join(dir, relPath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, 'utf8');
	}
	fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2), 'utf8');

	const plugin = await loadUploadedWidget(m.id, dir);
	if (!plugin) {
		fs.rmSync(dir, { recursive: true, force: true });
		return { ok: false, error: "widget failed to load — check its entry file's default export satisfies WidgetPlugin" };
	}

	installedWidgetsDb.insertWidget({
		id: m.id,
		displayName: m.displayName,
		source: 'uploaded',
		codePath: dir,
		version: m.version,
		ownedTables: plugin.ownedTables ?? [],
		frontendEntry: m.frontendEntry ?? null
	});

	const needsServerSwap = !!(plugin.registerPublicRoutes || plugin.registerAdminRoutes);
	if (needsServerSwap) {
		try {
			await validateRoutesBuildable();
		} catch (err) {
			// A widget whose routes break Fastify's registration (e.g. a path collision)
			// isn't a successful install — the site itself was never at risk since this
			// only ever touched a throwaway ephemeral-port instance, but this widget still
			// needs to be fully rolled back rather than left half-installed.
			logger.error('widgets', `Install of "${m.id}" rolled back — its routes failed to register: ${(err as Error).message}`);
			loadedWidgets.delete(m.id);
			installedWidgetsDb.deleteInstalled(m.id);
			fs.rmSync(dir, { recursive: true, force: true });
			return { ok: false, error: `widget's routes failed to register: ${(err as Error).message}` };
		}
	}

	startWidgetPolling(plugin);
	return { ok: true, id: m.id, needsServerSwap };
}
