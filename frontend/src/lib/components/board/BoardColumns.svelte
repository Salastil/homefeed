<script lang="ts">
	/**
	 * The board's columns. One per category (admin order) plus Wire and General; spillover
	 * categories, quiet ones (nothing in 48 h) and any that don't fit the width share one
	 * rotating column at the end, whose header rule doubles as its carousel timer. Each column
	 * shows exactly four items. Anything already shown in the storyline panel (a storyline's
	 * updates, a tracked event's developments) is left out, so the column shows the next
	 * regular item instead.
	 */
	import type { BoardColumn, StorylinesResponse } from '$lib/types';
	import { clock } from '$lib/live.svelte';
	import { authorOf, categoryColor, cleanPost, imageOf, isPost, relTime, textOf } from '$lib/text';
	import { slugify } from '$lib/format';

	let { columns, storylines, rotateSeconds = 20 }: { columns: BoardColumn[]; storylines: StorylinesResponse; rotateSeconds?: number } = $props();

	const PER_COLUMN = 4;
	const MIN_COL = 240;
	const QUIET_MS = 48 * 3_600_000;
	const NEW_MS = 6 * 60_000;
	let width = $state(1600);

	const inPanel = $derived.by(() => {
		const ids = new Set<string>();
		for (const s of storylines.storylines) for (const a of s.members) ids.add(a.id);
		for (const e of storylines.events) for (const d of e.developments) for (const a of d.members) ids.add(a.id);
		return ids;
	});
	const itemsOf = (c: BoardColumn) => c.items.filter((a) => !inPanel.has(a.id)).slice(0, PER_COLUMN);

	const isQuiet = (c: BoardColumn) => {
		const newest = c.items[0]?.publishedAt;
		return !newest || clock.now - new Date(newest).getTime() > QUIET_MS;
	};

	const layout = $derived.by(() => {
		const cats = columns.filter((c) => c.kind === 'category');
		const wire = columns.find((c) => c.kind === 'wire');
		const general = columns.find((c) => c.kind === 'general');
		const main = cats.filter((c) => !c.isSpillover && !isQuiet(c));
		const rotating = cats.filter((c) => c.isSpillover || isQuiet(c));
		const ordered = [...main];
		if (wire) ordered.splice(Math.min(2, ordered.length), 0, wire);
		if (general) ordered.push(general);
		const slots = Math.max(2, Math.floor((width + 10) / (MIN_COL + 10)));
		const room = rotating.length ? slots - 1 : slots;
		while (ordered.length > room) {
			// Fold the lowest-priority category first; Wire and General stay put longest.
			const idx = ordered.map((c) => c.kind).lastIndexOf('category');
			const victim = ordered.splice(idx >= 0 ? idx : ordered.length - 1, 1)[0];
			rotating.unshift(victim);
		}
		return { fixed: ordered, rotating };
	});

	let rotIndex = $state(0);
	let rotStarted = $state(Date.now());
	let rotNow = $state(Date.now());
	$effect(() => {
		if (layout.rotating.length < 2) return;
		const ms = rotateSeconds * 1000;
		const id = setInterval(() => {
			rotNow = Date.now();
			if (rotNow - rotStarted >= ms) {
				rotIndex = (rotIndex + 1) % layout.rotating.length;
				rotStarted = rotNow;
			}
		}, 250);
		return () => clearInterval(id);
	});
	const rotCurrent = $derived(layout.rotating[Math.min(rotIndex, layout.rotating.length - 1)]);
	const rotProgress = $derived(layout.rotating.length > 1 ? Math.min(1, (rotNow - rotStarted) / (rotateSeconds * 1000)) : 0);

	const href = (c: BoardColumn) => (c.kind === 'category' ? `/category/${slugify(c.name)}` : `/feed/${c.kind}`);
</script>

{#snippet column(c: BoardColumn, rotator: boolean)}
	{@const items = itemsOf(c)}
	{@const color = categoryColor(c.name)}
	<div class="col" class:rot={rotator && layout.rotating.length > 1} style:--cc={color}>
		<div class="ch">
			<a class="ttl" href={href(c)}><i></i>{c.name}<span class="arr">→</span></a>
			{#if c.isPrivate}<span class="lockd" title="Private category">🔒</span>{/if}
		</div>
		{#if rotator && layout.rotating.length > 1}
			<div class="rtabs">
				{#each layout.rotating as r, k (r.key)}
					<button class:on={k === rotIndex} onclick={() => ((rotIndex = k), (rotStarted = Date.now()))}>{r.name}</button>
				{/each}
			</div>
			<div class="timer" title="Next: {layout.rotating[(rotIndex + 1) % layout.rotating.length].name}"><i style:width="{rotProgress * 100}%"></i></div>
		{/if}
		<div class="cb">
			{#each items as a (a.id)}
				{@const img = imageOf(a)}
				{@const post = isPost(a)}
				<a class="r" class:new={clock.now - new Date(a.publishedAt).getTime() < NEW_MS} class:post href="/article/{a.id}">
					<div class="bd">
						{#if post}
							<div class="who">{authorOf(a).handle || authorOf(a).name}</div>
							<div class="tx">{textOf(a) || cleanPost(a.title)}</div>
						{:else}
							<div class="ti">{a.title}</div>
						{/if}
						<div class="meta"><span class="tm">{relTime(a.publishedAt, clock.now)}</span>{#if !post}<span>{a.sourceName}</span>{/if}{#if a.hasVideo}<span>▶ video</span>{/if}</div>
					</div>
					{#if img}
						<span class="th"><img src={img.url} alt="" loading="lazy" />{#if img.isVideo}<span class="pb">▶</span>{/if}</span>
					{/if}
				</a>
			{:else}
				<p class="empty">Nothing here yet.</p>
			{/each}
		</div>
	</div>
{/snippet}

<div class="cols" bind:clientWidth={width} style:grid-template-columns="repeat({layout.fixed.length + (rotCurrent ? 1 : 0)}, minmax(0, 1fr))">
	{#each layout.fixed as c (c.key)}
		{@render column(c, false)}
	{/each}
	{#if rotCurrent}
		{#key rotCurrent.key}
			{@render column(rotCurrent, true)}
		{/key}
	{/if}
</div>

<style>
	.cols {
		display: grid;
		gap: 10px;
		flex: 1;
		min-height: 0;
	}
	.col {
		background: var(--s1);
		border: 1px solid var(--bd);
		border-radius: 11px;
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
	}
	.ch {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 9px 12px;
		border-bottom: 1px solid var(--bd);
		flex: none;
	}
	.col.rot .ch {
		border-bottom: 0;
		padding-bottom: 4px;
	}
	.ttl {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		font-size: 11.5px;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--tx);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ttl:hover {
		text-decoration: none;
		color: var(--cc);
	}
	.ttl i {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: var(--cc);
	}
	.arr {
		color: var(--tx3);
		letter-spacing: 0;
		transition: transform 0.15s ease;
	}
	.ttl:hover .arr {
		color: var(--cc);
		transform: translateX(3px);
	}
	.lockd {
		font-size: 10px;
	}
	.rtabs {
		display: flex;
		gap: 4px;
		padding: 0 10px 8px;
		flex: none;
		overflow: hidden;
	}
	.rtabs button {
		font-size: 10.5px;
		padding: 2px 7px;
		border-radius: 5px;
		color: var(--tx3);
		background: transparent;
		white-space: nowrap;
	}
	.rtabs button.on {
		color: var(--tx);
		border-color: var(--tx3);
	}
	/* The header rule, filling as the rotation counts down. */
	.timer {
		height: 2px;
		background: var(--bd);
		flex: none;
	}
	.timer i {
		display: block;
		height: 100%;
		background: var(--cc);
	}
	.cb {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-rows: repeat(4, minmax(0, 1fr));
	}
	.r {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 10px;
		align-items: center;
		padding: 8px 12px;
		border-bottom: 1px solid var(--bd);
		color: inherit;
		min-height: 0;
		overflow: hidden;
	}
	.r:last-child {
		border-bottom: 0;
	}
	.r:hover {
		text-decoration: none;
		background: var(--s2);
	}
	.r:hover .ti {
		text-decoration: underline;
	}
	.bd {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.ti {
		font-size: 13.5px;
		font-weight: 500;
		line-height: 1.33;
		display: -webkit-box;
		-webkit-line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.who {
		font-size: 11.5px;
		font-weight: 600;
		color: var(--c-wire);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tx {
		font-size: 12.5px;
		line-height: 1.38;
		display: -webkit-box;
		-webkit-line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.meta {
		display: flex;
		gap: 6px;
		font-size: 11px;
		color: var(--tx3);
		white-space: nowrap;
		overflow: hidden;
	}
	.meta span + span::before {
		content: '·';
		margin-right: 6px;
	}
	.tm {
		font-family: var(--mono);
		font-size: 10.5px;
	}
	.th {
		position: relative;
		width: 64px;
		height: 64px;
		border-radius: 7px;
		overflow: hidden;
		background: var(--s2);
	}
	.th img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.pb {
		position: absolute;
		right: 3px;
		bottom: 3px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: rgba(10, 11, 13, 0.8);
		color: #fff;
		font-size: 7px;
		display: grid;
		place-items: center;
	}
	.r.new {
		background: color-mix(in srgb, var(--acc) 8%, transparent);
	}
	.r.new .tm {
		color: var(--acc);
	}
	.empty {
		margin: 0;
		padding: 12px;
		font-size: 12px;
		color: var(--tx3);
	}
</style>
