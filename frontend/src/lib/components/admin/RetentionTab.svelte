<script lang="ts">
	import type { AdminSettings } from '$lib/adminTypes';
	import { updateSettings, clearAllArticles, clearAllMedia } from '$lib/adminApi';
	import SaveStatus from './SaveStatus.svelte';

	let { settings }: { settings: AdminSettings } = $props();

	let retention = $state({ ...settings.retention });
	let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveTimer: ReturnType<typeof setTimeout>;
	let clearing = $state<'articles' | 'media' | null>(null);
	let clearResult = $state<string | null>(null);

	let nitterMediaMode = $state(settings.nitterMediaMode);
	let fxtwitterBaseUrl = $state(settings.fxtwitterBaseUrl);
	let nitterStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let nitterSaveTimer: ReturnType<typeof setTimeout>;

	function scheduleNitterSave() {
		nitterStatus = 'saving';
		clearTimeout(nitterSaveTimer);
		nitterSaveTimer = setTimeout(async () => {
			try {
				await updateSettings({ nitterMediaMode, fxtwitterBaseUrl });
				nitterStatus = 'saved';
				setTimeout(() => (nitterStatus = 'idle'), 1500);
			} catch {
				nitterStatus = 'error';
			}
		}, 500);
	}

	const mediaModes: { label: string; value: 'self-host' | 'proxy' | 'direct' }[] = [
		{ label: 'Self-host', value: 'self-host' },
		{ label: 'Proxy (recommended)', value: 'proxy' },
		{ label: 'Direct', value: 'direct' }
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
		<span class="panel-title">Nitter (tweet media)</span>
		<SaveStatus status={nitterStatus} />
	</div>
	<p class="hint">
		How images and video attached to ingested tweets are served to visitors. Self-hosting
		downloads and stores everything locally, same as regular article images. Proxying streams
		each request through this server without persisting anything, so only this server's IP is
		ever exposed to Twitter's CDN. Direct hotlinks the original URL straight from Twitter, with
		no server involvement at all.
	</p>
	<div class="pill-row">
		{#each mediaModes as mode}
			<button
				class="pill"
				class:active={nitterMediaMode === mode.value}
				onclick={() => {
					nitterMediaMode = mode.value;
					scheduleNitterSave();
				}}
			>
				{mode.label}
			</button>
		{/each}
	</div>
	<p class="hint" style="margin-top: 14px; margin-bottom: 6px;">
		Enrichment API used to fetch full tweet text, author info, and media — any fxtwitter/FixTweet-
		compatible endpoint works. Defaults to the public fxtwitter.com instance; point this at a
		self-hosted FixTweet mirror (or another public instance) instead if you'd rather not depend on it.
	</p>
	<input type="text" bind:value={fxtwitterBaseUrl} oninput={scheduleNitterSave} placeholder="https://api.fxtwitter.com" style="width: 100%" />
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
