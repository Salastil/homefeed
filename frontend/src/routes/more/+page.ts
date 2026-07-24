import type { PageLoad } from './$types';
import { getFeed } from '$lib/api';

const PREVIEW_COUNT = 4;

// The "More »" nav tab (see +layout.svelte) leads here — one section per spillover
// category (see MergeTab.svelte's "More" toggle) with its few newest articles, the
// category name itself linking through to the full /category/:slug page. Mirrors
// category/[name]/+page.ts's parent()-based category access rather than a second fetch.
export const load: PageLoad = async ({ fetch, parent }) => {
	const { categories } = await parent();
	const spillover = categories.filter((c) => c.isSpillover);

	const sections = await Promise.all(
		spillover.map(async (category) => ({
			category,
			articles: await getFeed({ category: category.name, limit: PREVIEW_COUNT }, fetch)
		}))
	);

	return { sections };
};
