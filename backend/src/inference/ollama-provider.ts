import { Agent } from 'undici';
import type { InferenceProvider } from './provider.js';
import * as stats from './stats.js';

/**
 * Node's global fetch (undici) defaults to a 5-minute headers/body timeout — fine for
 * ordinary HTTP calls, but a real problem for /api/generate on CPU-only inference: a
 * near-full context window can legitimately take longer than that just for prompt
 * processing on the reference hardware (i5-6600K, no GPU, ~17 tokens/sec). Once
 * synthesis prompts started carrying full article bodies instead of short blurbs, every
 * generate() call past a few thousand tokens got killed at exactly 5m0s — visible in
 * Ollama's own log as the request being cancelled, not a genuine model/server error —
 * so no cluster could ever finish synthesizing. No timeout at all here; Ollama's own
 * process is the natural backstop, not a clock tuned for hardware this doesn't run on.
 */
const noTimeoutDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

/**
 * Default context window / max-generation length requested from Ollama when a caller
 * doesn't specify its own. Ollama otherwise falls back to whatever the model's
 * Modelfile/runner defaults to (observed as low as 4096 tokens for qwen2.5:7b-instruct
 * here, well under that model's 32768-token training context) and SILENTLY truncates
 * any prompt that doesn't fit — dropping the middle of the prompt with no error
 * surfaced anywhere. Explicitly setting num_ctx/num_predict on every request makes the
 * limit deliberate and stable instead of whatever Ollama happens to pick.
 *
 * 8192 is sized for CPU-only inference (the reference box is an i5-6600K running
 * Ollama in Docker, no GPU, ~17 tokens/sec prompt processing) — RAM is not the
 * constraint (48GB available; the KV cache for 8192 tokens is well under 1GB), but
 * prompt-processing time scales with context, so this trades headroom against
 * per-request latency rather than maxing out the model's full 32768-token capacity.
 * Callers that build prompts (see pipeline/synthesis.ts) size their own content to fit
 * within this budget up front, rather than relying on Ollama to truncate for them.
 */
export const DEFAULT_NUM_CTX = 8192;
export const DEFAULT_NUM_PREDICT = 700;

/**
 * Talks to a self-hosted Ollama instance over HTTP. Address is a normal backend
 * setting (GlobalSettings.aiServiceHost/Port), editable via the admin panel —
 * see the Connections tab and "AI service connection" in the schema doc.
 */
export class OllamaProvider implements InferenceProvider {
	constructor(
		private host: string,
		private port: number
	) {}

	private base(): string {
		return `${this.host}:${this.port}`;
	}

	async generate(
		prompt: string,
		opts: { model?: string; system?: string; numCtx?: number; numPredict?: number; label?: string } = {}
	): Promise<string> {
		const startedAt = Date.now();
		stats.recordGenerateStart(opts.label ?? 'synthesis');
		try {
			const res = await fetch(`${this.base()}/api/generate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: opts.model,
					prompt,
					system: opts.system,
					stream: false,
					options: {
						num_ctx: opts.numCtx ?? DEFAULT_NUM_CTX,
						num_predict: opts.numPredict ?? DEFAULT_NUM_PREDICT
					}
				}),
				// Not in the ambient RequestInit type this project resolves to, but Node's global
				// fetch (built on undici) honors it at runtime — see noTimeoutDispatcher above.
				dispatcher: noTimeoutDispatcher
			} as RequestInit);
			if (!res.ok) throw new Error(`Ollama generate failed: ${res.status} ${await res.text()}`);
			const data = (await res.json()) as {
				response: string;
				eval_count?: number;
				eval_duration?: number;
				prompt_eval_count?: number;
				prompt_eval_duration?: number;
				total_duration?: number;
			};
			// Ollama reports these *_duration fields in nanoseconds — dividing eval_count by
			// (eval_duration/1e9) gives generation tokens/sec, and total_duration/1e6 gives
			// wall-clock milliseconds (falling back to a local measurement if a given Ollama
			// version's response ever omits it).
			stats.recordGenerateEnd({
				genTokensPerSec: data.eval_count && data.eval_duration ? data.eval_count / (data.eval_duration / 1e9) : null,
				promptTokensPerSec:
					data.prompt_eval_count && data.prompt_eval_duration ? data.prompt_eval_count / (data.prompt_eval_duration / 1e9) : null,
				totalDurationMs: data.total_duration ? data.total_duration / 1e6 : Date.now() - startedAt
			});
			return data.response;
		} catch (err) {
			stats.recordGenerateEnd(null);
			throw err;
		}
	}

	async embed(text: string, opts: { model?: string } = {}): Promise<number[]> {
		const res = await fetch(`${this.base()}/api/embeddings`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: opts.model, prompt: text }),
			// Ollama serves one inference request at a time (n_slots = 1) — an embed call
			// queued behind a slow generate() call waits for that same slot, and on this
			// CPU-only hardware a generate() call can easily run past 5 minutes. Without
			// this, that wait alone was enough to trip the same default fetch timeout
			// generate() had (see noTimeoutDispatcher above), silently dropping the item
			// from embedPendingItems — it never got clustered, so a single-source item
			// unlucky enough to be embedded while Ollama was busy never published at all,
			// retried every cycle with the same result for as long as Ollama stayed busy.
			dispatcher: noTimeoutDispatcher
		} as RequestInit);
		if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
		const data = (await res.json()) as { embedding: number[] };
		return data.embedding;
	}

	async listModels(): Promise<string[]> {
		const res = await fetch(`${this.base()}/api/tags`);
		if (!res.ok) throw new Error(`Ollama listModels failed: ${res.status}`);
		const data = (await res.json()) as { models: { name: string }[] };
		return data.models.map((m) => m.name);
	}

	async isReachable(): Promise<boolean> {
		try {
			const res = await fetch(`${this.base()}/api/tags`, { signal: AbortSignal.timeout(3000) });
			return res.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Ollama's /api/show returns a model_info object whose keys are prefixed by the
	 * model's own architecture name (e.g. "qwen2.context_length", "llama.context_length")
	 * rather than one fixed field — there's no single stable key across model families.
	 * Scanning for whichever key ends in ".context_length" avoids hardcoding a list of
	 * known architectures that will inevitably miss a future/uncommon one. Returns null
	 * (rather than throwing) on any failure — the admin-facing slider falls back to a
	 * generous default cap when this can't be determined, rather than blocking the whole
	 * Models tab on one unreliable, best-effort lookup.
	 */
	async getModelContextLength(model: string): Promise<number | null> {
		try {
			const res = await fetch(`${this.base()}/api/show`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model, name: model }),
				signal: AbortSignal.timeout(5000)
			});
			if (!res.ok) return null;
			const data = (await res.json()) as { model_info?: Record<string, unknown> };
			const entry = Object.entries(data.model_info ?? {}).find(([key]) => key.endsWith('.context_length'));
			const value = entry?.[1];
			return typeof value === 'number' && value > 0 ? value : null;
		} catch {
			return null;
		}
	}
}
