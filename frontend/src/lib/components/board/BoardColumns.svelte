<script lang="ts">
	/**
	 * The board's columns. One per category (admin order) plus Wire and General; spillover
	 * categories, quiet ones (nothing in 48 h) and any that don't fit the width share one
	 * rotating column at the end. Each column shows only the rows that fit and says how many
	 * it's hiding. Items that belong to an open storyline collapse into one storyline row.
	 */
	import type { BoardColumn, LiteArticle, Storyline } from '$lib/types';
	import { clock } from '$lib/live.svelte';
	import { fitRows } from '$lib/actions/fitRows';
	import { ago, authorOf, categoryColor, hhmm, imageOf, isPost, storyColor, textOf } from '$lib/text';
	import { slugify } from '$lib/format';

	let { columns, storylines, rotateSeconds = 20 }: { columns: BoardColumn[]; storylines: Storyline[]; rotateSeconds?: number } = $props();

	const MIN_COL = 240;
	const QUIET_MS = 48 * 3_600_000;
	let width = $state(1600);

	const membership = $derived.by(() => {
		const m = new Map<string, Storyline>();
		for (const s of storylines) for (const a of s.members) m.set(a.id, s);
		return m;
	});

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
		}, 500);
		return () => clearInterval(id);
	});
	const rotCurrent = $derived(layout.rotating[Math.min(rotIndex, layout.rotating.length - 1)]);
	const rotProgress = $derived(layout.rotating.length > 1 ? Math.min(1, (rotNow - rotStarted) / (rotateSeconds * 1000)) : 0);

	type Row = { kind: 'item'; item: LiteArticle } | { kind: 'story'; story: Storyline; here: number; at: string };
	function rowsOf(c: BoardColumn): Row[] {
		const out: Row[] = [];
		const seen = new Set<string>();
		for (const a of c.items) {
			const s = membership.get(a.id);
			if (s) {
				if (seen.has(s.id)) continue;
				seen.add(s.id);
				out.push({ kind: 'story', story: s, here: c.items.filter((x) => membership.get(x.id)?.id === s.id).length, at: a.publishedAt });
			} else out.push({ kind: 'item', item: a });
		}
		return out;
	}

	let hidden = $state<Record<string, number>>({});
	const href = (c: BoardColumn) => (c.kind === 'category' ? `/category/${slugify(c.name)}` : null);
	const NEW_MS = 6 * 60_000;
</script>

{#snippet column(c: BoardColumn, rotator: boolean)}
	{@const rows = rowsOf(c)}
	<div class="col">
		<div class="ch">
			<i style:background={categoryColor(c.name)}></i>{c.name}
			{#if c.isPrivate}<span class="lockd" title="Private category">🔒</span>{/if}
			<span>{c.count24h} today{c.items[0] ? ` · ${ago(c.items[0].publishedAt, clock.now)} ago` : ''}</span>
		</div>
		{#if rotator && layout.rotating.length > 1}
			<div class="rtabs">
				{#each layout.rotating as r, k (r.key)}
					<button class:on={k === rotIndex} onclick={() => ((rotIndex = k), (rotStarted = Date.now()))}>{r.name}</button>
				{/each}
			</div>
			<div class="rprog"><i style:width="{rotProgress * 100}%" style:background={categoryColor(c.name)}></i></div>
		{/if}
		<div class="cb" use:fitRows={{ key: rows.map((r) => (r.kind === 'item' ? r.item.id : r.story.id)).join(), onHidden: (n) => (hidden = { ...hidden, [c.key]: n }) }}>
			{#each rows as r (r.kind === 'item' ? r.item.id : 'stl-' + r.story.id)}
				{#if r.kind === 'story'}
					<a class="r sr" data-row href="/storyline/{r.story.id}" style:--sc={storyColor(r.story.id)}>
						<span class="tm">{hhmm(r.at)}</span>
						<div class="bd"><div class="ti"><span class="dia">◆</span> {r.story.tag || r.story.label}</div><div class="sub">storyline · {r.here} here · {r.story.itemCount} total</div></div>
					</a>
				{:else}
					{@const a = r.item}
					{@const img = imageOf(a)}
					<a class="r" class:new={clock.now - new Date(a.publishedAt).getTime() < NEW_MS} data-row href="/article/{a.id}">
						<span class="tm">{hhmm(a.publishedAt)}</span>
						<div class="bd">
							{#if isPost(a)}
								<div class="who">{authorOf(a).handle || authorOf(a).name}</div>
								<div class="tx">{textOf(a)}</div>
							{:else}
								<div class="ti">{a.title}</div>
								<div class="sub">{a.sourceName}{a.hasVideo ? ' · ▶ video' : ''}</div>
							{/if}
						</div>
						{#if img}
							<span class="th"><img src={img.url} alt="" loading="lazy" />{#if img.isVideo}<span class="pb">▶</span>{/if}</span>
						{/if}
					</a>
				{/if}
			{:else}
				<p class="empty" data-row>Nothing here yet.</p>
			{/each}
		</div>
		<div class="cf">
			<span>{hidden[c.key] ? `+${hidden[c.key]} older not shown` : ''}</span>
			{#if rotator && layout.rotating.length > 1}
				<span>next: {layout.rotating[(rotIndex + 1) % layout.rotating.length].name}</span>
			{:else if href(c)}
				<a href={href(c)}>open {c.name} →</a>
			{/if}
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
		font-size: 11.5px;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		flex: none;
	}
	.ch i {
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}
	.ch span {
		margin-left: auto;
		font-family: var(--mono);
		font-size: 10.5px;
		font-weight: 400;
		color: var(--tx3);
		letter-spacing: 0;
		text-transform: none;
		white-space: nowrap;
	}
	.ch .lockd {
		margin-left: 0;
		font-size: 10px;
	}
	.cb {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.r {
		display: grid;
		grid-template-columns: 38px minmax(0, 1fr) auto;
		gap: 8px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--bd);
		color: inherit;
	}
	.r:hover {
		text-decoration: none;
		background: var(--s2);
	}
	.r:hover .ti {
		text-decoration: underline;
	}
	.tm {
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--tx3);
		padding-top: 2px;
	}
	.bd {
		min-width: 0;
	}
	.ti {
		font-size: 13px;
		font-weight: 500;
		line-height: 1.33;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.sub {
		font-size: 11px;
		color: var(--tx3);
		margin-top: 2px;
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
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.th {
		position: relative;
		width: 52px;
		height: 52px;
		border-radius: 6px;
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
		width: 15px;
		height: 15px;
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
	.r.sr {
		background: var(--s2);
		grid-template-columns: 38px minmax(0, 1fr);
	}
	.r.sr .ti {
		font-weight: 600;
	}
	.dia {
		color: var(--sc);
	}
	.cf {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		padding: 7px 12px;
		font-size: 11px;
		color: var(--tx3);
		border-top: 1px solid var(--bd);
		flex: none;
	}
	.rtabs {
		display: flex;
		gap: 4px;
		padding: 7px 10px 0;
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
	.rprog {
		height: 2px;
		margin: 7px 10px 0;
		background: var(--s3);
		border-radius: 2px;
		flex: none;
		overflow: hidden;
	}
	.rprog i {
		display: block;
		height: 100%;
	}
	.empty {
		margin: 0;
		padding: 12px;
		font-size: 12px;
		color: var(--tx3);
	}
</style>
