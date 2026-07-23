<script lang="ts">
	import type { AdminTrackedEvent, AdminSource } from '$lib/adminTypes';
	import { addEvent, updateEvent, deleteEvent } from '$lib/adminApi';

	let { events: initial, sources }: { events: AdminTrackedEvent[]; sources: AdminSource[] } = $props();
	let events = $state([...initial]);
	let showAdd = $state(false);
	let newEvent = $state({ name: '', cadence: 'daily' as AdminTrackedEvent['cadence'], cadenceTime: '18:00' });

	let editingId = $state<string | null>(null);
	function emptyEditForm() {
		return {
			name: '',
			description: '',
			sourceIdSet: new Set<string>(),
			keywordsText: '',
			cadence: 'daily' as AdminTrackedEvent['cadence'],
			cadenceTime: '18:00',
			retentionOverrideDays: null as number | null
		};
	}
	let editForm = $state(emptyEditForm());

	function sourceNames(ids: string[]) {
		return ids.map((id) => sources.find((s) => s.id === id)?.name).filter(Boolean).join(', ') || 'No sources assigned';
	}

	async function handleAdd() {
		if (!newEvent.name) return;
		const created = await addEvent({
			name: newEvent.name,
			description: '',
			sourceIds: [],
			keywords: [],
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

	function startEdit(event: AdminTrackedEvent) {
		editingId = event.id;
		editForm = {
			name: event.name,
			description: event.description,
			sourceIdSet: new Set(event.sourceIds),
			keywordsText: event.keywords.join(', '),
			cadence: event.cadence,
			cadenceTime: event.cadenceTime ?? '18:00',
			retentionOverrideDays: event.retentionOverrideDays
		};
	}

	function cancelEdit() {
		editingId = null;
	}

	function toggleEditSource(id: string) {
		const next = new Set(editForm.sourceIdSet);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		editForm.sourceIdSet = next;
	}

	async function saveEdit() {
		if (!editingId || !editForm.name) return;
		const keywords = editForm.keywordsText
			.split(',')
			.map((k) => k.trim())
			.filter(Boolean);
		const updated = await updateEvent(editingId, {
			name: editForm.name,
			description: editForm.description,
			sourceIds: [...editForm.sourceIdSet],
			keywords,
			cadence: editForm.cadence,
			cadenceTime: editForm.cadence === 'daily' ? editForm.cadenceTime : null,
			retentionOverrideDays: editForm.retentionOverrideDays
		});
		events = events.map((e) => (e.id === editingId ? updated : e));
		editingId = null;
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
		<p class="hint">Assign sources and a keyword filter via Edit once created.</p>
	</div>
{/if}

<div class="list">
	{#each events as event (event.id)}
		{#if editingId === event.id}
			<div class="edit-panel">
				<div class="add-grid">
					<input placeholder="Event name" bind:value={editForm.name} />
					<select bind:value={editForm.cadence}>
						<option value="continuous">Continuous</option>
						<option value="daily">Daily</option>
						<option value="hourly">Hourly</option>
					</select>
					{#if editForm.cadence === 'daily'}
						<input type="text" placeholder="18:00" bind:value={editForm.cadenceTime} />
					{/if}
				</div>
				<textarea placeholder="Description (optional)" bind:value={editForm.description} rows="2"></textarea>

				<div class="field-label">Sources</div>
				<div class="source-checks">
					{#each sources as source (source.id)}
						<label class="source-check">
							<input
								type="checkbox"
								checked={editForm.sourceIdSet.has(source.id)}
								onchange={() => toggleEditSource(source.id)}
							/>
							{source.name}
						</label>
					{/each}
				</div>

				<div class="field-label">Keyword filter</div>
				<input placeholder="e.g. 🇮🇷, Tehran, IRGC" bind:value={editForm.keywordsText} />
				<p class="hint">
					Comma-separated words, phrases, or emoji — only items from the sources above whose
					title/summary/body contain at least one qualify for this event's recap. Leave blank to
					include everything from the assigned sources.
				</p>

				<div class="add-actions">
					<button onclick={cancelEdit}>Cancel</button>
					<button class="primary" onclick={saveEdit}>Save</button>
				</div>
			</div>
		{:else}
			<div class="row">
				<div>
					<div class="name">{event.name}</div>
					<div class="sub">
						{sourceNames(event.sourceIds)}
						{#if event.keywords.length > 0}
							· matching {event.keywords.map((k) => `"${k}"`).join(', ')}
						{/if}
						·
						{event.cadence === 'daily' ? `daily recap at ${event.cadenceTime}` : event.cadence}
					</div>
				</div>
				<span class="badge" class:active={event.active} onclick={() => toggleActive(event)} role="button" tabindex="0">
					{event.active ? 'Active' : 'Paused'}
				</span>
				<button class="icon-btn" onclick={() => startEdit(event)} title="Edit">Edit</button>
				<button class="icon-btn danger" onclick={() => handleDelete(event.id)} title="Delete">✕</button>
			</div>
		{/if}
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
	.icon-btn:hover {
		color: var(--text-accent);
	}
	.icon-btn.danger:hover {
		color: var(--text-danger);
	}
	.edit-panel {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 14px;
	}
	.edit-panel textarea {
		width: 100%;
		resize: vertical;
		font: inherit;
		margin-bottom: 10px;
	}
	.field-label {
		font-size: 11px;
		color: var(--text-muted);
		margin-bottom: 6px;
	}
	.source-checks {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 12px;
	}
	.source-check {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.source-check input {
		width: auto;
	}
	.edit-panel .hint {
		margin: 6px 0 10px;
	}
</style>
