<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		enabled,
		onToggle,
		canMoveUp,
		canMoveDown,
		onMoveUp,
		onMoveDown,
		children
	}: {
		title: string;
		enabled: boolean;
		onToggle: () => void;
		canMoveUp: boolean;
		canMoveDown: boolean;
		onMoveUp: () => void;
		onMoveDown: () => void;
		children: Snippet;
	} = $props();

	let expanded = $state(false);
</script>

<div class="section">
	<div class="section-head">
		<button class="icon-btn" onclick={onMoveUp} disabled={!canMoveUp} aria-label="Move up">▲</button>
		<button class="icon-btn" onclick={onMoveDown} disabled={!canMoveDown} aria-label="Move down">▼</button>
		<button class="head-btn" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
			<span class="chevron" class:open={expanded}>▸</span>
			<span class="title">{title}</span>
		</button>
		<span class="badge" class:active={enabled} onclick={onToggle} role="button" tabindex="0">
			{enabled ? 'Active' : 'Disabled'}
		</span>
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
		gap: 8px;
		padding: 12px 14px;
	}
	.icon-btn {
		font-size: 11px;
		padding: 2px 6px;
		background: transparent;
		border: none;
		color: var(--text-secondary);
	}
	.icon-btn:disabled {
		color: var(--text-muted);
		opacity: 0.4;
		cursor: default;
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
	.badge {
		font-size: 11px;
		padding: 2px 10px;
		border-radius: var(--radius);
		background: var(--surface-2);
		color: var(--text-muted);
		cursor: pointer;
		white-space: nowrap;
	}
	.badge.active {
		background: var(--bg-accent);
		color: var(--text-accent);
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
