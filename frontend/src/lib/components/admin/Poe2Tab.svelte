<script lang="ts">
	import type { AdminSettings, AdminPoe2Entry, Poe2BrowseEntry } from '$lib/adminTypes';
	import { browsePoe2Currencies, addPoe2WatchlistEntry, removePoe2WatchlistEntry } from '$lib/adminApi';
	import { formatPoeValue } from '$lib/format';

	let { settings, watchlist: initial }: { settings: AdminSettings; watchlist: AdminPoe2Entry[] } = $props();
	let watchlist = $state([...initial]);

	let showAdd = $state(false);
	let query = $state('');
	// null = not fetched yet — fetched once on first "+ Add currency" click, then filtered
	// client-side on every keystroke (the whole category is a bounded, small list).
	let browseList = $state<Poe2BrowseEntry[] | null>(null);
	let browsing = $state(false);
	let browseError = $state<string | null>(null);

	const watchedIds = $derived(new Set(watchlist.map((w) => w.currencyId)));
	const filtered = $derived(
		(browseList ?? [])
			.filter((c) => !watchedIds.has(c.id))
			.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
			.slice(0, 30)
	);

	async function openAdd() {
		showAdd = true;
		if (browseList) return;
		browsing = true;
		browseError = null;
		try {
			browseList = await browsePoe2Currencies();
		} catch {
			browseError = 'poe.ninja unreachable';
		} finally {
			browsing = false;
		}
	}

	async function pick(entry: Poe2BrowseEntry) {
		const created = await addPoe2WatchlistEntry(entry.id, entry.name, entry.icon);
		watchlist = [...watchlist, created];
		showAdd = false;
		query = '';
	}

	async function handleDelete(id: string) {
		await removePoe2WatchlistEntry(id);
		watchlist = watchlist.filter((w) => w.id !== id);
	}
</script>

<div class="toolbar">
	<span class="count">{watchlist.length} currencies tracked</span>
	<button class="add-btn" onclick={openAdd}>+ Add currency</button>
</div>
<p class="hint" style="margin: -6px 0 12px;">
	{#if settings.poe2.leagueName}
		Tracking {settings.poe2.leagueName}{settings.poe2.primaryCurrencyName
			? ` · values in ${settings.poe2.primaryCurrencyName}`
			: ''} · change is over the last 7 days.
	{:else}
		League not detected yet — check back after the next poll (every 15 minutes).
	{/if}
</p>

{#if showAdd}
	<div class="add-panel">
		<input type="text" bind:value={query} placeholder="Search currencies…" />
		{#if browsing}
			<p class="hint">Loading currency list…</p>
		{:else if browseError}
			<p class="hint" style="color: var(--text-danger);">{browseError}</p>
		{:else if filtered.length === 0}
			<p class="hint">{query ? 'No matches' : 'No traded currencies found for this league'}</p>
		{:else}
			<div class="results">
				{#each filtered as entry (entry.id)}
					<button class="result-row" onclick={() => pick(entry)}>
						{#if entry.icon}<img class="result-icon" src={entry.icon} alt="" />{/if}
						{entry.name}
					</button>
				{/each}
			</div>
		{/if}
		<div class="add-actions">
			<button onclick={() => (showAdd = false)}>Close</button>
		</div>
	</div>
{/if}

<div class="list">
	{#each watchlist as entry (entry.id)}
		<div class="row">
			<div class="row-main">
				{#if entry.icon}<img class="icon" src={entry.icon} alt="" />{/if}
				<div>
					<div class="name">{entry.name}</div>
					{#if entry.lastError}
						<div class="sub"><span class="error">{entry.lastError}</span></div>
					{/if}
				</div>
			</div>
			{#if entry.lastValue !== null}
				<span class="price" class:up={(entry.lastChangePercent ?? 0) >= 0} class:down={(entry.lastChangePercent ?? 0) < 0}>
					{formatPoeValue(entry.lastValue)}
					{#if entry.lastChangePercent !== null}
						({entry.lastChangePercent >= 0 ? '+' : ''}{entry.lastChangePercent.toFixed(2)}%)
					{/if}
				</span>
			{/if}
			<button class="icon-btn danger" onclick={() => handleDelete(entry.id)} title="Remove">✕</button>
		</div>
	{/each}
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}
	.count {
		font-size: 12px;
		color: var(--text-muted);
	}
	.add-btn {
		font-size: 12px;
		padding: 6px 12px;
	}
	.hint {
		font-size: 11px;
		color: var(--text-muted);
		margin: 0;
	}
	.add-panel {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 14px;
		margin-bottom: 14px;
	}
	.add-panel input {
		width: 100%;
		margin-bottom: 8px;
	}
	.results {
		display: flex;
		flex-direction: column;
		max-height: 280px;
		overflow-y: auto;
		border-radius: var(--radius);
		overflow-x: hidden;
		border: 0.5px solid var(--border);
	}
	.result-row {
		display: flex;
		align-items: center;
		gap: 8px;
		text-align: left;
		font-size: 12px;
		padding: 8px 10px;
		background: var(--surface-2);
		border: none;
		border-radius: 0;
	}
	.result-row:hover {
		background: var(--bg-accent);
	}
	.result-icon {
		width: 20px;
		height: 20px;
		object-fit: contain;
	}
	.add-actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 8px;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		background: var(--surface-1);
		border-radius: var(--radius);
		padding: 10px 14px;
	}
	.row-main {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.icon {
		width: 24px;
		height: 24px;
		object-fit: contain;
		flex-shrink: 0;
	}
	.name {
		font-size: 13px;
		font-weight: 500;
	}
	.sub {
		font-size: 11px;
		color: var(--text-muted);
	}
	.error {
		color: var(--text-danger);
	}
	.price {
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.price.up {
		color: var(--text-success);
	}
	.price.down {
		color: var(--text-danger);
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
