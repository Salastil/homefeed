<script lang="ts">
	import type { PageData } from './$types';
	import ArticleCard from '$lib/components/ArticleCard.svelte';
	import { timeAgo } from '$lib/format';

	let { data }: { data: PageData } = $props();
</script>

{#if data.hero}
	<a class="hero" href={`/article/${data.hero.id}`}>
		<div class="hero-meta">
			{#if data.hero.sourceCount > 1}
				<span>⇄ Merged from {data.hero.sourceCount} sources</span>
			{/if}
			<span>{data.hero.category.join(', ')}</span>
		</div>
		{#if data.hero.heroImage}
			<img class="hero-img" src={data.hero.heroImage.url} alt="" />
		{/if}
		<div class="hero-title">{data.hero.title}</div>
		<div class="hero-sub">{timeAgo(data.hero.publishedAt)}</div>
	</a>
{/if}

<section>
	<div class="section-head">
		<span class="section-title">Local &middot; Philadelphia</span>
		<a href="/category/local">See all</a>
	</div>
	<div class="grid">
		{#each data.local as article}
			<ArticleCard {article} />
		{/each}
	</div>
</section>

<section>
	<div class="section-head">
		<span class="section-title">Business</span>
		<a href="/category/business">See all</a>
	</div>
	<div class="grid">
		{#each data.business as article}
			<ArticleCard {article} />
		{/each}
	</div>
</section>

<section>
	<div class="section-head">
		<span class="section-title">Tech</span>
		<a href="/category/tech">See all</a>
	</div>
	<div class="grid">
		{#each data.tech as article}
			<ArticleCard {article} />
		{/each}
	</div>
</section>

<style>
	.hero {
		display: block;
		color: inherit;
		margin: 24px 0 36px;
		max-width: 720px;
	}
	.hero:hover {
		text-decoration: none;
	}
	.hero:hover .hero-title {
		text-decoration: underline;
	}
	.hero-meta {
		font-size: 12px;
		color: var(--text-accent);
		display: flex;
		gap: 10px;
		margin-bottom: 10px;
	}
	.hero-img {
		width: 100%;
		aspect-ratio: 16 / 8;
		object-fit: cover;
		border-radius: 12px;
		margin-bottom: 12px;
		background: var(--surface-1);
	}
	.hero-title {
		font-family: var(--font-voice);
		font-size: 30px;
		font-weight: 500;
		line-height: 1.25;
		margin-bottom: 8px;
	}
	.hero-sub {
		font-size: 12px;
		color: var(--text-muted);
	}

	section {
		margin-bottom: 32px;
	}
	.section-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 12px;
	}
	.section-title {
		font-family: var(--font-voice);
		font-size: 19px;
		font-weight: 500;
	}
	.section-head a {
		font-size: 12px;
		color: var(--text-muted);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 20px;
	}
</style>
