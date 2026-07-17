<script lang="ts">
	import type { AdminSource } from '$lib/adminTypes';
	import { addSource, deleteSource, updateSource, pollSourceNow } from '$lib/adminApi';

	let { sources: initial }: { sources: AdminSource[] } = $props();
	let sources = $state([...initial]);
	let showAdd = $state(false);
	let newSource = $state({ name: '', type: 'rss' as AdminSource['type'], url: '', category: '', pollIntervalMinutes: 15 });
	let pollingId = $state<string | null>(null);
	let justPolled = $state<{ id: string; count: number } | null>(null);

	async function handleAdd() {
		if (!newSource.name || !newSource.url) return;
		const created = await addSource({
			name: newSource.name,
			type: newSource.type,
			url: newSource.url,
			category: newSource.category ? [newSource.category] : [],
			pollIntervalMinutes: newSource.pollIntervalMinutes
		});
		sources = [...sources, created];
		newSource = { name: '', type: 'rss', url: '', category: '', pollIntervalMinutes: 15 };
		showAdd = false;
	}

	async function handleDelete(id: string) {
		await deleteSource(id);
		sources = sources.filter((s) => s.id !== id);
	}

	async function toggleEnabled(source: AdminSource) {
		const updated = await updateSource(source.id, { enabled: !source.enabled });
		sources = sources.map((s) => (s.id === source.id ? updated : s));
	}

	async function pollNow(source: AdminSource) {
		pollingId = source.id;
		justPolled = null;
		try {
			const { ingested, source: updated } = await pollSourceNow(source.id);
			sources = sources.map((s) => (s.id === source.id ? updated : s));
			justPolled = { id: source.id, count: ingested };
			setTimeout(() => {
				if (justPolled?.id === source.id) justPolled = null;
			}, 3000);
		} finally {
			pollingId = null;
		}
	}

	const typeIcon = (type: string) => (type === 'rss' ? '⟳' : type === 'telegram' ? '✈' : type === 'api' ? '⇄' : '•');
</script>

<div class="toolbar">
	<span class="count">{sources.length} sources</span>
	<button class="add-btn" onclick={() => (showAdd = !showAdd)}>+ Add source</button>
</div>

{#if showAdd}
	<div class="add-panel">
		<div class="add-grid">
			<input placeholder="Name" bind:value={newSource.name} />
			<select bind:value={newSource.type}>
				<option value="rss">RSS</option>
				<option value="api">API</option>
				<option value="telegram">Telegram</option>
				<option value="custom">Custom</option>
			</select>
			<input placeholder="URL or channel" bind:value={newSource.url} />
			<input placeholder="Category" bind:value={newSource.category} />
		</div>
		<div class="add-actions">
			<button onclick={() => (showAdd = false)}>Cancel</button>
			<button class="primary" onclick={handleAdd}>Add</button>
		</div>
	</div>
{/if}

<div class="list">
	<div class="row header">
		<span></span>
		<span>Name</span>
		<span>Type</span>
		<span>Category</span>
		<span>Poll</span>
		<span></span>
	</div>
	{#each sources as source (source.id)}
		<div class="row" class:disabled={!source.enabled}>
			<button
				class="type-icon"
				class:spinning={pollingId === source.id}
				onclick={() => pollNow(source)}
				disabled={pollingId === source.id}
				title="Poll now"
				aria-label={`Poll ${source.name} now`}
			>
				{typeIcon(source.type)}
			</button>
			<div>
				<div class="name">{source.name}</div>
				<div class="sub" class:error={source.lastError && !justPolled} class:success={justPolled?.id === source.id}>
					{#if justPolled?.id === source.id}
						{justPolled.count > 0 ? `✓ ${justPolled.count} new item(s)` : '✓ up to date, nothing new'}
					{:else if source.lastError}
						last poll failed · {source.lastError}
					{:else}
						{source.url}
					{/if}
				</div>
			</div>
			<span class="badge">{source.type.toUpperCase()}</span>
			<span class="cat">{source.category.join(', ')}</span>
			<span class="cat">{source.pollIntervalMinutes} min</span>
			<div class="actions">
				<button class="icon-btn" onclick={() => toggleEnabled(source)} title={source.enabled ? 'Disable' : 'Enable'}>
					{source.enabled ? '⏸' : '▶'}
				</button>
				<button class="icon-btn danger" onclick={() => handleDelete(source.id)} title="Delete">✕</button>
			</div>
		</div>
	{/each}
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}
	.count {
		font-size: 12px;
		color: var(--text-muted);
	}
	.add-btn {
		font-size: 12px;
		padding: 6px 12px;
	}
	.add-panel {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 14px;
		margin-bottom: 14px;
	}
	.add-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 8px;
		margin-bottom: 10px;
	}
	.add-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}
	.primary {
		background: var(--pill-bg);
		color: var(--pill-text);
		border-color: var(--pill-bg);
	}
	.list {
		display: flex;
		flex-direction: column;
	}
	.row {
		display: grid;
		grid-template-columns: 20px 1.4fr 0.7fr 0.9fr 0.7fr 60px;
		gap: 10px;
		padding: 10px;
		align-items: center;
		border-bottom: 0.5px solid var(--border);
	}
	.row.header {
		font-size: 11px;
		color: var(--text-muted);
		padding: 6px 10px;
	}
	.row.disabled {
		opacity: 0.5;
	}
	.type-icon {
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: 15px;
		cursor: pointer;
		padding: 2px;
		line-height: 1;
		border-radius: 4px;
	}
	.type-icon:hover:not(:disabled) {
		color: var(--text-accent);
		background: var(--bg-accent);
	}
	.type-icon.spinning {
		animation: spin 0.8s linear infinite;
		color: var(--text-accent);
	}
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	.name {
		font-size: 13px;
	}
	.sub {
		font-size: 11px;
		color: var(--text-muted);
	}
	.sub.error {
		color: var(--text-danger);
	}
	.sub.success {
		color: var(--text-success);
	}
	.badge {
		font-size: 11px;
		padding: 2px 8px;
		background: var(--surface-1);
		border-radius: var(--radius);
		width: fit-content;
	}
	.cat {
		font-size: 12px;
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		gap: 6px;
	}
	.icon-btn {
		font-size: 12px;
		padding: 3px 6px;
		background: transparent;
		border: none;
		color: var(--text-secondary);
	}
	.icon-btn.danger:hover {
		color: var(--text-danger);
	}
</style>
