import { Agent } from 'undici';
import type { InferenceProvider } from './provider.js';

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
		opts: { model?: string; system?: string; numCtx?: number; numPredict?: number } = {}
	): Promise<string> {
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
		const data = (await res.json()) as { response: string };
		return data.response;
	}

	async embed(text: string, opts: { model?: string } = {}): Promise<number[]> {
		const res = await fetch(`${this.base()}/api/embeddings`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: opts.model, prompt: text })
		});
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
}
