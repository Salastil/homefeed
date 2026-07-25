<script lang="ts">
	import type { AdminStockTicker } from '$lib/adminTypes';
	import { addStockTicker, updateStockTicker, deleteStockTicker } from '$lib/adminApi';

	let { tickers: initial }: { tickers: AdminStockTicker[] } = $props();
	let tickers = $state([...initial]);
	let showAdd = $state(false);
	let newTicker = $state({ label: '', symbol: '' });

	let editingId = $state<string | null>(null);
	let editForm = $state({ label: '', symbol: '' });

	async function handleAdd() {
		if (!newTicker.label.trim() || !newTicker.symbol.trim()) return;
		const created = await addStockTicker(newTicker.label.trim(), newTicker.symbol.trim());
		tickers = [...tickers, created];
		newTicker = { label: '', symbol: '' };
		showAdd = false;
	}

	async function handleDelete(id: string) {
		await deleteStockTicker(id);
		tickers = tickers.filter((t) => t.id !== id);
	}

	function startEdit(ticker: AdminStockTicker) {
		editingId = ticker.id;
		editForm = { label: ticker.label, symbol: ticker.symbol };
	}

	function cancelEdit() {
		editingId = null;
	}

	async function saveEdit() {
		if (!editingId || !editForm.label.trim() || !editForm.symbol.trim()) return;
		const updated = await updateStockTicker(editingId, { label: editForm.label.trim(), symbol: editForm.symbol.trim() });
		tickers = tickers.map((t) => (t.id === editingId ? updated : t));
		editingId = null;
	}
</script>

<div class="toolbar">
	<span class="count">{tickers.length} tickers</span>
	<button class="add-btn" onclick={() => (showAdd = !showAdd)}>+ New ticker</button>
</div>
<p class="hint" style="margin: -6px 0 12px;">Price and % change are today's — since the previous trading day's close.</p>

{#if showAdd}
	<div class="add-panel">
		<div class="add-grid">
			<input placeholder="Label, e.g. Apple" bind:value={newTicker.label} />
			<input placeholder="Yahoo symbol, e.g. AAPL" bind:value={newTicker.symbol} />
		</div>
		<div class="add-actions">
			<button onclick={() => (showAdd = false)}>Cancel</button>
			<button class="primary" onclick={handleAdd}>Create</button>
		</div>
		<p class="hint">
			Yahoo Finance has no symbol search, so type the exact syntax: stocks are plain tickers
			(AAPL), indices use a caret (^DJI, ^GSPC), crypto pairs use a dash (BTC-USD). Polled
			every 15 minutes; a new ticker is polled immediately.
		</p>
	</div>
{/if}

<div class="list">
	{#each tickers as ticker (ticker.id)}
		{#if editingId === ticker.id}
			<div class="edit-panel">
				<div class="add-grid">
					<input placeholder="Label" bind:value={editForm.label} />
					<input placeholder="Symbol" bind:value={editForm.symbol} />
				</div>
				<div class="add-actions">
					<button onclick={cancelEdit}>Cancel</button>
					<button class="primary" onclick={saveEdit}>Save</button>
				</div>
			</div>
		{:else}
			<div class="row">
				<div>
					<div class="name">{ticker.label}</div>
					<div class="sub">
						{ticker.symbol}
						{#if ticker.lastError}
							· <span class="error">{ticker.lastError}</span>
						{/if}
					</div>
				</div>
				{#if ticker.lastPrice !== null}
					<span class="price" class:up={(ticker.lastChangePercent ?? 0) >= 0} class:down={(ticker.lastChangePercent ?? 0) < 0}>
						{ticker.lastPrice.toFixed(2)}
						{#if ticker.lastChangePercent !== null}
							({ticker.lastChangePercent >= 0 ? '+' : ''}{ticker.lastChangePercent.toFixed(2)}%)
						{/if}
					</span>
				{/if}
				<button class="icon-btn" onclick={() => startEdit(ticker)} title="Edit">Edit</button>
				<button class="icon-btn danger" onclick={() => handleDelete(ticker.id)} title="Delete">✕</button>
			</div>
		{/if}
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
	.add-panel {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 14px;
		margin-bottom: 14px;
	}
	.add-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 8px;
		margin-bottom: 10px;
	}
	.add-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		margin-bottom: 6px;
	}
	.primary {
		background: var(--pill-bg);
		color: var(--pill-text);
		border-color: var(--pill-bg);
	}
	.hint {
		font-size: 11px;
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
		justify-content: space-between;
		gap: 12px;
		background: var(--surface-1);
		border-radius: var(--radius);
		padding: 10px 14px;
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
	.icon-btn:hover {
		color: var(--text-accent);
	}
	.icon-btn.danger:hover {
		color: var(--text-danger);
	}
	.edit-panel {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 14px;
	}
</style>
