import type { PageLoad } from './$types';
import { getFeed } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	const name = params.name;
	const isLocal = name.toLowerCase() === 'local';
	const articles = await getFeed(
		isLocal ? { geo: 'philadelphia' } : { category: name },
		fetch
	);
	return { articles, name };
};
