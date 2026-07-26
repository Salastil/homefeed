<script lang="ts">
	import { tick } from 'svelte';
	import type { Weather, StockTicker, Bookmark, Poe2Data, WidgetsEnabled } from '$lib/types';
	import WeatherWidget from './WeatherWidget.svelte';
	import StocksWidget from './StocksWidget.svelte';
	import BookmarksWidget from './BookmarksWidget.svelte';
	import Poe2Widget from './Poe2Widget.svelte';

	let {
		weather,
		stocks,
		bookmarks,
		poe2,
		widgetsEnabled
	}: {
		weather: Weather;
		stocks: StockTicker[];
		bookmarks: Bookmark[];
		poe2: Poe2Data;
		widgetsEnabled: WidgetsEnabled;
	} = $props();

	// Weather + Stocks + PoE2 + Bookmarks stacked can be taller than the viewport. Plain
	// `position: sticky` alone can only pin a box at a constant offset — it can't reveal
	// content taller than that box without either an internal scrollbar (a second,
	// separate scroll region — janky) or shifting the content within the box as the page
	// scrolls. This does the latter: `.sidebar-track` is a plain (non-positioned) spacer
	// sized to the widgets' full natural height, so the page reserves exactly enough
	// scroll room; `.sidebar-viewport` is the sticky, viewport-capped, clipped box; and
	// `.sidebar-content` is translated upward inside it in lockstep with how far the page
	// has scrolled past the point where the sidebar started sticking — one continuous
	// scroll gesture over the whole page drives it, not a separate widget-local scrollbar.
	const TOP_MARGIN = 20;
	const BOTTOM_MARGIN = 20;

	let trackEl: HTMLElement | undefined = $state();
	let contentEl: HTMLElement | undefined = $state();
	let trackHeight = $state(0);
	let viewportHeight = $state(0);
	let progress = $state(0);

	function update() {
		if (!trackEl || !contentEl) return;
		const naturalHeight = contentEl.offsetHeight;
		const cappedHeight = Math.min(naturalHeight, window.innerHeight - TOP_MARGIN - BOTTOM_MARGIN);
		const revealRange = naturalHeight - cappedHeight;

		trackHeight = naturalHeight;
		viewportHeight = cappedHeight;

		if (revealRange <= 0) {
			progress = 0;
			return;
		}

		// trackEl is never itself positioned/sticky, so its rect always reflects genuine
		// scroll progress — how far its top has moved past TOP_MARGIN is exactly how much
		// extra scrolling has happened since the sidebar started sticking.
		const extraScroll = TOP_MARGIN - trackEl.getBoundingClientRect().top;
		progress = Math.max(0, Math.min(revealRange, extraScroll));
	}

	async function remeasure() {
		await tick();
		update();
	}

	$effect(() => {
		// Widget data changing the sidebar's natural height needs a remeasure, not just a
		// scroll-position update. widgetsEnabled changes it too — a disabled widget is
		// removed from the flow entirely, not just emptied.
		void weather;
		void stocks;
		void bookmarks;
		void poe2;
		void widgetsEnabled;
		remeasure();
	});

	$effect(() => {
		window.addEventListener('scroll', update, { passive: true });
		window.addEventListener('resize', remeasure);
		return () => {
			window.removeEventListener('scroll', update);
			window.removeEventListener('resize', remeasure);
		};
	});
</script>

<div class="sidebar-track" bind:this={trackEl} style:height="{trackHeight}px">
	<aside class="sidebar-viewport" style:height="{viewportHeight}px">
		<div class="sidebar-content" bind:this={contentEl} style:transform="translateY(-{progress}px)">
			{#each widgetsEnabled.order as key (key)}
				{#if key === 'weather' && widgetsEnabled.weather}
					<WeatherWidget {weather} />
				{:else if key === 'stocks' && widgetsEnabled.stocks}
					<StocksWidget {stocks} />
				{:else if key === 'poe2' && widgetsEnabled.poe2}
					<Poe2Widget {poe2} />
				{:else if key === 'bookmarks' && widgetsEnabled.bookmarks}
					<BookmarksWidget {bookmarks} />
				{/if}
			{/each}
		</div>
	</aside>
</div>

<style>
	.sidebar-track {
		position: relative;
	}
	.sidebar-viewport {
		position: sticky;
		top: 20px;
		overflow: hidden;
	}
	.sidebar-content {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
</style>
