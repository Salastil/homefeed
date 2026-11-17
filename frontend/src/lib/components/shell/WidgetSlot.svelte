<script lang="ts">
	/**
	 * One position in the widget row. A slot holding several widgets - or a Markets widget
	 * with more tickers than fit - becomes a carousel that turns every `rotateSeconds`,
	 * pausing while the pointer is over it. Every page stays mounted and is only hidden, so a
	 * plug-in widget (the radio) keeps playing while another page is showing.
	 */
	import type { BookmarksFeed, Poe2Data, PluggableWidgetSummary, StocksFeed, Weather } from '$lib/types';
	import { formatPoeValue, poeLeagueSlug } from '$lib/format';
	import WeatherTile from './WeatherTile.svelte';
	import DynamicWidgetSlot from '../sidebar/DynamicWidgetSlot.svelte';
	import GenericWidgetCard from '../sidebar/GenericWidgetCard.svelte';

	let {
		widgets,
		rotateSeconds,
		weather,
		stocks,
		bookmarks,
		poe2,
		pluggable,
		weatherActive = false
	}: {
		widgets: string[];
		rotateSeconds: number;
		weather: Weather;
		stocks: StocksFeed;
		bookmarks: BookmarksFeed;
		poe2: Poe2Data;
		pluggable: PluggableWidgetSummary[];
		weatherActive?: boolean;
	} = $props();

	const MARKETS_PER_PAGE = 5;
	const BOOKMARKS_PER_PAGE = 16;

	type Page =
		| { key: string; kind: 'weather'; label: string; sub: string }
		| { key: string; kind: 'markets'; label: string; sub: string; tickers: StocksFeed['tickers'] }
		| { key: string; kind: 'poe2'; label: string; sub: string }
		| { key: string; kind: 'bookmarks'; label: string; sub: string }
		| { key: string; kind: 'plug'; label: string; sub: string; widget: PluggableWidgetSummary };

	const pages = $derived.by(() => {
		const out: Page[] = [];
		for (const id of widgets) {
			if (id === 'weather') out.push({ key: 'weather', kind: 'weather', label: 'Weather', sub: '' });
			else if (id === 'stocks') {
				const n = Math.max(1, Math.ceil(stocks.tickers.length / MARKETS_PER_PAGE));
				for (let k = 0; k < n; k++) {
					out.push({
						key: `markets-${k}`,
						kind: 'markets',
						label: 'Markets',
						sub: n > 1 ? `${k + 1}/${n}` : '',
						tickers: stocks.tickers.slice(k * MARKETS_PER_PAGE, (k + 1) * MARKETS_PER_PAGE)
					});
				}
			} else if (id === 'poe2') out.push({ key: 'poe2', kind: 'poe2', label: 'PoE2', sub: poe2.leagueName ?? '' });
			else if (id === 'bookmarks') out.push({ key: 'bookmarks', kind: 'bookmarks', label: 'Bookmarks', sub: '' });
			else {
				const w = pluggable.find((p) => p.id === id);
				if (w) out.push({ key: `plug-${id}`, kind: 'plug', label: w.displayName, sub: '', widget: w });
			}
		}
		return out;
	});

	let index = $state(0);
	let hovering = $state(false);
	let startedAt = $state(Date.now());
	let now = $state(Date.now());
	const current = $derived(pages[Math.min(index, pages.length - 1)]);
	const rotating = $derived(pages.length > 1);
	const next = $derived(pages[(index + 1) % Math.max(1, pages.length)]);

	$effect(() => {
		if (!rotating) return;
		const ms = Math.max(3, rotateSeconds) * 1000;
		const id = setInterval(() => {
			now = Date.now();
			if (hovering) {
				startedAt = now - Math.min(now - startedAt, ms - 1000);
				return;
			}
			if (now - startedAt >= ms) {
				index = (index + 1) % pages.length;
				startedAt = now;
			}
		}, 250);
		return () => clearInterval(id);
	});

	const progress = $derived(rotating ? Math.min(1, (now - startedAt) / (Math.max(3, rotateSeconds) * 1000)) : 0);
	const secondsLeft = $derived(Math.max(0, Math.ceil(Math.max(3, rotateSeconds) - (now - startedAt) / 1000)));

	// Markets bars share one scale across every page, so a bar means the same on page 2.
	const maxMove = $derived(Math.max(0.01, ...stocks.tickers.map((t) => Math.abs(t.lastChangePercent ?? 0))));
	const poeLink = $derived(poe2.leagueName ? `https://poe.ninja/poe2/economy/${poeLeagueSlug(poe2.leagueName)}/currency` : null);

	let bmPage = $state(0);
	const bmPages = $derived(Math.max(1, Math.ceil(bookmarks.items.length / BOOKMARKS_PER_PAGE)));
	const bmShown = $derived(bookmarks.items.slice(bmPage * BOOKMARKS_PER_PAGE, (bmPage + 1) * BOOKMARKS_PER_PAGE));

	const pct = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
	const price = (v: number | null) => (v === null ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
	const hasHeader = (p: Page) => p.kind === 'markets' || p.kind === 'poe2' || p.kind === 'bookmarks';
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tile" class:bare={current && !hasHeader(current)} onmouseenter={() => (hovering = true)} onmouseleave={() => (hovering = false)}>
	{#if current && (hasHeader(current) || rotating)}
		<div class="wh">
			{#if current.kind === 'poe2' && poeLink}
				<a class="name" href={poeLink} target="_blank" rel="noopener noreferrer">{current.label}</a>
			{:else}
				<b class="name">{current.label}</b>
			{/if}
			{#if current.sub}<span class="sub">{current.sub}</span>{/if}
			<span class="sp"></span>
			{#if rotating}
				<span class="dots">
					{#each pages as p, k (p.key)}
						<button class:on={k === index} aria-label="Show {p.label} {p.sub}" onclick={() => ((index = k), (startedAt = Date.now()))}></button>
					{/each}
				</span>
				<span class="next">next: {next.label}{next.kind === 'markets' && next.sub ? ` ${next.sub}` : ''} · {secondsLeft}s</span>
			{/if}
			{#if current.kind === 'bookmarks' && bmPages > 1}
				<button class="arr" disabled={bmPage === 0} aria-label="Previous bookmarks" onclick={() => (bmPage = Math.max(0, bmPage - 1))}>‹</button>
				<span class="pg">{bmPage + 1}/{bmPages}</span>
				<button class="arr" disabled={bmPage >= bmPages - 1} aria-label="Next bookmarks" onclick={() => (bmPage = Math.min(bmPages - 1, bmPage + 1))}>›</button>
			{/if}
		</div>
	{/if}

	{#each pages as p, k (p.key)}
		<div class="page" class:hidden={k !== index}>
			{#if p.kind === 'weather'}
				<WeatherTile {weather} active={weatherActive} />
			{:else if p.kind === 'markets'}
				{#each p.tickers as t (t.id)}
					<div class="q">
						<span class="lbl">{t.label}</span>
						<span class="db"><i class:up={(t.lastChangePercent ?? 0) >= 0} class:dn={(t.lastChangePercent ?? 0) < 0} style:width="{(Math.abs(t.lastChangePercent ?? 0) / maxMove) * 48}%"></i></span>
						<span class="p">{price(t.lastPrice)}</span>
						<span class="c" class:up={(t.lastChangePercent ?? 0) >= 0} class:dn={(t.lastChangePercent ?? 0) < 0}>{pct(t.lastChangePercent)}</span>
					</div>
				{:else}
					<p class="empty">No tickers yet</p>
				{/each}
			{:else if p.kind === 'poe2'}
				{#each poe2.entries.slice(0, MARKETS_PER_PAGE) as e (e.id)}
					<div class="q2">
						<span class="lbl">{e.baseName.replace(/ Orb$/, '').replace(' of Kalandra', '')} → {e.quoteName.replace(/ Orb$/, '')}</span>
						<span class="p">{e.lastRate === null ? '—' : formatPoeValue(e.lastRate)}</span>
						<span class="c" class:up={(e.lastChange24h ?? 0) >= 0} class:dn={(e.lastChange24h ?? 0) < 0}>{pct(e.lastChange24h)}</span>
					</div>
				{:else}
					<p class="empty">No currency pairs tracked</p>
				{/each}
			{:else if p.kind === 'bookmarks'}
				<div class="bmg">
					{#each bmShown as b (b.id)}
						<a class="bmk" href={b.url} target="_blank" rel="noopener noreferrer" title={b.url}>{b.name}</a>
					{:else}
						<p class="empty">No bookmarks yet</p>
					{/each}
				</div>
			{:else if p.kind === 'plug'}
				{#if p.widget.frontendEntry}
					<DynamicWidgetSlot id={p.widget.id} displayName={p.widget.displayName} frontendEntry={p.widget.frontendEntry} layout="tile" />
				{:else}
					<GenericWidgetCard id={p.widget.id} displayName={p.widget.displayName} />
				{/if}
			{/if}
		</div>
	{/each}

	{#if rotating}<div class="prog"><i style:width="{progress * 100}%"></i></div>{/if}
</div>

<style>
	.tile {
		position: relative;
		background: var(--s1);
		border: 1px solid var(--bd);
		border-radius: 11px;
		padding: 9px 14px 10px;
		height: 134px;
		min-width: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	.tile.bare {
		padding: 10px 14px;
	}
	.wh {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 16px;
		margin-bottom: 5px;
		flex: none;
	}
	.name {
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--tx2);
	}
	a.name:hover {
		color: var(--acc);
		text-decoration: none;
	}
	.sub {
		font-size: 11px;
		color: var(--tx3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sp {
		flex: 1;
	}
	.dots {
		display: flex;
		gap: 4px;
	}
	.dots button {
		width: 6px;
		height: 6px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: var(--s3);
	}
	.dots button.on {
		background: var(--acc);
	}
	.next {
		font-size: 10.5px;
		color: var(--tx3);
		white-space: nowrap;
	}
	.arr {
		width: 20px;
		height: 18px;
		padding: 0;
		border-radius: 5px;
		display: grid;
		place-items: center;
		color: var(--tx);
		background: transparent;
		font-size: 13px;
		line-height: 1;
	}
	.arr:disabled {
		color: var(--tx3);
		opacity: 0.45;
		cursor: default;
	}
	.pg {
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--tx3);
	}
	.page {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		justify-content: safe center;
	}
	.page.hidden {
		display: none;
	}
	.q {
		display: grid;
		grid-template-columns: 86px 1fr 74px 58px;
		gap: 8px;
		align-items: center;
		height: 18px;
		font-size: 12px;
	}
	.q2 {
		display: grid;
		grid-template-columns: 1fr auto 58px;
		gap: 8px;
		align-items: center;
		height: 18px;
		font-size: 12px;
	}
	.lbl {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.p {
		font-family: var(--mono);
		font-size: 11.5px;
		color: var(--tx2);
		text-align: right;
	}
	.c {
		font-family: var(--mono);
		font-size: 11.5px;
		text-align: right;
	}
	.up {
		color: var(--up);
	}
	.dn {
		color: var(--dn);
	}
	.db {
		height: 5px;
		position: relative;
		background: linear-gradient(var(--bd), var(--bd)) center/1px 100% no-repeat;
	}
	.db i {
		position: absolute;
		top: 0;
		bottom: 0;
		border-radius: 2px;
	}
	.db i.up {
		left: 50%;
		background: var(--up);
	}
	.db i.dn {
		right: 50%;
		background: var(--dn);
	}
	.bmg {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		grid-template-rows: repeat(4, minmax(0, 1fr));
		gap: 4px;
		flex: 1;
		min-height: 0;
	}
	.bmk {
		display: flex;
		align-items: center;
		min-width: 0;
		border: 1px solid var(--bd);
		border-radius: 5px;
		padding: 0 7px;
		font-size: 11.5px;
		line-height: 1;
		color: var(--tx2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		background: var(--s2);
	}
	.bmk:hover {
		text-decoration: none;
		color: var(--tx);
		border-color: var(--tx3);
	}
	.prog {
		position: absolute;
		left: 14px;
		right: 14px;
		bottom: 6px;
		height: 2px;
		background: var(--s3);
		border-radius: 2px;
		overflow: hidden;
	}
	.prog i {
		display: block;
		height: 100%;
		background: var(--acc);
	}
	.empty {
		margin: 0;
		font-size: 12px;
		color: var(--tx3);
	}
</style>
