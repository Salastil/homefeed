<script lang="ts">
	import type { Snippet } from 'svelte';

	// Same collapsed-by-default shell as WidgetSection, minus the enable/disable
	// checkbox — for sections that are always "on" (Category priority, Sources) and
	// just need to stay out of the way until expanded.
	let {
		title,
		defaultExpanded = false,
		children
	}: {
		title: string;
		defaultExpanded?: boolean;
		children: Snippet;
	} = $props();

	let expanded = $state(defaultExpanded);
</script>

<div class="section">
	<button class="section-head" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
		<span class="chevron" class:open={expanded}>▸</span>
		<span class="title">{title}</span>
	</button>
	{#if expanded}
		<div class="section-body">
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.section {
		background: var(--surface-1);
		border-radius: 12px;
		margin-bottom: 14px;
		overflow: hidden;
	}
	.section-head {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		background: transparent;
		border: none;
		padding: 12px 14px;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-primary);
		text-align: left;
	}
	.chevron {
		display: inline-block;
		font-size: 10px;
		color: var(--text-muted);
		transition: transform 0.15s ease;
	}
	.chevron.open {
		transform: rotate(90deg);
	}
	.section-body {
		padding: 14px;
		padding-top: 0;
		border-top: 0.5px solid var(--border);
	}
	.section-body > :global(*:first-child) {
		margin-top: 14px;
	}
</style>
