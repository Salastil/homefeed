import { env } from '$env/dynamic/private';
import type { LayoutServerLoad } from './$types';

// The admin panel is off by default on every deployment — it only appears (cog icon
// and the /admin/* pages themselves, see admin/+layout.svelte) once this is
// explicitly turned on. This is a UI-visibility gate only; the backend's API key
// check on every /api/admin/* request is what actually protects it either way.
//
// Uses $env/dynamic/private rather than raw process.env — Vite does not inject
// arbitrary (non-VITE_-prefixed) .env vars into process.env for server code, so
// process.env.ADMIN_PANEL_ENABLED is always undefined here even with it set in
// frontend/.env. $env/dynamic/private is SvelteKit's own env accessor and reads it
// correctly in dev, preview, and any adapter-based deployment.
export const load: LayoutServerLoad = async () => {
	return { adminPanelEnabled: env.ADMIN_PANEL_ENABLED === 'true' };
};
