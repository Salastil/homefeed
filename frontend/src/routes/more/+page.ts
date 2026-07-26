import type { PageLoad } from './$types';
import { getFeed } from '$lib/api';

const PREVIEW_COUNT = 5;

// The "More »" nav tab (see +layout.svelte) leads here — one section per spillover
// category (see MergeTab.svelte's "More" toggle) or spillover tracked item (see
// EventsTab.svelte's "More" toggle) with its few newest articles, the name itself
// linking through to the full /category/:slug or /event/:id page. Mirrors
// category/[name]/+page.ts's parent()-based category access rather than a second fetch.
export const load: PageLoad = async ({ fetch, parent }) => {
	const { categories, events } = await parent();
	const spilloverCategories = categories.filter((c) => c.isSpillover);
	const spilloverEvents = events.filter((e) => e.isSpillover);

	const categorySections = await Promise.all(
		spilloverCategories.map(async (category) => ({
			category,
			articles: await getFeed({ category: category.name, limit: PREVIEW_COUNT }, fetch)
		}))
	);

	const eventSections = await Promise.all(
		spilloverEvents.map(async (event) => ({
			event,
			articles: await getFeed({ eventId: event.id, limit: PREVIEW_COUNT }, fetch)
		}))
	);

	return { categorySections, eventSections };
};
