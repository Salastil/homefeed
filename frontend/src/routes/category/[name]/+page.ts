import type { PageLoad } from './$types';
import { getFeed } from '$lib/api';

const PAGE_SIZE = 15;

// Every category page (including "Local") filters by its category name — sources are
// assigned categories directly via checkboxes in the admin Sources tab, so a source
// tagged "Local" shows up here the same way one tagged "Tech" shows up on /category/tech.
export const load: PageLoad = async ({ params, fetch }) => {
	const name = params.name;
	const filters = { category: name };
	const initial = await getFeed({ ...filters, limit: PAGE_SIZE }, fetch);
	return { initial, filters, name, pageSize: PAGE_SIZE };
};
