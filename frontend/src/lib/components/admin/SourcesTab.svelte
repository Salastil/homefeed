<script lang="ts">
	import type { AdminSource, CategoryPriority } from '$lib/adminTypes';
	import { addSource, deleteSource, updateSource, pollSourceNow, clearSourceContent, reissueSourceContent } from '$lib/adminApi';

	let { sources: initial, categories }: { sources: AdminSource[]; categories: CategoryPriority[] } = $props();
	let sources = $state([...initial]);
	let showAdd = $state(false);
	let editingId = $state<string | null>(null);
	let pollingId = $state<string | null>(null);
	let clearingId = $state<string | null>(null);
	let reissuingId = $state<string | null>(null);
	let justPolled = $state<{ id: string; count: number } | null>(null);
	let justCleared = $state<{ id: string; items: number; articles: number } | null>(null);
	let justReissued = $state<{ id: string; articles: number; items: number } | null>(null);

	// "Top stories" isn't a real filterable tag — it's the homepage's all-categories,
	// chronological view (see /api/feed's no-filter default and +layout.svelte's nav
	// mapping). Assigning it to a source is the exact miscategorization this list is
	// meant to prevent — general news belongs under "News" instead.
	const assignableCategories = $derived(categories.filter((c) => c.name.toLowerCase() !== 'top stories'));

	function emptyForm() {
		return {
			name: '',
			type: 'rss' as AdminSource['type'],
			url: '',
			channelId: '',
			categorySet: new Set<string>(),
			pollIntervalMinutes: 15,
			pushToTopStories: false
		};
	}

	let form = $state(emptyForm());

	function startAdd() {
		form = emptyForm();
		editingId = null;
		showAdd = true;
	}

	function startEdit(source: AdminSource) {
		form = {
			name: source.name,
			type: source.type,
			url: source.type === 'youtube' ? '' : source.url,
			channelId: source.type === 'youtube' ? (source.url || (source.config?.channelId as string) || '') : '',
			categorySet: new Set(source.category),
			pollIntervalMinutes: source.pollIntervalMinutes,
			pushToTopStories: source.pushToTopStories
		};
		editingId = source.id;
		showAdd = true;
	}

	function cancelForm() {
		showAdd = false;
		editingId = null;
	}

	function toggleCategory(name: string) {
		const next = new Set(form.categorySet);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		form.categorySet = next;
	}

	function buildPayload(): Partial<AdminSource> {
		const category = [...form.categorySet];
		if (form.type === 'youtube') {
			return {
				name: form.name,
				type: form.type,
				url: form.channelId,
				category,
				pollIntervalMinutes: form.pollIntervalMinutes,
				pushToTopStories: form.pushToTopStories
			};
		}
		return {
			name: form.name,
			type: form.type,
			url: form.url,
			category,
			pollIntervalMinutes: form.pollIntervalMinutes,
			pushToTopStories: form.pushToTopStories
		};
	}

	async function handleSubmit() {
		if (!form.name || (form.type === 'youtube' ? !form.channelId : !form.url)) return;
		if (editingId) {
			const updated = await updateSource(editingId, buildPayload());
			sources = sources.map((s) => (s.id === editingId ? updated : s));
		} else {
			const created = await addSource(buildPayload());
			sources = [...sources, created];
		}
		cancelForm();
	}

	async function handleDelete(id: string) {
		if (!confirm('Delete this source? All of its ingested content (and any article made up entirely of it) will be deleted too.')) return;
		await deleteSource(id);
		sources = sources.filter((s) => s.id !== id);
	}

	async function handleClearContent(source: AdminSource) {
		if (!confirm(`Clear all ingested content for "${source.name}" so it can be repopulated fresh? The source itself stays.`)) return;
		clearingId = source.id;
		justCleared = null;
		try {
			const { itemsDeleted, articlesDeleted } = await clearSourceContent(source.id);
			justCleared = { id: source.id, items: itemsDeleted, articles: articlesDeleted };
			setTimeout(() => {
				if (justCleared?.id === source.id) justCleared = null;
			}, 4000);
		} finally {
			clearingId = null;
		}
	}

	async function handleReissue(source: AdminSource) {
		if (
			!confirm(
				`Republish "${source.name}"'s content fresh? Its already-published articles will be deleted and rebuilt from the same raw items using the current pipeline — nothing is re-fetched from the feed. Articles merged with other sources are left alone.`
			)
		)
			return;
		reissuingId = source.id;
		justReissued = null;
		try {
			const { articlesDeleted, itemsRequeued } = await reissueSourceContent(source.id);
			justReissued = { id: source.id, articles: articlesDeleted, items: itemsRequeued };
			setTimeout(() => {
				if (justReissued?.id === source.id) justReissued = null;
			}, 4000);
		} finally {
			reissuingId = null;
		}
	}

	async function toggleEnabled(source: AdminSource) {
		const updated = await updateSource(source.id, { enabled: !source.enabled });
		sources = sources.map((s) => (s.id === source.id ? updated : s));
	}

	async function toggleTopStories(source: AdminSource) {
		const updated = await updateSource(source.id, { pushToTopStories: !source.pushToTopStories });
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

	const typeIcon = (type: string) =>
		type === 'rss'
			? '⟳'
			: type === 'telegram'
				? '✈'
				: type === 'youtube'
					? '▶'
					: type === 'nitter'
						? '🐦'
						: type === 'api'
							? '⇄'
							: '•';
</script>

<div class="toolbar">
	<span class="count">{sources.length} sources</span>
	<button class="add-btn" onclick={() => (showAdd ? cancelForm() : startAdd())}>
		{showAdd ? 'Cancel' : '+ Add source'}
	</button>
</div>

{#if showAdd}
	<div class="add-panel">
		<div class="add-grid">
			<input placeholder="Name" bind:value={form.name} />
			<select bind:value={form.type}>
				<option value="rss">RSS</option>
				<option value="api">API</option>
				<option value="telegram">Telegram</option>
				<option value="youtube">YouTube</option>
				<option value="nitter">Nitter</option>
				<option value="custom">Custom</option>
			</select>
			{#if form.type === 'youtube'}
				<input placeholder="Channel URL (@handle or /channel/UC…), or channel ID" bind:value={form.channelId} />
			{:else if form.type === 'nitter'}
				<input placeholder="Nitter list/user RSS feed URL" bind:value={form.url} />
			{:else}
				<input placeholder="URL or channel" bind:value={form.url} />
			{/if}
			<select bind:value={form.pollIntervalMinutes}>
				<option value={5}>Every 5 minutes</option>
				<option value={15}>Every 15 minutes</option>
				<option value={60}>Every hour</option>
			</select>
		</div>
		<div class="categories-label">Categories</div>
		<div class="category-checks">
			{#each assignableCategories as cat (cat.id)}
				<label class="category-check">
					<input type="checkbox" checked={form.categorySet.has(cat.name)} onchange={() => toggleCategory(cat.name)} />
					{cat.name}
				</label>
			{/each}
		</div>
		<label class="top-stories-check">
			<input type="checkbox" bind:checked={form.pushToTopStories} />
			Push to Top Stories?
			<span class="hint">Off by default — keeps the homepage from being flooded by every source.</span>
		</label>
		<div class="add-actions">
			<button onclick={cancelForm}>Cancel</button>
			<button class="primary" onclick={handleSubmit}>{editingId ? 'Save' : 'Add'}</button>
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
				{#if justCleared?.id === source.id || justReissued?.id === source.id || justPolled?.id === source.id || source.lastError}
					<div
						class="sub"
						class:error={source.lastError && !justPolled && !justCleared && !justReissued}
						class:success={justPolled?.id === source.id || justCleared?.id === source.id || justReissued?.id === source.id}
					>
						{#if justCleared?.id === source.id}
							✓ cleared {justCleared.items} item(s), {justCleared.articles} article(s)
						{:else if justReissued?.id === source.id}
							✓ deleted {justReissued.articles} article(s), requeued {justReissued.items} item(s) — republishing within ~1 min
						{:else if justPolled?.id === source.id}
							{justPolled.count > 0 ? `✓ ${justPolled.count} new item(s)` : '✓ up to date, nothing new'}
						{:else if source.lastError}
							last poll failed · {source.lastError}
						{/if}
					</div>
				{/if}
			</div>
			<span class="badge">{source.type.toUpperCase()}</span>
			<span class="cat">{source.category.join(', ')}</span>
			<span class="cat">{source.pollIntervalMinutes} min</span>
			<div class="actions">
				<button
					class="icon-btn"
					class:starred={source.pushToTopStories}
					onclick={() => toggleTopStories(source)}
					title={source.pushToTopStories ? 'Pushing to Top Stories — click to stop' : 'Not pushed to Top Stories — click to enable'}
				>
					{source.pushToTopStories ? '★' : '☆'}
				</button>
				<button class="icon-btn" onclick={() => startEdit(source)} title="Edit">✎</button>
				<button class="icon-btn" onclick={() => toggleEnabled(source)} title={source.enabled ? 'Disable' : 'Enable'}>
					{source.enabled ? '⏸' : '▶'}
				</button>
				<button
					class="icon-btn"
					onclick={() => handleClearContent(source)}
					disabled={clearingId === source.id}
					title="Clear content (keep source)"
				>
					⟲
				</button>
				<button
					class="icon-btn"
					onclick={() => handleReissue(source)}
					disabled={reissuingId === source.id}
					title="Reissue: delete published articles and republish from the same raw items"
				>
					🔁
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
	.categories-label {
		font-size: 11px;
		color: var(--text-muted);
		margin-bottom: 6px;
	}
	.category-checks {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 12px;
	}
	.category-check {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.category-check input {
		width: auto;
	}
	.top-stories-check {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 12px;
		color: var(--text-secondary);
		margin-bottom: 12px;
	}
	.top-stories-check input {
		width: auto;
	}
	.top-stories-check .hint {
		font-size: 11px;
		color: var(--text-muted);
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
		grid-template-columns: 20px 1.4fr 0.7fr 0.9fr 0.7fr 120px;
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
		gap: 4px;
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
	.icon-btn.starred {
		color: var(--text-accent);
	}
</style>
