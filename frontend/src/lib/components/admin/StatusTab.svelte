<script lang="ts">
	/**
	 * Status: is everything working? Failing sources first (with Poll now), then storyline
	 * grouping, storage, and the pipeline dashboard and log. The AI writer's tiles and history
	 * only appear while it's on.
	 */
	import type { AdminSettings, AdminSource, LogEntry } from '$lib/adminTypes';
	import { pollSourceNow } from '$lib/adminApi';
	import { relTime } from '$lib/text';
	import { admin } from '$lib/adminSession.svelte';
	import StorylinesTab from './StorylinesTab.svelte';
	import LogsTab from './LogsTab.svelte';

	let { settings, sources: initial, logs }: { settings: AdminSettings; sources: AdminSource[]; logs: LogEntry[] } = $props();

	// svelte-ignore state_referenced_locally
	let sources = $state([...initial]);
	let polling = $state<string | null>(null);
	const failing = $derived(sources.filter((s) => s.lastError));
	const paused = $derived(sources.filter((s) => !s.enabled));
	const TYPE_SHORT: Record<string, string> = { rss: 'RSS', api: 'API', youtube: 'YT', nitter: 'X', telegram: 'TG' };

	async function pollNow(s: AdminSource) {
		polling = s.id;
		try {
			const r = await pollSourceNow(s.id);
			sources = sources.map((x) => (x.id === s.id ? r.source : x));
		} finally {
			polling = null;
		}
	}

	const r = $derived(settings.retention);
	const capMB = $derived(r.storageCapValue * (r.storageCapUnit === 'GB' ? 1024 : 1));
</script>

<div class="adm">
	<div class="panel">
		<div class="ph">
			<span class="pt">Sources</span>
			<span class="sp"></span>
			<a href="/admin/settings?tab=sources">Sources &amp; columns →</a>
		</div>
		{#if failing.length === 0}
			<p class="hint"><span class="ok">✓</span> All {sources.length} sources polled without errors{paused.length ? ` · ${paused.length} paused` : ''}.</p>
		{:else}
			<p class="hint">{failing.length} of {sources.length} failing{paused.length ? ` · ${paused.length} paused` : ''}.</p>
			{#each failing as s (s.id)}
				<div class="fail">
					<div class="row">
						<span class="tb">{TYPE_SHORT[s.type] ?? s.type}</span>
						<b>{s.name}</b>
						<span class="sub small">{s.lastPolledAt ? `last tried ${relTime(s.lastPolledAt, Date.now())}` : ''}</span>
						<span class="sp"></span>
						<button class="ghost" onclick={() => pollNow(s)} disabled={polling === s.id}>{polling === s.id ? 'Polling…' : 'Poll now'}</button>
						<a class="ghost" href="/admin/settings?tab=sources&source={s.id}">Open</a>
					</div>
					<div class="errbox">{s.lastError}</div>
				</div>
			{/each}
		{/if}
	</div>

	<StorylinesTab {settings} section="status" />

	<div class="panel">
		<div class="ph"><span class="pt">Storage</span><span class="sp"></span><a href="/admin/settings?tab=storage">Retention →</a></div>
		<p class="hint">
			{r.storageUsedMB.toLocaleString()} MB used{r.storageCapEnabled ? ` of a ${r.storageCapValue} ${r.storageCapUnit} cap` : ', no cap set'}.
		</p>
		{#if r.storageCapEnabled}
			<div class="bar"><i style:width="{Math.min(100, (r.storageUsedMB / capMB) * 100)}%"></i></div>
		{/if}
	</div>

	<div class="panel">
		<div class="ph"><span class="pt">Pipeline and log</span></div>
		{#if !admin.aiWriterEnabled}<p class="hint">The AI writer is off, so only direct publishing runs.</p>{/if}
		<LogsTab {logs} aiOn={admin.aiWriterEnabled} />
	</div>
</div>

<style>
	.fail {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 0;
		border-top: 1px solid var(--bd);
	}
	.small {
		font-size: 12px;
	}
	a.ghost {
		display: inline-flex;
		align-items: center;
		text-decoration: none;
	}
	.bar {
		height: 6px;
		border-radius: 3px;
		background: var(--bd);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		background: var(--acc);
	}
</style>
