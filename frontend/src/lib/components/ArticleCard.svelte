<script lang="ts">
	import type { MergedArticle } from '$lib/types';
	import { timeAgo } from '$lib/format';

	let { article }: { article: MergedArticle } = $props();

	const sourceLabel = $derived(
		article.sourceCount > 1
			? `${article.sourceCount} sources`
			: (article.sources[0]?.sourceName ?? 'Single source')
	);
</script>

<a class="card" href={`/article/${article.id}`}>
	{#if article.heroImage}
		<img class="thumb" src={article.heroImage.url} alt="" loading="lazy" />
	{:else}
		<div class="thumb placeholder"></div>
	{/if}
	<div class="meta">
		{#if article.video}
			<i class="tag-icon">▶</i> Video
		{:else if article.sourceCount > 1}
			<i class="tag-icon">⇄</i> {sourceLabel}
		{:else}
			{sourceLabel}
		{/if}
	</div>
	<div class="title">{article.title}</div>
	<div class="sub">{timeAgo(article.publishedAt)}</div>
</a>

<style>
	.card {
		display: block;
		color: inherit;
	}
	.card:hover {
		text-decoration: none;
	}
	.card:hover .title {
		text-decoration: underline;
	}
	.thumb {
		width: 100%;
		aspect-ratio: 16 / 10;
		object-fit: cover;
		border-radius: var(--radius);
		margin-bottom: 8px;
		background: var(--surface-1);
	}
	.thumb.placeholder {
		display: block;
	}
	.meta {
		font-size: 11px;
		color: var(--text-accent);
		margin-bottom: 3px;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.tag-icon {
		font-style: normal;
	}
	.title {
		font-size: 14px;
		font-weight: 500;
		line-height: 1.35;
		margin-bottom: 4px;
	}
	.sub {
		font-size: 11px;
		color: var(--text-muted);
	}
</style>
