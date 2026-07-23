import type { PageLoad } from './$types';
import { getFeed } from '$lib/api';

const PAGE_SIZE = 15;

// Mirrors /category/[name] — a tracked event is a displayed category too, just backed
// by a source+keyword filter instead of manual per-source category checkboxes (see
// EventsTab.svelte). The event's own name comes from the root layout's already-loaded
// active-events list (same pattern category pages use to resolve a slug back to a
// real category name) rather than a second fetch.
export const load: PageLoad = async ({ params, fetch, parent }) => {
	const { events } = await parent();
	const match = events.find((e) => e.id === params.id);

	const filters = { eventId: params.id };
	const initial = await getFeed({ ...filters, limit: PAGE_SIZE }, fetch);
	return { initial, filters, name: match?.name ?? 'Tracked event', pageSize: PAGE_SIZE };
};
