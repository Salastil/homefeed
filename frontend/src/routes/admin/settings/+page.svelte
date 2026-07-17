<script lang="ts">
	import type { PageData } from './$types';
	import MergeTab from '$lib/components/admin/MergeTab.svelte';
	import SourcesTab from '$lib/components/admin/SourcesTab.svelte';
	import ModelsTab from '$lib/components/admin/ModelsTab.svelte';
	import RetentionTab from '$lib/components/admin/RetentionTab.svelte';
	import EventsTab from '$lib/components/admin/EventsTab.svelte';
	import ConnectionsTab from '$lib/components/admin/ConnectionsTab.svelte';
	import LogsTab from '$lib/components/admin/LogsTab.svelte';

	let { data }: { data: PageData } = $props();

	const tabs = [
		{ id: 'merge', label: 'Merge' },
		{ id: 'sources', label: 'Sources' },
		{ id: 'models', label: 'Models' },
		{ id: 'retention', label: 'Retention' },
		{ id: 'events', label: 'Tracked events' },
		{ id: 'connections', label: 'Connections' },
		{ id: 'logs', label: 'Logs' }
	];

	let active = $state('merge');
</script>

<div class="head">
	<span class="title">Admin</span>
	<nav class="tabs">
		{#each tabs as tab}
			<button class="tab" class:active={active === tab.id} onclick={() => (active = tab.id)}>
				{tab.label}
			</button>
		{/each}
	</nav>
</div>

<div class="content">
	{#if active === 'merge'}
		<MergeTab settings={data.settings} />
	{:else if active === 'sources'}
		<SourcesTab sources={data.sources} />
	{:else if active === 'models'}
		<ModelsTab settings={data.settings} models={data.models} aiStatus={data.aiStatus} />
	{:else if active === 'retention'}
		<RetentionTab settings={data.settings} />
	{:else if active === 'events'}
		<EventsTab events={data.events} sources={data.sources} />
	{:else if active === 'connections'}
		<ConnectionsTab settings={data.settings} aiStatus={data.aiStatus} />
	{:else if active === 'logs'}
		<LogsTab logs={data.logs} />
	{/if}
</div>

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 20px;
	}
	.title {
		font-family: var(--font-voice);
		font-size: 24px;
		font-weight: 500;
	}
	.tabs {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.tab {
		font-size: 12px;
		padding: 5px 12px;
		border: none;
		background: transparent;
		color: var(--text-secondary);
		border-radius: var(--radius);
	}
	.tab.active {
		background: var(--pill-bg);
		color: var(--pill-text);
	}
	.content {
		max-width: 720px;
	}
</style>
