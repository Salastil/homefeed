<script lang="ts">
	import type { Poe2Data } from '$lib/types';
	import { formatPoeValue, poeLeagueSlug } from '$lib/format';

	let { poe2 }: { poe2: Poe2Data } = $props();

	const link = $derived(poe2.leagueName ? `https://poe.ninja/poe2/economy/${poeLeagueSlug(poe2.leagueName)}/currency` : null);
</script>

<svelte:element
	this={link ? 'a' : 'div'}
	class="widget"
	href={link ?? undefined}
	target={link ? '_blank' : undefined}
	rel={link ? 'noopener noreferrer' : undefined}
>
	<div class="head">
		<span class="title">PoE2</span>
		{#if poe2.entries.length > 0}<span class="interval">24h</span>{/if}
	</div>
	{#if poe2.leagueName}
		<p class="caption">{poe2.leagueName}</p>
	{/if}
	{#if poe2.entries.length > 0}
		<div class="list">
			{#each poe2.entries as entry (entry.id)}
				<div class="row">
					<span class="label">{entry.baseName} <span class="arrow">→</span> {entry.quoteName}</span>
					{#if entry.lastRate !== null}
						<span class="price" class:up={(entry.lastChange24h ?? 0) >= 0} class:down={(entry.lastChange24h ?? 0) < 0}>
							{formatPoeValue(entry.lastRate)}
							{#if entry.lastChange24h !== null}
								<span class="change">{entry.lastChange24h >= 0 ? '+' : ''}{entry.lastChange24h.toFixed(2)}%</span>
							{/if}
						</span>
					{:else}
						<span class="price">—</span>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<p class="empty">No currency pairs tracked</p>
	{/if}
</svelte:element>

<style>
	.widget {
		display: block;
		background: var(--surface-1);
		border-radius: 12px;
		padding: 14px;
		color: inherit;
		text-decoration: none;
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
		font-size: 13px;
		white-space: nowrap;
	}
	.arrow {
		color: var(--text-muted);
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
