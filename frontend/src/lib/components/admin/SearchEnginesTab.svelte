<script lang="ts">
	import { onMount } from 'svelte';
	import type { AdminSearchEngine } from '$lib/adminTypes';
	import { getSearchEngines, addSearchEngine, removeSearchEngine } from '$lib/adminApi';

	// Self-fetches rather than receiving props from +page.ts's load — this tab only exists
	// inside a WidgetSection, which doesn't render its body until expanded (see
	// WidgetSection.svelte's {#if expanded}), so this naturally only fetches once someone
	// actually opens "Search". Keeping it self-contained also means the shared settings
	// load function doesn't need to know about this one specific pluggable widget's config.
	let engines = $state<AdminSearchEngine[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	let newName = $state('');
	let newUrl = $state('');
	let addError = $state<string | null>(null);
	let adding = $state(false);

	onMount(async () => {
		try {
			engines = await getSearchEngines();
		} catch (err) {
			loadError = (err as Error).message;
		} finally {
			loading = false;
		}
	});

	async function handleAdd() {
		const name = newName.trim();
		const urlTemplate = newUrl.trim();
		addError = null;
		if (!name || !urlTemplate) {
			addError = 'Name and URL are both required.';
			return;
		}
		if (!urlTemplate.includes('%s')) {
			addError = 'URL must contain %s where the search query goes.';
			return;
		}
		adding = true;
		try {
			const created = await addSearchEngine(name, urlTemplate);
			engines = [...engines, created];
			newName = '';
			newUrl = '';
		} catch (err) {
			addError = (err as Error).message;
		} finally {
			adding = false;
		}
	}

	async function handleDelete(id: string) {
		await removeSearchEngine(id);
		engines = engines.filter((e) => e.id !== id);
	}
</script>

<div class="search-engines">
	<p class="hint">
		DuckDuckGo, Google, and Bing are always available in the widget. Engines added here show
		up for every visitor using the search widget.
	</p>
	{#if loading}
		<p class="hint">Loading…</p>
	{:else if loadError}
		<p class="hint" style="color: var(--text-danger);">{loadError}</p>
	{:else}
		<div class="add-grid">
			<input placeholder="Name, e.g. Startpage" bind:value={newName} />
			<input placeholder="URL with %s for the query" bind:value={newUrl} />
			<button class="primary" onclick={handleAdd} disabled={adding}>{adding ? 'Adding…' : 'Add'}</button>
		</div>
		{#if addError}<p class="hint" style="color: var(--text-danger);">{addError}</p>{/if}

		{#if engines.length === 0}
			<p class="hint">No custom engines yet.</p>
		{:else}
			<div class="list">
				{#each engines as engine (engine.id)}
					<div class="row">
						<span class="row-name">{engine.name}</span>
						<button class="icon-btn danger" onclick={() => handleDelete(engine.id)} title="Delete">✕</button>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.hint {
		font-size: 12px;
		color: var(--text-muted);
		margin: 0 0 10px;
	}
	.add-grid {
		display: grid;
		grid-template-columns: 1fr 1fr auto;
		gap: 8px;
		margin-bottom: 8px;
	}
	.primary {
		background: var(--pill-bg);
		color: var(--pill-text);
		border-color: var(--pill-bg);
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 8px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		background: var(--surface-2);
		border-radius: var(--radius);
		padding: 6px 10px;
	}
	.row-name {
		font-size: 13px;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.icon-btn {
		font-size: 12px;
		padding: 3px 6px;
		background: transparent;
		border: none;
		color: var(--text-secondary);
		flex-shrink: 0;
	}
	.icon-btn.danger:hover {
		color: var(--text-danger);
	}
</style>
