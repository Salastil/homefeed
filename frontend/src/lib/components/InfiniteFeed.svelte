<script lang="ts">
	import type { MergedArticle } from '$lib/types';
	import { getFeed, type FeedParams } from '$lib/api';
	import ArticleListRow from './ArticleListRow.svelte';

	let { initial, filters, pageSize = 15 }: { initial: MergedArticle[]; filters: FeedParams; pageSize?: number } = $props();

	// The publish pipeline runs on a ~1 minute tick (see queue/scheduler.ts), so there's
	// nothing new to find by asking any more often than this.
	const POLL_MS = 60_000;

	let articles = $state<MergedArticle[]>(initial);
	let loading = $state(false);
	let done = $state(initial.length < pageSize);
	let sentinel = $state<HTMLDivElement>();
	// Plain variable, not $state — nothing renders from it; it exists only to stop two
	// polls (interval tick and a visibilitychange landing together) from overlapping.
	let refreshing = false;

	// Re-syncs when the page's load data changes on a *subsequent* navigation —
	// necessary because SvelteKit reuses this component instance across client-side
	// navigations between category pages (only the route param changes), so a
	// one-time state init would leave stale articles on screen after navigating e.g.
	// Tech -> World.
	//
	// Keyed on which articles `initial` actually contains, not on the prop's object
	// identity. The layout's periodic invalidate('app:sidebar') rebuilds the page data
	// object without the feed itself having changed, and an identity-based check treated
	// that as a navigation and reset the list — which silently threw away everything
	// refresh() had polled in (measured: stories appearing and then vanishing 4ms later).
	// Comparing ids also subsumes the old skip-the-first-run guard, since on mount the
	// signature already matches what `articles` was initialized from.
	let syncedIds = initial.map((a) => a.id).join(',');
	$effect(() => {
		const ids = initial.map((a) => a.id).join(',');
		if (ids === syncedIds) return;
		syncedIds = ids;
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

	// Pulls the newest page and folds it into what's already on screen, rather than
	// replacing the list — a wholesale swap would throw away everything paged in by
	// loadMore() and bounce the reader back to the top.
	async function refresh() {
		// loadMore() appends using the last article's timestamp as its cursor; merging a
		// prepend into that mid-flight would shift the array under it.
		if (refreshing || loading) return;
		refreshing = true;
		try {
			const fresh = await getFeed({ ...filters, limit: pageSize });
			const known = new Set(articles.map((a) => a.id));
			const incoming = fresh.filter((a) => !known.has(a.id));
			// A story already on screen can change without being new: a merge keeps
			// absorbing sources after it publishes (sourceCount climbs, the body gets
			// rewritten), so a row whose updatedAt moved is swapped in place instead of
			// being left stale until the next full page load.
			const byId = new Map(fresh.map((a) => [a.id, a]));
			const revised = articles.map((a) => {
				const f = byId.get(a.id);
				return f && f.updatedAt !== a.updatedAt ? f : a;
			});
			const anyRevised = revised.some((a, i) => a !== articles[i]);
			if (incoming.length === 0 && !anyRevised) return;

			// Prepended deliberately, with no scroll adjustment of our own: browsers
			// implement scroll anchoring for exactly this case and keep the reader's place
			// when content is inserted above the viewport. Two hand-rolled corrections were
			// tried here and both made it worse — compensating by the document height delta
			// double-counted against the browser's own adjustment (overshooting by exactly
			// the inserted height), and anchoring off the previously-first row scrolled the
			// page to the top outright. The native behaviour was already correct on its own.
			articles = [...incoming, ...revised];
		} catch {
			// Transient failure (backend restarting, network blip) — the next tick retries.
			// Deliberately silent: a stale list is better than an error banner over content
			// that's still perfectly readable.
		} finally {
			refreshing = false;
		}
	}

	// SvelteKit re-runs load() only on navigation, so without this a tab left open never
	// shows anything published after it rendered. Polling rather than SSE on purpose: the
	// deployment sits behind a reverse proxy that needs explicit buffering changes before
	// an event stream works at all (see the /widget-assets note in README), and a
	// 1-minute poll already matches the rate at which articles can appear.
	$effect(() => {
		const pollIfVisible = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		const interval = setInterval(pollIfVisible, POLL_MS);
		// A hidden tab skips its polls, so refresh the moment it's looked at again instead
		// of showing content up to a full interval out of date.
		document.addEventListener('visibilitychange', pollIfVisible);
		return () => {
			clearInterval(interval);
			document.removeEventListener('visibilitychange', pollIfVisible);
		};
	});

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
