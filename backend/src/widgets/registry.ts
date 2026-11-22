import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { db } from '../storage/db/index.js';
import * as installedWidgetsDb from '../storage/db/installedWidgets.js';
import { logger } from '../storage/db/logs.js';
import type { WidgetPlugin } from './types.js';
import { sweepOrphanedWidgetData } from './sweep.js';
import { weatherPlugin } from './weather/plugin.js';
import { stocksPlugin } from './stocks/plugin.js';
import { bookmarksPlugin } from './bookmarks/plugin.js';
import { poe2Plugin } from './poe2/plugin.js';
import { searchbarPlugin } from './searchbar/plugin.js';

// Both built-in and uploaded widgets funnel into this one map — scheduler dispatch and
// route registration (see index.ts, queue/scheduler.ts) iterate it generically instead of
// hardcoding a block per widget, mirroring ingestion/poller.ts's
// Record<Source['type'], SourceAdapter> dispatch, just keyed by a dynamic string id.
export const loadedWidgets = new Map<string, WidgetPlugin>();

function registerBuiltinWidget(plugin: WidgetPlugin) {
	plugin.migrate?.(db);
	loadedWidgets.set(plugin.id, plugin);
}

// Called once at startup (see index.ts, after migrate() and before route registration /
// startScheduler()) and again after a live upload (see widgets/install.ts) to pick up just
// the newly-installed one without reloading everything else.
export async function loadAllWidgets(): Promise<void> {
	loadedWidgets.clear();

	registerBuiltinWidget(weatherPlugin);
	registerBuiltinWidget(stocksPlugin);
	registerBuiltinWidget(bookmarksPlugin);
	registerBuiltinWidget(poe2Plugin);
	registerBuiltinWidget(searchbarPlugin);

	// A widget that has since become built in (Search) is never loaded from an old upload.
	for (const row of installedWidgetsDb.listInstalled().filter((w) => w.source === 'uploaded' && !loadedWidgets.has(w.id))) {
		await loadUploadedWidget(row.id, row.codePath);
	}

	sweepOrphanedWidgetData(
		db,
		installedWidgetsDb.listInstalled().map((w) => w.id)
	);
}

// A widget whose code fails to load logs an error and is simply absent from
// loadedWidgets — scheduler/route registration skip an id with no entry. Its
// installed_widgets row stays, so it's still visible and deletable from the admin side
// (see widgets/uninstall.ts, which doesn't require the widget's own code to be loadable).
export async function loadUploadedWidget(id: string, codePath: string): Promise<WidgetPlugin | null> {
	try {
		const manifest = JSON.parse(fs.readFileSync(path.join(codePath, 'manifest.json'), 'utf8')) as { entry: string };
		const entryUrl = pathToFileURL(path.join(codePath, manifest.entry)).href;
		// The query string makes every load a distinct module URL. Node caches an import() by
		// URL for the life of the process, so without it re-uploading a widget (delete +
		// install, the only way to update one) silently kept running the PREVIOUS code - and
		// its module-level state - while the new files sat unused on disk, until the whole
		// backend was restarted. Costs one small leaked module per (re)load. Only the entry
		// file is re-evaluated: files it imports by relative path still come from the cache.
		const mod = await import(`${entryUrl}?v=${Date.now()}`);
		const plugin: WidgetPlugin = mod.default;
		if (!plugin || typeof plugin.id !== 'string') {
			throw new Error('module has no default-exported WidgetPlugin');
		}
		if (plugin.id !== id) {
			throw new Error(`plugin id "${plugin.id}" does not match installed id "${id}"`);
		}
		plugin.migrate?.(db);
		loadedWidgets.set(id, plugin);
		return plugin;
	} catch (err) {
		logger.error('widgets', `Failed to load uploaded widget "${id}": ${(err as Error).message}`);
		return null;
	}
}
