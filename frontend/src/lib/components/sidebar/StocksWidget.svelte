<script lang="ts">
	import type { StockTicker } from '$lib/types';

	let { stocks }: { stocks: StockTicker[] } = $props();
</script>

<div class="widget">
	<span class="title">Stocks</span>
	{#if stocks.length > 0}
		<div class="list">
			{#each stocks as stock (stock.id)}
				<div class="row">
					<span class="label">{stock.label}</span>
					{#if stock.lastPrice !== null}
						<span class="price" class:up={(stock.lastChangePercent ?? 0) >= 0} class:down={(stock.lastChangePercent ?? 0) < 0}>
							{stock.lastPrice.toFixed(2)}
							{#if stock.lastChangePercent !== null}
								<span class="change">{stock.lastChangePercent >= 0 ? '+' : ''}{stock.lastChangePercent.toFixed(2)}%</span>
							{/if}
						</span>
					{:else}
						<span class="price">—</span>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<p class="empty">No tickers configured</p>
	{/if}
</div>

<style>
	.widget {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 14px;
	}
	.title {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
	}
	.list {
		display: flex;
		flex-direction: column;
		margin-top: 8px;
	}
	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		padding: 6px 0;
		border-top: 0.5px solid var(--border);
	}
	.row:first-child {
		border-top: none;
	}
	.label {
		font-size: 13px;
	}
	.price {
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		color: var(--text-secondary);
	}
	.price.up .change {
		color: var(--text-success);
	}
	.price.down .change {
		color: var(--text-danger);
	}
	.change {
		margin-left: 4px;
	}
	.empty {
		font-size: 12px;
		color: var(--text-muted);
		margin: 8px 0 0;
	}
</style>
