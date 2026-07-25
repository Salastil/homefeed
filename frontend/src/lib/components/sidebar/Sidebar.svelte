<script lang="ts">
	import type { Weather, StockTicker, Bookmark } from '$lib/types';
	import WeatherWidget from './WeatherWidget.svelte';
	import StocksWidget from './StocksWidget.svelte';
	import BookmarksWidget from './BookmarksWidget.svelte';

	let { weather, stocks, bookmarks }: { weather: Weather; stocks: StockTicker[]; bookmarks: Bookmark[] } = $props();
</script>

<aside class="sidebar">
	<WeatherWidget {weather} />
	<StocksWidget {stocks} />
	<BookmarksWidget {bookmarks} />
</aside>

<style>
	.sidebar {
		display: flex;
		flex-direction: column;
		gap: 16px;
		position: sticky;
		top: 20px;
	}
</style>
