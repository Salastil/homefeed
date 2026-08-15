/** Raw throughput numbers Ollama reports alongside a generate() response — null for any field Ollama's response omits (older versions, or a request that errored before completing). Surfaced to the caller (rather than only feeding the anonymous rolling-average tracker in inference/stats.ts) so a caller that knows which article a call produced can persist per-article benchmark history — see storage/db/synthesisRuns.ts. */
export interface GenerateStats {
	promptTokens: number | null;
	promptTokensPerSec: number | null;
	genTokens: number | null;
	genTokensPerSec: number | null;
	totalDurationMs: number;
}

export interface InferenceProvider {
	generate(
		prompt: string,
		opts?: {
			model?: string;
			system?: string;
			numCtx?: number;
			numPredict?: number;
			label?: string;
			/** Explicitly disables a reasoning model's (e.g. Qwen3, DeepSeek-R1) hidden <think> pass — see GlobalSettings.synthesisDisableThinking for why an admin would want this. Ignored harmlessly by models that don't support reasoning at all. Omit to leave Ollama's default (thinking on, for models that support it). */
			think?: boolean;
			/** A JSON Schema object (or 'json' for schema-less JSON mode) — Ollama constrains the model's actual output tokens to conform via grammar-based sampling, not just a prompt instruction it can ignore or mangle. See pipeline/synthesis.ts for why this replaced a free-text delimiter convention. */
			format?: 'json' | Record<string, unknown>;
		}
	): Promise<{ text: string; stats: GenerateStats }>;
	embed(text: string, opts?: { model?: string }): Promise<number[]>;
	listModels(): Promise<string[]>;
	isReachable(): Promise<boolean>;
	/** The model's own reported max context length (training/architecture limit), or null if the server doesn't expose it — used to bound the admin-facing num_ctx slider (Models tab) so it can't be set past what the model actually supports. */
	getModelContextLength(model: string): Promise<number | null>;
}

/** The two independent inference-server connections — embedding/clustering and article synthesis each get their own (see admin/settings' Models tab). */
export interface AiProviders {
	embedding: InferenceProvider;
	synthesis: InferenceProvider;
}
