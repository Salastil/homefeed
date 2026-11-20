<script lang="ts">
	/**
	 * Settings for the widgets in one widget-row position, edited from the board (issue #1, C1).
	 * Reuses each built-in widget's own admin settings; arranging the row (positions, rotation,
	 * turning widgets on and off) stays on the admin Widgets page.
	 */
	import { onMount } from 'svelte';
	import { getAdminBookmarks, getBookmarksConfig, getPoe2Watchlist, getStockTickers, getStocksConfig, getWeatherConfig, listWidgets } from '$lib/adminApi';
	import { getPoe2 } from '$lib/api';
	import WeatherTab from '$lib/components/admin/WeatherTab.svelte';
	import StocksTab from '$lib/components/admin/StocksTab.svelte';
	import BookmarksTab from '$lib/components/admin/BookmarksTab.svelte';
	import Poe2Tab from '$lib/components/admin/Poe2Tab.svelte';
	import SearchEnginesTab from '$lib/components/admin/SearchEnginesTab.svelte';

	let { ids }: { ids: string[] } = $props();

	const TITLES: Record<string, string> = { weather: 'Weather', stocks: 'Markets', bookmarks: 'Bookmarks', poe2: 'PoE2', searchbar: 'Search', empty: 'Open slot' };
	let names = $state<Record<string, string>>({});
	// svelte-ignore state_referenced_locally
	let tab = $state(ids[0]);
	let data = $state<Record<string, unknown> | null>(null);
	let error = $state<string | null>(null);

	onMount(async () => {
		listWidgets()
			.then((ws) => (names = Object.fromEntries(ws.map((w) => [w.id, w.displayName]))))
			.catch(() => {});
	});

	$effect(() => {
		const id = tab;
		data = null;
		error = null;
		const load = async (): Promise<Record<string, unknown>> => {
			if (id === 'weather') return { config: await getWeatherConfig() };
			if (id === 'stocks') {
				const [tickers, config] = await Promise.all([getStockTickers(), getStocksConfig()]);
				return { tickers, config };
			}
			if (id === 'bookmarks') {
				const [bookmarks, config] = await Promise.all([getAdminBookmarks(), getBookmarksConfig()]);
				return { bookmarks, config };
			}
			if (id === 'poe2') {
				const [poe2, watchlist] = await Promise.all([getPoe2(), getPoe2Watchlist()]);
				return { poe2, watchlist };
			}
			return {};
		};
		load()
			.then((d) => tab === id && (data = d))
			.catch((err) => (error = (err as Error).message));
	});

	const title = (id: string) => TITLES[id] ?? names[id] ?? id;
</script>

<div class="hd">
	<b>{ids.length > 1 ? 'Widgets in this position' : title(ids[0])}</b>
</div>
{#if ids.length > 1}
	<div class="seg tabs">
		{#each ids as id (id)}<button class:on={tab === id} onclick={() => (tab = id)}>{title(id)}</button>{/each}
	</div>
{/if}

<div class="body">
	{#if error}
		<p class="err">{error}</p>
	{:else if !data}
		<p class="hint">Loading…</p>
	{:else if tab === 'weather'}
		<WeatherTab config={data.config as never} />
	{:else if tab === 'stocks'}
		<StocksTab tickers={data.tickers as never} config={data.config as never} />
	{:else if tab === 'bookmarks'}
		<BookmarksTab bookmarks={data.bookmarks as never} config={data.config as never} />
	{:else if tab === 'poe2'}
		<Poe2Tab poe2={data.poe2 as never} watchlist={data.watchlist as never} />
	{:else if tab === 'searchbar'}
		<SearchEnginesTab />
	{:else if tab === 'empty'}
		<p class="hint">An open slot keeps this position empty until a widget takes it.</p>
	{:else}
		<p class="hint">{title(tab)} has no settings of its own.</p>
	{/if}
</div>

<div class="foot">
	<a href="/admin/settings?tab=widgets">Arrange the widget row, or turn widgets on and off →</a>
</div>

<style>
	.hd b {
		font-family: var(--serif);
		font-size: 22px;
		font-weight: 500;
	}
	.hd {
		margin: 0 30px 12px 0;
	}
	.tabs {
		margin-bottom: 14px;
	}
	.body {
		min-height: 0;
	}
	.foot {
		padding-top: 14px;
		margin-top: 14px;
		border-top: 1px solid var(--bd);
		font-size: 12px;
	}
</style>
