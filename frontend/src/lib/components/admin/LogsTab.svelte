<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { LogEntry } from '$lib/adminTypes';
	import { getLogs } from '$lib/adminApi';

	let { logs: initial }: { logs: LogEntry[] } = $props();
	let logs = $state([...initial]);
	let filter = $state<'all' | 'info' | 'warn' | 'error'>('all');
	let autoRefresh = $state(true);
	let loading = $state(false);
	let timer: ReturnType<typeof setInterval>;

	async function refresh() {
		loading = true;
		try {
			logs = await getLogs(filter === 'all' ? {} : { level: filter });
		} finally {
			loading = false;
		}
	}

	function setFilter(f: typeof filter) {
		filter = f;
		refresh();
	}

	onMount(() => {
		timer = setInterval(() => {
			if (autoRefresh) refresh();
		}, 5000);
	});
	onDestroy(() => clearInterval(timer));

	function formatTime(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}
</script>

<div class="toolbar">
	<div class="filters">
		<button class="pill" class:active={filter === 'all'} onclick={() => setFilter('all')}>All</button>
		<button class="pill" class:active={filter === 'info'} onclick={() => setFilter('info')}>Standard</button>
		<button class="pill warn" class:active={filter === 'warn'} onclick={() => setFilter('warn')}>Warn</button>
		<button class="pill err" class:active={filter === 'error'} onclick={() => setFilter('error')}>Error</button>
	</div>
	<div class="right">
		<label class="checkbox">
			<input type="checkbox" bind:checked={autoRefresh} />
			Auto-refresh
		</label>
		<button onclick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
	</div>
</div>

<div class="log-list">
	{#if logs.length === 0}
		<div class="empty">Nothing logged yet.</div>
	{/if}
	{#each logs as log (log.id)}
		<div class="log-row">
			<span class="time">{formatTime(log.timestamp)}</span>
			<span class="level" class:warn={log.level === 'warn'} class:err={log.level === 'error'}>
				{log.level === 'info' ? 'standard' : log.level}
			</span>
			<span class="source">{log.source}</span>
			<span class="message">{log.message}</span>
		</div>
	{/each}
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
		flex-wrap: wrap;
		gap: 10px;
	}
	.filters {
		display: flex;
		gap: 6px;
	}
	.pill {
		font-size: 12px;
		padding: 5px 12px;
		border-radius: var(--radius);
		border: 0.5px solid var(--border);
		background: var(--surface-2);
		color: var(--text-secondary);
	}
	.pill.active {
		background: var(--pill-bg);
		color: var(--pill-text);
		border-color: var(--pill-bg);
	}
	.pill.warn.active {
		background: #a8710f;
		border-color: #a8710f;
		color: #fff;
	}
	.pill.err.active {
		background: var(--text-danger);
		border-color: var(--text-danger);
		color: #fff;
	}
	.right {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.checkbox {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.checkbox input {
		width: auto;
	}
	.log-list {
		background: var(--surface-1);
		border-radius: 12px;
		max-height: 480px;
		overflow-y: auto;
		font-family: var(--font-mono);
	}
	.empty {
		padding: 20px;
		font-size: 12px;
		color: var(--text-muted);
		font-family: var(--font-sans);
	}
	.log-row {
		display: grid;
		grid-template-columns: 76px 66px 90px 1fr;
		gap: 10px;
		padding: 6px 12px;
		font-size: 12px;
		border-bottom: 0.5px solid var(--border);
		align-items: baseline;
	}
	.log-row:last-child {
		border-bottom: none;
	}
	.time {
		color: var(--text-muted);
	}
	.level {
		color: var(--text-secondary);
		text-transform: uppercase;
		font-size: 10px;
	}
	.level.warn {
		color: #a8710f;
	}
	.level.err {
		color: var(--text-danger);
	}
	.source {
		color: var(--text-accent);
	}
	.message {
		color: var(--text-primary);
		word-break: break-word;
	}
</style>
