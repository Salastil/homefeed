<script lang="ts">
	import type { PageData } from './$types';
	import InfiniteFeed from '$lib/components/InfiniteFeed.svelte';

	let { data }: { data: PageData } = $props();
</script>

<div class="head">
	<span class="title">{data.name}</span>
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
		text-transform: capitalize;
	}
</style>
