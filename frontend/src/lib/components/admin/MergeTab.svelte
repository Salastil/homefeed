<script lang="ts">
	import type { AdminSettings, AdminSource } from '$lib/adminTypes';
	import { updateSettings, createCategory, deleteCategory } from '$lib/adminApi';
	import SaveStatus from './SaveStatus.svelte';
	import CollapsibleSection from './CollapsibleSection.svelte';
	import SourcesTab from './SourcesTab.svelte';

	let { settings, sources }: { settings: AdminSettings; sources: AdminSource[] } = $props();

	let local = $state({ ...settings, categoryPriority: [...settings.categoryPriority] });
	let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveTimer: ReturnType<typeof setTimeout>;
	let newCategoryName = $state('');
	let newCategoryPrivate = $state(false);
	let newCategorySpillover = $state(false);
	let newCategoryDisableAi = $state(false);
	let addingCategory = $state(false);

	// Advisory only — the nav starts getting too wide / wrapping past ~10 tabs, so this
	// nudges the admin toward marking some categories as spillover once they cross that
	// rough guideline. Never enforced — actual wrapping depends on name lengths and
	// viewport width, which this simple count can't know.
	const primaryCategoryCount = $derived(local.categoryPriority.filter((c) => !c.isSpillover).length);

	function scheduleSave() {
		status = 'saving';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			try {
				await updateSettings({
					mergeStrictness: local.mergeStrictness,
					holdBeforePublishMinutes: local.holdBeforePublishMinutes,
					followUpMinHoursSinceLast: local.followUpMinHoursSinceLast,
					followUpMinNewSources: local.followUpMinNewSources,
					tagDedupThreshold: local.tagDedupThreshold,
					tagExpiryDays: local.tagExpiryDays,
					categoryPriority: local.categoryPriority,
					synthesisStylePreset: local.synthesisStylePreset,
					synthesisCustomInstructions: local.synthesisCustomInstructions
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
			const created = await createCategory(name, newCategoryPrivate, newCategorySpillover, newCategoryDisableAi);
			local.categoryPriority = [...local.categoryPriority, created];
			newCategoryName = '';
			newCategoryPrivate = false;
			newCategorySpillover = false;
			newCategoryDisableAi = false;
		} finally {
			addingCategory = false;
		}
	}

	function togglePrivate(id: string) {
		local.categoryPriority = local.categoryPriority.map((c) => (c.id === id ? { ...c, isPrivate: !c.isPrivate } : c));
		scheduleSave();
	}

	function toggleSpillover(id: string) {
		local.categoryPriority = local.categoryPriority.map((c) => (c.id === id ? { ...c, isSpillover: !c.isSpillover } : c));
		scheduleSave();
	}

	function toggleDisableAi(id: string) {
		local.categoryPriority = local.categoryPriority.map((c) => (c.id === id ? { ...c, disableAi: !c.disableAi } : c));
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

<div class="moved">
	Categories now live on the <b>Board</b> tab: their order, which ones share a rotating column, colours, private and AI settings,
	and which sources feed each one. The board order is also the order the AI writer works through its queue.
</div>

<CollapsibleSection title="Sources">
	<SourcesTab {sources} categories={local.categoryPriority.filter((c) => c.name.toLowerCase() !== 'top stories')} nitterInstanceUrl={settings.nitterInstanceUrl} />
</CollapsibleSection>

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

<div class="panel">
	<span class="panel-title">Writing style</span>
	<p class="hint">
		Applies to AI-merged articles only — a story with just one source publishes with its
		original text untouched, no AI involved. Event recaps have their own independent writing
		style, set per tracked item under Tracked items → Edit → More.
	</p>
	<select bind:value={local.synthesisStylePreset} onchange={scheduleSave}>
		<option value="default">Default (neutral, wire-service tone)</option>
		<option value="casual">Casual</option>
		<option value="formal">Formal</option>
	</select>
	<label class="field-label" for="custom-instructions" style="margin-top: 10px;">
		Additional instructions (optional)
	</label>
	<textarea
		id="custom-instructions"
		rows="3"
		placeholder={'e.g. "Keep paragraphs under 3 sentences", "Never use the word notably"'}
		bind:value={local.synthesisCustomInstructions}
		oninput={scheduleSave}
	></textarea>
</div>

<div class="panel">
	<span class="panel-title">Hold before publish</span>
	<p class="hint">Wait window to gather more sources before finalizing a story.</p>
	<select bind:value={local.holdBeforePublishMinutes} onchange={scheduleSave}>
		<option value={0}>Publish immediately</option>
		<option value={15}>Wait 15 minutes</option>
		<option value={30}>Wait 30 minutes</option>
		<option value={60}>Wait 1 hour</option>
		<option value={120}>Wait 2 hours</option>
	</select>
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
	.moved {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 14px 16px;
		margin-bottom: 14px;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-secondary);
	}
	.moved b {
		color: var(--text-primary);
		font-weight: 500;
	}
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
	.hint.warn {
		color: var(--text-accent);
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
	textarea {
		width: 100%;
		margin-top: 6px;
		font: inherit;
		resize: vertical;
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
