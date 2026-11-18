<script lang="ts">
	/**
	 * The admin panel (issue #1, admin rework): four groups in a sidebar - Feeds (what comes
	 * in), Screen (what the board shows), Processing (how items become stories), System (is it
	 * healthy and wired up). ?tab=<id> picks the page, so the ⌘K palette and other pages can
	 * link straight to one; the tab ids of the old ten-tab layout still resolve.
	 */
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import { getEvents, getSettings, getSources } from '$lib/adminApi';
	import { admin } from '$lib/adminSession.svelte';
	import SourcesMap from '$lib/components/admin/SourcesMap.svelte';
	import EventsTab from '$lib/components/admin/EventsTab.svelte';
	import BoardTab from '$lib/components/admin/BoardTab.svelte';
	import StorylinesTab from '$lib/components/admin/StorylinesTab.svelte';
	import WidgetsTab from '$lib/components/admin/WidgetsTab.svelte';
	import EmbeddingsTab from '$lib/components/admin/EmbeddingsTab.svelte';
	import AiWriterTab from '$lib/components/admin/AiWriterTab.svelte';
	import StatusTab from '$lib/components/admin/StatusTab.svelte';
	import ConnectionsTab from '$lib/components/admin/ConnectionsTab.svelte';
	import RetentionTab from '$lib/components/admin/RetentionTab.svelte';
	import BackupTab from '$lib/components/admin/BackupTab.svelte';

	let { data }: { data: PageData } = $props();

	const GROUPS = [
		{ name: 'Feeds', pages: [{ id: 'sources', label: 'Sources & columns' }, { id: 'events', label: 'Tracked items' }] },
		{
			name: 'Screen',
			pages: [
				{ id: 'board', label: 'Board columns' },
				{ id: 'panel', label: 'Storyline panel' },
				{ id: 'widgets', label: 'Widgets' }
			]
		},
		{
			name: 'Processing',
			pages: [
				{ id: 'embeddings', label: 'Embeddings & tags' },
				{ id: 'storylines', label: 'Storylines' },
				{ id: 'ai', label: 'AI writer' }
			]
		},
		{
			name: 'System',
			pages: [
				{ id: 'status', label: 'Status' },
				{ id: 'connections', label: 'Connections' },
				{ id: 'storage', label: 'Storage' },
				{ id: 'backup', label: 'Backup' }
			]
		}
	];
	const IDS = new Set(GROUPS.flatMap((g) => g.pages.map((p) => p.id)));
	const LEGACY: Record<string, string> = { merge: 'sources', models: 'ai', retention: 'storage', logs: 'status' };
	const WIDE = new Set(['sources', 'board', 'ai', 'status']);

	const active = $derived.by(() => {
		const t = $page.url.searchParams.get('tab') ?? '';
		const id = LEGACY[t] ?? t;
		return IDS.has(id) ? id : 'sources';
	});

	// Pages read their settings once when they open, so each switch re-reads what other pages
	// (or the board's edit mode) may have changed meanwhile.
	// svelte-ignore state_referenced_locally
	let settings = $state(data.settings);
	// svelte-ignore state_referenced_locally
	let sources = $state(data.sources);
	// svelte-ignore state_referenced_locally
	let events = $state(data.events);
	let shown = $state<string | null>(null);
	let first = true;
	$effect(() => {
		const id = active;
		if (first) {
			first = false;
			shown = id;
			return;
		}
		Promise.all([getSettings(), getSources(), getEvents()])
			.then(([s, src, ev]) => {
				settings = s;
				sources = src;
				events = ev;
			})
			.catch(() => {})
			.finally(() => (shown = id));
	});
	$effect(() => {
		admin.valid = true;
		admin.aiWriterEnabled = settings.aiWriterEnabled;
	});

	const failing = $derived(sources.filter((s) => s.lastError).length);
</script>

<svelte:head><title>Admin · Homefeed</title></svelte:head>

<div class="shell">
	<nav class="side" aria-label="Admin pages">
		<span class="title">Admin</span>
		{#each GROUPS as g (g.name)}
			<span class="gh">{g.name}</span>
			{#each g.pages as p (p.id)}
				<a href="?tab={p.id}" class:on={active === p.id} aria-current={active === p.id ? 'page' : undefined}>
					{p.label}
					{#if p.id === 'sources' && failing}<span class="badge bad">{failing} failing</span>{/if}
					{#if p.id === 'ai'}<span class="badge">{admin.aiWriterEnabled ? 'on' : 'off'}</span>{/if}
				</a>
			{/each}
		{/each}
		<span class="tip">Signed in here, the board gets an Edit button and <kbd>Ctrl</kbd> <kbd>K</kbd> finds any setting.</span>
	</nav>

	<div class="content" class:wide={WIDE.has(active)}>
		{#if shown !== active}
			<p class="checking">Loading…</p>
		{:else if active === 'sources'}
			<SourcesMap />
		{:else if active === 'events'}
			<StorylinesTab {settings} section="events" />
			<EventsTab {events} {sources} />
		{:else if active === 'board'}
			<BoardTab />
		{:else if active === 'panel'}
			<StorylinesTab {settings} section="panel" />
		{:else if active === 'widgets'}
			<WidgetsTab
				{settings}
				stockTickers={data.stockTickers}
				stocksConfig={data.stocksConfig}
				bookmarks={data.bookmarks}
				bookmarksConfig={data.bookmarksConfig}
				poe2Watchlist={data.poe2Watchlist}
				weatherConfig={data.weatherConfig}
				poe2={data.poe2}
				installedWidgets={data.installedWidgets}
			/>
		{:else if active === 'storylines'}
			<StorylinesTab {settings} section="pipeline" />
		{:else if active === 'embeddings' || active === 'ai' || active === 'connections'}
			<!-- The AI server's answer is deliberately not awaited by the page load (an unreachable
			     host takes seconds to time out), so these pages wait for it themselves. -->
			{#await Promise.all([data.models, data.aiStatus])}
				<p class="checking">Checking the AI servers…</p>
			{:then [models, aiStatus]}
				{#if active === 'embeddings'}
					<EmbeddingsTab {settings} {models} {aiStatus} />
				{:else if active === 'ai'}
					<AiWriterTab {settings} {models} {aiStatus} />
				{:else}
					<ConnectionsTab {settings} telegramStatus={data.telegramStatus} {aiStatus} />
				{/if}
			{/await}
		{:else if active === 'status'}
			<StatusTab {settings} {sources} logs={data.logs} />
		{:else if active === 'storage'}
			<RetentionTab {settings} />
		{:else if active === 'backup'}
			<BackupTab />
		{/if}
	</div>
</div>

<style>
	.shell {
		display: flex;
		flex-wrap: wrap;
		gap: 28px;
		align-items: flex-start;
	}
	.side {
		flex: 1 1 190px;
		max-width: 220px;
		position: sticky;
		top: 16px;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.title {
		font-family: var(--serif);
		font-size: 24px;
		font-weight: 500;
		padding: 0 10px 6px;
	}
	.gh {
		font-size: 10.5px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--tx2);
		padding: 14px 10px 4px;
	}
	.side a {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border-radius: 7px;
		color: var(--tx2);
		font-size: 13px;
		text-decoration: none;
	}
	.side a:hover {
		background: var(--s1);
		color: var(--tx);
	}
	.side a.on {
		background: var(--s1);
		color: var(--tx);
		box-shadow: inset 2px 0 0 var(--acc);
	}
	.badge {
		margin-left: auto;
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--tx2);
		border: 1px solid var(--bd);
		border-radius: 4px;
		padding: 0 5px;
	}
	.badge.bad {
		color: var(--dn);
		border-color: transparent;
	}
	.tip {
		margin-top: 22px;
		padding: 0 10px;
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--tx2);
	}
	.content {
		flex: 999 1 560px;
		min-width: 0;
		max-width: 760px;
	}
	.content.wide {
		max-width: none;
	}
	.checking {
		color: var(--tx2);
		font-size: 13px;
		padding: 24px 0;
	}
	@media (max-width: 760px) {
		.side {
			position: static;
			max-width: none;
		}
	}
</style>
