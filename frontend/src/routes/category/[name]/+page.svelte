<script lang="ts">
	import type { PageData } from './$types';
	import ArticleCard from '$lib/components/ArticleCard.svelte';

	let { data }: { data: PageData } = $props();
</script>

<div class="head">
	<span class="title">{data.name}</span>
	<span class="count">{data.articles.length} stories</span>
</div>

{#if data.articles.length === 0}
	<p class="empty">No stories in this category yet.</p>
{:else}
	<div class="grid">
		{#each data.articles as article}
			<ArticleCard {article} />
		{/each}
	</div>
{/if}

<style>
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin: 24px 0 20px;
	}
	.title {
		font-family: var(--font-voice);
		font-size: 26px;
		font-weight: 500;
		text-transform: capitalize;
	}
	.count {
		font-size: 12px;
		color: var(--text-muted);
	}
	.empty {
		color: var(--text-muted);
		font-size: 14px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 20px;
	}
</style>
