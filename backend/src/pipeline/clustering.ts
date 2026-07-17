import { randomUUID } from 'node:crypto';
import { cosineSimilarity } from './embedding.js';
import type { ContentItem } from '../storage/db/types.js';

/**
 * Maps the admin-facing 1-5 strictness slider to a cosine similarity threshold.
 * 1 (loose) merges more readily; 5 (strict) requires near-duplicate stories.
 */
export function strictnessToThreshold(strictness: number): number {
	const table: Record<number, number> = { 1: 0.55, 2: 0.65, 3: 0.75, 4: 0.85, 5: 0.92 };
	return table[strictness] ?? 0.75;
}

export interface Cluster {
	id: string;
	items: ContentItem[];
	centroid: number[];
}

function average(vectors: number[][]): number[] {
	const len = vectors[0].length;
	const sum = new Array(len).fill(0);
	for (const v of vectors) for (let i = 0; i < len; i++) sum[i] += v[i];
	return sum.map((s) => s / vectors.length);
}

/**
 * Greedy single-pass clustering: items already events-only (event-assigned items are
 * excluded upstream — see TrackedEvent handling) get grouped against existing cluster
 * centroids, or start a new cluster if nothing is similar enough.
 */
export function clusterItems(items: ContentItem[], strictness: number): Cluster[] {
	const threshold = strictnessToThreshold(strictness);
	const clusters: Cluster[] = [];

	for (const item of items) {
		if (!item.embedding) continue;

		let best: { cluster: Cluster; score: number } | null = null;
		for (const cluster of clusters) {
			const score = cosineSimilarity(item.embedding, cluster.centroid);
			if (score >= threshold && (!best || score > best.score)) {
				best = { cluster, score };
			}
		}

		if (best) {
			best.cluster.items.push(item);
			best.cluster.centroid = average(best.cluster.items.map((i) => i.embedding!));
		} else {
			clusters.push({ id: randomUUID(), items: [item], centroid: item.embedding });
		}
	}

	return clusters;
}
