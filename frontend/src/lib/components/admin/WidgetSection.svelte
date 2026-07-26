<script lang="ts">
	import type { Snippet } from 'svelte';

	// Minimized by default — Weather/Stocks/Bookmarks/PoE2 stacked at full height would
	// make the consolidated "Widgets" tab unwieldy as more get added over time. Enabled
	// state is independent of expanded state: disabling a widget hides it from the
	// sidebar AND stops its backend poller from making outbound requests (see
	// scheduler.ts's widgets.* gate) — it just doesn't stop the admin from expanding
	// this section to keep configuring it while it's off.
	let {
		title,
		enabled,
		onToggle,
		// Weather/Stocks/PoE2 have a backend poller that scheduler.ts gates on this same
		// flag (see scheduler.ts); Bookmarks doesn't poll anything, so disabling it only
		// ever affects sidebar visibility — the tooltip shouldn't claim otherwise.
		hasBackendPoller = true,
		children
	}: {
		title: string;
		enabled: boolean;
		onToggle: () => void;
		hasBackendPoller?: boolean;
		children: Snippet;
	} = $props();

	let expanded = $state(false);
</script>

<div class="section">
	<div class="section-head">
		<button class="head-btn" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
			<span class="chevron" class:open={expanded}>▸</span>
			<span class="title">{title}</span>
			{#if !enabled}<span class="disabled-tag">Off</span>{/if}
		</button>
		<label
			class="enable-toggle"
			title={hasBackendPoller
				? enabled
					? 'Disable — stops polling and hides from the sidebar'
					: 'Enable — resumes polling and shows in the sidebar'
				: enabled
					? 'Disable — hides from the sidebar'
					: 'Enable — shows in the sidebar'}
		>
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
