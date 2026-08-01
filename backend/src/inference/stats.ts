/**
 * In-memory-only tracking of Ollama generate() throughput and in-flight status, for the
 * admin "Logs" dashboard (see queue/backlogStats.ts, api/admin.ts's GET
 * /api/admin/pipeline-stats). Deliberately not persisted to disk — a restart losing a
 * few minutes of rolling samples is fine, since the next few generate() calls rebuild it.
 */

const MAX_SAMPLES = 20;

export interface GenerateSample {
	/** Generation speed (tokens/sec) from Ollama's eval_count/eval_duration — null if the response omitted them. */
	genTokensPerSec: number | null;
	/** Prompt-processing speed (tokens/sec) from prompt_eval_count/prompt_eval_duration — usually the dominant cost on CPU-only inference. */
	promptTokensPerSec: number | null;
	totalDurationMs: number;
}

const samples: GenerateSample[] = [];
let inFlight: { label: string; startedAt: number } | null = null;

/** Call immediately before issuing a generate() request. */
export function recordGenerateStart(label: string): void {
	inFlight = { label, startedAt: Date.now() };
}

/** Call in a finally block after the request settles — pass null on failure/abort. */
export function recordGenerateEnd(sample: GenerateSample | null): void {
	inFlight = null;
	if (!sample) return;
	samples.push(sample);
	if (samples.length > MAX_SAMPLES) samples.shift();
}

export function getInFlight(): { label: string; elapsedMs: number } | null {
	return inFlight ? { label: inFlight.label, elapsedMs: Date.now() - inFlight.startedAt } : null;
}

function average(nums: number[]): number | null {
	if (nums.length === 0) return null;
	return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export interface ThroughputStats {
	sampleCount: number;
	avgGenTokensPerSec: number | null;
	avgPromptTokensPerSec: number | null;
	avgGenerateDurationMs: number | null;
}

export function getThroughput(): ThroughputStats {
	return {
		sampleCount: samples.length,
		avgGenTokensPerSec: average(samples.map((s) => s.genTokensPerSec).filter((n): n is number => n !== null)),
		avgPromptTokensPerSec: average(samples.map((s) => s.promptTokensPerSec).filter((n): n is number => n !== null)),
		avgGenerateDurationMs: average(samples.map((s) => s.totalDurationMs))
	};
}
