<script lang="ts">
	import type { AdminSettings, ModelCatalog, AiStatus } from '$lib/adminTypes';
	import { updateSettings, getAiStatus, getModelContext } from '$lib/adminApi';
	import SaveStatus from './SaveStatus.svelte';

	let { settings, models, aiStatus: initialStatus }: { settings: AdminSettings; models: ModelCatalog; aiStatus: AiStatus } =
		$props();

	let selected = $state({ ...settings.selectedModels });
	let aiStatus = $state(initialStatus);
	let testing = $state(false);
	let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

	async function save() {
		status = 'saving';
		try {
			await updateSettings({ selectedModels: selected });
			status = 'saved';
			setTimeout(() => (status = 'idle'), 1500);
		} catch {
			status = 'error';
		}
	}

	async function testConnection() {
		testing = true;
		try {
			aiStatus = await getAiStatus();
		} finally {
			testing = false;
		}
	}

	// Context window / max response length — see backend/src/inference/ollama-provider.ts's
	// DEFAULT_NUM_CTX/DEFAULT_NUM_PREDICT for why these are ever explicit at all: too low a
	// num_predict silently truncates the model's output mid-sentence rather than erroring
	// (this is what a "cut off" article/recap means), and num_ctx bounds how much source
	// text can even be included in the prompt before it gets trimmed.
	let numCtx = $state(settings.synthesisNumCtx);
	let numPredict = $state(settings.synthesisNumPredict);
	let contextStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let contextSaveTimer: ReturnType<typeof setTimeout>;

	// The selected synthesis model's own reported max context (via Ollama's /api/show) —
	// null when undetectable (older Ollama, unusual model format, unreachable), in which
	// case the slider falls back to a generous cap rather than blocking on it.
	let detectedMax = $state<number | null>(null);
	let detecting = $state(false);
	const FALLBACK_MAX_CTX = 32768;
	let maxCtx = $derived(detectedMax ?? FALLBACK_MAX_CTX);
	// num_predict counts against the same context window as the prompt — capping it well
	// under num_ctx leaves room for the prompt itself to actually fit.
	let maxPredict = $derived(Math.max(100, numCtx - 512));

	async function detectContext(model: string) {
		if (!model) return;
		detecting = true;
		try {
			const info = await getModelContext(model);
			detectedMax = info.contextLength;
		} catch {
			detectedMax = null;
		} finally {
			detecting = false;
		}
	}

	$effect(() => {
		detectContext(selected.synthesis);
	});

	function scheduleContextSave() {
		contextStatus = 'saving';
		clearTimeout(contextSaveTimer);
		contextSaveTimer = setTimeout(async () => {
			try {
				await updateSettings({ synthesisNumCtx: numCtx, synthesisNumPredict: numPredict });
				contextStatus = 'saved';
				setTimeout(() => (contextStatus = 'idle'), 1500);
			} catch {
				contextStatus = 'error';
			}
		}, 500);
	}

	function onNumCtxChange() {
		if (numPredict > numCtx - 512) numPredict = Math.max(100, numCtx - 512);
		scheduleContextSave();
	}
</script>

<div class="panel">
	<div class="head">
		<span class="panel-title">AI service connection</span>
	</div>
	<p class="hint">
		Address of your self-hosted inference server (e.g. Ollama). Model lists below are fetched
		live from it.
	</p>
	<div class="status-row">
		{#if aiStatus.connected}
			<span class="connected">✓ Connected · {aiStatus.host}:{aiStatus.port} · {aiStatus.ramGB}GB RAM · GPU: {aiStatus.gpu}</span>
		{:else}
			<span class="disconnected">✕ Unreachable</span>
		{/if}
		<button onclick={testConnection} disabled={testing}>{testing ? 'Testing…' : 'Test'}</button>
	</div>
</div>

<div class="panel">
	<div class="head">
		<span class="panel-title">Embedding &amp; clustering</span>
	</div>
	<select bind:value={selected.embedding} onchange={save}>
		{#each models.embedding as m}
			<option value={m}>{m}</option>
		{/each}
	</select>
</div>

<div class="panel">
	<div class="head">
		<span class="panel-title">Image selection</span>
	</div>
	<select bind:value={selected.image} onchange={save}>
		{#each models.image as m}
			<option value={m}>{m}</option>
		{/each}
	</select>
</div>

<div class="panel accent">
	<div class="head">
		<span class="panel-title">Article synthesis</span>
		<SaveStatus {status} />
	</div>
	<select bind:value={selected.synthesis} onchange={save}>
		{#each models.synthesis as m}
			<option value={m}>{m}</option>
		{/each}
	</select>
</div>

<div class="panel">
	<div class="head">
		<span class="panel-title">Context window</span>
		<SaveStatus status={contextStatus} />
	</div>
	<p class="hint">
		How much text the synthesis model can take in (context window) and how long its response
		can be (max response length). Too low a response limit is why an article or event recap
		sometimes cuts off mid-sentence instead of finishing.
		{#if detecting}
			Detecting {selected.synthesis}'s limit…
		{:else if detectedMax}
			Detected max for {selected.synthesis}: {detectedMax.toLocaleString()} tokens.
		{:else}
			Couldn't detect a limit for {selected.synthesis} — defaulting the slider's ceiling to
			{FALLBACK_MAX_CTX.toLocaleString()}. Setting num_ctx above what the model actually
			supports will make Ollama reject or silently degrade requests.
		{/if}
	</p>

	<label class="field-label" for="num-ctx">
		Context window (num_ctx) — {numCtx.toLocaleString()} tokens
	</label>
	<div class="slider-row">
		<input
			id="num-ctx"
			type="range"
			min="1024"
			max={maxCtx}
			step="512"
			bind:value={numCtx}
			oninput={onNumCtxChange}
		/>
	</div>

	<label class="field-label" for="num-predict" style="margin-top: 12px;">
		Max response length (num_predict) — {numPredict.toLocaleString()} tokens
	</label>
	<div class="slider-row">
		<input
			id="num-predict"
			type="range"
			min="100"
			max={maxPredict}
			step="50"
			bind:value={numPredict}
			oninput={scheduleContextSave}
		/>
	</div>
</div>

<style>
	.panel {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 16px;
		margin-bottom: 12px;
	}
	.panel.accent {
		border: 0.5px solid var(--border-accent);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}
	.panel-title {
		font-size: 13px;
		font-weight: 500;
	}
	.hint {
		font-size: 12px;
		color: var(--text-secondary);
		margin: 4px 0 12px;
	}
	.status-row {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12px;
	}
	.connected {
		color: var(--text-success);
	}
	.disconnected {
		color: var(--text-danger);
	}
	.field-label {
		display: block;
		font-size: 11px;
		color: var(--text-muted);
		margin-bottom: 6px;
	}
	.slider-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.slider-row input[type='range'] {
		flex: 1;
		border: none;
		padding: 0;
		background: transparent;
	}
	select {
		width: 100%;
	}
</style>
