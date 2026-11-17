<script lang="ts">
	import type { PageData } from './$types';
	import InfiniteFeed from '$lib/components/InfiniteFeed.svelte';
	import BrowsePanel from '$lib/components/shell/BrowsePanel.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>#{data.tag.label} · Homefeed</title></svelte:head>

<BrowsePanel title="#{data.tag.label}" kicker="Tag" color="var(--acc)" note="{data.tag.articleCount} articles">
	<InfiniteFeed initial={data.initial} filters={data.filters} pageSize={data.pageSize} />
</BrowsePanel>
