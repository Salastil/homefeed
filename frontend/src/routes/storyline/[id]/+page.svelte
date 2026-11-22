<script lang="ts">
	/**
	 * One storyline: every update as a timeline on the left (newest first), and the selected
	 * update with the ones before it as Layout A tiles on the right. Nothing scrolls - the list
	 * shows what fits and the tiles page by selection. Re-polls every minute while open.
	 */
	import type { PageData } from './$types';
	import { getStoryline } from '$lib/api';
	import { clock, poll } from '$lib/live.svelte';
	import { scrollList, toTop } from '$lib/actions/scrollList';
	import { resolveMediaUrl } from '$lib/config';
	import { agoShort, authorOf, fullTime, headlineOf, isPost, relTime, storyColor, until } from '$lib/text';
	import PostTiles from '$lib/components/tiles/PostTiles.svelte';
	import { browser } from '$app/environment';
	import { getApiKey } from '$lib/adminAuth';
	import { renameStoryline } from '$lib/adminApi';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	let s = $state(data.storyline);
	$effect(() => {
		s = data.storyline;
	});
	$effect(() => {
		const id = data.storyline.id;
		return poll(async () => {
			try {
				s = await getStoryline(id);
			} catch {
				/* closed and aged out while open: keep what's on screen */
			}
		}, 60_000);
	});

	const color = $derived(storyColor(s.id));
	const newest = $derived([...s.members].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)));
	let picked = $state<string | null>(null);
	const selIndex = $derived(Math.max(0, newest.findIndex((m) => m.id === picked)));
	const PAGE = 6;
	const tiles = $derived(newest.slice(selIndex, selIndex + PAGE));
	const sources = $derived(new Set(s.members.map((m) => m.sourceKey)).size);
	// The updates list scrolls (issue #3, option A); rows scrolled up out of view.
	let above = $state(0);
	let listBox: HTMLElement | undefined = $state();
	// Admins (a key stored in this browser) can name a storyline by hand.
	// Read after hydration, so the server's render (never an admin) and the client's agree.
	let isAdmin = $state(false);
	$effect(() => {
		isAdmin = browser && !!getApiKey();
	});
	let editing = $state(false);
	let draft = $state('');
	let saving = $state(false);
	async function saveName(tag: string) {
		saving = true;
		try {
			const r = await renameStoryline(s.id, tag);
			s = { ...s, tag: r.tag, tagLocked: r.tagLocked };
			editing = false;
		} catch {
			/* keep the editor open */
		} finally {
			saving = false;
		}
	}

	const stateText = $derived(
		s.state === 'live' ? 'LIVE' : s.state === 'cooling' ? `COOLING · closes in ${until(s.closesAt, clock.now)}` : 'CLOSED'
	);
</script>

<svelte:head><title>{s.tag || s.label} · Homefeed</title></svelte:head>

<div class="spage" style:--sc={color}>
	<section class="shead card">
		<a class="back" href="/">← Board</a>
		{#if s.image}<img class="hi" src={resolveMediaUrl(s.image.url)} alt="" />{/if}
		<div class="ht">
			<div class="hk">
				<span class="pill" class:live={s.state === 'live'} class:cool={s.state !== 'live'}>{#if s.state === 'live'}<i></i>{/if}{stateText}</span>
				{#if editing}
					<form class="rn" onsubmit={(e) => (e.preventDefault(), saveName(draft))}>
						<!-- svelte-ignore a11y_autofocus -->
						<input bind:value={draft} maxlength="60" autofocus onkeydown={(e) => e.key === 'Escape' && (editing = false)} />
						<button type="submit" disabled={saving}>Save</button>
						{#if s.tagLocked}<button type="button" disabled={saving} onclick={() => saveName('')} title="Let the engine name it again">Automatic</button>{/if}
						<button type="button" onclick={() => (editing = false)}>Cancel</button>
					</form>
				{:else}
					<b>{s.tag}</b>
					{#if isAdmin}
						<button class="pen" title={s.tagLocked ? 'Named by hand - rename' : 'Rename this storyline'} onclick={() => ((draft = s.tag), (editing = true))}>✎{s.tagLocked ? ' named by hand' : ''}</button>
					{/if}
				{/if}
			</div>
			<h1>{s.label}</h1>
		</div>
		<span class="sp"></span>
		<div class="hs">
			<span><b>{s.itemCount}</b> updates</span><span><b>{sources}</b> sources</span>
			<span title={fullTime(s.firstItemAt)}>started <b>{relTime(s.firstItemAt, clock.now)}</b></span><span title={fullTime(s.lastItemAt)}>latest <b>{relTime(s.lastItemAt, clock.now)}</b></span>
		</div>
		{#if s.continuesId}<a class="cont" href="/storyline/{s.continuesId}">continues an earlier storyline →</a>{/if}
	</section>

	<section class="lower">
		<div class="tlist card">
			<div class="lh">Updates <em>newest first</em></div>
			{#if above}<button class="top-pill" onclick={() => toTop(listBox)}>↑ {above} newer · back to top</button>{/if}
			<div class="tb scroll-thin" bind:this={listBox} use:scrollList={{ onAbove: (n) => (above = n) }}>
				{#each newest as m, i (m.id)}
					{@const who = authorOf(m)}
					<button data-row class="u" class:on={i >= selIndex && i < selIndex + PAGE} class:first={i === selIndex} onclick={() => (picked = m.id)}>
						<span class="tm" title={fullTime(m.publishedAt)}>{agoShort(m.publishedAt, clock.now)}</span>
						<span class="dot"></span>
						<div class="ub">
							<div class="uw">{isPost(m) ? who.name : m.sourceName}</div>
							<div class="ut" class:art={!isPost(m)}>{headlineOf(m)}</div>
						</div>
					</button>
				{/each}
			</div>
			<div class="lf"><span>{newest.length} updates{newest.length > 10 ? ' · scroll for earlier' : ''}</span><span>select an update to show it and the ones before it</span></div>
		</div>
		<div class="detail card">
			<div class="dh">
				<span>Showing {selIndex + 1}–{selIndex + tiles.length} of {newest.length}</span>
				<span class="sp"></span>
				<button disabled={selIndex === 0} onclick={() => (picked = newest[Math.max(0, selIndex - PAGE)].id)}>‹ newer</button>
				<button disabled={selIndex + PAGE >= newest.length} onclick={() => (picked = newest[selIndex + PAGE].id)}>older ›</button>
			</div>
			<div class="body"><PostTiles items={tiles} /></div>
		</div>
	</section>
</div>

<style>
	.spage {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		gap: 10px;
	}
	.shead {
		display: flex;
		align-items: center;
		gap: 16px;
		border-left: 3px solid var(--sc);
		padding: 10px 16px;
	}
	.back,
	.cont {
		font-size: 12.5px;
		border: 1px solid var(--bd);
		border-radius: 7px;
		padding: 6px 11px;
		white-space: nowrap;
	}
	.hi {
		width: 96px;
		height: 64px;
		object-fit: cover;
		border-radius: 7px;
		flex: none;
	}
	.ht {
		min-width: 0;
	}
	.hk {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12px;
		color: var(--sc);
	}
	.hk b,
	.pen {
		white-space: nowrap;
	}
	.pen {
		font-size: 11px;
		padding: 0 6px;
		border: 1px solid var(--bd);
		border-radius: 5px;
		background: transparent;
		color: var(--tx3);
	}
	.rn {
		display: flex;
		gap: 6px;
	}
	.rn input {
		font-size: 12px;
		padding: 2px 7px;
		width: 220px;
		border: 1px solid var(--sc);
		border-radius: 5px;
		background: var(--s2);
		color: var(--tx);
	}
	.rn button {
		font-size: 11px;
		padding: 2px 8px;
		border: 1px solid var(--bd);
		border-radius: 5px;
		background: transparent;
		color: var(--tx2);
	}
	h1 {
		margin: 4px 0 0;
		font-family: var(--serif);
		font-size: 24px;
		font-weight: 600;
		line-height: 1.2;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.sp {
		flex: 1;
	}
	.hs {
		display: flex;
		gap: 14px;
		font-size: 12.5px;
		color: var(--tx2);
		white-space: nowrap;
	}
	.hs b {
		color: var(--tx);
		font-family: var(--mono);
		font-weight: 600;
	}
	.lower {
		display: grid;
		grid-template-columns: 440px minmax(0, 1fr);
		gap: 12px;
		min-height: 0;
	}
	.tlist,
	.detail {
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
	}
	.lh em {
		font-style: normal;
		font-weight: 400;
		color: var(--tx3);
		letter-spacing: 0;
		text-transform: none;
		margin-left: 6px;
	}
	.tlist {
		position: relative;
	}
	.tb {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		position: relative;
	}
	.u {
		display: grid;
		grid-template-columns: 52px 14px minmax(0, 1fr);
		gap: 6px;
		width: 100%;
		padding: 7px 14px;
		text-align: left;
		background: transparent;
		border: 0;
		border-radius: 0;
		color: inherit;
		position: relative;
	}
	.u:hover {
		background: var(--s2);
	}
	.u.on {
		background: color-mix(in srgb, var(--sc) 9%, transparent);
	}
	.u.first {
		box-shadow: inset 3px 0 0 var(--sc);
	}
	.tm {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--tx3);
		padding-top: 1px;
	}
	.dot {
		position: relative;
	}
	.dot::before {
		content: '';
		position: absolute;
		left: 6px;
		top: -7px;
		bottom: -8px;
		width: 2px;
		background: color-mix(in srgb, var(--sc) 30%, var(--bd));
	}
	.dot::after {
		content: '';
		position: absolute;
		left: 2px;
		top: 4px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--s1);
		border: 2px solid var(--sc);
		box-sizing: border-box;
	}
	.u.on .dot::after {
		background: var(--sc);
	}
	.ub {
		min-width: 0;
	}
	.uw {
		font-size: 11px;
		color: var(--tx3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ut {
		font-size: 12.5px;
		line-height: 1.35;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.ut.art {
		font-family: var(--serif);
		font-size: 13.5px;
		font-weight: 600;
	}
	.lf {
		display: flex;
		justify-content: space-between;
		padding: 7px 14px;
		font-size: 11px;
		color: var(--tx3);
		border-top: 1px solid var(--bd);
	}
	.detail {
		padding: 10px 14px 14px;
	}
	.dh {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11.5px;
		color: var(--tx3);
		padding-bottom: 10px;
	}
	.dh button {
		font-size: 12px;
		padding: 4px 10px;
		border-radius: 6px;
		background: transparent;
		color: var(--tx2);
	}
	.dh button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.body {
		flex: 1;
		min-height: 0;
	}
	/* Phones: header wraps, the update list and the tiles stack, and the page scrolls (see
	   +layout.svelte). The list stops at a fixed height so a long storyline doesn't push the
	   tiles a dozen screens down; rows that don't fit become "+N earlier". */
	@media (max-width: 760px) {
		.spage {
			flex: none;
			grid-template-rows: auto auto;
		}
		.shead {
			flex-wrap: wrap;
			gap: 10px 12px;
			padding: 10px 12px;
		}
		.back {
			order: -2;
		}
		.cont {
			order: -1;
		}
		.ht {
			flex: 1 1 0;
		}
		.hi {
			width: 84px;
			height: 58px;
		}
		h1 {
			font-size: 20px;
			-webkit-line-clamp: 3;
		}
		.sp {
			display: none;
		}
		.hs {
			flex: 1 1 100%;
			flex-wrap: wrap;
			gap: 4px 14px;
		}
		.rn {
			flex-wrap: wrap;
		}
		.rn input {
			width: 100%;
		}
		.lower {
			grid-template-columns: minmax(0, 1fr);
		}
		.tb {
			flex: none;
			max-height: 340px;
		}
		.lf {
			gap: 10px;
		}
		.lf span:last-child {
			display: none;
		}
		.detail {
			padding: 10px 12px 12px;
		}
		.dh {
			flex-wrap: wrap;
		}
		.dh button {
			padding: 6px 12px;
		}
	}
</style>
