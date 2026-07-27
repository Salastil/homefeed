<script lang="ts">
	import type { PageData } from './$types';
	import InfiniteFeed from '$lib/components/InfiniteFeed.svelte';
	import { timeUntil } from '$lib/format';

	let { data }: { data: PageData } = $props();

	// recapIntervalHours === null means recaps are turned off for this item entirely;
	// lastRecapAt === null means the first recap hasn't happened yet (it fires once
	// there's new coverage to summarize — see backend/src/queue/eventsRecap.ts).
	let nextRecapText = $derived.by(() => {
		if (data.recapIntervalHours === null) return null;
		if (data.lastRecapAt === null) return 'first recap pending';
		const next = new Date(data.lastRecapAt).getTime() + data.recapIntervalHours * 3600_000;
		return `next recap ${timeUntil(new Date(next).toISOString())}`;
	});
</script>

<div class="head">
	<span class="title">{data.name}</span>
	<span class="sub">
		Tracked item — periodically recapped by AI
		{#if nextRecapText}
			· {nextRecapText}
		{/if}
	</span>
</div>

<InfiniteFeed initial={data.initial} filters={data.filters} pageSize={data.pageSize} />

<style>
	.head {
		margin: 24px 0 8px;
	}
	.title {
		font-family: var(--font-voice);
		font-size: 26px;
		font-weight: 500;
	}
	.sub {
		display: block;
		font-size: 12px;
		color: var(--text-muted);
		margin-top: 2px;
	}
</style>
