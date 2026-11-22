<script lang="ts">
	/**
	 * One row of the storyline panel: picture, headline block and a horizontal timeline.
	 * An ordinary storyline's timeline is its updates (first one, then the latest five);
	 * a tracked event's is its latest developments. Clicking a node opens the sheet.
	 */
	import type { EventStoryline, LiteArticle, Storyline } from '$lib/types';
	import { resolveMediaUrl } from '$lib/config';
	import { clock } from '$lib/live.svelte';
	import { authorOf, clockTime, headlineOf, relTime } from '$lib/text';

	type Item = { kind: 'story'; color: string; story: Storyline } | { kind: 'event'; color: string; event: EventStoryline };

	let {
		item,
		onNode,
		selectedNode = null,
		big = false
	}: {
		item: Item;
		/** Hybrid mode's single row: twice the height, a larger picture and headline. */
		big?: boolean;
		onNode: (title: string, members: LiteArticle[], nodeId: string) => void;
		selectedNode?: string | null;
	} = $props();

	const PIN = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M16 3l5 5-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z"/></svg>';

	const image = $derived(item.kind === 'story' ? item.story.image : item.event.image);
	const href = $derived(item.kind === 'story' ? `/storyline/${item.story.id}` : `/event/${item.event.id}`);
	const closesIn = $derived.by(() => {
		if (item.kind !== 'story') return '';
		const m = Math.max(0, Math.round((new Date(item.story.closesAt).getTime() - clock.now) / 60000));
		return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
	});

	type Node = { id: string; time: string; text: string; sub: string; title: string; members: LiteArticle[] };
	const nodes = $derived.by((): { list: Node[]; gap: number } => {
		if (item.kind === 'event') {
			// Newest on the left (issue #1).
			const devs = item.event.developments.slice(-6).reverse();
			return {
				gap: 0,
				list: devs.map((d) => ({
					id: d.id,
					time: relTime(d.lastItemAt, clock.now),
					text: d.members.length ? headlineOf(d.members.find((m) => m.id === d.labelArticleId) ?? d.members[0]) : d.label,
					sub: `${d.itemCount} posts · ${d.sourceCount} channels`,
					title: d.members.length ? headlineOf(d.members.find((m) => m.id === d.labelArticleId) ?? d.members[0]) : d.label,
					members: d.members
				}))
			};
		}
		const m = item.story.members;
		// Newest on the left; the first update stays at the far right, with the gap before it.
		const pick = m.length <= 6 ? [...m].reverse() : [...m.slice(-5).reverse(), m[0]];
		return {
			gap: item.story.itemCount - pick.length,
			list: pick.map((a) => ({ id: a.id, time: relTime(a.publishedAt, clock.now), text: headlineOf(a), sub: authorOf(a).handle === 'article' ? a.sourceName : authorOf(a).handle, title: headlineOf(a), members: [a] }))
		};
	});
</script>

<div class="st" class:big class:cooling={item.kind === 'story' && item.story.state === 'cooling'} style:--sc={item.color}>
	<a class="thumb" class:none={!image} {href}>
		{#if image}
			<img src={resolveMediaUrl(image.url)} alt="" loading="lazy" />
		{:else}
			<span>no image yet</span>
		{/if}
	</a>
	<div class="sh">
		{#if item.kind === 'event'}
			<span class="pill trk">{@html PIN} TRACKED</span>
			<div class="sname dim">Tracked event · never auto-closes</div>
			<a class="slab" {href}>{item.event.name}</a>
			<div class="smeta">{item.event.postCount} posts in 12 h · {item.event.developmentCount} developments · {item.event.channelCount} channels</div>
		{:else}
			{#if item.story.state === 'live'}
				<span class="pill live"><i></i>LIVE</span>
			{:else}
				<span class="pill cool">COOLING · closes in {closesIn}</span>
			{/if}
			<div class="sname">{item.story.tag}</div>
			<a class="slab" {href}>{item.story.label}</a>
			<div class="smeta">{item.story.itemCount} updates · {item.story.sourceCount} sources · since {clockTime(item.story.firstItemAt)}</div>
		{/if}
	</div>
	<div class="tl" style:grid-template-columns={nodes.list.map((_, i) => (i === nodes.list.length - 2 && nodes.gap ? '1fr 38px' : '1fr')).join(' ')}>
		{#each nodes.list as n, i (n.id)}
			<button
				class="nd"
				class:dev={item.kind === 'event'}
				class:newest={i === 0}
				class:sel={selectedNode === n.id}
				onclick={() => onNode(n.title, n.members, n.id)}
			>
				<b>{n.time}</b>
				<p>{n.text}</p>
				<i>{n.sub}</i>
			</button>
			{#if i === nodes.list.length - 2 && nodes.gap}
				<div class="gapn"><span>+{nodes.gap}</span></div>
			{/if}
		{:else}
			<p class="none">No developments in the last 12 hours.</p>
		{/each}
	</div>
</div>

<style>
	.st {
		display: grid;
		grid-template-columns: 150px 300px minmax(0, 1fr);
		gap: 0 18px;
		padding: 9px 0;
		border-top: 1px solid var(--bd);
		align-items: center;
	}
	.st.cooling {
		opacity: 0.74;
	}
	.thumb {
		position: relative;
		width: 150px;
		height: 100px;
		border-radius: 8px;
		overflow: hidden;
		background: var(--s2);
		box-shadow: inset 0 0 0 1px var(--bd);
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.cooling .thumb img {
		filter: saturate(0.55);
	}
	.thumb::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 3px;
		background: var(--sc);
	}
	.thumb span {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 3px;
		padding: 12px 7px 4px;
		font-size: 10px;
		color: #e8e6e0;
		background: linear-gradient(transparent, rgba(8, 9, 11, 0.85));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.thumb.none {
		display: grid;
		place-items: center;
	}
	.thumb.none span {
		position: static;
		background: none;
		color: var(--tx3);
		padding: 0;
	}
	.sh {
		border-left: 3px solid var(--sc);
		padding-left: 11px;
		min-width: 0;
	}
	.sh :global(.pill svg) {
		display: block;
	}
	.sname {
		font-size: 11px;
		font-weight: 700;
		color: var(--sc);
		margin: 7px 0 2px;
	}
	.sname.dim {
		color: var(--tx3);
		font-weight: 500;
	}
	.slab {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-family: var(--serif);
		font-size: 17px;
		font-weight: 600;
		line-height: 1.18;
		color: var(--tx);
	}
	.smeta {
		font-size: 11px;
		color: var(--tx3);
		margin-top: 4px;
	}
	.tl {
		display: grid;
		align-items: start;
		position: relative;
		padding-top: 18px;
		min-width: 0;
	}
	.tl::before {
		content: '';
		position: absolute;
		left: 5px;
		right: 0;
		top: 4px;
		height: 2px;
		background: color-mix(in srgb, var(--sc) 35%, var(--bd));
	}
	.nd {
		position: relative;
		padding: 0 16px 0 0;
		min-width: 0;
		text-align: left;
		background: none;
		border: 0;
		border-radius: 4px;
		color: inherit;
	}
	.nd::before {
		content: '';
		position: absolute;
		top: -18px;
		left: 0;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--s1);
		border: 2px solid var(--sc);
	}
	.nd.dev::before {
		border-radius: 3px;
	}
	.nd.newest::before {
		background: var(--sc);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--sc) 25%, transparent);
	}
	.nd.sel {
		outline: 1px solid color-mix(in srgb, var(--sc) 55%, transparent);
		outline-offset: 6px;
	}
	.nd.sel::before {
		background: var(--sc);
	}
	.nd:hover p {
		color: var(--tx);
		text-decoration: underline;
	}
	.nd b {
		display: block;
		font-family: var(--mono);
		font-size: 11px;
		font-weight: 500;
		color: var(--sc);
		margin-bottom: 2px;
	}
	.nd p {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.35;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.nd i {
		display: block;
		font-style: normal;
		font-size: 11px;
		color: var(--tx3);
		margin-top: 3px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.gapn {
		position: relative;
	}
	.gapn span {
		position: absolute;
		top: -23px;
		left: 0;
		font-family: var(--mono);
		font-size: 10px;
		color: var(--tx3);
		background: var(--s1);
		padding: 0 3px;
		border: 1px dashed var(--bd);
		border-radius: 4px;
	}
	/* Hybrid's single row: 1px rule + 18px padding + 219px picture = two ordinary rows. */
	.st.big {
		grid-template-columns: 330px 440px minmax(0, 1fr);
		gap: 0 22px;
	}
	.big .thumb {
		width: 330px;
		height: 219px;
		border-radius: 10px;
	}
	.big .thumb::after {
		height: 4px;
	}
	.big .sh {
		border-left-width: 4px;
		padding-left: 14px;
	}
	.big .sname {
		font-size: 12.5px;
		margin: 9px 0 4px;
	}
	.big .slab {
		font-size: 26px;
		line-height: 1.15;
		-webkit-line-clamp: 4;
	}
	.big .smeta {
		font-size: 12px;
		margin-top: 8px;
	}
	.big .nd b {
		font-size: 12px;
		margin-bottom: 4px;
	}
	.big .nd p {
		font-size: 14px;
		line-height: 1.4;
		-webkit-line-clamp: 5;
	}
	.big .nd i {
		font-size: 11.5px;
		margin-top: 5px;
	}
	.none {
		margin: 0;
		font-size: 12px;
		color: var(--tx3);
	}
	/* Phones: picture and headline side by side, the timeline under them with its two newest
	   updates. Hybrid's big row is drawn the same way - there's no board height to match. */
	@media (max-width: 760px) {
		.st,
		.st.big {
			grid-template-columns: 104px minmax(0, 1fr);
			gap: 10px 12px;
			padding: 10px 0;
		}
		.thumb,
		.big .thumb {
			width: 104px;
			height: 78px;
			border-radius: 8px;
		}
		.big .thumb::after {
			height: 3px;
		}
		.sh,
		.big .sh {
			border-left-width: 3px;
			padding-left: 10px;
		}
		.sname,
		.big .sname {
			font-size: 11px;
			margin: 5px 0 2px;
		}
		.slab,
		.big .slab {
			font-size: 17px;
			line-height: 1.2;
			-webkit-line-clamp: 3;
		}
		.smeta,
		.big .smeta {
			font-size: 11px;
			margin-top: 4px;
		}
		.tl {
			grid-column: 1 / -1;
			grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
		}
		.tl > button:nth-of-type(n + 3),
		.gapn {
			display: none;
		}
		.big .nd b {
			font-size: 11px;
			margin-bottom: 2px;
		}
		.big .nd p {
			font-size: 13px;
			-webkit-line-clamp: 3;
		}
		.nd p {
			font-size: 13px;
			-webkit-line-clamp: 3;
		}
		.big .nd i {
			font-size: 11px;
			margin-top: 3px;
		}
	}
</style>
