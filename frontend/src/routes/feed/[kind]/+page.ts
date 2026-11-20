import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getFeed } from '$lib/api';

const PAGE_SIZE = 15;
const NAMES = { wire: 'Wire', general: 'General' } as const;

// The board's two catch-all columns as full feeds: posts (Wire) and articles (General) that
// have no category and aren't part of a tracked event.
export const load: PageLoad = async ({ params, fetch }) => {
	const kind = params.kind;
	if (kind !== 'wire' && kind !== 'general') error(404, 'No such feed');
	const filters = { kind } as const;
	const initial = await getFeed({ ...filters, limit: PAGE_SIZE }, fetch);
	return { initial, filters, name: NAMES[kind], pageSize: PAGE_SIZE };
};
