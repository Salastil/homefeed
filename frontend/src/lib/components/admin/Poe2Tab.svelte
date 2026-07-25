<script lang="ts">
	import type { AdminSettings, AdminPoe2Entry, Poe2BrowseEntry } from '$lib/adminTypes';
	import { browsePoe2Currencies, addPoe2WatchlistEntry, removePoe2WatchlistEntry } from '$lib/adminApi';
	import { formatPoeValue, invertChangePercent } from '$lib/format';

	let { settings, watchlist: initial }: { settings: AdminSettings; watchlist: AdminPoe2Entry[] } = $props();
	let watchlist = $state([...initial]);

	let showAdd = $state(false);
	// Two-step wizard: pick the base currency first, then the quote currency (excluding the
	// base) — a pair needs both, and currency ids are opaque so they have to be picked from a
	// live list rather than typed (same idiom as the old single-currency picker).
	let step = $state<'base' | 'quote'>('base');
	let selectedBase = $state<Poe2BrowseEntry | null>(null);
	let query = $state('');
	// null = not fetched yet — fetched once on first "+ Add pair" click, then filtered
	// client-side on every keystroke (the whole category is a bounded, small list).
	let browseList = $state<Poe2BrowseEntry[] | null>(null);
	let browsing = $state(false);
	let browseError = $state<string | null>(null);

	const filtered = $derived(
		(browseList ?? [])
			.filter((c) => c.id !== selectedBase?.id)
			.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
			.slice(0, 30)
	);

	async function openAdd() {
		showAdd = true;
		step = 'base';
		selectedBase = null;
		query = '';
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

	function pickBase(entry: Poe2BrowseEntry) {
		selectedBase = entry;
		step = 'quote';
		query = '';
	}

	async function pickQuote(entry: Poe2BrowseEntry) {
		if (!selectedBase) return;
		const created = await addPoe2WatchlistEntry(
			{ currencyId: selectedBase.id, name: selectedBase.name },
			{ currencyId: entry.id, name: entry.name }
		);
		watchlist = [...watchlist, created];
		showAdd = false;
	}

	function closeAdd() {
		showAdd = false;
	}

	async function handleDelete(id: string) {
		await removePoe2WatchlistEntry(id);
		watchlist = watchlist.filter((w) => w.id !== id);
	}

	function fmtChange(value: number | null): string {
		if (value === null) return '—';
		return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
	}
</script>

<div class="toolbar">
	<span class="count">{watchlist.length} pairs tracked</span>
	<button class="add-btn" onclick={openAdd}>+ Add pair</button>
</div>
<p class="hint" style="margin: -6px 0 12px;">
	{#if settings.poe2.leagueName}
		Tracking {settings.poe2.leagueName} · change is over the last 24h.
	{:else}
		League not detected yet — check back after the next poll (every hour).
	{/if}
</p>

{#if showAdd}
	<div class="add-panel">
		<div class="step-label">
			{#if step === 'base'}
				Step 1 — pick the base currency
			{:else}
				Step 2 — pick what to quote <strong>{selectedBase?.name}</strong> against
			{/if}
		</div>
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
					<button
						class="result-row"
						onclick={() => (step === 'base' ? pickBase(entry) : pickQuote(entry))}
					>
						{entry.name}
					</button>
				{/each}
			</div>
		{/if}
		<div class="add-actions">
			<button onclick={closeAdd}>Close</button>
		</div>
	</div>
{/if}

<div class="list">
	{#each watchlist as entry (entry.id)}
		<div class="row">
			<div class="row-head">
				<div class="pair-name">{entry.baseName} <span class="arrow">⇄</span> {entry.quoteName}</div>
				<button class="icon-btn danger" onclick={() => handleDelete(entry.id)} title="Remove">✕</button>
			</div>
			{#if entry.lastError}
				<div class="sub"><span class="error">{entry.lastError}</span></div>
			{:else if entry.lastRate !== null}
				<div class="direction">
					<span class="rate">1 {entry.baseName} = {formatPoeValue(entry.lastRate)} {entry.quoteName}</span>
					<span class="changes">24h {fmtChange(entry.lastChange24h)}</span>
				</div>
				<div class="direction">
					<span class="rate">1 {entry.quoteName} = {formatPoeValue(1 / entry.lastRate)} {entry.baseName}</span>
					<span class="changes">24h {fmtChange(invertChangePercent(entry.lastChange24h))}</span>
				</div>
			{:else}
				<div class="sub">Waiting for first poll…</div>
			{/if}
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
	.step-label {
		font-size: 12px;
		color: var(--text-secondary);
		margin-bottom: 8px;
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
		background: var(--surface-1);
		border-radius: var(--radius);
		padding: 10px 14px;
	}
	.row-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.pair-name {
		font-size: 13px;
		font-weight: 500;
		min-width: 0;
	}
	.arrow {
		color: var(--text-muted);
		font-weight: 400;
	}
	.sub {
		font-size: 11px;
		color: var(--text-muted);
		margin-top: 4px;
	}
	.error {
		color: var(--text-danger);
	}
	.direction {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		margin-top: 4px;
		font-size: 12px;
	}
	.rate {
		font-variant-numeric: tabular-nums;
	}
	.changes {
		font-size: 11px;
		color: var(--text-muted);
		white-space: nowrap;
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
