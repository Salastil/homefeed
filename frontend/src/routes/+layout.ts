import type { LayoutLoad } from './$types';
import { getCategories, getEvents } from '$lib/api';
import { getPrivateAccessStatus } from '$lib/privateAccess';

export const load: LayoutLoad = async ({ fetch, data }) => {
	const [categories, events, privateAccess] = await Promise.all([
		getCategories(fetch),
		getEvents(fetch),
		getPrivateAccessStatus(fetch)
	]);
	// Tracked events are a displayed category like any other (see MergeTab/EventsTab) —
	// only active ones show up as browsable, same as a paused/disabled category wouldn't.
	return { ...data, categories, events: events.filter((e) => e.active), privateAccess };
};
