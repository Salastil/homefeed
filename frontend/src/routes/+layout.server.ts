import type { LayoutServerLoad } from './$types';

// The admin panel is off by default on every deployment — it only appears (cog icon
// and the /admin/* pages themselves, see admin/+layout.svelte) once this is
// explicitly turned on. This is a UI-visibility gate only; the backend's API key
// check on every /api/admin/* request is what actually protects it either way.
export const load: LayoutServerLoad = async () => {
	return { adminPanelEnabled: process.env.ADMIN_PANEL_ENABLED === 'true' };
};
