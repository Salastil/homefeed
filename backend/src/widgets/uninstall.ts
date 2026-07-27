import fs from 'node:fs';
import path from 'node:path';
import { db } from '../storage/db/index.js';
import * as installedWidgetsDb from '../storage/db/installedWidgets.js';
import { logger } from '../storage/db/logs.js';
import { loadedWidgets } from './registry.js';
import { sweepWidgetData } from './sweep.js';
import { stopWidgetPolling } from '../queue/scheduler.js';

const WIDGETS_INSTALLED_DIR = process.env.WIDGETS_INSTALLED_DIR || './data/widgets-installed';
const WIDGETS_DATA_DIR = process.env.WIDGETS_DATA_DIR || './data/widgets-data';

// Fully removes an uploaded widget — safe to call even if its code is already
// broken/missing (the plugin.uninstall() step is best-effort; sweepWidgetData is the real
// guarantee, matching every table/kv row/on-disk file regardless of the widget's own
// cooperation). Callers (see api/admin.ts's DELETE /api/admin/widgets/:id) are
// responsible for rejecting built-in widgets before calling this.
export async function uninstallWidget(id: string): Promise<void> {
	stopWidgetPolling(id);

	const plugin = loadedWidgets.get(id);
	if (plugin?.uninstall) {
		try {
			plugin.uninstall(db);
		} catch (err) {
			logger.error('widgets', `uninstall() hook failed for "${id}": ${(err as Error).message}`);
		}
	}

	const row = installedWidgetsDb.getInstalled(id);
	sweepWidgetData(db, id, row?.ownedTables ?? []);

	fs.rmSync(path.join(WIDGETS_INSTALLED_DIR, id), { recursive: true, force: true });
	fs.rmSync(path.join(WIDGETS_DATA_DIR, id), { recursive: true, force: true });

	loadedWidgets.delete(id);
	installedWidgetsDb.deleteInstalled(id);
}
