import type { LayoutLoad } from './$types';
import { getCategories } from '$lib/api';

export const load: LayoutLoad = async ({ fetch, data }) => {
	const categories = await getCategories(fetch);
	return { ...data, categories };
};
