<script lang="ts">
	import type { Poe2Data } from '$lib/types';
	import { formatPoeValue } from '$lib/format';

	let { poe2 }: { poe2: Poe2Data } = $props();
</script>

<div class="widget">
	<div class="head">
		<span class="title">PoE2</span>
		{#if poe2.entries.length > 0}<span class="interval">7d</span>{/if}
	</div>
	{#if poe2.leagueName}
		<p class="caption">
			{poe2.leagueName}{poe2.primaryCurrencyName ? ` · in ${poe2.primaryCurrencyName}` : ''}
		</p>
	{/if}
	{#if poe2.entries.length > 0}
		<div class="list">
			{#each poe2.entries as entry (entry.id)}
				<div class="row">
					<span class="label">
						{#if entry.icon}<img class="icon" src={entry.icon} alt="" />{/if}
						{entry.name}
					</span>
					{#if entry.lastValue !== null}
						<span class="price" class:up={(entry.lastChangePercent ?? 0) >= 0} class:down={(entry.lastChangePercent ?? 0) < 0}>
							{formatPoeValue(entry.lastValue)}
							{#if entry.lastChangePercent !== null}
								<span class="change">{entry.lastChangePercent >= 0 ? '+' : ''}{entry.lastChangePercent.toFixed(2)}%</span>
							{/if}
						</span>
					{:else}
						<span class="price">—</span>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<p class="empty">No currencies tracked</p>
	{/if}
</div>

<style>
	.widget {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 14px;
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}
	.title {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
	}
	.interval {
		font-size: 10px;
		color: var(--text-muted);
	}
	.caption {
		font-size: 11px;
		color: var(--text-muted);
		margin: 2px 0 0;
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
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
	}
	.icon {
		width: 16px;
		height: 16px;
		object-fit: contain;
		flex-shrink: 0;
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
