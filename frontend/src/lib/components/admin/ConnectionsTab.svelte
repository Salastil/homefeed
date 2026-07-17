<script lang="ts">
	import type { AdminSettings, AiStatus } from '$lib/adminTypes';
	import { getBackendUrl, setBackendUrl } from '$lib/config';
	import { updateSettings, getAiStatus } from '$lib/adminApi';
	import SaveStatus from './SaveStatus.svelte';

	let { settings, aiStatus: initialStatus }: { settings: AdminSettings; aiStatus: AiStatus } = $props();

	let backendUrl = $state(getBackendUrl());
	let backendSaved = $state(false);

	let aiHost = $state(settings.aiServiceHost);
	let aiPort = $state(settings.aiServicePort);
	let aiStatus = $state(initialStatus);
	let testing = $state(false);
	let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

	function saveBackendUrl() {
		setBackendUrl(backendUrl);
		backendSaved = true;
		setTimeout(() => (backendSaved = false), 1500);
	}

	async function saveAiService() {
		status = 'saving';
		try {
			await updateSettings({ aiServiceHost: aiHost, aiServicePort: aiPort });
			aiStatus = await getAiStatus();
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
		<span class="panel-title">Backend address</span>
		{#if backendSaved}<span class="saved-note">✓ Saved to this browser</span>{/if}
	</div>
	<p class="hint">
		Stored in this browser only — each device connecting to the admin panel sets its own
		backend address. Not synced across devices.
	</p>
	<div class="row">
		<input type="text" bind:value={backendUrl} placeholder="https://backend.homefeed.local:8443" />
		<button onclick={saveBackendUrl}>Save</button>
	</div>
</div>

<div class="panel">
	<div class="head">
		<span class="panel-title">AI service connection</span>
		<SaveStatus {status} />
	</div>
	<p class="hint">
		Address of your self-hosted inference server (e.g. Ollama). This is a backend setting,
		shared across everyone using this admin panel.
	</p>
	<div class="row">
		<input type="text" bind:value={aiHost} placeholder="http://10.0.0.14" style="flex: 1" />
		<input type="text" bind:value={aiPort} placeholder="11434" style="width: 90px" />
		<button onclick={testConnection} disabled={testing}>{testing ? 'Testing…' : 'Test'}</button>
		<button class="primary" onclick={saveAiService}>Save</button>
	</div>
	<div class="status-row">
		{#if aiStatus.connected}
			<span class="connected">✓ Connected · {aiStatus.ramGB}GB RAM · GPU: {aiStatus.gpu}</span>
		{:else}
			<span class="disconnected">✕ Unreachable</span>
		{/if}
	</div>
</div>

<style>
	.panel {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 16px;
		margin-bottom: 14px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
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
	.row {
		display: flex;
		gap: 8px;
		margin-bottom: 10px;
	}
	.row input {
		flex: 1;
	}
	.primary {
		background: var(--pill-bg);
		color: var(--pill-text);
		border-color: var(--pill-bg);
	}
	.saved-note {
		font-size: 12px;
		color: var(--text-success);
	}
	.status-row {
		font-size: 12px;
	}
	.connected {
		color: var(--text-success);
	}
	.disconnected {
		color: var(--text-danger);
	}
</style>
