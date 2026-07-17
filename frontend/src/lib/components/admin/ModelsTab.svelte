<script lang="ts">
	import type { AdminSettings, ModelCatalog, AiStatus } from '$lib/adminTypes';
	import { updateSettings, getAiStatus } from '$lib/adminApi';
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
	select {
		width: 100%;
	}
</style>
