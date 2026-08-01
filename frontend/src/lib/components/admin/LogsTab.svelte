<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { LogEntry, PipelineStats } from '$lib/adminTypes';
	import { getLogs, getPipelineStats } from '$lib/adminApi';

	let { logs: initial }: { logs: LogEntry[] } = $props();
	let logs = $state([...initial]);
	let stats = $state<PipelineStats | null>(null);
	let filter = $state<'all' | 'info' | 'warn' | 'error'>('all');
	let autoRefresh = $state(true);
	let loading = $state(false);
	let timer: ReturnType<typeof setInterval>;

	async function refresh() {
		loading = true;
		try {
			const [nextLogs, nextStats] = await Promise.all([
				getLogs(filter === 'all' ? {} : { level: filter }),
				getPipelineStats().catch(() => stats) // stats endpoint failing shouldn't block the log list
			]);
			logs = nextLogs;
			stats = nextStats;
		} finally {
			loading = false;
		}
	}

	function setFilter(f: typeof filter) {
		filter = f;
		refresh();
	}

	onMount(() => {
		refresh();
		timer = setInterval(() => {
			if (autoRefresh) refresh();
		}, 5000);
	});
	onDestroy(() => clearInterval(timer));

	function formatTime(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	function formatAgo(iso: string | null): string {
		if (!iso) return 'never';
		const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
		if (seconds < 5) return 'just now';
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.round(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		return `${Math.round(minutes / 60)}h ago`;
	}

	function formatDuration(ms: number): string {
		if (ms < 1000) return `${Math.round(ms)}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
	}

	function formatEta(minutes: number | null): string {
		if (minutes === null) return 'collecting data…';
		if (minutes === 0) return 'caught up';
		if (minutes < 60) return `~${minutes}m`;
		return `~${Math.floor(minutes / 60)}h ${minutes % 60}m`;
	}
</script>

{#if stats}
	<div class="dashboard">
		<div class="tile">
			<span class="tile-label">Backlog</span>
			<span class="tile-value">{stats.backlog.totalUnclusteredItems}</span>
			<span class="tile-sub">item{stats.backlog.totalUnclusteredItems === 1 ? '' : 's'} not yet published</span>
		</div>
		<div class="tile">
			<span class="tile-label">Awaiting embedding</span>
			<span class="tile-value">{stats.backlog.awaitingEmbeddingItems}</span>
			<span class="tile-sub">need an embed() call before they can cluster</span>
		</div>
		<div class="tile">
			<span class="tile-label">Held for publishing</span>
			<span class="tile-value">{stats.backlog.clusters.itemsOnHold}</span>
			<span class="tile-sub">
				{stats.backlog.clusters.onHold} cluster{stats.backlog.clusters.onHold === 1 ? '' : 's'} on hold-before-publish
				{#if stats.backlog.clusters.earliestHoldRemainingMs !== null}
					· earliest clears in {formatDuration(stats.backlog.clusters.earliestHoldRemainingMs)}
				{/if}
			</span>
		</div>
		<div class="tile">
			<span class="tile-label">Awaiting synthesis</span>
			<span class="tile-value">{stats.backlog.clusters.readyNowNeedingSynthesis}</span>
			<span class="tile-sub">multi-source cluster{stats.backlog.clusters.readyNowNeedingSynthesis === 1 ? '' : 's'} ready, needs an AI merge</span>
		</div>
		<div class="tile">
			<span class="tile-label">Estimated to clear</span>
			<span class="tile-value">{formatEta(stats.estimatedMinutesToClear)}</span>
			<span class="tile-sub">
				{#if stats.ollama.avgGenerateDurationMs !== null}
					based on {stats.ollama.sampleCount} recent generate call{stats.ollama.sampleCount === 1 ? '' : 's'}, avg {formatDuration(stats.ollama.avgGenerateDurationMs)} each
				{:else}
					no completed generate calls yet
				{/if}
			</span>
		</div>
		<div class="tile">
			<span class="tile-label">Ollama right now</span>
			{#if stats.ollama.inFlight}
				<span class="tile-value live">Synthesizing</span>
				<span class="tile-sub" title={stats.ollama.inFlight.label}>{stats.ollama.inFlight.label} · {formatDuration(stats.ollama.inFlight.elapsedMs)} elapsed</span>
			{:else}
				<span class="tile-value">Idle</span>
				<span class="tile-sub">
					{#if stats.ollama.avgGenTokensPerSec !== null}
						~{stats.ollama.avgGenTokensPerSec.toFixed(1)} gen tok/s, ~{stats.ollama.avgPromptTokensPerSec?.toFixed(1) ?? '?'} prompt tok/s
					{:else}
						no throughput data yet
					{/if}
				</span>
			{/if}
		</div>
		<div class="tile">
			<span class="tile-label">Last direct-publish tick</span>
			<span class="tile-value">{stats.lastDirectCycle ? stats.lastDirectCycle.published : '—'}</span>
			<span class="tile-sub">{formatAgo(stats.lastDirectCycle?.at ?? null)}</span>
		</div>
		<div class="tile">
			<span class="tile-label">Last synthesis tick</span>
			<span class="tile-value">{stats.lastSynthesisCycle ? stats.lastSynthesisCycle.published : '—'}</span>
			<span class="tile-sub">{formatAgo(stats.lastSynthesisCycle?.at ?? null)}</span>
		</div>
	</div>
{/if}

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
	.dashboard {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 10px;
		margin-bottom: 16px;
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: var(--surface-1);
		border: 0.5px solid var(--border);
		border-radius: 12px;
		padding: 12px 14px;
	}
	.tile-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: var(--text-muted);
	}
	.tile-value {
		font-size: 20px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.tile-value.live {
		color: var(--text-accent);
	}
	.tile-sub {
		font-size: 11px;
		color: var(--text-secondary);
		line-height: 1.4;
	}

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
