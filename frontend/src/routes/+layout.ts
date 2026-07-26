import type { LayoutLoad } from './$types';
import { getCategories, getEvents, getWeather, getStocks, getBookmarks, getPoe2 } from '$lib/api';
import { getPrivateAccessStatus } from '$lib/privateAccess';

// Named so the layout can be re-fetched on its own (see +layout.svelte's periodic
// invalidate('app:sidebar')) without disturbing page-level loads — e.g. the home feed's
// own pagination state, which a blanket invalidateAll() would reset every refresh.
export const load: LayoutLoad = async ({ fetch, data, depends }) => {
	depends('app:sidebar');
	const [categories, events, privateAccess, weather, stocks, bookmarks, poe2] = await Promise.all([
		getCategories(fetch),
		getEvents(fetch),
		getPrivateAccessStatus(fetch),
		getWeather(fetch),
		getStocks(fetch),
		getBookmarks(fetch),
		getPoe2(fetch)
	]);
	// Tracked events are a displayed category like any other (see MergeTab/EventsTab) —
	// only active ones show up as browsable, same as a paused/disabled category wouldn't.
	return {
		...data,
		categories,
		events: events.filter((e) => e.active),
		privateAccess,
		weather,
		stocks,
		bookmarks,
		poe2
	};
};
