<script lang="ts">
	import type { AdminSettings } from '$lib/adminTypes';
	import { updateSettings, clearAllArticles, clearAllMedia, reissueArticle } from '$lib/adminApi';
	import SaveStatus from './SaveStatus.svelte';

	let { settings }: { settings: AdminSettings } = $props();

	let retention = $state({ ...settings.retention });
	let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveTimer: ReturnType<typeof setTimeout>;
	let clearing = $state<'articles' | 'media' | null>(null);
	let clearResult = $state<string | null>(null);

	let reissueArticleId = $state('');
	let reissuing = $state(false);
	let reissueResult = $state<string | null>(null);
	let reissueError = $state<string | null>(null);

	let telegramMediaMode = $state(settings.telegramMediaMode);
	let telegramMediaStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let telegramMediaSaveTimer: ReturnType<typeof setTimeout>;

	function scheduleTelegramMediaSave() {
		telegramMediaStatus = 'saving';
		clearTimeout(telegramMediaSaveTimer);
		telegramMediaSaveTimer = setTimeout(async () => {
			try {
				await updateSettings({ telegramMediaMode });
				telegramMediaStatus = 'saved';
				setTimeout(() => (telegramMediaStatus = 'idle'), 1500);
			} catch {
				telegramMediaStatus = 'error';
			}
		}, 500);
	}

	// No "Direct" option here — unlike Twitter's CDN, Telegram has no public
	// hotlinkable media URL, so there's nothing to hotlink straight from.
	const telegramMediaModes: { label: string; value: 'self-host' | 'proxy' }[] = [
		{ label: 'Self-host', value: 'self-host' },
		{ label: 'Proxy', value: 'proxy' }
	];

	async function handleClearArticles() {
		if (!confirm('Delete every published article and its media? Raw ingested items are kept, so sources can be re-synthesized fresh.')) return;
		clearing = 'articles';
		clearResult = null;
		try {
			const { deleted } = await clearAllArticles();
			clearResult = `${deleted} article(s) deleted`;
		} finally {
			clearing = null;
		}
	}

	async function handleClearMedia() {
		if (!confirm('Delete every locally stored media file? Articles referencing them will show broken images until re-published.')) return;
		clearing = 'media';
		clearResult = null;
		try {
			const { deleted } = await clearAllMedia();
			clearResult = `${deleted} media file(s) deleted`;
		} finally {
			clearing = null;
		}
	}

	async function handleReissueArticle() {
		const id = reissueArticleId.trim();
		if (!id) return;
		reissuing = true;
		reissueResult = null;
		reissueError = null;
		try {
			const { itemsRequeued } = await reissueArticle(id);
			reissueResult = `Deleted — ${itemsRequeued} source item(s) requeued for re-publish`;
			reissueArticleId = '';
		} catch (err) {
			reissueError = /\(404\)/.test((err as Error).message) ? 'No article with that ID' : (err as Error).message;
		} finally {
			reissuing = false;
		}
	}

	function scheduleSave() {
		status = 'saving';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			try {
				await updateSettings({ retention });
				status = 'saved';
				setTimeout(() => (status = 'idle'), 1500);
			} catch {
				status = 'error';
			}
		}, 500);
	}

	const usagePercent = $derived(
		retention.storageCapEnabled
			? Math.min(
					100,
					(retention.storageUsedMB / (retention.storageCapValue * (retention.storageCapUnit === 'GB' ? 1024 : 1))) * 100
				)
			: 0
	);

	const presets = [
		{ label: '7 days', value: 7 },
		{ label: '30 days', value: 30 },
		{ label: '1 year', value: 365 },
		{ label: 'Forever', value: null }
	];
</script>

<div class="panel">
	<div class="head">
		<span class="panel-title">Published articles</span>
		<SaveStatus {status} />
	</div>
	<p class="hint">How long merged, published stories stay available.</p>
	<div class="pill-row">
		{#each presets as preset}
			<button
				class="pill"
				class:active={retention.publishedArticleMaxAgeDays === preset.value}
				onclick={() => {
					retention.publishedArticleMaxAgeDays = preset.value;
					scheduleSave();
				}}
			>
				{preset.label}
			</button>
		{/each}
	</div>
</div>

<div class="panel">
	<span class="panel-title">Raw source items</span>
	<p class="hint">Individual RSS/API/Telegram entries used to build merged stories.</p>
	<div class="pill-row">
		{#each [{ label: '3 days', value: 3 }, { label: '7 days', value: 7 }, { label: '30 days', value: 30 }] as preset}
			<button
				class="pill"
				class:active={retention.rawItemMaxAgeDays === preset.value}
				onclick={() => {
					retention.rawItemMaxAgeDays = preset.value;
					scheduleSave();
				}}
			>
				{preset.label}
			</button>
		{/each}
	</div>
</div>

<div class="panel">
	<div class="head">
		<span class="panel-title">Storage cap</span>
		<label class="checkbox">
			<input
				type="checkbox"
				bind:checked={retention.storageCapEnabled}
				onchange={scheduleSave}
			/>
			Enabled
		</label>
	</div>
	<p class="hint">
		When total storage exceeds this size, oldest items are deleted first (FIFO) regardless of
		the age settings above.
	</p>
	<div class="cap-row">
		<input
			type="number"
			bind:value={retention.storageCapValue}
			oninput={scheduleSave}
			style="width: 100px"
		/>
		<select bind:value={retention.storageCapUnit} onchange={scheduleSave} style="width: 90px">
			<option value="MB">MB</option>
			<option value="GB">GB</option>
		</select>
		<span class="usage-label">currently using {retention.storageUsedMB} MB</span>
	</div>
	<div class="bar">
		<div class="bar-fill" style="width: {usagePercent}%"></div>
	</div>
</div>

<div class="panel">
	<div class="head">
		<span class="panel-title">Telegram (message media)</span>
		<SaveStatus status={telegramMediaStatus} />
	</div>
	<p class="hint">
		How photos/videos attached to ingested Telegram messages (and channel avatars) are served
		to visitors. Telegram has no public URL for this media the way Twitter's CDN does — bytes
		only ever come from the logged-in account (Connections tab), so there's no "Direct" option.
		Self-hosting downloads and stores everything locally, same as regular article images.
		Proxying re-fetches each request live through the logged-in account and streams it straight
		through without persisting anything, so only this server ever touches Telegram's servers —
		at the cost of a live round-trip to Telegram on every view (a short cache absorbs repeats).
	</p>
	<div class="pill-row">
		{#each telegramMediaModes as mode}
			<button
				class="pill"
				class:active={telegramMediaMode === mode.value}
				onclick={() => {
					telegramMediaMode = mode.value;
					scheduleTelegramMediaSave();
				}}
			>
				{mode.label}
			</button>
		{/each}
	</div>
</div>

<div class="panel">
	<span class="panel-title">Clear content</span>
	<p class="hint">
		Wipe everything so a category or the whole site can be repopulated fresh. To clear a single
		source's content without deleting the source, use the ✕ next to it in the Sources tab's
		"Clear content" action instead.
	</p>
	<div class="clear-row">
		<button class="danger-btn" onclick={handleClearArticles} disabled={clearing !== null}>
			{clearing === 'articles' ? 'Clearing…' : 'Clear all articles'}
		</button>
		<button class="danger-btn" onclick={handleClearMedia} disabled={clearing !== null}>
			{clearing === 'media' ? 'Clearing…' : 'Clear all media'}
		</button>
		{#if clearResult}
			<span class="usage-label">{clearResult}</span>
		{/if}
	</div>
</div>

<div class="panel">
	<span class="panel-title">Reissue an article</span>
	<p class="hint">
		Deletes one specific published article and requeues every source item it was built from, so
		they re-cluster and re-synthesize fresh on the next scheduler tick — for fixing a single bad
		publish (e.g. a garbled AI merge) without wiping anything else. Unlike a source's own "Clear
		content" action, this works regardless of how many different sources the article merged
		together. Find the article ID in its URL or via <code>GET /api/article/:id</code>.
	</p>
	<div class="clear-row">
		<input
			type="text"
			placeholder="art-…"
			bind:value={reissueArticleId}
			onkeydown={(e) => e.key === 'Enter' && handleReissueArticle()}
			style="flex: 1; min-width: 220px"
		/>
		<button
			class="danger-btn"
			onclick={handleReissueArticle}
			disabled={reissuing || !reissueArticleId.trim()}
		>
			{reissuing ? 'Reissuing…' : 'Reissue'}
		</button>
		{#if reissueResult}
			<span class="usage-label">{reissueResult}</span>
		{/if}
		{#if reissueError}
			<span class="error-label">{reissueError}</span>
		{/if}
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
	.pill-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.pill {
		font-size: 12px;
		padding: 6px 12px;
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
	.checkbox {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.checkbox input {
		width: auto;
	}
	.cap-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 10px;
	}
	.usage-label {
		font-size: 12px;
		color: var(--text-muted);
	}
	.error-label {
		font-size: 12px;
		color: var(--text-danger);
	}
	.bar {
		width: 100%;
		height: 6px;
		background: var(--border);
		border-radius: 4px;
		overflow: hidden;
	}
	.bar-fill {
		height: 100%;
		background: var(--border-accent);
	}
	.clear-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.danger-btn {
		font-size: 12px;
		padding: 6px 12px;
		border-radius: var(--radius);
		border: 0.5px solid var(--text-danger);
		background: transparent;
		color: var(--text-danger);
	}
	.danger-btn:hover:not(:disabled) {
		background: var(--bg-accent);
	}
	.danger-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
