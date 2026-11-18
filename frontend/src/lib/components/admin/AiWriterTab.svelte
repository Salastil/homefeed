<script lang="ts">
	/**
	 * AI writer (issue #1, mockup B2, accepted): one switch for everything generative. While it
	 * is off every item publishes as its own article with its source's text and no recaps are
	 * written (backend queue/scheduler.ts); everything below is kept, greyed out, so it's
	 * clear what turns on with it. Gathers what used to be spread over Sources & Merge (merge
	 * strictness, hold, follow-ups, writing style) and Models (the synthesis server and model).
	 */
	import { onMount } from 'svelte';
	import type { AdminSettings, AiStatusBySlot, ModelCatalog } from '$lib/adminTypes';
	import { getAiStatus, getBoardOverview, getModelContext, testAiConnection, updateCategory, updateSettings, type BoardOverview } from '$lib/adminApi';
	import { saver } from '$lib/adminSaver.svelte';
	import { admin } from '$lib/adminSession.svelte';
	import { columnColor } from '$lib/text';
	import SaveStatus from './SaveStatus.svelte';

	let { settings, models, aiStatus: initialStatus }: { settings: AdminSettings; models: ModelCatalog; aiStatus: AiStatusBySlot } = $props();

	// svelte-ignore state_referenced_locally
	let s = $state({
		aiWriterEnabled: settings.aiWriterEnabled,
		mergeStrictness: settings.mergeStrictness,
		holdBeforePublishMinutes: settings.holdBeforePublishMinutes,
		followUpMinHoursSinceLast: settings.followUpMinHoursSinceLast,
		followUpMinNewSources: settings.followUpMinNewSources,
		synthesisStylePreset: settings.synthesisStylePreset,
		synthesisCustomInstructions: settings.synthesisCustomInstructions,
		synthesisLanguage: settings.synthesisLanguage,
		synthesisDisableThinking: settings.synthesisDisableThinking,
		synthesisNumCtx: settings.synthesisNumCtx,
		synthesisNumPredict: settings.synthesisNumPredict,
		synthesisModel: settings.selectedModels.synthesis
	});
	// svelte-ignore state_referenced_locally
	let host = $state(settings.synthesisServiceHost);
	// svelte-ignore state_referenced_locally
	let port = $state(settings.synthesisServicePort);
	// svelte-ignore state_referenced_locally
	let status = $state(initialStatus.synthesis);
	let testing = $state(false);

	const main = saver(0);
	const merging = saver();
	const writing = saver(500);
	const model = saver();
	const conn = saver(0);

	function toggle() {
		s.aiWriterEnabled = !s.aiWriterEnabled;
		admin.aiWriterEnabled = s.aiWriterEnabled;
		main.run(() => updateSettings({ aiWriterEnabled: s.aiWriterEnabled }));
	}
	const saveMerging = () =>
		merging.run(() =>
			updateSettings({
				mergeStrictness: s.mergeStrictness,
				holdBeforePublishMinutes: s.holdBeforePublishMinutes,
				followUpMinHoursSinceLast: s.followUpMinHoursSinceLast,
				followUpMinNewSources: s.followUpMinNewSources
			})
		);
	const saveWriting = () =>
		writing.run(() =>
			updateSettings({
				synthesisStylePreset: s.synthesisStylePreset,
				synthesisCustomInstructions: s.synthesisCustomInstructions,
				synthesisLanguage: s.synthesisLanguage
			})
		);
	const saveModel = () =>
		model.run(() =>
			updateSettings({
				selectedModels: { ...settings.selectedModels, synthesis: s.synthesisModel },
				synthesisDisableThinking: s.synthesisDisableThinking,
				synthesisNumCtx: s.synthesisNumCtx,
				synthesisNumPredict: s.synthesisNumPredict
			})
		);
	const saveConn = () =>
		conn.run(async () => {
			await updateSettings({ synthesisServiceHost: host, synthesisServicePort: port });
			status = (await getAiStatus()).synthesis;
		});
	async function test() {
		testing = true;
		try {
			status = await testAiConnection(host, port);
		} finally {
			testing = false;
		}
	}

	// The context-window slider's ceiling is the selected model's own reported maximum.
	const FALLBACK_MAX_CTX = 32768;
	let detectedMax = $state<number | null>(null);
	$effect(() => {
		const m = s.synthesisModel;
		if (!m) return;
		getModelContext(m)
			.then((info) => (detectedMax = info.contextLength))
			.catch(() => (detectedMax = null));
	});
	const maxCtx = $derived(detectedMax ?? FALLBACK_MAX_CTX);
	const maxPredict = $derived(Math.max(100, s.synthesisNumCtx - 512));
	function onCtx() {
		if (s.synthesisNumPredict > s.synthesisNumCtx - 512) s.synthesisNumPredict = Math.max(100, s.synthesisNumCtx - 512);
		saveModel();
	}

	// Mirrors LANGUAGE_SCRIPTS in backend/src/pipeline/synthesis.ts (a value not listed there
	// is still asked for, just not verified).
	const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Dutch', 'Polish', 'Turkish', 'Vietnamese', 'Indonesian', 'Russian', 'Ukrainian', 'Greek', 'Chinese (Simplified)', 'Japanese', 'Korean', 'Arabic', 'Hebrew', 'Hindi'];
	const synthModels = $derived(models.synthesis.includes(s.synthesisModel) || !s.synthesisModel ? models.synthesis : [s.synthesisModel, ...models.synthesis]);

	// Per-column scope: the same "AI rewrite" switch as Board columns.
	let ov = $state<BoardOverview | null>(null);
	onMount(async () => {
		admin.aiWriterEnabled = s.aiWriterEnabled;
		ov = await getBoardOverview().catch(() => null);
	});
	const cats = $derived((ov?.columns ?? []).filter((c) => c.kind === 'category'));
	async function toggleColumn(id: string, disableAi: boolean) {
		ov = await updateCategory(id, { disableAi });
	}
</script>

<div class="adm">
	<div class="panel hero">
		<div class="txt">
			<h1>AI writer</h1>
			<p>
				Merges a story that several sources cover into one rewritten article, and writes recaps for tracked items. Every article is a
				generative call. On a CPU-only host one takes minutes, and the machine is slow while it runs.
			</p>
			<p class="sub">
				<b>While it is off:</b> every item publishes as its own article with its source's text, straight away. Storylines still group related
				coverage, and tags still come from embeddings.
			</p>
		</div>
		<button class="switch" role="switch" aria-checked={s.aiWriterEnabled} onclick={toggle}>
			<span class="st"><b>{s.aiWriterEnabled ? 'On' : 'Off'}</b><em>for every column and tracked item</em></span>
			<span class="knob" class:on={s.aiWriterEnabled}><i></i></span>
		</button>
		<SaveStatus status={main.status} />
	</div>

	<div class="divider">
		<span>{s.aiWriterEnabled ? 'How it writes' : 'Everything below turns on with the switch'}</span>
		<i></i>
	</div>

	<fieldset class="cards" disabled={!s.aiWriterEnabled}>
		<div class="panel">
			<div class="ph"><span class="pt">Merging</span><span class="sp"></span><SaveStatus status={merging.status} /></div>
			<span class="lbl">Merge strictness</span>
			<div class="slider">
				<span>Loose</span>
				<input type="range" min="1" max="5" step="1" bind:value={s.mergeStrictness} oninput={saveMerging} aria-label="Merge strictness" />
				<span>Strict</span>
				<b>{s.mergeStrictness}</b>
			</div>
			<p class="hint">How alike two articles must be to become one story.</p>
			<label class="fld">
				<span class="lbl">Hold before publish</span>
				<select bind:value={s.holdBeforePublishMinutes} onchange={saveMerging}>
					<option value={0}>Publish immediately</option>
					<option value={15}>Wait 15 minutes</option>
					<option value={30}>Wait 30 minutes</option>
					<option value={60}>Wait 1 hour</option>
					<option value={120}>Wait 2 hours</option>
				</select>
			</label>
			<span class="lbl">Follow-up articles</span>
			<div class="grid2">
				<select bind:value={s.followUpMinHoursSinceLast} onchange={saveMerging} aria-label="Minimum time since the last article">
					{#each [1, 6, 12, 24] as h (h)}<option value={h}>after {h} h</option>{/each}
				</select>
				<select bind:value={s.followUpMinNewSources} onchange={saveMerging} aria-label="Minimum new sources">
					{#each [1, 2, 3, 4] as n (n)}<option value={n}>{n} new source{n === 1 ? '' : 's'}</option>{/each}
				</select>
			</div>
			<p class="hint">A separate follow-up article once enough new sources arrive. Storyline timelines also show new developments.</p>
		</div>

		<div class="panel">
			<div class="ph"><span class="pt">Writing</span><span class="sp"></span><SaveStatus status={writing.status} /></div>
			<label class="fld">
				<span class="lbl">Style</span>
				<select bind:value={s.synthesisStylePreset} onchange={saveWriting}>
					<option value="default">Default (neutral, wire-service tone)</option>
					<option value="casual">Casual</option>
					<option value="formal">Formal</option>
				</select>
			</label>
			<label class="fld">
				<span class="lbl">Additional instructions</span>
				<textarea rows="3" bind:value={s.synthesisCustomInstructions} oninput={saveWriting} placeholder={'e.g. "Keep paragraphs under 3 sentences"'}></textarea>
			</label>
			<label class="fld">
				<span class="lbl">Output language</span>
				<select bind:value={s.synthesisLanguage} onchange={saveWriting}>
					{#each LANGUAGES as l (l)}<option value={l}>{l}</option>{/each}
				</select>
			</label>
			<details class="hint">
				<summary>Why the language is pinned</summary>
				Multilingual models sometimes slip into another language mid-sentence. The model is told the language, and the reply's script is checked;
				an article in the wrong script is regenerated once.
			</details>
			<p class="hint">Tracked items' recaps have their own style, on each item.</p>
		</div>

		<div class="panel">
			<div class="ph"><span class="pt">Model</span><span class="sp"></span><SaveStatus status={model.status} /></div>
			<span class="lbl">Server</span>
			<div class="row">
				<input class="grow mono" bind:value={host} placeholder="http://10.0.0.14" aria-label="Synthesis server host" />
				<input class="portin mono" bind:value={port} placeholder="11434" aria-label="Synthesis server port" />
				<button class="btn" onclick={test} disabled={testing}>{testing ? 'Testing…' : 'Test'}</button>
				<button class="btn" onclick={saveConn}>Save</button>
				<SaveStatus status={conn.status} />
			</div>
			<p class="hint">
				{#if status.connected}<span class="ok">✓ Connected · {status.host}:{status.port}</span>{:else}<span class="err">✕ Unreachable</span>{/if}
				· separate from the embedding server, which is under <a href="/admin/settings?tab=connections#ai-servers">Connections</a>.
			</p>
			<label class="fld">
				<span class="lbl">Model</span>
				<select bind:value={s.synthesisModel} onchange={saveModel}>
					{#each synthModels as m (m)}<option value={m}>{m}</option>{/each}
				</select>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={s.synthesisDisableThinking} onchange={saveModel} />
				<span>Skip hidden reasoning (think: false)<em>For reasoning models (Qwen3, DeepSeek-R1). It saves time and is ignored by other models.</em></span>
			</label>
			<span class="lbl">Context window · {s.synthesisNumCtx.toLocaleString()} tokens{detectedMax ? ` (model max ${detectedMax.toLocaleString()})` : ''}</span>
			<div class="slider"><input type="range" min="1024" max={maxCtx} step="512" bind:value={s.synthesisNumCtx} oninput={onCtx} aria-label="Context window" /></div>
			<span class="lbl" style="margin-top: 10px">Max response · {s.synthesisNumPredict.toLocaleString()} tokens</span>
			<div class="slider"><input type="range" min="100" max={maxPredict} step="50" bind:value={s.synthesisNumPredict} oninput={saveModel} aria-label="Max response length" /></div>
			<p class="hint">Too low a response limit is why an article sometimes stops mid-sentence.</p>
		</div>

		<div class="panel">
			<div class="ph"><span class="pt">Where it runs</span></div>
			<p class="hint">Columns it rewrites. The same switch is on Board columns. X, Telegram and YouTube posts always publish as they are.</p>
			<div class="chips">
				{#each cats as c (c.key)}
					<button class="chip" class:on={!c.disableAi} style:--cc={columnColor(c.name, ov?.layout.colors[c.key])} onclick={() => toggleColumn(c.id!, !c.disableAi)}>
						<i></i>{c.name}<span class="mono small">{c.disableAi ? 'no AI' : 'AI'}</span>
					</button>
				{/each}
			</div>
		</div>

		<div class="panel">
			<div class="ph"><span class="pt">Tracked item recaps</span></div>
			<p class="hint">Each tracked item can get a recap every few hours. Cadence, style and "Recap now" are on <a href="/admin/settings?tab=events">Tracked items</a>, shown while the writer is on.</p>
		</div>
	</fieldset>
</div>

<style>
	.hero {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
		align-items: flex-start;
		padding: 20px 22px;
	}
	.txt {
		flex: 999 1 420px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.txt p {
		margin: 0;
		max-width: 680px;
		line-height: 1.5;
		color: var(--tx);
	}
	.txt p.sub {
		color: var(--tx2);
	}
	.txt b {
		color: var(--tx);
	}
	.switch {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 14px;
		border-radius: 12px;
		background: var(--s0);
		border: 1px solid var(--bd);
		text-align: left;
	}
	.st {
		display: flex;
		flex-direction: column;
	}
	.st em {
		font-style: normal;
		font-size: 11.5px;
		color: var(--tx2);
	}
	.knob {
		width: 46px;
		height: 26px;
		border-radius: 999px;
		background: var(--bd);
		position: relative;
		transition: background 0.15s;
	}
	.knob i {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--tx2);
		transition: left 0.15s;
	}
	.knob.on {
		background: var(--up);
	}
	.knob.on i {
		left: 23px;
		background: var(--s0);
	}
	.divider {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 6px 0 14px;
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--tx2);
	}
	.divider i {
		flex: 1;
		height: 1px;
		background: var(--bd);
	}
	.cards {
		border: 0;
		margin: 0;
		padding: 0;
		min-width: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 14px;
		align-items: start;
	}
	.cards .panel {
		margin: 0;
	}
	.cards:disabled {
		opacity: 0.5;
	}
	.grow {
		flex: 1;
		min-width: 120px;
	}
	.portin {
		width: 80px;
	}
	textarea {
		width: 100%;
		resize: vertical;
	}
	details.hint summary {
		margin-bottom: 4px;
	}
	.small {
		font-size: 10px;
		opacity: 0.8;
	}
</style>
