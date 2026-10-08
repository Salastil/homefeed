import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { getArticle, getTags } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	// Articles genuinely disappear — retention ages them out and the storage cap trims
	// oldest-first — so a link that worked yesterday 404ing is expected, not a fault.
	// Without this it surfaces as a 500 to the reader and as a stack trace in the log.
	const [article, tags] = await Promise.all([
		getArticle(params.id, fetch).catch((err) => {
			if ((err as { status?: number }).status === 404) throw error(404, 'Article not found');
			throw err;
		}),
		getTags(fetch)
	]);

	let nextArticle = null;
	let previousArticle = null;
	if (article.nextArticleId) {
		nextArticle = await getArticle(article.nextArticleId, fetch);
	}
	if (article.previousArticleId) {
		previousArticle = await getArticle(article.previousArticleId, fetch);
	}

	const tagLabels = article.tags
		.map((id) => tags.find((t) => t.id === id))
		.filter((t): t is NonNullable<typeof t> => Boolean(t));

	return { article, tagLabels, nextArticle, previousArticle };
};
