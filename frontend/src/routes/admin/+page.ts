import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// There's no page at exactly /admin — only /admin/login and /admin/settings — so a
// bare visit here would otherwise 404. Settings itself already redirects to login on
// a 401, so sending everyone through there is the one sensible default landing spot.
export const load: PageLoad = async () => {
	throw redirect(302, '/admin/settings');
};
