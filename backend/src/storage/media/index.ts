import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { logger } from '../db/logs.js';

const MEDIA_DIR = process.env.MEDIA_DIR || './data/media';
fs.mkdirSync(MEDIA_DIR, { recursive: true });

export interface StoredMedia {
	id: string;
	localPath: string;
	servedPath: string; // what the API returns to the frontend
	sizeBytes: number;
}

/**
 * Downloads and locally hosts an image (or other media) rather than hotlinking the
 * original — see the retention design doc. `tier` is 'candidate' for raw source
 * images (pruned with raw-item retention) or 'published' for an article's chosen
 * image (kept for the article's own retention lifetime, independent of the source).
 */
export async function downloadAndStore(
	sourceUrl: string,
	tier: 'candidate' | 'published',
	refs: { contentItemId?: string; articleId?: string }
): Promise<StoredMedia | null> {
	try {
		const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) return null;
		const buffer = Buffer.from(await res.arrayBuffer());

		const ext = guessExtension(res.headers.get('content-type') ?? '', sourceUrl);
		const id = randomUUID();
		const filename = `${id}${ext}`;
		const localPath = path.join(MEDIA_DIR, filename);
		fs.writeFileSync(localPath, buffer);

		db.prepare(
			`INSERT INTO media_assets (id, source_url, local_path, size_bytes, downloaded_at, tier, content_item_id, article_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		).run(id, sourceUrl, localPath, buffer.length, new Date().toISOString(), tier, refs.contentItemId ?? null, refs.articleId ?? null);

		return { id, localPath, servedPath: `/media/${filename}`, sizeBytes: buffer.length };
	} catch (err) {
		logger.error('media', `Failed to download ${sourceUrl}: ${(err as Error).message}`);
		return null;
	}
}

/** Promotes a candidate-tier asset to published-tier so raw-item retention can no longer prune it. */
export function promoteToPublished(mediaId: string, articleId: string) {
	db.prepare("UPDATE media_assets SET tier = 'published', article_id = ? WHERE id = ?").run(articleId, mediaId);
}

export function totalStorageBytes(): number {
	const row = db.prepare('SELECT COALESCE(SUM(size_bytes), 0) as total FROM media_assets').get() as { total: number };
	return row.total;
}

export function deleteCandidateMediaOlderThan(days: number): number {
	const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
	const rows = db
		.prepare("SELECT id, local_path FROM media_assets WHERE tier = 'candidate' AND downloaded_at < ?")
		.all(cutoff) as { id: string; local_path: string }[];
	for (const row of rows) {
		fs.rm(row.local_path, () => {});
	}
	db.prepare("DELETE FROM media_assets WHERE tier = 'candidate' AND downloaded_at < ?").run(cutoff);
	return rows.length;
}

function deleteRows(rows: { id: string; local_path: string }[]) {
	for (const row of rows) fs.rm(row.local_path, () => {});
	return rows.length;
}

export function deleteMediaByArticleId(articleId: string): number {
	const rows = db.prepare('SELECT id, local_path FROM media_assets WHERE article_id = ?').all(articleId) as {
		id: string;
		local_path: string;
	}[];
	const count = deleteRows(rows);
	db.prepare('DELETE FROM media_assets WHERE article_id = ?').run(articleId);
	return count;
}

export function deleteMediaByContentItemIds(contentItemIds: string[]): number {
	if (contentItemIds.length === 0) return 0;
	const placeholders = contentItemIds.map(() => '?').join(',');
	const rows = db
		.prepare(`SELECT id, local_path FROM media_assets WHERE content_item_id IN (${placeholders})`)
		.all(...contentItemIds) as { id: string; local_path: string }[];
	const count = deleteRows(rows);
	db.prepare(`DELETE FROM media_assets WHERE content_item_id IN (${placeholders})`).run(...contentItemIds);
	return count;
}

export function deleteAllMedia(): number {
	const rows = db.prepare('SELECT id, local_path FROM media_assets').all() as { id: string; local_path: string }[];
	const count = deleteRows(rows);
	db.prepare('DELETE FROM media_assets').run();
	return count;
}

function guessExtension(contentType: string, url: string): string {
	if (contentType.includes('jpeg')) return '.jpg';
	if (contentType.includes('png')) return '.png';
	if (contentType.includes('webp')) return '.webp';
	if (contentType.includes('gif')) return '.gif';
	const match = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i);
	return match ? `.${match[1].toLowerCase()}` : '.jpg';
}
