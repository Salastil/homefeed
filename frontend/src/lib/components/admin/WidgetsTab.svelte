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

	// Local copy so each checkbox flips immediately — same idiom as BookmarksTab's
	// per-row "Private" toggle, just for widget visibility instead.
	let widgets = $state({ ...settings.widgets });

	async function toggle(key: keyof typeof widgets) {
		widgets[key] = !widgets[key];
		await updateSettings({ widgets });
	}
</script>

<p class="hint">
	Each widget can be shown or hidden from the sidebar independently. Hiding one only affects
	whether it's visible on the site — its own settings and data below keep working either way.
</p>

<WidgetSection title="Weather" enabled={widgets.weather} onToggle={() => toggle('weather')}>
	<WeatherTab {settings} />
</WidgetSection>

<WidgetSection title="Stocks" enabled={widgets.stocks} onToggle={() => toggle('stocks')}>
	<StocksTab tickers={stockTickers} />
</WidgetSection>

<WidgetSection title="Bookmarks" enabled={widgets.bookmarks} onToggle={() => toggle('bookmarks')}>
	<BookmarksTab {bookmarks} />
</WidgetSection>

<WidgetSection title="PoE2" enabled={widgets.poe2} onToggle={() => toggle('poe2')}>
	<Poe2Tab {settings} watchlist={poe2Watchlist} />
</WidgetSection>

<style>
	.hint {
		font-size: 12px;
		color: var(--text-secondary);
		margin: 0 0 14px;
	}
</style>
