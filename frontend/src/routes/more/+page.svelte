<script lang="ts">
	import type { PageData } from './$types';
	import { timeAgo, slugify } from '$lib/format';

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
				<div class="preview-list">
					{#each section.articles as article (article.id)}
						<a class="preview-row" href={`/article/${article.id}`}>
							<span class="preview-title">{article.title}</span>
							<span class="preview-time">{timeAgo(article.publishedAt)}</span>
						</a>
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
	.preview-list {
		display: flex;
		flex-direction: column;
	}
	.preview-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 0;
		border-top: 0.5px solid var(--border);
		color: inherit;
	}
	.preview-row:first-child {
		border-top: none;
	}
	.preview-row:hover {
		text-decoration: none;
	}
	.preview-row:hover .preview-title {
		text-decoration: underline;
	}
	.preview-title {
		font-size: 14px;
		line-height: 1.4;
	}
	.preview-time {
		font-size: 11px;
		color: var(--text-muted);
		white-space: nowrap;
		flex-shrink: 0;
	}
</style>
