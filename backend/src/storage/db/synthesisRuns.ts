import { db } from './index.js';

export interface SynthesisRun {
	id: number;
	timestamp: string;
	kind: 'merge' | 'recap';
	/** Null if the article was somehow deleted between publish and this row being read — shouldn't happen in practice since insertArticle always precedes recordSynthesisRun (see publish.ts), but retention could in principle race it. */
	articleId: string | null;
	articleTitle: string;
	sourceCount: number;
	model: string;
	numCtx: number;
	numPredict: number;
	promptTokens: number | null;
	promptTokensPerSec: number | null;
	genTokens: number | null;
	genTokensPerSec: number | null;
	totalDurationMs: number;
}

function rowToRun(row: any): SynthesisRun {
	return {
		id: row.id,
		timestamp: row.timestamp,
		kind: row.kind,
		articleId: row.article_id,
		articleTitle: row.article_title,
		sourceCount: row.source_count,
		model: row.model,
		numCtx: row.num_ctx,
		numPredict: row.num_predict,
		promptTokens: row.prompt_tokens,
		promptTokensPerSec: row.prompt_tokens_per_sec,
		genTokens: row.gen_tokens,
		genTokensPerSec: row.gen_tokens_per_sec,
		totalDurationMs: row.total_duration_ms
	};
}

/** Called once a synthesis call has actually resulted in a published article — see publishCluster/publishEventRecap in pipeline/publish.ts. */
export function recordSynthesisRun(run: Omit<SynthesisRun, 'id' | 'timestamp'>): void {
	db.prepare(
		`INSERT INTO synthesis_runs
		 (timestamp, kind, article_id, article_title, source_count, model, num_ctx, num_predict, prompt_tokens, prompt_tokens_per_sec, gen_tokens, gen_tokens_per_sec, total_duration_ms)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		new Date().toISOString(),
		run.kind,
		run.articleId,
		run.articleTitle,
		run.sourceCount,
		run.model,
		run.numCtx,
		run.numPredict,
		run.promptTokens,
		run.promptTokensPerSec,
		run.genTokens,
		run.genTokensPerSec,
		run.totalDurationMs
	);
}

export function listSynthesisRuns(filters: { limit?: number } = {}): SynthesisRun[] {
	const limit = Math.min(filters.limit ?? 100, 500);
	const rows = db.prepare('SELECT * FROM synthesis_runs ORDER BY id DESC LIMIT ?').all(limit);
	return rows.map(rowToRun);
}
