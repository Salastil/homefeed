<script lang="ts">
	import type { PageData } from './$types';
	import { slugify } from '$lib/format';
	import ArticleListRow from '$lib/components/ArticleListRow.svelte';
	import BrowsePanel from '$lib/components/shell/BrowsePanel.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>More · Homefeed</title></svelte:head>

<BrowsePanel title="More" color="var(--tx3)" note="Spillover categories and tracked items">
<div class="sections">
	{#each data.categorySections as section (section.category.id)}
		<section class="cat-section">
			<a class="cat-name" href={`/category/${slugify(section.category.name)}`}>{section.category.name}</a>
			<div class="list">
				{#if section.articles.length > 0}
					{#each section.articles as article (article.id)}
						<ArticleListRow {article} />
					{/each}
				{:else}
					<div class="empty">No stories here yet.</div>
				{/if}
			</div>
		</section>
	{/each}
	{#each data.eventSections as section (section.event.id)}
		<section class="cat-section">
			<a class="cat-name" href={`/event/${section.event.id}`}>{section.event.name}</a>
			<div class="list">
				{#if section.articles.length > 0}
					{#each section.articles as article (article.id)}
						<ArticleListRow {article} />
					{/each}
				{:else}
					<div class="empty">No stories here yet.</div>
				{/if}
			</div>
		</section>
	{/each}
</div>
</BrowsePanel>

<style>
	.sections {
		display: flex;
		flex-direction: column;
		gap: 22px;
		margin-top: 12px;
	}
	.cat-section {
		border-bottom: 0.5px solid var(--border);
		padding-bottom: 18px;
	}
	.cat-name {
		display: inline-block;
		font-family: var(--serif);
		font-size: 19px;
		font-weight: 600;
		color: var(--tx);
		margin-bottom: 10px;
	}
	.cat-name:hover {
		color: var(--text-accent);
	}
	.empty {
		font-size: 12px;
		color: var(--text-muted);
		padding: 4px 0;
	}
</style>
