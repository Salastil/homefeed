<script lang="ts">
	/**
	 * Tracked-event timeline (accepted pane C): developments newest first on the left, the
	 * selected development's posts as Layout A tiles in the middle, and the posts that didn't
	 * group on the right. Fits the screen; lists show what fits and count the rest. Re-polls
	 * every minute like the board.
	 */
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { getEventTimeline } from '$lib/api';
	import { clock, poll } from '$lib/live.svelte';
	import { fitRows } from '$lib/actions/fitRows';
	import { authorOf, clockTime, headlineOf, hhmm, imageOf, isPost, storyColor, textOf } from '$lib/text';
	import { timeUntil } from '$lib/format';
	import PostTiles from '$lib/components/tiles/PostTiles.svelte';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	let tl = $state(data.timeline);
	$effect(() => {
		tl = data.timeline;
	});
	$effect(() => poll(async () => (tl = await getEventTimeline(data.timeline.event.id, data.hours)), 60_000));

	const devsNewest = $derived([...tl.developments].sort((a, b) => b.lastItemAt.localeCompare(a.lastItemAt)));
	let picked = $state<string | null>(null);
	const selected = $derived(devsNewest.find((d) => d.id === (picked ?? data.selected)) ?? devsNewest[0] ?? null);
	const color = $derived(storyColor(tl.event.id));
	const PIN = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M16 3l5 5-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z"/></svg>';

	let hiddenDevs = $state(0);
	let hiddenSingles = $state(0);
	const recapNote = $derived.by(() => {
		const ev = tl.event;
		if (ev.recapIntervalHours === null) return 'AI recaps are off for this event';
		if (!ev.lastRecapAt) return `AI recap every ${ev.recapIntervalHours} h when the writer is on · first recap pending`;
		const next = new Date(new Date(ev.lastRecapAt).getTime() + ev.recapIntervalHours * 3_600_000).toISOString();
		return `AI recap every ${ev.recapIntervalHours} h when the writer is on · next ${timeUntil(next)} · recaps appear in the developments list like any post`;
	});
	const singlesNewest = $derived([...tl.singles].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)));
	const span = (d: { members: { publishedAt: string }[] }) => `${hhmm(d.members[0].publishedAt)}–${hhmm(d.members[d.members.length - 1].publishedAt)}`;
	const setRange = (h: number) => goto(`?h=${h}`, { keepFocus: true, noScroll: true });
</script>

<svelte:head><title>{tl.event.name} · Homefeed</title></svelte:head>

<div class="tpage" style:--sc={color}>
	<section class="ehead card">
		<a class="back" href="/">← Board</a>
		<div class="et"><span class="pill trk">{@html PIN} TRACKED</span><h1>{tl.event.name}</h1></div>
		<div class="estats">
			<span><b>{tl.postCount}</b> posts</span><span><b>{tl.developments.length}</b> developments</span><span><b>{tl.channelCount}</b> channels</span><span><b>{tl.singles.length}</b> single posts</span>
		</div>
		<span class="sp"></span>
		<div class="range">
			{#each data.ranges as h}
				<button class:on={h === data.hours} onclick={() => setRange(h)}>{h < 72 ? `${h} h` : '3 d'}</button>
			{/each}
		</div>
		<div class="emeta">{recapNote}</div>
	</section>

	<section class="lower">
		<div class="devlist card">
			<div class="lh">Developments <em>newest first</em></div>
			<div class="dvb" use:fitRows={{ key: devsNewest.map((d) => d.id).join() + selected?.id, onHidden: (n) => (hiddenDevs = n) }}>
				{#each devsNewest as d (d.id)}
					<button data-row class="dv" class:on={d.id === selected?.id} onclick={() => (picked = d.id)}>
						<span class="tm">{hhmm(d.lastItemAt)}</span>
						<div>
							<div class="dtt">{headlineOf(d.members.find((m) => m.id === d.labelArticleId) ?? d.members[0])}</div>
							<div class="dsub">{d.itemCount} posts · {d.sourceCount} channels · {span(d)}</div>
						</div>
					</button>
				{:else}
					<p class="none" data-row>No developments in this window yet.</p>
				{/each}
			</div>
			<div class="dvf"><span>{hiddenDevs ? `+${hiddenDevs} earlier` : ''}</span><span>Single posts ({tl.singles.length}) →</span></div>
		</div>

		<div class="detail card">
			{#if selected}
				<div class="dh">
					<div class="sk">Selected development · {selected.itemCount} posts · {selected.sourceCount} channels · {clockTime(selected.firstItemAt)} – {clockTime(selected.lastItemAt)}</div>
					<div class="stt">{headlineOf(selected.members.find((m) => m.id === selected.labelArticleId) ?? selected.members[0])}</div>
				</div>
				<div class="body"><PostTiles items={selected.members} /></div>
			{:else}
				<p class="none big">Nothing has grouped into a development in the last {data.hours} hours. Every post is in the single posts column.</p>
			{/if}
		</div>

		<div class="singles card">
			<div class="lh">Single posts <em>{tl.singles.length} in {data.hours} h · newest first</em></div>
			<div class="sgb" use:fitRows={{ key: singlesNewest.map((s) => s.id).join(), onHidden: (n) => (hiddenSingles = n) }}>
				{#each singlesNewest as a (a.id)}
					{@const who = authorOf(a)}
					{@const img = imageOf(a)}
					<a data-row class="sr" class:new={clock.now - new Date(a.publishedAt).getTime() < 10 * 60_000} class:art={!isPost(a)} href="/article/{a.id}">
						<span class="tm">{hhmm(a.publishedAt)}</span>
						<div class="sb">
							<div class="sw">{#if who.avatar}<img class="sav" src={who.avatar} alt="" loading="lazy" />{/if}<b>{who.name}</b></div>
							<div class="stx">{isPost(a) ? textOf(a) : a.title}</div>
						</div>
						{#if img}<span class="sth"><img src={img.url} alt="" loading="lazy" /></span>{:else if a.hasVideo || (a.tweet?.media ?? a.telegramMessage?.media ?? []).length}<span class="sth vid">▶</span>{/if}
					</a>
				{:else}
					<p class="none" data-row>None.</p>
				{/each}
			</div>
			<div class="dvf"><span>{hiddenSingles ? `+${hiddenSingles} earlier` : ''}</span><span>Posts that didn't join a development</span></div>
		</div>
	</section>
</div>

<style>
	.tpage {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		gap: 10px;
	}
	.ehead {
		display: flex;
		align-items: center;
		gap: 18px;
		border-left: 3px solid var(--sc);
		padding: 10px 16px;
		flex-wrap: wrap;
	}
	.back {
		font-size: 12.5px;
		border: 1px solid var(--bd);
		border-radius: 7px;
		padding: 6px 11px;
	}
	.et {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.et :global(svg) {
		display: block;
	}
	h1 {
		margin: 0;
		font-family: var(--serif);
		font-size: 28px;
		font-weight: 600;
		letter-spacing: -0.4px;
	}
	.estats {
		display: flex;
		gap: 16px;
		font-size: 12.5px;
		color: var(--tx2);
	}
	.estats b {
		color: var(--tx);
		font-weight: 600;
		font-family: var(--mono);
		font-size: 13px;
		margin-right: 3px;
	}
	.sp {
		flex: 1;
	}
	.range {
		display: flex;
		border: 1px solid var(--bd);
		border-radius: 7px;
		overflow: hidden;
	}
	.range button {
		padding: 5px 11px;
		font-size: 12px;
		color: var(--tx2);
		border: 0;
		border-left: 1px solid var(--bd);
		border-radius: 0;
		background: transparent;
	}
	.range button:first-child {
		border-left: 0;
	}
	.range button.on {
		background: var(--tx);
		color: var(--s0);
		font-weight: 600;
	}
	.emeta {
		width: 100%;
		font-size: 11.5px;
		color: var(--tx3);
		margin-top: -4px;
	}
	.lower {
		display: grid;
		grid-template-columns: 400px minmax(0, 1fr) 470px;
		gap: 12px;
		min-height: 0;
	}
	.devlist,
	.singles {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.lh {
		padding: 10px 14px;
		border-bottom: 1px solid var(--bd);
		font-size: 11.5px;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		flex: none;
	}
	.lh em {
		font-style: normal;
		font-weight: 400;
		color: var(--tx3);
		letter-spacing: 0;
		text-transform: none;
		margin-left: 6px;
	}
	.dvb,
	.sgb {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.dv {
		display: grid;
		grid-template-columns: 44px 1fr;
		gap: 8px;
		padding: 8px 14px;
		border: 0;
		border-bottom: 1px solid var(--bd);
		border-radius: 0;
		width: 100%;
		text-align: left;
		background: transparent;
		color: inherit;
	}
	.dv:hover {
		background: var(--s2);
	}
	.dv.on {
		background: color-mix(in srgb, var(--sc) 12%, transparent);
		box-shadow: inset 3px 0 0 var(--sc);
	}
	.tm {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--tx3);
		padding-top: 2px;
	}
	.dv.on .tm {
		color: var(--sc);
	}
	.dtt {
		font-size: 13px;
		font-weight: 500;
		line-height: 1.33;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.dsub {
		font-size: 11px;
		color: var(--tx3);
		margin-top: 2px;
	}
	.dvf {
		display: flex;
		justify-content: space-between;
		padding: 7px 14px;
		font-size: 11px;
		color: var(--tx3);
		border-top: 1px solid var(--bd);
		flex: none;
	}
	.detail {
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.dh {
		padding-bottom: 10px;
		border-bottom: 1px solid var(--bd);
		flex: none;
	}
	.sk {
		font-size: 11.5px;
		color: var(--tx3);
	}
	.stt {
		font-family: var(--serif);
		font-size: 20px;
		font-weight: 600;
		line-height: 1.2;
		margin-top: 5px;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.body {
		flex: 1;
		min-height: 0;
		padding-top: 12px;
	}
	.sr {
		display: grid;
		grid-template-columns: 40px minmax(0, 1fr) auto;
		gap: 8px;
		align-items: center;
		padding: 6px 12px;
		border-bottom: 1px solid var(--bd);
		color: inherit;
	}
	.sr:hover {
		text-decoration: none;
		background: var(--s2);
	}
	.sr .tm {
		align-self: start;
		margin-top: 2px;
	}
	.sb {
		min-width: 0;
	}
	.sw {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--tx2);
		white-space: nowrap;
		overflow: hidden;
	}
	.sw b {
		font-weight: 600;
	}
	.sav {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		object-fit: cover;
	}
	.stx {
		font-size: 12px;
		line-height: 1.35;
		margin-top: 2px;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.sr.art .stx {
		font-family: var(--serif);
		font-size: 13.5px;
		font-weight: 600;
	}
	.sth {
		width: 40px;
		height: 40px;
		border-radius: 5px;
		overflow: hidden;
		background: var(--s2);
		display: grid;
		place-items: center;
		color: var(--tx2);
		font-size: 11px;
	}
	.sth img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.sr.new {
		background: color-mix(in srgb, var(--acc) 8%, transparent);
	}
	.sr.new .tm {
		color: var(--acc);
	}
	.none {
		margin: 0;
		padding: 12px 14px;
		font-size: 12px;
		color: var(--tx3);
	}
	.none.big {
		font-size: 13px;
	}
	/* Phones: header wraps, the three panels stack (developments, the selected one's tiles,
	   single posts) and the page scrolls (see +layout.svelte). Both lists stop at a fixed height;
	   rows that don't fit become "+N earlier". */
	@media (max-width: 760px) {
		.tpage {
			flex: none;
			grid-template-rows: auto auto;
		}
		.ehead {
			gap: 10px 14px;
			padding: 10px 12px;
		}
		.et {
			flex: 1 1 100%;
			flex-wrap: wrap;
			gap: 6px 10px;
		}
		.estats {
			flex-wrap: wrap;
			gap: 4px 14px;
		}
		.sp {
			display: none;
		}
		.lower {
			grid-template-columns: minmax(0, 1fr);
		}
		.dvb,
		.sgb {
			flex: none;
			max-height: 320px;
		}
		.stt {
			font-size: 18px;
			-webkit-line-clamp: 3;
		}
		h1 {
			font-size: 22px;
		}
	}
</style>
