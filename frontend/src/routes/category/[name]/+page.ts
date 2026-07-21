import type { PageLoad } from './$types';
import { getFeed } from '$lib/api';

const PAGE_SIZE = 15;

export const load: PageLoad = async ({ params, fetch }) => {
	const name = params.name;
	const isLocal = name.toLowerCase() === 'local';
	const filters = isLocal ? { geo: 'philadelphia' } : { category: name };
	const initial = await getFeed({ ...filters, limit: PAGE_SIZE }, fetch);
	return { initial, filters, name, pageSize: PAGE_SIZE };
};
