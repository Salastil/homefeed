import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getStoryline } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	try {
		return { storyline: await getStoryline(params.id, fetch) };
	} catch (err) {
		// Storylines are deleted once all their articles age out, so old links 404 by design.
		if ((err as { status?: number }).status === 404) error(404, 'This storyline has closed and its articles have aged out');
		throw err;
	}
};
