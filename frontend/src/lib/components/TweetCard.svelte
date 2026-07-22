<script lang="ts">
	import type { MergedArticle } from '$lib/types';
	import { timeAgo, exactTime } from '$lib/format';
	import { resolveMediaUrl } from '$lib/config';

	let { article }: { article: MergedArticle } = $props();

	const sourceLabel = $derived(article.sources[0]?.sourceName ?? 'Nitter');
</script>

<a class="tweet-card" href={`/article/${article.id}`}>
	<div class="meta">
		<span>{article.category[0] ?? ''}</span>
		<span>&middot;</span>
		<span>{sourceLabel}</span>
		<span>&middot;</span>
		<span>🐦 Tweet</span>
	</div>
	<div class="author-row">
		{#if article.tweet?.avatarUrl}
			<img class="avatar" src={resolveMediaUrl(article.tweet.avatarUrl)} alt="" loading="lazy" />
		{:else}
			<div class="avatar placeholder"></div>
		{/if}
		<span class="name">{article.tweet?.authorName}</span>
		<span class="handle">@{article.tweet?.authorHandle}</span>
	</div>
	<div class="text">{article.body}</div>
	{#if article.heroImage}
		<img class="tweet-img" src={resolveMediaUrl(article.heroImage.url)} alt="" loading="lazy" />
	{/if}
	<div class="time">{timeAgo(article.publishedAt)} &middot; {exactTime(article.publishedAt)}</div>
</a>

<style>
	.tweet-card {
		display: block;
		border: 0.5px solid var(--border);
		border-radius: 12px;
		padding: 14px;
		margin-bottom: 12px;
		background: var(--surface-2);
		color: inherit;
	}
	.tweet-card:hover {
		text-decoration: none;
		border-color: var(--border-accent);
	}
	.meta {
		font-size: 11px;
		color: var(--text-accent);
		display: flex;
		gap: 6px;
		margin-bottom: 10px;
	}
	.author-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}
	.avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
		background: var(--surface-1);
	}
	.avatar.placeholder {
		display: block;
	}
	.name {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.handle {
		font-size: 13px;
		color: var(--text-muted);
	}
	.text {
		font-size: 14px;
		line-height: 1.5;
		color: var(--text-primary);
		white-space: pre-line;
		margin-bottom: 8px;
	}
	.tweet-img {
		width: 100%;
		border-radius: var(--radius);
		margin-bottom: 8px;
		display: block;
		background: var(--surface-1);
	}
	.time {
		font-size: 11px;
		color: var(--text-muted);
	}
</style>
