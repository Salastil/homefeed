<script lang="ts">
	import type { AdminSettings } from '$lib/adminTypes';
	import { updateSettings } from '$lib/adminApi';
	import SaveStatus from './SaveStatus.svelte';

	let { settings }: { settings: AdminSettings } = $props();

	let retention = $state({ ...settings.retention });
	let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveTimer: ReturnType<typeof setTimeout>;

	function scheduleSave() {
		status = 'saving';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			try {
				await updateSettings({ retention });
				status = 'saved';
				setTimeout(() => (status = 'idle'), 1500);
			} catch {
				status = 'error';
			}
		}, 500);
	}

	const usagePercent = $derived(
		retention.storageCapEnabled
			? Math.min(
					100,
					(retention.storageUsedMB / (retention.storageCapValue * (retention.storageCapUnit === 'GB' ? 1024 : 1))) * 100
				)
			: 0
	);

	const presets = [
		{ label: '7 days', value: 7 },
		{ label: '30 days', value: 30 },
		{ label: '1 year', value: 365 },
		{ label: 'Forever', value: null }
	];
</script>

<div class="panel">
	<div class="head">
		<span class="panel-title">Published articles</span>
		<SaveStatus {status} />
	</div>
	<p class="hint">How long merged, published stories stay available.</p>
	<div class="pill-row">
		{#each presets as preset}
			<button
				class="pill"
				class:active={retention.publishedArticleMaxAgeDays === preset.value}
				onclick={() => {
					retention.publishedArticleMaxAgeDays = preset.value;
					scheduleSave();
				}}
			>
				{preset.label}
			</button>
		{/each}
	</div>
</div>

<div class="panel">
	<span class="panel-title">Raw source items</span>
	<p class="hint">Individual RSS/API/Telegram entries used to build merged stories.</p>
	<div class="pill-row">
		{#each [{ label: '3 days', value: 3 }, { label: '7 days', value: 7 }, { label: '30 days', value: 30 }] as preset}
			<button
				class="pill"
				class:active={retention.rawItemMaxAgeDays === preset.value}
				onclick={() => {
					retention.rawItemMaxAgeDays = preset.value;
					scheduleSave();
				}}
			>
				{preset.label}
			</button>
		{/each}
	</div>
</div>

<div class="panel">
	<div class="head">
		<span class="panel-title">Storage cap</span>
		<label class="checkbox">
			<input
				type="checkbox"
				bind:checked={retention.storageCapEnabled}
				onchange={scheduleSave}
			/>
			Enabled
		</label>
	</div>
	<p class="hint">
		When total storage exceeds this size, oldest items are deleted first (FIFO) regardless of
		the age settings above.
	</p>
	<div class="cap-row">
		<input
			type="number"
			bind:value={retention.storageCapValue}
			oninput={scheduleSave}
			style="width: 100px"
		/>
		<select bind:value={retention.storageCapUnit} onchange={scheduleSave} style="width: 90px">
			<option value="MB">MB</option>
			<option value="GB">GB</option>
		</select>
		<span class="usage-label">currently using {retention.storageUsedMB} MB</span>
	</div>
	<div class="bar">
		<div class="bar-fill" style="width: {usagePercent}%"></div>
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
	.pill-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.pill {
		font-size: 12px;
		padding: 6px 12px;
		border-radius: var(--radius);
		border: 0.5px solid var(--border);
		background: var(--surface-2);
		color: var(--text-secondary);
	}
	.pill.active {
		background: var(--pill-bg);
		color: var(--pill-text);
		border-color: var(--pill-bg);
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
	.cap-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 10px;
	}
	.usage-label {
		font-size: 12px;
		color: var(--text-muted);
	}
	.bar {
		width: 100%;
		height: 6px;
		background: var(--border);
		border-radius: 4px;
		overflow: hidden;
	}
	.bar-fill {
		height: 100%;
		background: var(--border-accent);
	}
</style>
