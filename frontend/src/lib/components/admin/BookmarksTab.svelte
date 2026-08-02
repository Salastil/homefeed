<script lang="ts">
	import type { AdminBookmark } from '$lib/adminTypes';
	import { addBookmark, updateBookmark, deleteBookmark, updateSettings } from '$lib/adminApi';

	let { bookmarks: initial, columns: initialColumns }: { bookmarks: AdminBookmark[]; columns: 1 | 2 | 3 } = $props();
	let bookmarks = $state([...initial]);
	let columns = $state(initialColumns);
	let showAdd = $state(false);
	let newBookmark = $state({ name: '', url: '', isPrivate: false });

	async function setColumns(n: 1 | 2 | 3) {
		columns = n;
		await updateSettings({ bookmarksColumns: n });
	}

	const columnOptions: (1 | 2 | 3)[] = [1, 2, 3];

	let editingId = $state<string | null>(null);
	let editForm = $state({ name: '', url: '' });

	async function handleAdd() {
		if (!newBookmark.name.trim() || !newBookmark.url.trim()) return;
		const created = await addBookmark(newBookmark.name.trim(), newBookmark.url.trim(), newBookmark.isPrivate);
		bookmarks = [...bookmarks, created];
		newBookmark = { name: '', url: '', isPrivate: false };
		showAdd = false;
	}

	async function togglePrivate(bookmark: AdminBookmark) {
		const updated = await updateBookmark(bookmark.id, { isPrivate: !bookmark.isPrivate });
		bookmarks = bookmarks.map((b) => (b.id === bookmark.id ? updated : b));
	}

	async function handleDelete(id: string) {
		await deleteBookmark(id);
		bookmarks = bookmarks.filter((b) => b.id !== id);
	}

	function startEdit(bookmark: AdminBookmark) {
		editingId = bookmark.id;
		editForm = { name: bookmark.name, url: bookmark.url };
	}

	function cancelEdit() {
		editingId = null;
	}

	async function saveEdit() {
		if (!editingId || !editForm.name.trim() || !editForm.url.trim()) return;
		const updated = await updateBookmark(editingId, { name: editForm.name.trim(), url: editForm.url.trim() });
		bookmarks = bookmarks.map((b) => (b.id === editingId ? updated : b));
		editingId = null;
	}
</script>

<div class="toolbar">
	<span class="count">{bookmarks.length} bookmarks</span>
	<div class="columns-picker">
		<span class="field-label">Columns</span>
		<div class="pill-row">
			{#each columnOptions as n}
				<button class="pill" class:active={columns === n} onclick={() => setColumns(n)}>{n}</button>
			{/each}
		</div>
	</div>
	<button class="add-btn" onclick={() => (showAdd = !showAdd)}>+ New bookmark</button>
</div>

{#if showAdd}
	<div class="add-panel">
		<div class="add-grid">
			<input placeholder="Name, e.g. Weather.gov" bind:value={newBookmark.name} />
			<input placeholder="https://example.com" bind:value={newBookmark.url} />
		</div>
		<label class="private-toggle">
			<input type="checkbox" bind:checked={newBookmark.isPrivate} />
			Private
		</label>
		<div class="add-actions">
			<button onclick={() => (showAdd = false)}>Cancel</button>
			<button class="primary" onclick={handleAdd}>Create</button>
		</div>
	</div>
{/if}

<div class="list">
	{#each bookmarks as bookmark (bookmark.id)}
		{#if editingId === bookmark.id}
			<div class="edit-panel">
				<div class="add-grid">
					<input placeholder="Name" bind:value={editForm.name} />
					<input placeholder="URL" bind:value={editForm.url} />
				</div>
				<div class="add-actions">
					<button onclick={cancelEdit}>Cancel</button>
					<button class="primary" onclick={saveEdit}>Save</button>
				</div>
			</div>
		{:else}
			<div class="row">
				<div>
					<div class="name">{bookmark.name}</div>
					<div class="sub">{bookmark.url}</div>
				</div>
				<label class="private-toggle">
					<input type="checkbox" checked={bookmark.isPrivate} onchange={() => togglePrivate(bookmark)} />
					Private
				</label>
				<button class="icon-btn" onclick={() => startEdit(bookmark)} title="Edit">Edit</button>
				<button class="icon-btn danger" onclick={() => handleDelete(bookmark.id)} title="Delete">✕</button>
			</div>
		{/if}
	{/each}
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 12px;
	}
	.count {
		font-size: 12px;
		color: var(--text-muted);
	}
	.columns-picker {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.field-label {
		font-size: 11px;
		color: var(--text-muted);
	}
	.pill-row {
		display: flex;
		gap: 6px;
	}
	.pill {
		font-size: 12px;
		padding: 4px 10px;
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
	.private-toggle {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--text-secondary);
		white-space: nowrap;
		margin-bottom: 10px;
	}
	.private-toggle input {
		width: auto;
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 320px;
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
</style>
