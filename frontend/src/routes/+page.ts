import type { PageLoad } from './$types';
import { getFeed } from '$lib/api';

const PAGE_SIZE = 15;

export const load: PageLoad = async ({ fetch }) => {
	const initial = await getFeed({ limit: PAGE_SIZE }, fetch);
	return { initial, pageSize: PAGE_SIZE };
};
