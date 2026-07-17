import type { PageLoad } from './$types';
import { getFeed } from '$lib/api';

export const load: PageLoad = async ({ fetch }) => {
	const [all, local] = await Promise.all([
		getFeed({}, fetch),
		getFeed({ geo: 'philadelphia' }, fetch)
	]);

	const byCategory = (name: string) =>
		all.filter((a) => a.category.some((c) => c.toLowerCase() === name.toLowerCase()));

	return {
		hero: all[0] ?? null,
		local,
		business: byCategory('business'),
		tech: byCategory('tech')
	};
};
