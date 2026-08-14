<script lang="ts">
	import type { AdminSettings, ModelCatalog, AiStatusBySlot } from '$lib/adminTypes';
	import { updateSettings, getAiStatus, testAiConnection, getModelContext } from '$lib/adminApi';
	import SaveStatus from './SaveStatus.svelte';

	let { settings, models, aiStatus: initialStatus }: { settings: AdminSettings; models: ModelCatalog; aiStatus: AiStatusBySlot } =
		$props();

	let selected = $state({ ...settings.selectedModels });
	let aiStatus = $state(initialStatus);
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

	// Embedding/clustering and article synthesis each get their own independent
	// inference-server connection — same host/port/Test/Save shape ConnectionsTab used
	// for the single shared connection this replaces, just duplicated per slot.
	let embeddingHost = $state(settings.embeddingServiceHost);
	let embeddingPort = $state(settings.embeddingServicePort);
	let embeddingTesting = $state(false);
	let embeddingConnStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

	let synthesisHost = $state(settings.synthesisServiceHost);
	let synthesisPort = $state(settings.synthesisServicePort);
	let synthesisTesting = $state(false);
	let synthesisConnStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

	let disableThinking = $state(settings.synthesisDisableThinking);
	let thinkingStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

	async function saveDisableThinking() {
		thinkingStatus = 'saving';
		try {
			await updateSettings({ synthesisDisableThinking: disableThinking });
			thinkingStatus = 'saved';
			setTimeout(() => (thinkingStatus = 'idle'), 1500);
		} catch {
			thinkingStatus = 'error';
		}
	}

	async function saveEmbeddingConnection() {
		embeddingConnStatus = 'saving';
		try {
			await updateSettings({ embeddingServiceHost: embeddingHost, embeddingServicePort: embeddingPort });
			aiStatus = await getAiStatus();
			embeddingConnStatus = 'saved';
			setTimeout(() => (embeddingConnStatus = 'idle'), 1500);
		} catch {
			embeddingConnStatus = 'error';
		}
	}

	async function testEmbeddingConnection() {
		embeddingTesting = true;
		try {
			// Tests whatever's currently typed in the fields, not the last-saved value —
			// only updates this panel's own status, leaving the synthesis panel alone.
			aiStatus = { ...aiStatus, embedding: await testAiConnection(embeddingHost, embeddingPort) };
		} finally {
			embeddingTesting = false;
		}
	}

	async function saveSynthesisConnection() {
		synthesisConnStatus = 'saving';
		try {
			await updateSettings({ synthesisServiceHost: synthesisHost, synthesisServicePort: synthesisPort });
			aiStatus = await getAiStatus();
			synthesisConnStatus = 'saved';
			setTimeout(() => (synthesisConnStatus = 'idle'), 1500);
		} catch {
			synthesisConnStatus = 'error';
		}
	}

	async function testSynthesisConnection() {
		synthesisTesting = true;
		try {
			aiStatus = { ...aiStatus, synthesis: await testAiConnection(synthesisHost, synthesisPort) };
		} finally {
			synthesisTesting = false;
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
		<span class="panel-title">Embedding &amp; clustering</span>
	</div>
	<p class="hint">
		Inference server used for embedding/clustering calls. Independent of the synthesis
		connection below — point it at a different Ollama install if you want.
	</p>
	<div class="row">
		<input type="text" bind:value={embeddingHost} placeholder="http://10.0.0.14" style="flex: 1" />
		<input type="text" bind:value={embeddingPort} placeholder="11434" style="width: 90px" />
		<button onclick={testEmbeddingConnection} disabled={embeddingTesting}>{embeddingTesting ? 'Testing…' : 'Test'}</button>
		<button class="primary" onclick={saveEmbeddingConnection}>Save</button>
		<SaveStatus status={embeddingConnStatus} />
	</div>
	<div class="status-row">
		{#if aiStatus.embedding.connected}
			<span class="connected">✓ Connected · {aiStatus.embedding.host}:{aiStatus.embedding.port}</span>
		{:else}
			<span class="disconnected">✕ Unreachable</span>
		{/if}
	</div>
	<select bind:value={selected.embedding} onchange={save} style="margin-top: 12px;">
		{#each models.embedding as m}
			<option value={m}>{m}</option>
		{/each}
	</select>
</div>

<div class="panel accent">
	<div class="head">
		<span class="panel-title">Article synthesis</span>
	</div>
	<p class="hint">Inference server used for article synthesis and recaps.</p>
	<div class="row">
		<input type="text" bind:value={synthesisHost} placeholder="http://10.0.0.14" style="flex: 1" />
		<input type="text" bind:value={synthesisPort} placeholder="11434" style="width: 90px" />
		<button onclick={testSynthesisConnection} disabled={synthesisTesting}>{synthesisTesting ? 'Testing…' : 'Test'}</button>
		<button class="primary" onclick={saveSynthesisConnection}>Save</button>
		<SaveStatus status={synthesisConnStatus} />
	</div>
	<div class="status-row">
		{#if aiStatus.synthesis.connected}
			<span class="connected">✓ Connected · {aiStatus.synthesis.host}:{aiStatus.synthesis.port}</span>
		{:else}
			<span class="disconnected">✕ Unreachable</span>
		{/if}
	</div>
	<select bind:value={selected.synthesis} onchange={save} style="margin-top: 12px;">
		{#each models.synthesis as m}
			<option value={m}>{m}</option>
		{/each}
	</select>

	<label class="checkbox" style="margin-top: 12px;">
		<input type="checkbox" bind:checked={disableThinking} onchange={saveDisableThinking} />
		Disable reasoning (think: false)
		<SaveStatus status={thinkingStatus} />
	</label>
	<p class="hint">
		Reasoning models (Qwen3, DeepSeek-R1, and similar) silently "think" through a hidden pass
		before writing their actual response, even for a rewrite/merge task with no logic or math
		to work through — that reasoning is pure overhead here, slows generation down, and can eat
		into the response budget for no quality benefit. Turn this on if your selected synthesis
		model supports reasoning — it's ignored harmlessly if it doesn't.
	</p>
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
	.checkbox {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.checkbox input {
		width: auto;
	}
	.hint {
		font-size: 12px;
		color: var(--text-secondary);
		margin: 4px 0 12px;
	}
	.row {
		display: flex;
		gap: 8px;
		margin-bottom: 10px;
	}
	.primary {
		background: var(--pill-bg);
		color: var(--pill-text);
		border-color: var(--pill-bg);
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
