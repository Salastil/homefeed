<script lang="ts">
	import { exportBackup, importBackup } from '$lib/adminApi';

	let exporting = $state(false);
	let exportError = $state<string | null>(null);

	let selectedFile = $state<File | null>(null);
	let importing = $state(false);
	let importError = $state<string | null>(null);
	let importWarnings = $state<string[] | null>(null);
	let importSucceeded = $state(false);

	async function handleExport() {
		exporting = true;
		exportError = null;
		try {
			const blob = await exportBackup();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `homefeed-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (err) {
			exportError = (err as Error).message;
		} finally {
			exporting = false;
		}
	}

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		selectedFile = input.files?.[0] ?? null;
		importError = null;
		importWarnings = null;
		importSucceeded = false;
	}

	async function handleImport() {
		if (!selectedFile) return;
		if (
			!confirm(
				'Replace this instance\'s configuration with the zip\'s contents? This wipes and replaces sources, tracked items, categories, settings, connections, and widget config — Telegram may need re-authenticating if the zip\'s encryption key differs from this instance\'s. A restart is required afterward to fully apply it. This cannot be undone.'
			)
		) {
			return;
		}
		importing = true;
		importError = null;
		importWarnings = null;
		importSucceeded = false;
		try {
			const result = await importBackup(selectedFile);
			importSucceeded = true;
			importWarnings = result.warnings;
			selectedFile = null;
		} catch (err) {
			importError = (err as Error).message;
		} finally {
			importing = false;
		}
	}
</script>

<div class="panel">
	<span class="panel-title">Export configuration</span>
	<p class="hint">
		Downloads a zip of everything that defines how this instance is configured — Sources, Tracked
		items, Categories, Settings (including the embedding/synthesis Connections), Telegram
		credentials, and every widget's own settings/data. Deliberately excludes ingested items,
		published articles, media, tags, logs, and synthesis benchmark history — a new instance
		re-ingests and re-publishes those on its own.
	</p>
	<div class="row">
		<button class="primary-btn" onclick={handleExport} disabled={exporting}>
			{exporting ? 'Exporting…' : 'Export configuration'}
		</button>
		{#if exportError}
			<span class="error-label">{exportError}</span>
		{/if}
	</div>
</div>

<div class="panel">
	<span class="panel-title">Import configuration</span>
	<p class="hint">
		Loads a configuration zip exported from another instance (or this one). This fully replaces
		the current sources, tracked items, categories, settings, connections, and widget config —
		it does not merge with what's already here. A process restart is required afterward for
		widget code and registry changes to fully take effect.
	</p>
	<div class="row">
		<input type="file" accept=".zip" onchange={handleFileSelect} />
		<button class="danger-btn" onclick={handleImport} disabled={!selectedFile || importing}>
			{importing ? 'Importing…' : 'Import configuration'}
		</button>
	</div>
	{#if importError}
		<p class="error-label">{importError}</p>
	{/if}
	{#if importSucceeded}
		<p class="success-label">✓ Import complete — restart the backend process to fully apply it.</p>
		{#if importWarnings && importWarnings.length > 0}
			<ul class="warnings">
				{#each importWarnings as warning}
					<li>{warning}</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.panel {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 16px;
		margin-bottom: 14px;
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
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.primary-btn {
		font-size: 12px;
		padding: 6px 12px;
		border-radius: var(--radius);
		background: var(--pill-bg);
		color: var(--pill-text);
		border: 0.5px solid var(--pill-bg);
	}
	.primary-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.danger-btn {
		font-size: 12px;
		padding: 6px 12px;
		border-radius: var(--radius);
		border: 0.5px solid var(--text-danger);
		background: transparent;
		color: var(--text-danger);
	}
	.danger-btn:hover:not(:disabled) {
		background: var(--bg-accent);
	}
	.danger-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.error-label {
		font-size: 12px;
		color: var(--text-danger);
	}
	.success-label {
		font-size: 12px;
		color: var(--text-success);
		margin: 10px 0 0;
	}
	.warnings {
		font-size: 12px;
		color: var(--text-muted);
		margin: 6px 0 0;
		padding-left: 18px;
	}
</style>
