import type { InferenceProvider } from './provider.js';

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

	async generate(prompt: string, opts: { model?: string; system?: string } = {}): Promise<string> {
		const res = await fetch(`${this.base()}/api/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: opts.model,
				prompt,
				system: opts.system,
				stream: false
			})
		});
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
