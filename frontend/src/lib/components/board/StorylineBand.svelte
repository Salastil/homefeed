<script lang="ts">
	/**
	 * The storyline panel: `rows` storylines at once (admin setting), turning to the next page
	 * every `rotateSeconds` (or, in hybrid mode, one large row until enough are open for two). Tracked events take part as pinned storylines. The chip row lists
	 * every open one and outlines those on screen; clicking a chip jumps to its page. With
	 * "jump on update", a storyline that gets a new update is shown at the next turn.
	 */
	import type { EventStoryline, LiteArticle, Storyline, StorylinesResponse } from '$lib/types';
	import { clock } from '$lib/live.svelte';
	import { storyColor, until } from '$lib/text';
	import StoryRow from './StoryRow.svelte';

	let {
		data,
		paused = false,
		selectedNode = null,
		onNode
	}: {
		data: StorylinesResponse;
		paused?: boolean;
		selectedNode?: string | null;
		onNode: (info: { title: string; members: LiteArticle[]; nodeId: string; color: string; scopeName: string; href: string; anchor: number }) => void;
	} = $props();

	type Item = { kind: 'story'; id: string; color: string; story: Storyline; score: number; lastAt: string } | { kind: 'event'; id: string; color: string; event: EventStoryline; score: number; lastAt: string };

	const items = $derived.by((): Item[] => {
		const out: Item[] = [
			...data.storylines.map((s) => ({ kind: 'story' as const, id: s.id, color: storyColor(s.id), story: s, score: s.score, lastAt: s.lastItemAt })),
			...data.events.map((e) => ({
				kind: 'event' as const,
				id: `evt:${e.id}`,
				color: storyColor(e.id),
				event: e,
				score: e.score,
				lastAt: e.developments.at(-1)?.lastItemAt ?? ''
			}))
		];
		return out.sort((a, b) => b.score - a.score);
	});

	// Hybrid: one double-height storyline until `hybridSwitchAt` are in the rotation, then the
	// ordinary two rows. The big row is exactly two rows tall, so the columns never move.
	const big = $derived(!!data.settings.hybrid && items.length < (data.settings.hybridSwitchAt ?? 10));
	const rows = $derived(data.settings.hybrid ? (big ? 1 : 2) : data.settings.rows);
	const pages = $derived(Math.max(1, Math.ceil(items.length / rows)));
	let page = $state(0);
	let hovering = $state(false);
	let turnedAt = $state(Date.now());
	let now = $state(Date.now());
	let pendingJump: number | null = null;
	const shownPage = $derived(Math.min(page, pages - 1));
	const shown = $derived(items.slice(shownPage * rows, shownPage * rows + rows));
	const shownIds = $derived(new Set(shown.map((i) => i.id)));
	const ms = $derived(Math.max(5, data.settings.rotateSeconds) * 1000);
	const stopped = $derived(paused || (hovering && data.settings.pauseOnHover) || pages <= 1);

	// Jump on update: remember each storyline's newest update; a change off-screen queues its page.
	let lastSeen = new Map<string, string>();
	$effect(() => {
		const seen = new Map<string, string>();
		items.forEach((it, i) => {
			seen.set(it.id, it.lastAt);
			const before = lastSeen.get(it.id);
			if (data.settings.jumpOnUpdate && before && before !== it.lastAt && !shownIds.has(it.id)) pendingJump = Math.floor(i / rows);
		});
		lastSeen = seen;
	});

	$effect(() => {
		const id = setInterval(() => {
			now = Date.now();
			if (stopped) {
				turnedAt = now - Math.min(now - turnedAt, ms - 1000);
				return;
			}
			if (now - turnedAt >= ms) {
				page = pendingJump ?? (shownPage + 1) % pages;
				pendingJump = null;
				turnedAt = now;
			}
		}, 250);
		return () => clearInterval(id);
	});

	const progress = $derived(pages > 1 ? Math.min(1, (now - turnedAt) / ms) : 0);
	const go = (p: number) => {
		page = ((p % pages) + pages) % pages;
		turnedAt = Date.now();
	};
	const openCount = $derived(data.storylines.length);
	const trackedCount = $derived(data.events.length);

	let band: HTMLElement | undefined = $state();
	function open(it: Item, title: string, members: LiteArticle[], nodeId: string, rowEl: EventTarget | null) {
		const row = (rowEl as HTMLElement | null)?.closest('.st') as HTMLElement | null;
		const anchor = (row ?? band)?.getBoundingClientRect().bottom ?? 0;
		onNode({
			title,
			members,
			nodeId,
			color: it.color,
			scopeName: it.kind === 'event' ? it.event.name : it.story.tag,
			href: it.kind === 'event' ? `/event/${it.event.id}` : `/storyline/${it.story.id}`,
			anchor
		});
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<section class="band" bind:this={band} onmouseenter={() => (hovering = true)} onmouseleave={() => (hovering = false)}>
	<div class="cprog"><i style:width="{progress * 100}%"></i></div>
	<div class="bh">
		<span class="ttl">Storylines</span>
		<em>{openCount} open{trackedCount ? ` + ${trackedCount} tracked` : ''} · auto-close after {data.settings.closeHours}h quiet</em>
		{#if pages > 1}
			<span class="pager">
				<button aria-label="Previous storylines" onclick={() => go(shownPage - 1)}>‹</button>
				<span class="pdots">{#each { length: pages } as _, k}<i class:on={k === shownPage}></i>{/each}</span>
				{shownPage * rows + 1}{rows > 1 && shown.length > 1 ? `–${shownPage * rows + shown.length}` : ''} of {items.length}
				<button aria-label="Next storylines" onclick={() => go(shownPage + 1)}>›</button>
				<em>{stopped ? 'paused' : `next in ${Math.max(0, Math.ceil((ms - (now - turnedAt)) / 1000))}s`}</em>
			</span>
		{/if}
		<span class="sp"></span>
		{#if data.grouping === false}<span class="chip arch" title="The embedding server set under admin Connections isn't reachable">grouping paused</span>{/if}
		{#if data.closedToday}<span class="chip arch">Closed today: {data.closedToday}</span>{/if}
	</div>
	{#each shown as it (it.id)}
		<StoryRow item={it} {big} {selectedNode} onNode={(title, members, nodeId) => open(it, title, members, nodeId, document.activeElement)} />
	{:else}
		<p class="quiet">
			{#if data.grouping === false}
				Storylines are paused: the embedding server set under admin Connections isn't reachable. New articles are grouped
				as soon as it's back.
			{:else}
				No storylines open right now. A storyline appears once several sources cover the same story.
			{/if}
		</p>
	{/each}
	{#if items.length > rows}
		<div class="chips">
			<span class="also">All open</span>
			{#each items as it, i (it.id)}
				<button class="chip" class:on={shownIds.has(it.id)} class:cooling={it.kind === 'story' && it.story.state === 'cooling'} class:tracked={it.kind === 'event'} style:--sc={it.color} onclick={() => go(Math.floor(i / rows))}>
					{#if it.kind === 'event'}
						<span class="dia">◆</span>{it.event.name} <em>tracked</em>
					{:else}
						<span class="dia">◆</span>{it.story.tag || it.story.label.slice(0, 30)} <em>{it.story.itemCount}</em>{it.story.state === 'cooling' ? ` · closes in ${until(it.story.closesAt, clock.now)}` : ''}
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</section>

<style>
	.band {
		position: relative;
		background: var(--s1);
		border: 1px solid var(--bd);
		border-radius: 11px;
		padding: 4px 14px 8px;
		overflow: hidden;
		flex: none;
	}
	.cprog {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 2px;
		background: var(--s3);
	}
	.cprog i {
		display: block;
		height: 100%;
		background: var(--acc);
	}
	.bh {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 0 4px;
		font-size: 10.5px;
		color: var(--tx2);
	}
	.ttl {
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.bh em {
		font-style: normal;
		color: var(--tx3);
	}
	.pager {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: 14px;
		font-family: var(--mono);
		font-size: 11px;
		color: var(--tx2);
	}
	.pager button {
		width: 20px;
		height: 20px;
		padding: 0;
		border-radius: 5px;
		display: grid;
		place-items: center;
		background: transparent;
		color: var(--tx2);
	}
	.pager em {
		font-family: var(--sans);
	}
	.pdots {
		display: flex;
		gap: 4px;
	}
	.pdots i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--s3);
	}
	.pdots i.on {
		background: var(--acc);
	}
	.sp {
		flex: 1;
	}
	.chips {
		display: flex;
		gap: 6px;
		align-items: center;
		padding-top: 8px;
		border-top: 1px solid var(--bd);
		white-space: nowrap;
		overflow: hidden;
	}
	.chips > * {
		flex: none;
	}
	.also {
		font-size: 10.5px;
		color: var(--tx3);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		border: 1px solid var(--bd);
		border-radius: 99px;
		padding: 3px 10px;
		color: var(--tx2);
		background: transparent;
	}
	.chip .dia {
		color: var(--sc);
		font-size: 10px;
	}
	.chip em {
		font-style: normal;
		font-family: var(--mono);
		font-size: 11px;
		color: var(--tx3);
	}
	.chip.cooling {
		opacity: 0.75;
	}
	.chip.tracked {
		border-style: dashed;
	}
	.chip.on {
		border-color: var(--sc);
		background: color-mix(in srgb, var(--sc) 14%, transparent);
		color: var(--tx);
		opacity: 1;
	}
	.chip.arch {
		font-size: 11px;
		padding: 2px 9px;
		color: var(--tx3);
	}
	.quiet {
		margin: 0;
		padding: 14px 0 10px;
		border-top: 1px solid var(--bd);
		font-size: 12.5px;
		color: var(--tx3);
	}
</style>
