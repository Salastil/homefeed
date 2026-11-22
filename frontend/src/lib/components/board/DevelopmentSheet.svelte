<script lang="ts">
	/**
	 * Opens from a timeline node: the node's posts as Layout A tiles, over the columns. The
	 * storyline rotation pauses while it's open; it closes on Esc, a click on the dimmed area,
	 * the close button, or after 60 s with no interaction - so an unattended board returns to
	 * glance mode by itself.
	 */
	import type { LiteArticle } from '$lib/types';
	import { relTime } from '$lib/text';
	import { clock } from '$lib/live.svelte';
	import PostTiles from '../tiles/PostTiles.svelte';

	let {
		title,
		members,
		color,
		scopeName,
		href,
		anchor,
		onClose
	}: {
		title: string;
		members: LiteArticle[];
		color: string;
		scopeName: string;
		href: string;
		anchor: number;
		onClose: () => void;
	} = $props();

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

	const sorted = $derived([...members].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)));
	const sources = $derived(new Set(members.map((m) => m.sourceKey)).size);
	const span = $derived(
		!sorted.length ? '' : sorted.length === 1 ? relTime(sorted[0].publishedAt, clock.now) : `${relTime(sorted[0].publishedAt, clock.now)} – ${relTime(sorted[sorted.length - 1].publishedAt, clock.now)}`
	);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="scrim" style:top="{anchor}px" onclick={onClose}></div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sheet" style:top="{anchor + 10}px" style:--sc={color} role="dialog" aria-label={title} tabindex="-1" onmousemove={touch} onwheel={touch}>
	<div class="shd">
		<div class="hd">
			<div class="sk"><span class="pill trk">{scopeName}</span>{members.length > 1 ? 'development' : 'update'} · {members.length} {members.length === 1 ? 'post' : 'posts'} · {sources} {sources === 1 ? 'source' : 'sources'}{span ? ` · ${span}` : ''}</div>
			<div class="stt">{title}</div>
		</div>
		<div class="act">
			{#if members.length === 1}<a class="btn" href="/article/{members[0].id}">Open article →</a>{/if}
			<a class="btn" {href}>Open {scopeName} timeline →</a>
			<button class="x" aria-label="Close" onclick={onClose}>✕</button>
		</div>
	</div>
	<div class="body"><PostTiles items={sorted} compact moreHref={href} /></div>
	<div class="sft">
		<span>{members.length} {members.length === 1 ? 'post' : 'posts'} — word-for-word reposts are folded together</span>
		<span>Rotation paused while open · closes on <kbd>Esc</kbd>, a click outside, or after 60 s idle</span>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(6, 7, 9, 0.62);
		backdrop-filter: blur(1.5px);
		z-index: 40;
	}
	.sheet {
		position: fixed;
		left: 16px;
		right: 16px;
		bottom: 14px;
		display: flex;
		flex-direction: column;
		background: var(--s1);
		border: 1px solid color-mix(in srgb, var(--sc) 50%, var(--bd));
		border-radius: 12px;
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
		padding: 14px 16px 10px;
		z-index: 41;
	}
	.shd {
		display: flex;
		align-items: flex-start;
		gap: 20px;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--bd);
	}
	.hd {
		min-width: 0;
	}
	.sk {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 11.5px;
		color: var(--tx3);
	}
	.stt {
		font-family: var(--serif);
		font-size: 22px;
		font-weight: 600;
		line-height: 1.2;
		margin-top: 6px;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.act {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 10px;
		flex: none;
	}
	.btn {
		font-size: 12px;
		border: 1px solid var(--bd);
		border-radius: 7px;
		padding: 6px 11px;
		white-space: nowrap;
	}
	.x {
		width: 30px;
		height: 30px;
		padding: 0;
		display: grid;
		place-items: center;
		border-radius: 7px;
		color: var(--tx2);
		background: transparent;
	}
	.body {
		flex: 1;
		min-height: 0;
		padding: 12px 0 10px;
	}
	.sft {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		font-size: 11px;
		color: var(--tx3);
		border-top: 1px solid var(--bd);
		padding-top: 8px;
	}
	/* Phones: a bottom sheet over the whole screen rather than one hung under the tapped row
	   (the row can sit anywhere on a scrolled page); the tiles scroll inside it. */
	@media (max-width: 760px) {
		.scrim {
			top: 0 !important;
		}
		.sheet {
			top: auto !important;
			left: 0;
			right: 0;
			bottom: 0;
			max-height: 86dvh;
			border-radius: 14px 14px 0 0;
			padding: 12px 12px 8px;
		}
		.shd {
			flex-direction: column;
			gap: 10px;
		}
		.sk {
			flex-wrap: wrap;
			gap: 4px 8px;
		}
		.stt {
			font-size: 18px;
			-webkit-line-clamp: 3;
		}
		.act {
			margin-left: 0;
			width: 100%;
			flex-wrap: wrap;
		}
		.x {
			margin-left: auto;
		}
		.body {
			overflow-y: auto;
		}
		.sft span:last-child {
			display: none;
		}
	}
</style>
