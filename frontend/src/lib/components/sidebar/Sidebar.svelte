<script lang="ts">
	import type { Weather, StockTicker, Bookmark, Poe2Data } from '$lib/types';
	import WeatherWidget from './WeatherWidget.svelte';
	import StocksWidget from './StocksWidget.svelte';
	import BookmarksWidget from './BookmarksWidget.svelte';
	import Poe2Widget from './Poe2Widget.svelte';

	let { weather, stocks, bookmarks, poe2 }: { weather: Weather; stocks: StockTicker[]; bookmarks: Bookmark[]; poe2: Poe2Data } = $props();
</script>

<aside class="sidebar">
	<WeatherWidget {weather} />
	<StocksWidget {stocks} />
	<Poe2Widget {poe2} />
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
