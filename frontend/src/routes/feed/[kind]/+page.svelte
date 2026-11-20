<script lang="ts">
	import type { PageData } from './$types';
	import InfiniteFeed from '$lib/components/InfiniteFeed.svelte';
	import BrowsePanel from '$lib/components/shell/BrowsePanel.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.name} · Homefeed</title></svelte:head>

<BrowsePanel title={data.name} kicker="Feed" note="Newest first · new posts appear at the top">
	<InfiniteFeed initial={data.initial} filters={data.filters} pageSize={data.pageSize} />
</BrowsePanel>
