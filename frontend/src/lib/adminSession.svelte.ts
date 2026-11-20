/**
 * Whether this browser is signed in to the admin panel, for the admin-only tools that live on
 * the board itself: edit mode (issue #1, mockup C1) and the ⌘K palette (C2).
 *
 * "Signed in" means the admin key saved by /admin/login is present AND the backend accepts it
 * right now - a stale key from before a restart, or none at all, leaves every one of those
 * tools hidden. The backend checks the key on every /api/admin/* call regardless, so this is
 * only about not showing controls that can't work.
 */
import { getApiKey } from './adminAuth';
import { getSettings } from './adminApi';

/** What a board edit sheet is open on: a column (by board key), a widget-row slot, or the storyline panel. */
export type EditSheet = { kind: 'column'; key: string } | { kind: 'widgets'; ids: string[] } | { kind: 'panel' } | null;

export const admin = $state<{
	valid: boolean;
	editing: boolean;
	palette: boolean;
	aiWriterEnabled: boolean;
	boardVersion: number;
	sheet: EditSheet;
}>({
	/** The saved admin key exists and the backend accepted it. */
	valid: false,
	/** Board edit mode (C1) is on. */
	editing: false,
	/** The ⌘K palette (C2) is open. */
	palette: false,
	/** Mirrors the AI writer switch, for greying out per-column AI toggles. */
	aiWriterEnabled: true,
	/** Bumped after an edit that changes what the board shows, so it re-reads at once. */
	boardVersion: 0,
	/** The edit sheet open in edit mode, if any. */
	sheet: null
});

/** Checks the saved key against the backend; with the admin panel disabled nothing is shown. */
export async function checkAdmin(panelEnabled: boolean): Promise<void> {
	if (!panelEnabled || !getApiKey()) {
		admin.valid = false;
		return;
	}
	try {
		const s = await getSettings();
		admin.valid = true;
		admin.aiWriterEnabled = s.aiWriterEnabled;
	} catch {
		admin.valid = false;
		admin.editing = false;
		admin.palette = false;
		admin.sheet = null;
	}
}

export function boardChanged() {
	admin.boardVersion++;
}
