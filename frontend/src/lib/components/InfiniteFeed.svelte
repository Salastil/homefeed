<script lang="ts">
	import type { MergedArticle } from '$lib/types';
	import { getFeed, type FeedParams } from '$lib/api';
	import ArticleListRow from './ArticleListRow.svelte';

	let { initial, filters, pageSize = 15 }: { initial: MergedArticle[]; filters: FeedParams; pageSize?: number } = $props();

	let articles = $state<MergedArticle[]>(initial);
	let loading = $state(false);
	let done = $state(initial.length < pageSize);
	let sentinel = $state<HTMLDivElement>();

	// Re-syncs when the page's load data changes on a *subsequent* navigation —
	// necessary because SvelteKit reuses this component instance across client-side
	// navigations between category pages (only the route param changes), so a
	// one-time state init would leave stale articles on screen after navigating e.g.
	// Tech -> World. Guarded to skip the first run: articles is already correctly
	// initialized from `initial` above, and re-running this unconditionally on mount
	// created a render race where SSR output briefly reflected an empty array instead.
	let firstEffectRun = true;
	$effect(() => {
		initial;
		pageSize;
		if (firstEffectRun) {
			firstEffectRun = false;
			return;
		}
		articles = [...initial];
		done = initial.length < pageSize;
	});

	async function loadMore() {
		if (loading || done) return;
		loading = true;
		try {
			const last = articles[articles.length - 1];
			const next = await getFeed({ ...filters, before: last?.publishedAt, limit: pageSize });
			if (next.length < pageSize) done = true;
			if (next.length === 0) return;
			articles = [...articles, ...next];
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!sentinel) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) loadMore();
			},
			{ rootMargin: '400px' }
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	});
</script>

<div class="list">
	{#each articles as article (article.id)}
		<ArticleListRow {article} />
	{/each}
</div>

{#if !done}
	<div class="sentinel" bind:this={sentinel}></div>
{/if}

{#if loading}
	<div class="status">Loading more…</div>
{:else if done && articles.length > 0}
	<div class="status">You're caught up.</div>
{:else if articles.length === 0}
	<div class="status">No stories here yet.</div>
{/if}

<style>
	.list {
		max-width: 720px;
	}
	.sentinel {
		height: 1px;
	}
	.status {
		text-align: center;
		font-size: 12px;
		color: var(--text-muted);
		padding: 20px 0;
	}
</style>
