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
	import SearchEnginesTab from './SearchEnginesTab.svelte';

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

	const BUILTIN_TITLES: Record<string, string> = {
		weather: 'Weather',
		stocks: 'Stocks',
		bookmarks: 'Bookmarks',
		poe2: 'PoE2'
	};

	// One ordered list for every installed widget, built-in or uploaded — installedWidgets
	// (GET /api/admin/widgets) already returns both kinds from the same registry with no
	// filtering, and widgetOrder is that same registry's priority_rank, so a single move()
	// here can position a pluggable widget anywhere relative to a built-in.
	let widgetOrder = $state([...settings.widgetOrder]);
	let installed = $state([...installedWidgets]);
	const installedById = $derived(new Map(installed.map((w) => [w.id, w])));

	async function toggle(w: InstalledWidget) {
		const updated = await setWidgetEnabled(w.id, !w.enabled);
		installed = installed.map((x) => (x.id === w.id ? updated : x));
	}

	async function move(index: number, dir: -1 | 1) {
		const target = index + dir;
		if (target < 0 || target >= widgetOrder.length) return;
		const arr = [...widgetOrder];
		[arr[index], arr[target]] = [arr[target], arr[index]];
		widgetOrder = arr;
		await updateSettings({ widgetOrder });
	}

	// Built-ins are rejected by the delete route (400) — this button only ever renders for
	// an uploaded widget's row (see the {#if} below), so no source check needed here.
	async function handleDelete(id: string) {
		if (!confirm('Delete this widget? This removes all of its data and cannot be undone.')) return;
		await deleteWidget(id);
		installed = installed.filter((w) => w.id !== id);
		widgetOrder = widgetOrder.filter((k) => k !== id);
	}

	let showUpload = $state(false);
	let uploadId = $state('');
	let uploadName = $state('');
	let uploadVersion = $state('1.0.0');
	let backendFile = $state<File | null>(null);
	let frontendFile = $state<File | null>(null);
	let uploading = $state(false);
	let uploadError = $state<string | null>(null);

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
			installed = await listWidgets();
			widgetOrder = installed.map((w) => w.id);
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
</script>

{#each widgetOrder as key, i (key)}
	{@const w = installedById.get(key)}
	{#if w}
		<WidgetSection
			title={BUILTIN_TITLES[key] ?? w.displayName}
			enabled={w.enabled}
			onToggle={() => toggle(w)}
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
			{:else}
				{#if key === 'searchbar'}
					<SearchEnginesTab />
				{/if}
				<div class="pluggable-footer">
					<button class="icon-btn danger" onclick={() => handleDelete(w.id)}>Delete widget</button>
				</div>
			{/if}
		</WidgetSection>
	{/if}
{/each}

<div class="pluggable">
	<div class="pluggable-head">
		<span class="section-title">Upload a new widget</span>
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
	.pluggable-footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 10px;
		padding-top: 10px;
		border-top: 0.5px solid var(--border);
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
