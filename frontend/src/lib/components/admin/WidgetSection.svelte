<script lang="ts">
	import type { Snippet } from 'svelte';

	// Minimized by default — Weather/Stocks/Bookmarks/PoE2 stacked at full height would
	// make the consolidated "Widgets" tab unwieldy as more get added over time. Enabled
	// state is independent of expanded state: disabling a widget only hides it from the
	// sidebar (see Sidebar.svelte's widgetsEnabled gate), it doesn't stop the admin from
	// expanding this section to keep configuring it.
	let {
		title,
		enabled,
		onToggle,
		children
	}: {
		title: string;
		enabled: boolean;
		onToggle: () => void;
		children: Snippet;
	} = $props();

	let expanded = $state(false);
</script>

<div class="section">
	<div class="section-head">
		<button class="head-btn" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
			<span class="chevron" class:open={expanded}>▸</span>
			<span class="title">{title}</span>
			{#if !enabled}<span class="disabled-tag">Hidden</span>{/if}
		</button>
		<label class="enable-toggle" title={enabled ? 'Hide from sidebar' : 'Show in sidebar'}>
			<input type="checkbox" checked={enabled} onchange={onToggle} />
		</label>
	</div>
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
		margin-bottom: 12px;
		overflow: hidden;
	}
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px;
	}
	.head-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		background: transparent;
		border: none;
		padding: 0;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-primary);
		flex: 1;
		min-width: 0;
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
	.disabled-tag {
		font-size: 10px;
		font-weight: 400;
		color: var(--text-muted);
		border: 0.5px solid var(--border);
		padding: 1px 6px;
		border-radius: var(--radius);
	}
	.enable-toggle {
		display: flex;
		align-items: center;
	}
	.enable-toggle input {
		width: auto;
	}
	.section-body {
		padding: 14px;
		padding-top: 0;
		border-top: 0.5px solid var(--border);
		margin-top: 0;
	}
	.section-body > :global(*:first-child) {
		margin-top: 14px;
	}
</style>
