<script lang="ts">
	import type { PageData } from './$types';
	import { slugify } from '$lib/format';
	import ArticleListRow from '$lib/components/ArticleListRow.svelte';

	let { data }: { data: PageData } = $props();
</script>

<div class="head">
	<span class="title">More</span>
</div>

<div class="sections">
	{#each data.sections as section (section.category.id)}
		{#if section.articles.length > 0}
			<section class="cat-section">
				<a class="cat-name" href={`/category/${slugify(section.category.name)}`}>{section.category.name}</a>
				<div class="list">
					{#each section.articles as article (article.id)}
						<ArticleListRow {article} />
					{/each}
				</div>
			</section>
		{/if}
	{/each}
</div>

<style>
	.head {
		margin: 24px 0 8px;
	}
	.title {
		font-family: var(--font-voice);
		font-size: 26px;
		font-weight: 500;
	}
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
		font-size: 16px;
		font-weight: 500;
		color: var(--text-primary);
		margin-bottom: 10px;
	}
	.cat-name:hover {
		color: var(--text-accent);
	}
	.list {
		max-width: 720px;
	}
</style>
