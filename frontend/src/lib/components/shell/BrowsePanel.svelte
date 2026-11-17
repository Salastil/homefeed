<script lang="ts">
	/**
	 * Frame for the browse pages (a category, a tag, More): a header row and one panel that
	 * scrolls inside itself, so the top bar and widget row stay on screen like everywhere else.
	 */
	import type { Snippet } from 'svelte';
	import { categoryColor } from '$lib/text';

	let {
		title,
		kicker = '',
		color = null,
		note = '',
		children
	}: { title: string; kicker?: string; color?: string | null; note?: string; children: Snippet } = $props();

	let body: HTMLElement | undefined = $state();
	let progress = $state(0);
	const onScroll = () => {
		if (!body) return;
		const max = body.scrollHeight - body.clientHeight;
		progress = max > 0 ? body.scrollTop / max : 0;
	};
</script>

<div class="browse">
	<nav class="crumbs"><a class="back" href="/">← Board</a>{#if kicker}<span>{kicker}</span><span>›</span>{/if}<span>{title}</span></nav>
	<section class="panel card" style:--bc={color ?? categoryColor(title)}>
		<div class="prog"><i style:width="{progress * 100}%"></i></div>
		<header>
			<i class="sw"></i>
			<h1>{title}</h1>
			{#if note}<span class="note">{note}</span>{/if}
		</header>
		<div class="body" bind:this={body} onscroll={onScroll}>
			<div class="inner">{@render children()}</div>
		</div>
	</section>
</div>

<style>
	.browse {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.crumbs {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12.5px;
		color: var(--tx3);
		flex: none;
	}
	.back {
		border: 1px solid var(--bd);
		border-radius: 7px;
		padding: 4px 10px;
	}
	.panel {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.prog {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 2px;
	}
	.prog i {
		display: block;
		height: 100%;
		background: var(--bc);
	}
	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 24px 12px;
		border-bottom: 1px solid var(--bd);
		flex: none;
	}
	.sw {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		background: var(--bc);
	}
	h1 {
		margin: 0;
		font-family: var(--serif);
		font-size: 26px;
		font-weight: 600;
		text-transform: capitalize;
	}
	.note {
		margin-left: auto;
		font-size: 12px;
		color: var(--tx3);
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		scrollbar-width: thin;
	}
	.inner {
		max-width: 920px;
		margin: 0 auto;
		padding: 8px 24px 40px;
	}
</style>
