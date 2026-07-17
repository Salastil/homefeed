<script lang="ts">
	import type { AdminTrackedEvent, AdminSource } from '$lib/adminTypes';
	import { addEvent, updateEvent, deleteEvent } from '$lib/adminApi';

	let { events: initial, sources }: { events: AdminTrackedEvent[]; sources: AdminSource[] } = $props();
	let events = $state([...initial]);
	let showAdd = $state(false);
	let newEvent = $state({ name: '', cadence: 'daily' as AdminTrackedEvent['cadence'], cadenceTime: '18:00' });

	function sourceNames(ids: string[]) {
		return ids.map((id) => sources.find((s) => s.id === id)?.name).filter(Boolean).join(', ') || 'No sources assigned';
	}

	async function handleAdd() {
		if (!newEvent.name) return;
		const created = await addEvent({
			name: newEvent.name,
			description: '',
			sourceIds: [],
			cadence: newEvent.cadence,
			cadenceTime: newEvent.cadence === 'daily' ? newEvent.cadenceTime : null,
			retentionOverrideDays: null
		});
		events = [...events, created];
		newEvent = { name: '', cadence: 'daily', cadenceTime: '18:00' };
		showAdd = false;
	}

	async function toggleActive(event: AdminTrackedEvent) {
		const updated = await updateEvent(event.id, { active: !event.active });
		events = events.map((e) => (e.id === event.id ? updated : e));
	}

	async function handleDelete(id: string) {
		await deleteEvent(id);
		events = events.filter((e) => e.id !== id);
	}
</script>

<div class="toolbar">
	<span class="count">{events.length} tracked events</span>
	<button class="add-btn" onclick={() => (showAdd = !showAdd)}>+ New event</button>
</div>

{#if showAdd}
	<div class="add-panel">
		<div class="add-grid">
			<input placeholder="Event name (e.g. Iran war)" bind:value={newEvent.name} />
			<select bind:value={newEvent.cadence}>
				<option value="continuous">Continuous</option>
				<option value="daily">Daily</option>
				<option value="hourly">Hourly</option>
			</select>
			{#if newEvent.cadence === 'daily'}
				<input type="text" placeholder="18:00" bind:value={newEvent.cadenceTime} />
			{/if}
		</div>
		<div class="add-actions">
			<button onclick={() => (showAdd = false)}>Cancel</button>
			<button class="primary" onclick={handleAdd}>Create</button>
		</div>
		<p class="hint">Assign sources to this event from the Sources tab once created.</p>
	</div>
{/if}

<div class="list">
	{#each events as event (event.id)}
		<div class="row">
			<div>
				<div class="name">{event.name}</div>
				<div class="sub">
					{sourceNames(event.sourceIds)} ·
					{event.cadence === 'daily' ? `daily recap at ${event.cadenceTime}` : event.cadence}
				</div>
			</div>
			<span class="badge" class:active={event.active} onclick={() => toggleActive(event)} role="button" tabindex="0">
				{event.active ? 'Active' : 'Paused'}
			</span>
			<button class="icon-btn danger" onclick={() => handleDelete(event.id)} title="Delete">✕</button>
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
		margin-bottom: 6px;
	}
	.primary {
		background: var(--pill-bg);
		color: var(--pill-text);
		border-color: var(--pill-bg);
	}
	.hint {
		font-size: 11px;
		color: var(--text-muted);
		margin: 0;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		background: var(--surface-1);
		border-radius: var(--radius);
		padding: 10px 14px;
	}
	.name {
		font-size: 13px;
		font-weight: 500;
	}
	.sub {
		font-size: 11px;
		color: var(--text-muted);
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
