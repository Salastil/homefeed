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
	import ClosedSheet from '$lib/components/board/ClosedSheet.svelte';
	import { admin } from '$lib/adminSession.svelte';

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

	// An edit made in board edit mode (or on the admin pages in this tab) shows at once.
	let seenVersion = admin.boardVersion;
	$effect(() => {
		if (admin.boardVersion === seenVersion) return;
		seenVersion = admin.boardVersion;
		Promise.allSettled([getBoard(), getStorylines()]).then(([b, s]) => {
			if (b.status === 'fulfilled') board = b.value;
			if (s.status === 'fulfilled') storylines = s.value;
		});
	});

	// A storyline whose close time has passed leaves the panel (and its chip) on the next clock
	// tick instead of waiting for the next poll; that poll then confirms it.
	const open = $derived({ ...storylines, storylines: storylines.storylines.filter((s) => !s.closesAt || Date.parse(s.closesAt) > clock.now) });

	let sheet = $state<{ title: string; members: LiteArticle[]; nodeId: string; color: string; scopeName: string; href: string; anchor: number } | null>(null);
	// The closed-storylines pane, hung under the "Closed today" chip (null = shut).
	let closedAt = $state<number | null>(null);
</script>

<svelte:head><title>Homefeed</title></svelte:head>

<div class="board">
	<div class="band" class:editing={admin.editing} class:sel={admin.sheet?.kind === 'panel'}>
		<StorylineBand
			data={open}
			paused={!!sheet || closedAt !== null || admin.editing}
			selectedNode={sheet?.nodeId ?? null}
			closedOpen={closedAt !== null}
			onNode={(info) => ((closedAt = null), (sheet = info))}
			onClosed={(anchor) => ((sheet = null), (closedAt = closedAt === null ? anchor : null))}
		/>
		{#if admin.editing}
			<button class="eh" onclick={() => (admin.sheet = { kind: 'panel' })}>Storyline panel · {storylines.settings.rows} row{storylines.settings.rows === 1 ? '' : 's'} · {storylines.settings.rotateSeconds} s</button>
		{/if}
	</div>
	<BoardColumns columns={board.columns} layout={board.layout} storylines={open} />
</div>

{#if sheet}
	<DevelopmentSheet {...sheet} onClose={() => (sheet = null)} />
{/if}
{#if closedAt !== null}
	<ClosedSheet anchor={closedAt} onClose={() => (closedAt = null)} />
{/if}

<style>
	.band {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: none;
	}
	.band.editing {
		outline: 1.5px dashed var(--acc);
		outline-offset: 3px;
		border-radius: 11px;
	}
	.band.sel {
		outline-style: solid;
	}
	.eh {
		position: absolute;
		top: -11px;
		right: 12px;
		z-index: 2;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 9px;
		border: 0;
		border-radius: 6px;
		background: var(--acc);
		color: var(--s0);
	}
	.board {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
</style>
