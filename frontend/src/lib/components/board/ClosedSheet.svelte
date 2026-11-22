<script lang="ts">
	/**
	 * Opens from the storyline panel's "Closed today" chip (issue #3): a column of the
	 * storylines that have closed over the last week, most recently closed first, grouped by
	 * day. Each one opens its storyline page. Like the development sheet it pauses the
	 * rotation while open and closes on Esc, a click outside, the close button, or 60 s idle.
	 */
	import type { ClosedStoryline } from '$lib/types';
	import { getClosedStorylines } from '$lib/api';
	import { resolveMediaUrl } from '$lib/config';
	import { clock } from '$lib/live.svelte';
	import { relTime, storyColor } from '$lib/text';
	import { hideBroken } from '$lib/actions/hideBroken';

	let { anchor, onClose }: { anchor: number; onClose: () => void } = $props();

	const DAYS = 7;
	let list = $state<ClosedStoryline[] | null>(null);
	let failed = $state(false);
	$effect(() => {
		getClosedStorylines(DAYS)
			.then((r) => (list = r.storylines))
			.catch(() => (failed = true));
	});

	const IDLE_MS = 60_000;
	let lastActive = Date.now();
	const touch = () => (lastActive = Date.now());
	$effect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
			else touch();
		};
		const id = setInterval(() => {
			if (Date.now() - lastActive > IDLE_MS) onClose();
		}, 5000);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			clearInterval(id);
		};
	});

	// Day groups by when each one closed: Today, Yesterday, then the weekday and date.
	const groups = $derived.by(() => {
		const out: { label: string; items: ClosedStoryline[] }[] = [];
		const today = new Date(clock.now);
		today.setHours(0, 0, 0, 0);
		for (const s of list ?? []) {
			const d = new Date(s.closesAt);
			d.setHours(0, 0, 0, 0);
			const back = Math.round((today.getTime() - d.getTime()) / 86_400_000);
			const label = back <= 0 ? 'Today' : back === 1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
			const last = out.at(-1);
			if (last?.label === label) last.items.push(s);
			else out.push({ label, items: [s] });
		}
		return out;
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="scrim" style:top="{anchor}px" onclick={onClose}></div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pane" style:top="{anchor + 6}px" role="dialog" aria-label="Closed storylines" tabindex="-1" onmousemove={touch} onwheel={touch}>
	<div class="ph">
		<div>
			<b>Closed storylines</b>
			<span>last {DAYS} days{list ? ` · ${list.length}` : ''} · most recently closed first</span>
		</div>
		<button class="x" aria-label="Close" onclick={onClose}>✕</button>
	</div>
	<div class="pb scroll-thin">
		{#if failed}
			<p class="none">Couldn't load the closed storylines.</p>
		{:else if !list}
			<p class="none">Loading…</p>
		{:else if !list.length}
			<p class="none">Nothing has closed in the last {DAYS} days.</p>
		{:else}
			{#each groups as g (g.label)}
				<div class="gh">{g.label} <em>{g.items.length}</em></div>
				{#each g.items as s (s.id)}
					<a class="it" href="/storyline/{s.id}" style:--sc={storyColor(s.id)}>
						{#if s.image}<span class="th"><img src={resolveMediaUrl(s.image.url)} alt="" loading="lazy" use:hideBroken={'.th'} /></span>{/if}
						<span class="ib">
							<span class="tg"><i>◆</i>{s.tag || 'Storyline'}</span>
							<span class="lb">{s.label}</span>
							<span class="mt">{s.itemCount} updates · {s.sourceCount} sources · closed {relTime(s.closesAt, clock.now)}</span>
						</span>
					</a>
				{/each}
			{/each}
		{/if}
	</div>
	<div class="pf">Rotation paused while open · closes on <kbd>Esc</kbd>, a click outside or 60 s idle</div>
</div>

<style>
	.scrim {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(6, 7, 9, 0.5);
		z-index: 40;
	}
	.pane {
		position: fixed;
		right: 16px;
		bottom: 14px;
		width: 440px;
		max-width: calc(100vw - 32px);
		display: flex;
		flex-direction: column;
		background: var(--s1);
		border: 1px solid var(--bd);
		border-radius: 12px;
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
		z-index: 41;
	}
	.ph {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 12px 14px 10px;
		border-bottom: 1px solid var(--bd);
	}
	.ph div {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.ph b {
		font-size: 11.5px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.ph span {
		font-size: 11.5px;
		color: var(--tx3);
	}
	.x {
		width: 28px;
		height: 28px;
		padding: 0;
		display: grid;
		place-items: center;
		border-radius: 7px;
		color: var(--tx2);
		background: transparent;
	}
	.pb {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.gh {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: 7px 14px;
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--tx2);
		background: var(--s2);
		border-bottom: 1px solid var(--bd);
	}
	.gh em {
		font-style: normal;
		font-family: var(--mono);
		font-weight: 400;
		color: var(--tx3);
		margin-left: 4px;
	}
	.it {
		display: flex;
		gap: 10px;
		padding: 9px 14px;
		border-bottom: 1px solid var(--bd);
		color: inherit;
	}
	.it:hover {
		text-decoration: none;
		background: var(--s2);
		box-shadow: inset 3px 0 0 var(--sc);
	}
	.th {
		flex: none;
		width: 56px;
		height: 56px;
		border-radius: 7px;
		overflow: hidden;
		background: var(--s3);
	}
	.th img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		filter: grayscale(0.35);
	}
	.ib {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.tg {
		font-size: 12px;
		font-weight: 600;
		color: var(--tx);
	}
	.tg i {
		font-style: normal;
		color: var(--sc);
		font-size: 9px;
		margin-right: 6px;
	}
	.lb {
		font-family: var(--serif);
		font-size: 13.5px;
		line-height: 1.3;
		color: var(--tx2);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.mt {
		font-size: 11px;
		color: var(--tx3);
	}
	.none {
		margin: 0;
		padding: 16px 14px;
		font-size: 12.5px;
		color: var(--tx3);
	}
	.pf {
		padding: 7px 14px;
		font-size: 11px;
		color: var(--tx3);
		border-top: 1px solid var(--bd);
	}
	@media (max-width: 760px) {
		.scrim {
			top: 0 !important;
		}
		.pane {
			top: auto !important;
			left: 0;
			right: 0;
			bottom: 0;
			width: auto;
			max-width: none;
			max-height: 86dvh;
			border-radius: 14px 14px 0 0;
		}
		.pf {
			display: none;
		}
	}
</style>
