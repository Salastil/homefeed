import type { LayoutLoad } from './$types';
import { getCategories } from '$lib/api';
import { getPrivateAccessStatus } from '$lib/privateAccess';

export const load: LayoutLoad = async ({ fetch, data }) => {
	const [categories, privateAccess] = await Promise.all([getCategories(fetch), getPrivateAccessStatus(fetch)]);
	return { ...data, categories, privateAccess };
};
