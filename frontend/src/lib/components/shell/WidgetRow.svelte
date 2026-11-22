<script lang="ts">
	import type { BookmarksFeed, Poe2Data, StocksFeed, Weather, WidgetsEnabled } from '$lib/types';
	import WidgetSlot from './WidgetSlot.svelte';
	import { admin } from '$lib/adminSession.svelte';

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
			<div class="ws" class:editing={admin.editing} class:sel={admin.sheet?.kind === 'widgets' && admin.sheet.ids.join() === slot.widgets.join()}>
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
				{#if admin.editing}
					<button class="eh" onclick={() => (admin.sheet = { kind: 'widgets', ids: slot.widgets })}>Edit</button>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.row {
		display: grid;
		gap: 10px;
		flex: none;
	}
	.ws {
		position: relative;
		min-width: 0;
	}
	.ws.editing {
		outline: 1.5px dashed var(--acc);
		outline-offset: 3px;
		border-radius: 11px;
	}
	.ws.sel {
		outline-style: solid;
	}
	.eh {
		position: absolute;
		top: -11px;
		right: 10px;
		z-index: 2;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 9px;
		border: 0;
		border-radius: 6px;
		background: var(--acc);
		color: var(--s0);
	}
	@media (max-width: 900px) {
		.row {
			grid-template-columns: 1fr 1fr !important;
		}
	}
	/* Phones: one tile at a time in a swipeable strip, the next one peeking in at the edge, so
	   the widgets cost one tile's height instead of pushing the news a screen down. Bleeds to
	   the screen edges so a tile can scroll fully into view. */
	@media (max-width: 760px) {
		.row {
			display: flex;
			gap: 8px;
			overflow-x: auto;
			scroll-snap-type: x mandatory;
			scrollbar-width: none;
			margin: 0 -12px;
			padding: 0 12px;
			scroll-padding: 0 12px;
		}
		.row::-webkit-scrollbar {
			display: none;
		}
		.ws {
			flex: 0 0 min(88%, 380px);
			scroll-snap-align: start;
		}
	}
</style>
