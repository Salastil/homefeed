import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getEventTimeline } from '$lib/api';

const RANGES = [3, 6, 12, 24, 72];

export const load: PageLoad = async ({ params, fetch, url }) => {
	const hours = RANGES.includes(Number(url.searchParams.get('h'))) ? Number(url.searchParams.get('h')) : 12;
	try {
		const timeline = await getEventTimeline(params.id, hours, fetch);
		return { timeline, hours, ranges: RANGES, selected: url.searchParams.get('dev') };
	} catch (err) {
		const status = (err as { status?: number }).status;
		if (status === 404) error(404, 'Tracked event not found');
		throw err;
	}
};
