import type { PageLoad } from './$types';
import { getFeed } from '$lib/api';
import { slugify } from '$lib/format';

const PAGE_SIZE = 15;

// Every category page (including "Local") filters by its category name — sources are
// assigned categories directly via checkboxes in the admin Sources tab, so a source
// tagged "Local" shows up here the same way one tagged "Tech" shows up on /category/tech.
//
// The URL param is a slug (e.g. "x-news" from slugify("X News")), not the real category
// name — for single-word categories those happen to be the same lowercased, but for a
// multi-word name like "X News" the slug's hyphen never matches the stored "X News"
// (with a space) in a merged_articles.category LIKE match. Resolve the slug back to the
// real category name via the site's own category list (already loaded by the root
// layout) before filtering, rather than passing the raw slug straight through.
export const load: PageLoad = async ({ params, fetch, parent }) => {
	const { categories } = await parent();
	const match = categories.find((c) => slugify(c.name) === params.name);
	const categoryName = match?.name ?? params.name;

	const filters = { category: categoryName };
	const initial = await getFeed({ ...filters, limit: PAGE_SIZE }, fetch);
	return { initial, filters, name: categoryName, pageSize: PAGE_SIZE };
};
