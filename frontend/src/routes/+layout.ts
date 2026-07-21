import type { LayoutLoad } from './$types';
import { getCategories } from '$lib/api';

export const load: LayoutLoad = async ({ fetch }) => {
	const categories = await getCategories(fetch);
	return { categories };
};
