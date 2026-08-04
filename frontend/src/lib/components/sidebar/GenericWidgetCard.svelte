<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getBackendUrl } from '$lib/config';
	import type { WidgetReport } from '$lib/types';

	// Renders any uploaded widget that has no custom frontend bundle — fetches whatever its
	// own poll.run() published via setKv(id, 'report', ...) (see GET /api/widget/:id/report,
	// registered once generically on the backend so this works for a widget uploaded after
	// the server started, with no restart). Self-contained refresh interval since this
	// component isn't wired into +layout.ts's load-based invalidation — matches the layout's
	// own 5-minute sidebar refresh cadence.
	let { id, displayName }: { id: string; displayName: string } = $props();

	let report = $state<WidgetReport | null>(null);
	let loaded = $state(false);
	let timer: ReturnType<typeof setInterval>;

	async function fetchReport() {
		try {
			const res = await fetch(`${getBackendUrl()}/api/widget/${id}/report`);
			if (res.ok) {
				const body = (await res.json()) as { data: WidgetReport | null };
				report = body.data;
			}
		} catch {
			// Leave the last-known report showing — a stale card beats a blank one.
		} finally {
			loaded = true;
		}
	}

	onMount(() => {
		fetchReport();
		timer = setInterval(fetchReport, 5 * 60_000);
	});

	onDestroy(() => clearInterval(timer));
</script>

<div class="widget">
	<div class="head">
		<span class="title">{report?.title ?? displayName}</span>
	</div>
	{#if report?.headline}
		<div class="headline">
			<span class="value">{report.headline.value}</span>
			{#if report.headline.delta}<span class="delta">{report.headline.delta}</span>{/if}
		</div>
	{/if}
	{#if report?.rows && report.rows.length > 0}
		<div class="list">
			{#each report.rows as row, i (i)}
				<div class="row">
					<span class="label">{row.label}</span>
					<span class="value">{row.value}</span>
				</div>
			{/each}
		</div>
	{:else if !report?.headline}
		<p class="empty">{loaded ? 'No data yet' : 'Loading…'}</p>
	{/if}
</div>

<style>
	.widget {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 14px;
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}
	.title {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
	}
	.headline {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-top: 8px;
	}
	.headline .value {
		font-size: 18px;
		font-weight: 500;
	}
	.delta {
		font-size: 12px;
		color: var(--text-secondary);
	}
	.list {
		display: flex;
		flex-direction: column;
		margin-top: 8px;
	}
	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		padding: 6px 0;
		border-top: 0.5px solid var(--border);
	}
	.row:first-child {
		border-top: none;
	}
	.label {
		font-size: 13px;
	}
	.value {
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		color: var(--text-secondary);
	}
	.empty {
		font-size: 12px;
		color: var(--text-muted);
		margin: 8px 0 0;
	}
</style>
