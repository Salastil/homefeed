<script lang="ts">
	import type { PageData } from './$types';
	import { timeAgo, exactTime } from '$lib/format';
	import { resolveMediaUrl } from '$lib/config';

	let { data }: { data: PageData } = $props();
	const a = $derived(data.article);
</script>

<div class="breadcrumb">
	<a href="/">{a.category[0] ?? 'Top stories'}</a>
	<span>›</span>
	<span>{a.title.slice(0, 40)}{a.title.length > 40 ? '…' : ''}</span>
</div>

<article>
	<div class="meta">
		{#if a.sourceCount > 1}
			<span>⇄ Merged from {a.sourceCount} sources</span>
			<span>&middot;</span>
		{/if}
		<span>{a.category.join(', ')}</span>
	</div>

	<h1>{a.title}</h1>

	<div class="dates">
		<span>Published {timeAgo(a.publishedAt)} &middot; {exactTime(a.publishedAt)}</span>
		{#if a.updatedAt !== a.publishedAt}
			<span>&middot; Updated {timeAgo(a.updatedAt)} &middot; {exactTime(a.updatedAt)}</span>
		{/if}
	</div>

	{#if a.heroImage}
		<img class="hero-img" src={resolveMediaUrl(a.heroImage.url)} alt="" />
		<div class="img-caption">
			Image via <span class="accent">{a.sources[0]?.sourceName ?? 'source'}</span>
		</div>
	{/if}

	{#each a.body.split('\n\n') as paragraph}
		<p>{paragraph}</p>
	{/each}

	{#if a.video}
		<div class="video-embed">▶ video embed &middot; via {a.video.provider}</div>
	{/if}

	{#if data.tagLabels.length}
		<div class="tags">
			{#each data.tagLabels as tag}
				<a class="tag-chip" href={`/tag/${tag.slug}`}>{tag.label}</a>
			{/each}
		</div>
	{/if}

	{#if data.nextArticle}
		<a class="thread-banner" href={`/article/${data.nextArticle.id}`}>
			→ Newer coverage available: <strong>{data.nextArticle.title}</strong>
		</a>
	{/if}
	{#if data.previousArticle}
		<a class="thread-banner" href={`/article/${data.previousArticle.id}`}>
			← Earlier coverage: <strong>{data.previousArticle.title}</strong>
		</a>
	{/if}

	{#if a.sources.length}
		<div class="sources">
			<span class="sources-label">Sources:</span>
			{#each a.sources as source, i}
				<a href={source.link} target="_blank" rel="noreferrer">{source.sourceName}</a>
				{#if i < a.sources.length - 1}<span>&middot;</span>{/if}
			{/each}
		</div>
	{/if}
</article>

<style>
	.breadcrumb {
		font-size: 12px;
		color: var(--text-muted);
		margin: 20px 0 18px;
		display: flex;
		gap: 8px;
	}
	article {
		max-width: 640px;
	}
	.meta {
		font-size: 11px;
		color: var(--text-accent);
		margin-bottom: 10px;
		display: flex;
		gap: 6px;
	}
	h1 {
		font-family: var(--font-voice);
		font-size: 32px;
		line-height: 1.2;
		font-weight: 500;
		margin: 0 0 14px;
	}
	.dates {
		font-size: 12px;
		color: var(--text-muted);
		margin-bottom: 20px;
		display: flex;
		gap: 6px;
	}
	.hero-img {
		width: 100%;
		border-radius: 12px;
		margin-bottom: 8px;
		background: var(--surface-1);
	}
	.img-caption {
		font-size: 11px;
		color: var(--text-muted);
		margin-bottom: 24px;
	}
	.accent {
		color: var(--text-accent);
	}
	p {
		font-size: 16px;
		line-height: 1.75;
		color: var(--text-primary);
		margin: 0 0 16px;
	}
	.video-embed {
		width: 100%;
		border-radius: 12px;
		background: var(--surface-1);
		height: 200px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: var(--text-muted);
		font-size: 12px;
		margin-bottom: 24px;
	}
	.tags {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-bottom: 20px;
	}
	.tag-chip {
		font-size: 12px;
		padding: 5px 12px;
		background: var(--surface-1);
		border-radius: 16px;
		color: var(--text-secondary);
	}
	.tag-chip:hover {
		text-decoration: none;
		background: var(--border);
	}
	.thread-banner {
		display: block;
		background: var(--bg-accent);
		border-radius: var(--radius);
		padding: 12px 14px;
		margin-bottom: 16px;
		font-size: 13px;
		color: var(--text-accent);
	}
	.thread-banner:hover {
		text-decoration: none;
	}
	.thread-banner strong {
		font-weight: 500;
	}
	.sources {
		border-top: 0.5px solid var(--border);
		padding-top: 14px;
		margin-top: 8px;
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 12px;
	}
	.sources-label {
		color: var(--text-muted);
	}
</style>
