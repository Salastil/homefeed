<script lang="ts">
	import type {
		AdminSettings,
		AdminStockTicker,
		AdminBookmark,
		AdminBookmarksConfig,
		AdminPoe2Entry,
		AdminWeatherSettings,
		InstalledWidget,
		WidgetUploadManifest
	} from '$lib/adminTypes';
	import type { Poe2Data } from '$lib/types';
	import { updateSettings, listWidgets, installWidget, setWidgetEnabled, deleteWidget } from '$lib/adminApi';
	import WidgetSection from './WidgetSection.svelte';
	import WeatherTab from './WeatherTab.svelte';
	import StocksTab from './StocksTab.svelte';
	import BookmarksTab from './BookmarksTab.svelte';
	import Poe2Tab from './Poe2Tab.svelte';

	let {
		settings,
		stockTickers,
		bookmarks,
		bookmarksConfig,
		poe2Watchlist,
		weatherConfig,
		poe2,
		installedWidgets
	}: {
		settings: AdminSettings;
		stockTickers: AdminStockTicker[];
		bookmarks: AdminBookmark[];
		bookmarksConfig: AdminBookmarksConfig;
		poe2Watchlist: AdminPoe2Entry[];
		weatherConfig: AdminWeatherSettings;
		poe2: Poe2Data;
		installedWidgets: InstalledWidget[];
	} = $props();

	// Local copies so each toggle/reorder reflects immediately — same idiom as
	// BookmarksTab's per-row "Private" toggle.
	let widgets = $state({ ...settings.widgets });
	let widgetOrder = $state([...settings.widgetOrder]);

	const titles: Record<(typeof widgetOrder)[number], string> = {
		weather: 'Weather',
		stocks: 'Stocks',
		bookmarks: 'Bookmarks',
		poe2: 'PoE2'
	};

	async function toggle(key: keyof typeof widgets) {
		widgets[key] = !widgets[key];
		await updateSettings({ widgets });
	}

	async function move(index: number, dir: -1 | 1) {
		const target = index + dir;
		if (target < 0 || target >= widgetOrder.length) return;
		const arr = [...widgetOrder];
		[arr[index], arr[target]] = [arr[target], arr[index]];
		widgetOrder = arr;
		await updateSettings({ widgetOrder });
	}

	// --- Pluggable (uploaded) widgets — see backend/src/widgets/install.ts, uninstall.ts.
	// Built-ins never appear here (source: 'builtin'); the delete route rejects them anyway.
	let pluggable = $state(installedWidgets.filter((w) => w.source === 'uploaded'));

	let showUpload = $state(false);
	let uploadId = $state('');
	let uploadName = $state('');
	let uploadVersion = $state('1.0.0');
	let backendFile = $state<File | null>(null);
	let frontendFile = $state<File | null>(null);
	let uploading = $state(false);
	let uploadError = $state<string | null>(null);

	async function refreshPluggable() {
		pluggable = (await listWidgets()).filter((w) => w.source === 'uploaded');
	}

	async function handleUpload() {
		if (!uploadId.trim() || !uploadName.trim() || !backendFile) {
			uploadError = 'id, display name, and a backend .mjs file are required';
			return;
		}
		uploading = true;
		uploadError = null;
		try {
			const files: Record<string, string> = { 'index.mjs': await backendFile.text() };
			const manifest: WidgetUploadManifest = {
				id: uploadId.trim(),
				displayName: uploadName.trim(),
				version: uploadVersion.trim() || '1.0.0',
				entry: 'index.mjs'
			};
			if (frontendFile) {
				files['frontend.mjs'] = await frontendFile.text();
				manifest.frontendEntry = 'frontend.mjs';
			}
			await installWidget(manifest, files);
			await refreshPluggable();
			showUpload = false;
			uploadId = '';
			uploadName = '';
			uploadVersion = '1.0.0';
			backendFile = null;
			frontendFile = null;
		} catch (err) {
			uploadError = (err as Error).message;
		} finally {
			uploading = false;
		}
	}

	async function togglePluggable(w: InstalledWidget) {
		const updated = await setWidgetEnabled(w.id, !w.enabled);
		pluggable = pluggable.map((x) => (x.id === w.id ? updated : x));
	}

	async function handleDeletePluggable(id: string) {
		if (!confirm('Delete this widget? This removes all of its data and cannot be undone.')) return;
		await deleteWidget(id);
		pluggable = pluggable.filter((w) => w.id !== id);
	}
</script>

{#each widgetOrder as key, i (key)}
	<WidgetSection
		title={titles[key]}
		enabled={widgets[key]}
		onToggle={() => toggle(key)}
		canMoveUp={i > 0}
		canMoveDown={i < widgetOrder.length - 1}
		onMoveUp={() => move(i, -1)}
		onMoveDown={() => move(i, 1)}
	>
		{#if key === 'weather'}
			<WeatherTab config={weatherConfig} />
		{:else if key === 'stocks'}
			<StocksTab tickers={stockTickers} />
		{:else if key === 'bookmarks'}
			<BookmarksTab {bookmarks} config={bookmarksConfig} />
		{:else if key === 'poe2'}
			<Poe2Tab {poe2} watchlist={poe2Watchlist} />
		{/if}
	</WidgetSection>
{/each}

<div class="pluggable">
	<div class="pluggable-head">
		<span class="section-title">Pluggable widgets</span>
		<button class="upload-toggle" onclick={() => (showUpload = !showUpload)}>{showUpload ? 'Cancel' : '+ Upload'}</button>
	</div>

	{#if showUpload}
		<div class="upload-form">
			<input type="text" placeholder="id (a-z0-9-)" bind:value={uploadId} />
			<input type="text" placeholder="Display name" bind:value={uploadName} />
			<input type="text" placeholder="Version" bind:value={uploadVersion} />
			<label class="file-field">
				<span>Backend entry (.mjs, required)</span>
				<input type="file" accept=".mjs,.js" onchange={(e) => (backendFile = e.currentTarget.files?.[0] ?? null)} />
			</label>
			<label class="file-field">
				<span>Frontend entry (.mjs, optional)</span>
				<input type="file" accept=".mjs,.js" onchange={(e) => (frontendFile = e.currentTarget.files?.[0] ?? null)} />
			</label>
			{#if uploadError}<p class="hint" style="color: var(--text-danger);">{uploadError}</p>{/if}
			<button onclick={handleUpload} disabled={uploading}>{uploading ? 'Uploading…' : 'Install'}</button>
		</div>
	{/if}

	{#if pluggable.length === 0}
		<p class="hint">No uploaded widgets installed.</p>
	{:else}
		<div class="list">
			{#each pluggable as w (w.id)}
				<div class="row">
					<span class="row-name">{w.displayName}</span>
					<span class="badge" class:active={w.enabled} onclick={() => togglePluggable(w)} role="button" tabindex="0">
						{w.enabled ? 'Active' : 'Disabled'}
					</span>
					<button class="icon-btn danger" onclick={() => handleDeletePluggable(w.id)} title="Delete">✕</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.pluggable {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 14px;
		margin-top: 4px;
	}
	.pluggable-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 10px;
	}
	.section-title {
		font-size: 13px;
		font-weight: 500;
	}
	.upload-toggle {
		font-size: 12px;
		padding: 4px 10px;
	}
	.upload-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: var(--surface-2);
		border-radius: var(--radius);
		padding: 12px;
		margin-bottom: 12px;
	}
	.file-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		color: var(--text-muted);
	}
	.hint {
		font-size: 12px;
		color: var(--text-muted);
		margin: 0;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		background: var(--surface-2);
		border-radius: var(--radius);
		padding: 8px 12px;
	}
	.row-name {
		font-size: 13px;
		flex: 1;
		min-width: 0;
	}
	.badge {
		font-size: 11px;
		padding: 2px 10px;
		border-radius: var(--radius);
		background: var(--surface-1);
		color: var(--text-muted);
		cursor: pointer;
		white-space: nowrap;
	}
	.badge.active {
		background: var(--bg-accent);
		color: var(--text-accent);
	}
	.icon-btn {
		font-size: 12px;
		padding: 3px 6px;
		background: transparent;
		border: none;
		color: var(--text-secondary);
	}
	.icon-btn.danger:hover {
		color: var(--text-danger);
	}
</style>
