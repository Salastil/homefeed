import type { PageLoad } from './$types';
import { getArticle, getTags } from '$lib/api';

export const load: PageLoad = async ({ params, fetch }) => {
	const [article, tags] = await Promise.all([getArticle(params.id, fetch), getTags(fetch)]);

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
