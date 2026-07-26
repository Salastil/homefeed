<script lang="ts">
	import type { AdminSettings, AdminStockTicker, AdminBookmark, AdminPoe2Entry } from '$lib/adminTypes';
	import { updateSettings } from '$lib/adminApi';
	import WidgetSection from './WidgetSection.svelte';
	import WeatherTab from './WeatherTab.svelte';
	import StocksTab from './StocksTab.svelte';
	import BookmarksTab from './BookmarksTab.svelte';
	import Poe2Tab from './Poe2Tab.svelte';

	let {
		settings,
		stockTickers,
		bookmarks,
		poe2Watchlist
	}: {
		settings: AdminSettings;
		stockTickers: AdminStockTicker[];
		bookmarks: AdminBookmark[];
		poe2Watchlist: AdminPoe2Entry[];
	} = $props();

	// Local copies so each toggle/reorder reflects immediately — same idiom as
	// BookmarksTab's per-row "Private" toggle.
	let widgets = $state({ ...settings.widgets });
	let widgetOrder = $state([...settings.widgetOrder]);

	const titles: Record<(typeof widgetOrder)[number], string> = {
		weather: 'Weather',
		stocks: 'Stocks',
		bookmarks: 'Bookmarks',
		poe2: 'PoE2'
	};

	async function toggle(key: keyof typeof widgets) {
		widgets[key] = !widgets[key];
		await updateSettings({ widgets });
	}

	async function move(index: number, dir: -1 | 1) {
		const target = index + dir;
		if (target < 0 || target >= widgetOrder.length) return;
		const arr = [...widgetOrder];
		[arr[index], arr[target]] = [arr[target], arr[index]];
		widgetOrder = arr;
		await updateSettings({ widgetOrder });
	}
</script>

{#each widgetOrder as key, i (key)}
	<WidgetSection
		title={titles[key]}
		enabled={widgets[key]}
		onToggle={() => toggle(key)}
		canMoveUp={i > 0}
		canMoveDown={i < widgetOrder.length - 1}
		onMoveUp={() => move(i, -1)}
		onMoveDown={() => move(i, 1)}
	>
		{#if key === 'weather'}
			<WeatherTab {settings} />
		{:else if key === 'stocks'}
			<StocksTab tickers={stockTickers} />
		{:else if key === 'bookmarks'}
			<BookmarksTab {bookmarks} />
		{:else if key === 'poe2'}
			<Poe2Tab {settings} watchlist={poe2Watchlist} />
		{/if}
	</WidgetSection>
{/each}
