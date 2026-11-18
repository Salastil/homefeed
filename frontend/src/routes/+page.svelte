<script lang="ts">
	/**
	 * The board (accepted design A/B in issue #1): storyline panel over the category columns,
	 * filling the screen under the widget row. Both halves re-poll every minute and replace
	 * what's on screen wholesale - the server sends bounded lists, so a tab left open for
	 * days holds the same amount of data as one opened a minute ago.
	 */
	import type { PageData } from './$types';
	import type { LiteArticle } from '$lib/types';
	import { getBoard, getStorylines } from '$lib/api';
	import { clock, poll } from '$lib/live.svelte';
	import StorylineBand from '$lib/components/board/StorylineBand.svelte';
	import BoardColumns from '$lib/components/board/BoardColumns.svelte';
	import DevelopmentSheet from '$lib/components/board/DevelopmentSheet.svelte';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	let board = $state(data.board);
	// svelte-ignore state_referenced_locally
	let storylines = $state(data.storylines);
	$effect(() => {
		board = data.board;
		storylines = data.storylines;
	});

	$effect(() =>
		poll(async () => {
			// Each half updates on its own: one failing request doesn't hold back the other.
			const [b, s] = await Promise.allSettled([getBoard(), getStorylines()]);
			if (b.status === 'fulfilled') board = b.value;
			if (s.status === 'fulfilled') storylines = s.value;
		}, 60_000)
	);

	// A storyline whose close time has passed leaves the panel (and its chip) on the next clock
	// tick instead of waiting for the next poll; that poll then confirms it.
	const open = $derived({ ...storylines, storylines: storylines.storylines.filter((s) => !s.closesAt || Date.parse(s.closesAt) > clock.now) });

	let sheet = $state<{ title: string; members: LiteArticle[]; nodeId: string; color: string; scopeName: string; href: string; anchor: number } | null>(null);
</script>

<svelte:head><title>Homefeed</title></svelte:head>

<div class="board">
	<StorylineBand data={open} paused={!!sheet} selectedNode={sheet?.nodeId ?? null} onNode={(info) => (sheet = info)} />
	<BoardColumns columns={board.columns} layout={board.layout} storylines={open} />
</div>

{#if sheet}
	<DevelopmentSheet {...sheet} onClose={() => (sheet = null)} />
{/if}

<style>
	.board {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
</style>
