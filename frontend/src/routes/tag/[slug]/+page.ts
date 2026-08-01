import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { getFeed, getTagBySlug } from '$lib/api';

const PAGE_SIZE = 15;

// Mirrors /category/[name] and /event/[id] — a tag chip links by slug, so the slug is
// resolved to the real tag (id + label) via a dedicated backend lookup (GET
// /api/tag/:slug) rather than a preloaded list, since tags aren't loaded by the root
// layout the way categories/events are.
export const load: PageLoad = async ({ params, fetch }) => {
	let tag;
	try {
		tag = await getTagBySlug(params.slug, fetch);
	} catch {
		throw error(404, 'Tag not found');
	}

	const filters = { tag: tag.id };
	const initial = await getFeed({ ...filters, limit: PAGE_SIZE }, fetch);
	return { initial, filters, tag, pageSize: PAGE_SIZE };
};
