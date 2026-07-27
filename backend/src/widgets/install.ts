import fs from 'node:fs';
import path from 'node:path';
import * as installedWidgetsDb from '../storage/db/installedWidgets.js';
import { loadUploadedWidget } from './registry.js';
import { startWidgetPolling } from '../queue/scheduler.js';
import { validateManifest, type WidgetManifest } from './manifest.js';

const WIDGETS_INSTALLED_DIR = process.env.WIDGETS_INSTALLED_DIR || './data/widgets-installed';

export type InstallResult = { ok: true; id: string } | { ok: false; error: string };

// Installs and hot-loads a widget uploaded live to the running backend (see
// api/admin.ts's POST /api/admin/widgets) — writes its files under ./data/, never
// dist/ or src/, so it survives a rebuild/redeploy of the core app. Its migrate()
// runs and its poll interval (if declared) starts immediately, with no restart
// required. NOTE: its registerPublicRoutes/registerAdminRoutes, if declared, do NOT
// take effect until the next restart — Fastify throws "instance is already
// listening" if you try to add a route after app.listen() has resolved, and there's
// no supported way around that short of a much larger request-dispatch redesign. A
// live-installed widget's data/poll side works immediately; its custom HTTP routes
// don't until the process restarts (see widgets/registry.ts's startup discovery,
// which re-registers everything, routes included, on every boot).
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

	startWidgetPolling(plugin);
	return { ok: true, id: m.id };
}
