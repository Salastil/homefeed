import type { InferenceProvider } from '../inference/provider.js';
import { logger } from '../storage/db/logs.js';
import * as contentItems from '../storage/db/contentItems.js';
import type { ContentItem } from '../storage/db/types.js';

/** Computes and stores an embedding for any content item that doesn't have one yet. */
export async function embedPendingItems(
	provider: InferenceProvider,
	model: string,
	items: ContentItem[]
): Promise<ContentItem[]> {
	const withEmbeddings: ContentItem[] = [];
	for (const item of items) {
		if (item.embedding) {
			withEmbeddings.push(item);
			continue;
		}
		try {
			const embedding = await provider.embed(`${item.title}\n${item.summary}`, { model });
			contentItems.setEmbedding(item.id, embedding);
			withEmbeddings.push({ ...item, embedding });
		} catch (err) {
			logger.error('synthesis', `Embedding failed for item ${item.id}: ${(err as Error).message}`);
		}
	}
	return withEmbeddings;
}

export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
	let dot = 0,
		normA = 0,
		normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] ** 2;
		normB += b[i] ** 2;
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
