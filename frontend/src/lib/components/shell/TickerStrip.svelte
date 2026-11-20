<script lang="ts">
	/**
	 * One-line market ticker (the Option B strip from issue #1): stock tickers, then the PoE2
	 * currency pairs. When it's wider than the screen it scrolls slowly in a loop (CSS only,
	 * pausing under the pointer); otherwise it sits still.
	 */
	import type { Poe2Data, StocksFeed } from '$lib/types';
	import { formatPoeValue } from '$lib/format';

	let { stocks, poe2 }: { stocks: StocksFeed; poe2: Poe2Data } = $props();

	const price = (v: number | null) => (v === null ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
	const pct = (v: number | null) => (v === null ? '' : `${Math.abs(v).toFixed(2)}%`);
	const short = (name: string) => name.replace(/ Orb$/, '').replace(' of Kalandra', '');

	let box: HTMLElement | undefined = $state();
	let track: HTMLElement | undefined = $state();
	let overflow = $state(false);
	$effect(() => {
		if (!box || !track) return;
		const measure = () => (overflow = !!track && !!box && track.scrollWidth / (overflow ? 2 : 1) > box.clientWidth);
		const ro = new ResizeObserver(measure);
		ro.observe(box);
		measure();
		return () => ro.disconnect();
	});
	const secs = $derived(Math.max(30, (stocks.tickers.length + poe2.entries.length) * 6));
</script>

{#snippet items()}
	{#if stocks.tickers.length}<span class="grp first">Markets</span>{/if}
	{#each stocks.tickers as t (t.id)}
		{@const up = (t.lastChangePercent ?? 0) >= 0}
		<span class="it"><b>{t.label}</b><span class="p">{price(t.lastPrice)}</span><span class="c" class:up class:dn={!up}>{up ? '▲' : '▼'} {pct(t.lastChangePercent)}</span></span>
	{/each}
	{#if poe2.entries.length}
		<span class="grp">PoE2{poe2.leagueName ? ` · ${poe2.leagueName}` : ''}</span>
		{#each poe2.entries as e (e.id)}
			{@const up = (e.lastChange24h ?? 0) >= 0}
			<span class="it"><b>{short(e.baseName)} → {short(e.quoteName)}</b><span class="p">{e.lastRate === null ? '—' : formatPoeValue(e.lastRate)}</span>{#if e.lastChange24h !== null}<span class="c" class:up class:dn={!up}>{up ? '▲' : '▼'} {pct(e.lastChange24h)}</span>{/if}</span>
		{/each}
	{/if}
{/snippet}

<div class="ticker" bind:this={box}>
	<div class="track" class:run={overflow} style:--secs="{secs}s" bind:this={track}>
		<div class="set">{@render items()}</div>
		{#if overflow}<div class="set" aria-hidden="true">{@render items()}</div>{/if}
	</div>
</div>

<style>
	.ticker {
		position: relative;
		flex: none;
		height: 34px;
		overflow: hidden;
		border-top: 1px solid var(--bd);
		border-bottom: 1px solid var(--bd);
		mask-image: linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent);
	}
	.track {
		display: flex;
		height: 100%;
		width: max-content;
	}
	.track.run {
		animation: scroll var(--secs) linear infinite;
	}
	.ticker:hover .track.run {
		animation-play-state: paused;
	}
	@keyframes scroll {
		to {
			transform: translateX(-50%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.track.run {
			animation: none;
		}
	}
	.set {
		display: flex;
		align-items: center;
		gap: 26px;
		padding: 0 26px 0 14px;
		white-space: nowrap;
	}
	.it {
		display: flex;
		align-items: baseline;
		gap: 7px;
		font-size: 12.5px;
	}
	.it b {
		font-weight: 600;
	}
	.p {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--tx2);
	}
	.c {
		font-family: var(--mono);
		font-size: 11.5px;
	}
	.up {
		color: var(--up);
	}
	.dn {
		color: var(--dn);
	}
	.grp.first {
		padding-left: 0;
		border-left: 0;
	}
	.grp {
		padding-left: 26px;
		border-left: 1px solid var(--bd);
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--tx3);
	}
</style>
