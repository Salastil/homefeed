<script lang="ts">
	import type { MergedArticle } from '$lib/types';
	import { timeAgo, exactTime, excerpt } from '$lib/format';
	import { resolveMediaUrl } from '$lib/config';

	let { article }: { article: MergedArticle } = $props();

	const sourceLabel = $derived(
		article.sourceCount > 1
			? `⇄ ${article.sourceCount} sources`
			: (article.sources[0]?.sourceName ?? 'Single source')
	);
</script>

<a class="row" href={`/article/${article.id}`}>
	{#if article.heroImage}
		<img class="thumb" src={resolveMediaUrl(article.heroImage.url)} alt="" loading="lazy" />
	{:else}
		<div class="thumb placeholder"></div>
	{/if}

	<div class="content">
		<div class="meta">
			<span>{article.category[0] ?? ''}</span>
			<span>&middot;</span>
			<span>{sourceLabel}</span>
			{#if article.video}
				<span>&middot;</span>
				<span>▶ Video</span>
			{/if}
		</div>
		<div class="title">{article.title}</div>
		<div class="excerpt">{excerpt(article.body)}</div>
		<div class="time">{timeAgo(article.publishedAt)} &middot; {exactTime(article.publishedAt)}</div>
	</div>
</a>

<style>
	.row {
		display: flex;
		gap: 16px;
		padding: 16px 0;
		border-bottom: 0.5px solid var(--border);
		color: inherit;
	}
	.row:hover {
		text-decoration: none;
	}
	.row:hover .title {
		text-decoration: underline;
	}
	.thumb {
		width: 88px;
		height: 88px;
		flex-shrink: 0;
		object-fit: cover;
		border-radius: var(--radius);
		background: var(--surface-1);
	}
	.thumb.placeholder {
		display: block;
	}
	.content {
		min-width: 0;
		flex: 1;
	}
	.meta {
		font-size: 11px;
		color: var(--text-accent);
		display: flex;
		gap: 6px;
		margin-bottom: 4px;
	}
	.title {
		font-size: 16px;
		font-weight: 500;
		line-height: 1.35;
		margin-bottom: 4px;
	}
	.excerpt {
		font-size: 13px;
		color: var(--text-secondary);
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		margin-bottom: 4px;
	}
	.time {
		font-size: 11px;
		color: var(--text-muted);
	}
</style>
