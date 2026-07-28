export interface InferenceProvider {
	generate(
		prompt: string,
		opts?: { model?: string; system?: string; numCtx?: number; numPredict?: number; label?: string }
	): Promise<string>;
	embed(text: string, opts?: { model?: string }): Promise<number[]>;
	listModels(): Promise<string[]>;
	isReachable(): Promise<boolean>;
	/** The model's own reported max context length (training/architecture limit), or null if the server doesn't expose it — used to bound the admin-facing num_ctx slider (Models tab) so it can't be set past what the model actually supports. */
	getModelContextLength(model: string): Promise<number | null>;
}
