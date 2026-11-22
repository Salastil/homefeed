<script lang="ts">
	/**
	 * The board's columns, in the admin's Board layout (admin → Board): positions left to
	 * right, where a position holding several columns rotates through them on its own timer
	 * (its header rule is the countdown). Quiet columns (nothing in 48 h) can join the rotating
	 * position, and positions that don't fit the width fold into it, right-most first - both
	 * admin switches. Each column shows exactly four items; anything already in the storyline
	 * panel is left out so the next regular item shows instead.
	 */
	import type { BoardColumn, BoardLayout, StorylinesResponse } from '$lib/types';
	import { clock } from '$lib/live.svelte';
	import { authorOf, cleanPost, columnColor, imageOf, isPost, relTime, textOf } from '$lib/text';
	import { slugify } from '$lib/format';
	import { admin } from '$lib/adminSession.svelte';
	import { MediaQuery } from 'svelte/reactivity';

	let {
		columns,
		layout = undefined,
		storylines
	}: { columns: BoardColumn[]; layout?: BoardLayout; storylines: StorylinesResponse } = $props();

	const PER_COLUMN = 4;
	const MIN_COL = 240;
	const QUIET_MS = 48 * 3_600_000;
	const NEW_MS = 6 * 60_000;
	/** The phone layout (same breakpoint as the styles): columns stack one under another. */
	const phone = new MediaQuery('max-width: 760px', false);
	let width = $state(1600);

	const inPanel = $derived.by(() => {
		const ids = new Set<string>();
		for (const s of storylines.storylines) for (const a of s.members) ids.add(a.id);
		for (const e of storylines.events) for (const d of e.developments) for (const a of d.members) ids.add(a.id);
		return ids;
	});
	const itemsOf = (c: BoardColumn) => c.items.filter((a) => !inPanel.has(a.id)).slice(0, PER_COLUMN);
	const byKey = $derived(new Map(columns.map((c) => [c.key, c])));

	const isQuiet = (c: BoardColumn) => {
		const newest = c.items[0]?.publishedAt;
		return !newest || clock.now - new Date(newest).getTime() > QUIET_MS;
	};

	// The saved layout, or (older backend) the earlier arrangement: categories in order with
	// Wire third and General last, spillover categories sharing one rotating position.
	const base = $derived.by((): BoardLayout => {
		if (layout) return layout;
		const cats = columns.filter((c) => c.kind === 'category');
		const main = cats.filter((c) => !c.isSpillover).map((c) => c.key);
		if (byKey.has('wire')) main.splice(Math.min(2, main.length), 0, 'wire');
		if (byKey.has('general')) main.push('general');
		const slots = main.map((k) => ({ columns: [k], rotateSeconds: 20 }));
		const more = cats.filter((c) => c.isSpillover).map((c) => c.key);
		if (more.length) slots.push({ columns: more, rotateSeconds: 20 });
		return { slots, autoRotateQuiet: true, autoFold: true };
	});

	type Position = { id: string; keys: string[]; rotateSeconds: number };
	const positions = $derived.by((): Position[] => {
		let pos = base.slots
			.map((s) => ({ keys: s.columns.filter((k) => byKey.has(k)), rotateSeconds: s.rotateSeconds }))
			.filter((p) => p.keys.length > 0);
		// The position quiet and folded columns join: the last rotating one, else one created at
		// the end - created once and then reused, even while it still holds a single column.
		let made: { keys: string[]; rotateSeconds: number } | null = null;
		const target = () => {
			if (made) return made;
			for (let i = pos.length - 1; i >= 0; i--) if (pos[i].keys.length > 1) return pos[i];
			made = { keys: [] as string[], rotateSeconds: 20 };
			pos.push(made);
			return made;
		};
		if (base.autoRotateQuiet) {
			const quiet = pos.filter((p) => p.keys.length === 1 && byKey.get(p.keys[0])!.kind === 'category' && isQuiet(byKey.get(p.keys[0])!));
			if (quiet.length) {
				pos = pos.filter((p) => !quiet.includes(p));
				const t = target();
				t.keys.push(...quiet.flatMap((p) => p.keys));
			}
		}
		// Phones stack the columns (see the styles), so nothing needs folding to fit.
		if (base.autoFold && !phone.current) {
			const room = Math.max(2, Math.floor((width + 10) / (MIN_COL + 10)));
			// Every pass removes one position, so this ends; the cap is a second guard.
			for (let guard = 0; pos.length > room && guard < 100; guard++) {
				const t = target();
				// Right-most single category first; Wire and General fold last.
				const singles = pos.filter((p) => p !== t && p.keys.length === 1);
				const victim = [...singles].reverse().find((p) => byKey.get(p.keys[0])!.kind === 'category') ?? singles.at(-1);
				if (!victim) break;
				pos = pos.filter((p) => p !== victim);
				t.keys.unshift(...victim.keys);
			}
		}
		return pos.filter((p) => p.keys.length > 0).map((p) => ({ ...p, id: p.keys.join('+') }));
	});

	// One interval drives every rotating position's timer.
	let now = $state(Date.now());
	let rot = $state<Record<string, { i: number; t: number }>>({});
	const rotOf = (p: Position) => rot[p.id] ?? { i: 0, t: now };
	$effect(() => {
		if (!positions.some((p) => p.keys.length > 1)) return;
		const id = setInterval(() => {
			now = Date.now();
			const next: Record<string, { i: number; t: number }> = {};
			for (const p of positions) {
				if (p.keys.length < 2) continue;
				const r = rot[p.id] ?? { i: 0, t: now };
				next[p.id] = now - r.t >= p.rotateSeconds * 1000 ? { i: (r.i + 1) % p.keys.length, t: now } : { i: r.i % p.keys.length, t: r.t };
			}
			rot = next;
		}, 250);
		return () => clearInterval(id);
	});
	const pick = (p: Position, i: number) => (rot = { ...rot, [p.id]: { i, t: Date.now() } });

	const href = (c: BoardColumn) => (c.kind === 'category' ? `/category/${slugify(c.name)}` : `/feed/${c.kind}`);
</script>

{#snippet column(c: BoardColumn, p: Position)}
	{@const items = itemsOf(c)}
	{@const color = columnColor(c.name, c.color)}
	{@const r = rotOf(p)}
	<div class="col" class:rot={p.keys.length > 1} class:editing={admin.editing} class:sel={admin.sheet?.kind === 'column' && admin.sheet.key === c.key} style:--cc={color}>
		<div class="ch">
			<a class="ttl" href={href(c)}><i></i>{c.name}<span class="arr">→</span></a>
			{#if c.isPrivate}<span class="lockd" title="Private category">🔒</span>{/if}
			{#if admin.editing}
				<button class="edit" onclick={() => (admin.sheet = { kind: 'column', key: c.key })} aria-label="Edit the {c.name} column">Edit</button>
			{/if}
		</div>
		{#if p.keys.length > 1}
			<div class="rtabs">
				{#each p.keys as k, n (k)}
					<button class:on={n === r.i} onclick={() => pick(p, n)}>{byKey.get(k)?.name}</button>
				{/each}
			</div>
			<div class="timer" title="Next: {byKey.get(p.keys[(r.i + 1) % p.keys.length])?.name}"><i style:width="{Math.min(1, (now - r.t) / (p.rotateSeconds * 1000)) * 100}%"></i></div>
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

<div class="cols" bind:clientWidth={width} style:grid-template-columns="repeat({positions.length}, minmax(0, 1fr))">
	{#each positions as p (p.id)}
		{@const c = byKey.get(p.keys[rotOf(p).i % p.keys.length])}
		{#if c}
			{#key c.key}
				{@render column(c, p)}
			{/key}
		{/if}
	{/each}
</div>

<style>
	.col.editing {
		outline: 1.5px dashed color-mix(in srgb, var(--acc) 70%, transparent);
		outline-offset: 2px;
	}
	.col.sel {
		outline: 2px solid var(--cc);
	}
	.edit {
		margin-left: auto;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 9px;
		border: 0;
		border-radius: 6px;
		background: var(--acc);
		color: var(--s0);
		flex: none;
	}
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
	/* Phones: the columns stack full width, one under another, each as tall as its four items;
	   the page scrolls there (see +layout.svelte). */
	@media (max-width: 760px) {
		.cols {
			grid-template-columns: minmax(0, 1fr) !important;
			flex: none;
		}
		.ch {
			padding: 11px 12px;
		}
		.rtabs {
			overflow-x: auto;
			scrollbar-width: none;
		}
		.rtabs::-webkit-scrollbar {
			display: none;
		}
		.rtabs button {
			font-size: 12px;
			padding: 4px 9px;
		}
		.cb {
			grid-template-rows: none;
		}
		.r {
			padding: 10px 12px;
		}
		.ti {
			font-size: 15px;
			-webkit-line-clamp: 3;
		}
		.tx {
			font-size: 14px;
			-webkit-line-clamp: 3;
		}
		.th {
			width: 72px;
			height: 72px;
		}
	}
</style>
