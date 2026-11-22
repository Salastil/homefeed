<script lang="ts">
	/**
	 * Layout A (accepted in issue #1): equal tiles. Every tile has the same parts in the same
	 * order - header, media box, text, footer - whatever the item is. A text-only post puts
	 * its text in the media box. The grid has fixed shapes so a tile is the same size whichever
	 * set it shows: 3x2 up to 6 cards, 3x3 up to 9, 4x3 beyond (last tile = "+N more").
	 * `compact` (the board's sheet, which is shorter) uses one row for up to 3 cards.
	 * Word-for-word reposts fold into one card that names the others. Newest first.
	 */
	import type { LiteArticle } from '$lib/types';
	import { authorOf, clockTime, foldReposts, imageOf, initials, isPost, KIND_ICON, KIND_LABEL, kindOf, textOf } from '$lib/text';

	let {
		items,
		compact = false,
		moreHref = null
	}: { items: LiteArticle[]; compact?: boolean; moreHref?: string | null } = $props();

	// Newest first: top left is the latest, bottom right the oldest (and "+N more" the oldest of all).
	const cards = $derived(foldReposts(items).sort((a, b) => b.item.publishedAt.localeCompare(a.item.publishedAt)));
	const shape = $derived.by(() => {
		const n = cards.length;
		if (compact && n <= 3) return { cols: 3, rows: 1 };
		if (n <= 6) return { cols: 3, rows: 2 };
		if (n <= 9) return { cols: 3, rows: 3 };
		return { cols: 4, rows: 3 };
	});
	const cap = $derived(shape.cols * shape.rows);
	const shown = $derived(cards.length <= cap ? cards : cards.slice(0, cap - 1));
	const rest = $derived(cards.length <= cap ? [] : cards.slice(cap - 1));
	const restKinds = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const c of rest) {
			const k = KIND_LABEL[kindOf(c.item)].toLowerCase();
			counts.set(k, (counts.get(k) ?? 0) + 1);
		}
		return [...counts].map(([k, n]) => `${n} ${k}`).join(' · ');
	});
	const linkHost = (a: LiteArticle) => {
		if (a.tweet) return 'x.com';
		if (a.telegramMessage) return 't.me';
		try {
			return new URL(a.sourceLink ?? '').hostname.replace(/^www\./, '');
		} catch {
			return a.sourceName;
		}
	};
	const lines = $derived(shape.rows >= 3 ? 3 : shape.rows === 2 ? 4 : 6);
</script>

<div class="grid" class:d1={shape.rows === 1} style:grid-template-columns="repeat({shape.cols}, minmax(0, 1fr))" style:grid-template-rows="repeat({shape.rows}, minmax(0, 1fr))" style:--tl={lines}>
	{#each shown as { item, reposts } (item.id)}
		{@const kind = kindOf(item)}
		{@const who = authorOf(item)}
		{@const img = imageOf(item)}
		<a class="tile" href="/article/{item.id}">
			<div class="th">
				{#if who.avatar}<img class="av" src={who.avatar} alt="" loading="lazy" />{:else}<span class="av ini">{initials(who.name)}</span>{/if}
				<div class="cw"><b>{who.name}</b><span>{who.handle} · {clockTime(item.publishedAt)}</span></div>
				<span class="kb k-{kind}">{@html KIND_ICON[kind]}{KIND_LABEL[kind]}</span>
			</div>
			{#if kind === 'text'}
				<div class="mb quote"><p>{textOf(item)}</p></div>
			{:else if img}
				<div class="mb"><img src={img.url} alt="" loading="lazy" />{#if img.isVideo}<span class="pl">{@html KIND_ICON.video}</span>{/if}</div>
			{:else}
				<div class="mb vph"><span class="pl">{@html KIND_ICON.video}</span><em>Video · loads when played</em></div>
			{/if}
			{#if kind !== 'text'}
				<div class="tb">
					{#if !isPost(item)}<div class="ht">{item.title}</div>{/if}
					<div class="bt" class:dk={!isPost(item)}>{textOf(item)}</div>
				</div>
			{/if}
			<div class="tf">
				<span class="rp">{reposts.length ? `Also posted by ${reposts.map((r) => authorOf(r).name).join(', ')}` : ''}</span>
				<span>{linkHost(item)} ↗</span>
			</div>
		</a>
	{/each}
	{#if rest.length}
		<svelte:element this={moreHref ? 'a' : 'div'} class="tile more" href={moreHref ?? undefined}>
			<b>+{rest.length}</b><span>more posts</span><em>{restKinds}</em>
			{#if moreHref}<i>Open full list →</i>{/if}
		</svelte:element>
	{/if}
</div>

<style>
	.grid {
		display: grid;
		gap: 10px;
		height: 100%;
		min-height: 0;
	}
	.tile {
		background: var(--s2);
		border: 1px solid var(--bd);
		border-radius: 10px;
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-height: 0;
		min-width: 0;
		color: inherit;
		overflow: hidden;
	}
	.tile:hover {
		text-decoration: none;
		border-color: var(--tx3);
	}
	.th {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		flex: none;
	}
	.av {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		object-fit: cover;
		flex: none;
		background: var(--s3);
	}
	.av.ini {
		display: grid;
		place-items: center;
		font-size: 10px;
		font-weight: 700;
		color: var(--tx2);
		border-radius: 6px;
	}
	.cw {
		min-width: 0;
		flex: 1;
	}
	.cw b {
		display: block;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cw span {
		display: block;
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--tx3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mb {
		position: relative;
		flex: 1;
		min-height: 0;
		border-radius: 7px;
		overflow: hidden;
		background: var(--s0);
	}
	.d1 .mb:not(.quote) {
		flex: none;
		aspect-ratio: 16 / 10;
	}
	.mb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.vph {
		display: grid;
		place-items: center;
		align-content: center;
		gap: 8px;
		background: repeating-linear-gradient(135deg, var(--s0) 0 10px, color-mix(in srgb, var(--s0) 80%, var(--s3)) 10px 20px);
	}
	.vph em {
		font-style: normal;
		font-size: 10.5px;
		color: var(--tx3);
		margin-top: 52px;
	}
	.pl {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: 38px;
		height: 38px;
		border-radius: 50%;
		background: rgba(232, 230, 224, 0.92);
		color: #0f1114;
		display: grid;
		place-items: center;
	}
	.pl :global(svg) {
		width: 13px;
		height: 13px;
	}
	.quote {
		background: color-mix(in srgb, var(--acc) 7%, var(--s0));
		border: 1px solid color-mix(in srgb, var(--acc) 18%, transparent);
		display: flex;
		align-items: center;
		padding: 12px 14px;
	}
	.quote p {
		margin: 0;
		font-family: var(--serif);
		font-size: 16px;
		line-height: 1.35;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 6;
		overflow: hidden;
	}
	.tb {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 3px;
		max-height: calc(var(--tl) * 1.4 * 12.5px + 20px);
		overflow: hidden;
	}
	.d1 .tb {
		flex: 1;
		max-height: none;
	}
	.ht {
		font-family: var(--serif);
		font-size: 15px;
		font-weight: 600;
		line-height: 1.22;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		overflow: hidden;
	}
	.bt {
		font-size: 12.5px;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: var(--tl);
		overflow: hidden;
	}
	.bt.dk {
		color: var(--tx2);
		-webkit-line-clamp: calc(var(--tl) - 2);
	}
	.tf {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		font-size: 10.5px;
		color: var(--tx3);
		flex: none;
		min-height: 14px;
		margin-top: auto;
	}
	.rp {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--tx2);
	}
	.more {
		align-items: center;
		justify-content: center;
		gap: 4px;
		border-style: dashed;
		background: transparent;
	}
	.more b {
		font-size: 26px;
		font-family: var(--mono);
		font-weight: 500;
	}
	.more span {
		color: var(--tx2);
		font-size: 12px;
	}
	.more em {
		font-style: normal;
		font-size: 11px;
		color: var(--tx3);
	}
	.more i {
		font-style: normal;
		font-size: 12px;
		color: var(--acc);
		margin-top: 4px;
	}
	/* Phones: two tiles a row, as many rows as there are tiles, each as tall as its content
	   (the fixed shapes are for fitting a desktop panel). */
	@media (max-width: 760px) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
			grid-template-rows: none !important;
			height: auto;
			gap: 8px;
		}
		.mb:not(.quote) {
			flex: none;
			aspect-ratio: 4 / 3;
		}
		.mb.quote {
			flex: none;
			min-height: 96px;
		}
		.quote p {
			font-size: 15px;
		}
	}
</style>
