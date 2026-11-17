<script lang="ts">
	import type { BookmarksFeed, Poe2Data, StocksFeed, Weather, WidgetsEnabled } from '$lib/types';
	import WidgetSlot from './WidgetSlot.svelte';

	let {
		widgets,
		weather,
		stocks,
		bookmarks,
		poe2,
		weatherActive = false
	}: {
		widgets: WidgetsEnabled;
		weather: Weather;
		stocks: StocksFeed;
		bookmarks: BookmarksFeed;
		poe2: Poe2Data;
		weatherActive?: boolean;
	} = $props();

	const slots = $derived(widgets.slots ?? []);
	// The weather tile is a little wider (it carries a curve); everything else shares evenly.
	const columns = $derived(slots.map((s) => (s.widgets.includes('weather') ? '1.35fr' : '1.1fr')).join(' '));
</script>

{#if slots.length > 0}
	<div class="row" style:grid-template-columns={columns}>
		{#each slots as slot, i (slot.widgets.join('+') + i)}
			<WidgetSlot
				widgets={slot.widgets}
				rotateSeconds={slot.rotateSeconds}
				{weather}
				{stocks}
				{bookmarks}
				{poe2}
				pluggable={widgets.pluggable}
				{weatherActive}
			/>
		{/each}
	</div>
{/if}

<style>
	.row {
		display: grid;
		gap: 10px;
		flex: none;
	}
	@media (max-width: 900px) {
		.row {
			grid-template-columns: 1fr 1fr !important;
		}
	}
</style>
