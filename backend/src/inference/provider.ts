export interface InferenceProvider {
	generate(prompt: string, opts?: { model?: string; system?: string; numCtx?: number; numPredict?: number }): Promise<string>;
	embed(text: string, opts?: { model?: string }): Promise<number[]>;
	listModels(): Promise<string[]>;
	isReachable(): Promise<boolean>;
}
