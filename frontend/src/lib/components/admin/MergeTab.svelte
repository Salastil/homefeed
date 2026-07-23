<script lang="ts">
	import type { AdminSettings } from '$lib/adminTypes';
	import { updateSettings, createCategory, deleteCategory } from '$lib/adminApi';
	import SaveStatus from './SaveStatus.svelte';

	let { settings }: { settings: AdminSettings } = $props();

	let local = $state({ ...settings, categoryPriority: [...settings.categoryPriority] });
	let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveTimer: ReturnType<typeof setTimeout>;
	let newCategoryName = $state('');
	let newCategoryPrivate = $state(false);
	let addingCategory = $state(false);

	function scheduleSave() {
		status = 'saving';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			try {
				await updateSettings({
					mergeStrictness: local.mergeStrictness,
					defaultPollIntervalMinutes: local.defaultPollIntervalMinutes,
					holdBeforePublishMinutes: local.holdBeforePublishMinutes,
					followUpMinHoursSinceLast: local.followUpMinHoursSinceLast,
					followUpMinNewSources: local.followUpMinNewSources,
					tagDedupThreshold: local.tagDedupThreshold,
					tagExpiryDays: local.tagExpiryDays,
					categoryPriority: local.categoryPriority
				});
				status = 'saved';
				setTimeout(() => (status = 'idle'), 1500);
			} catch {
				status = 'error';
			}
		}, 500);
	}

	async function addCategory() {
		const name = newCategoryName.trim();
		if (!name) return;
		addingCategory = true;
		try {
			const created = await createCategory(name, newCategoryPrivate);
			local.categoryPriority = [...local.categoryPriority, created];
			newCategoryName = '';
			newCategoryPrivate = false;
		} finally {
			addingCategory = false;
		}
	}

	function togglePrivate(id: string) {
		local.categoryPriority = local.categoryPriority.map((c) => (c.id === id ? { ...c, isPrivate: !c.isPrivate } : c));
		scheduleSave();
	}

	async function removeCategory(id: string, isDefault: boolean, name: string) {
		if (isDefault) {
			// Sensible-default categories can still be removed — e.g. a fresh install's
			// Business/Culture defaults aren't everyone's interest — just a lighter check.
			const confirmed = confirm(`Remove "${name}"? Sources already tagged with it will keep the label but stop appearing under a nav tab.`);
			if (!confirmed) return;
		}
		await deleteCategory(id);
		local.categoryPriority = local.categoryPriority.filter((c) => c.id !== id);
	}

	function move(index: number, dir: -1 | 1) {
		const target = index + dir;
		if (target < 0 || target >= local.categoryPriority.length) return;
		const arr = [...local.categoryPriority];
		[arr[index], arr[target]] = [arr[target], arr[index]];
		arr.forEach((c, i) => (c.priorityRank = i + 1));
		local.categoryPriority = arr;
		scheduleSave();
	}
</script>

<div class="panel">
	<div class="head">
		<span class="panel-title">Merge strictness</span>
		<SaveStatus {status} />
	</div>
	<p class="hint">How similar articles must be before they're combined into one story.</p>
	<div class="slider-row">
		<span class="end">Loose</span>
		<input
			type="range"
			min="1"
			max="5"
			step="1"
			bind:value={local.mergeStrictness}
			oninput={scheduleSave}
		/>
		<span class="end">Strict</span>
		<span class="value">{local.mergeStrictness}</span>
	</div>
</div>

<div class="grid-2">
	<div class="panel">
		<span class="panel-title">Poll interval</span>
		<p class="hint">How often each source is checked for new items.</p>
		<select bind:value={local.defaultPollIntervalMinutes} onchange={scheduleSave}>
			<option value={5}>Every 5 minutes</option>
			<option value={15}>Every 15 minutes</option>
			<option value={60}>Every hour</option>
		</select>
	</div>
	<div class="panel">
		<span class="panel-title">Hold before publish</span>
		<p class="hint">Wait window to gather more sources before finalizing a story.</p>
		<select bind:value={local.holdBeforePublishMinutes} onchange={scheduleSave}>
			<option value={0}>Publish immediately</option>
			<option value={30}>Wait 30 minutes</option>
			<option value={120}>Wait 2 hours</option>
		</select>
	</div>
</div>

<div class="panel">
	<span class="panel-title">Follow-up articles</span>
	<p class="hint">
		Instead of editing a published article, a distinct follow-up is created once enough new
		corroborating sources arrive after enough time has passed.
	</p>
	<div class="grid-2">
		<div>
			<label class="field-label" for="followup-hours">Minimum time since last article</label>
			<select id="followup-hours" bind:value={local.followUpMinHoursSinceLast} onchange={scheduleSave}>
				<option value={1}>1 hour</option>
				<option value={6}>6 hours</option>
				<option value={12}>12 hours</option>
				<option value={24}>24 hours</option>
			</select>
		</div>
		<div>
			<label class="field-label" for="followup-sources">Minimum new sources</label>
			<select id="followup-sources" bind:value={local.followUpMinNewSources} onchange={scheduleSave}>
				<option value={1}>1</option>
				<option value={2}>2</option>
				<option value={3}>3</option>
				<option value={4}>4</option>
			</select>
		</div>
	</div>
</div>

<div class="panel">
	<span class="panel-title">Category priority</span>
	<p class="hint">
		Synthesis queue processes higher-ranked categories first. Nothing is dropped — lower
		categories just wait longer when the queue is busy. This list also drives the site's nav —
		remove anything you're not interested in (Business, Culture, etc.) or add your own. A
		private category (and everything in it) is hidden from the public site until a visitor
		logs in with the lock icon in the masthead.
	</p>
	<div class="priority-list">
		{#each local.categoryPriority as cat, i (cat.id)}
			<div class="priority-row">
				<span class="rank">{i + 1}</span>
				<span class="name">{cat.name}</span>
				{#if cat.name.toLowerCase() !== 'top stories'}
					<label class="private-toggle">
						<input type="checkbox" checked={cat.isPrivate} onchange={() => togglePrivate(cat.id)} />
						Private
					</label>
				{/if}
				<button class="icon-btn" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">▲</button>
				<button
					class="icon-btn"
					onclick={() => move(i, 1)}
					disabled={i === local.categoryPriority.length - 1}
					aria-label="Move down">▼</button
				>
				{#if cat.name.toLowerCase() !== 'top stories'}
					<button class="icon-btn danger" onclick={() => removeCategory(cat.id, cat.isDefault, cat.name)} aria-label={`Remove ${cat.name}`}
						>✕</button
					>
				{/if}
			</div>
		{/each}
	</div>
	<div class="add-row">
		<input
			type="text"
			placeholder="New category name"
			bind:value={newCategoryName}
			onkeydown={(e) => e.key === 'Enter' && addCategory()}
		/>
		<label class="private-toggle">
			<input type="checkbox" bind:checked={newCategoryPrivate} />
			Private
		</label>
		<button onclick={addCategory} disabled={addingCategory || !newCategoryName.trim()}>
			{addingCategory ? 'Adding…' : '+ Add'}
		</button>
	</div>
</div>

<div class="panel">
	<span class="panel-title">Tags</span>
	<div class="grid-2">
		<div>
			<label class="field-label" for="dedup">Tag dedup threshold</label>
			<div class="slider-row">
				<input
					id="dedup"
					type="range"
					min="0.5"
					max="0.99"
					step="0.01"
					bind:value={local.tagDedupThreshold}
					oninput={scheduleSave}
				/>
				<span class="value">{local.tagDedupThreshold.toFixed(2)}</span>
			</div>
		</div>
		<div>
			<label class="field-label" for="expiry">Tag expiry</label>
			<select id="expiry" bind:value={local.tagExpiryDays} onchange={scheduleSave}>
				<option value={7}>7 days</option>
				<option value={21}>21 days</option>
				<option value={60}>60 days</option>
			</select>
		</div>
	</div>
</div>

<style>
	.panel {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 16px;
		margin-bottom: 14px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}
	.panel-title {
		font-size: 13px;
		font-weight: 500;
	}
	.hint {
		font-size: 12px;
		color: var(--text-secondary);
		margin: 4px 0 12px;
	}
	.slider-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.slider-row input[type='range'] {
		flex: 1;
		border: none;
		padding: 0;
		background: transparent;
	}
	.end {
		font-size: 11px;
		color: var(--text-muted);
	}
	.value {
		font-size: 13px;
		font-weight: 500;
		min-width: 32px;
		text-align: right;
	}
	.grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.field-label {
		display: block;
		font-size: 11px;
		color: var(--text-muted);
		margin-bottom: 6px;
	}
	select {
		width: 100%;
	}
	.priority-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.priority-row {
		display: flex;
		align-items: center;
		gap: 10px;
		background: var(--surface-2);
		border-radius: var(--radius);
		padding: 8px 12px;
	}
	.rank {
		font-size: 11px;
		color: var(--text-muted);
		width: 16px;
	}
	.private-toggle {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.private-toggle input {
		width: auto;
	}
	.name {
		font-size: 13px;
		flex: 1;
	}
	.icon-btn {
		font-size: 11px;
		padding: 2px 6px;
		background: transparent;
		border: none;
		color: var(--text-secondary);
	}
	.icon-btn:disabled {
		color: var(--text-muted);
		opacity: 0.4;
		cursor: default;
	}
	.icon-btn.danger:hover {
		color: var(--text-danger);
	}
	.add-row {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	.add-row input {
		flex: 1;
	}
</style>
