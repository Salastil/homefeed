<script lang="ts">
	/**
	 * AI writer (issue #1, mockup B2, accepted): one switch for everything generative. While it
	 * is off every item publishes as its own article with its source's text and no recaps are
	 * written (backend queue/scheduler.ts); everything below is kept, greyed out, so it's
	 * clear what turns on with it. Gathers what used to be spread over Sources & Merge (merge
	 * strictness, hold, follow-ups, writing style) and Models (the synthesis server and model).
	 */
	import { onMount } from 'svelte';
	import type { AdminSettings, AiStatusBySlot, ModelCatalog, SynthesisModelInfo } from '$lib/adminTypes';
	import { getBoardOverview, getModelContext, getSynthesisModels, setColumnAi, updateSettings, type BoardColumnInfo, type BoardOverview } from '$lib/adminApi';
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
			saved = { host, port };
			tested = null;
			await refreshModels();
		});

	// The model list comes from the server itself: asked when the page opens, every 30 s while
	// it's visible, and on ↻. Until the first answer, the names from the page load stand in.
	// svelte-ignore state_referenced_locally
	let saved = $state({ host: settings.synthesisServiceHost, port: settings.synthesisServicePort });
	// svelte-ignore state_referenced_locally
	let installed = $state<SynthesisModelInfo[]>(
		models.synthesis.map((name) => ({ name, sizeBytes: null, parameterSize: null, quantization: null, family: null, modifiedAt: null, embeddingOnly: false }))
	);
	let checkedAt = $state<string | null>(null);
	let refreshing = $state(false);
	/** The Test button's answer for an address that isn't saved yet. */
	let tested = $state<{ host: string; port: number; connected: boolean; count: number } | null>(null);

	async function refreshModels() {
		refreshing = true;
		try {
			const r = await getSynthesisModels();
			status = { ...status, connected: r.connected, host: r.host, port: r.port };
			if (r.connected) installed = r.models;
			checkedAt = r.checkedAt;
		} catch {
			// The backend itself didn't answer; keep what's shown.
		} finally {
			refreshing = false;
		}
	}
	async function test() {
		testing = true;
		try {
			const r = await getSynthesisModels({ host, port });
			const same = r.host === saved.host && Number(r.port) === Number(saved.port);
			if (same) {
				tested = null;
				status = { ...status, connected: r.connected };
				if (r.connected) installed = r.models;
				checkedAt = r.checkedAt;
			} else {
				tested = { host: r.host, port: r.port, connected: r.connected, count: r.models.filter((m) => !m.embeddingOnly).length };
			}
		} finally {
			testing = false;
		}
	}
	onMount(() => {
		refreshModels();
		const timer = setInterval(() => document.visibilityState === 'visible' && refreshModels(), 30_000);
		const onVisible = () => document.visibilityState === 'visible' && refreshModels();
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});
	const writers = $derived(installed.filter((m) => !m.embeddingOnly));
	const missing = $derived(!!s.synthesisModel && status.connected && checkedAt !== null && !writers.some((m) => m.name === s.synthesisModel));
	const gb = (b: number | null) => (b ? `${(b / 1e9).toFixed(1)} GB` : '');
	const describe = (m: SynthesisModelInfo) => [m.parameterSize, m.quantization, gb(m.sizeBytes)].filter(Boolean).join(' · ');

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

	// Per-column scope: the same "AI rewrite" switch as Board columns, for every column on the
	// board including the built-in Wire and General, in board order.
	let ov = $state<BoardOverview | null>(null);
	onMount(async () => {
		admin.aiWriterEnabled = s.aiWriterEnabled;
		ov = await getBoardOverview().catch(() => null);
	});
	const boardColumns = $derived.by(() => {
		if (!ov) return [];
		const byKey = new Map(ov.columns.map((c) => [c.key, c]));
		const order = [...ov.layout.slots.flatMap((sl) => sl.columns), ...ov.layout.hidden];
		const listed = order.map((k) => byKey.get(k)).filter((c): c is BoardColumnInfo => !!c);
		return [...listed, ...ov.columns.filter((c) => !order.includes(c.key))];
	});
	async function toggleColumn(c: BoardColumnInfo) {
		ov = await setColumnAi(c, c.disableAi);
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
				coverage using embeddings; X, Telegram and YouTube posts are still tagged, RSS articles are not.
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
				{#if tested}
					{#if tested.connected}<span class="ok">✓ {tested.host}:{tested.port} answers · {tested.count} model{tested.count === 1 ? '' : 's'}</span>{:else}<span class="err">✕ {tested.host}:{tested.port} doesn't answer</span>{/if}
					· not saved; Save to use it.
				{:else}
					{#if status.connected}<span class="ok">✓ Connected · {status.host}:{status.port} · {writers.length} model{writers.length === 1 ? '' : 's'}</span>{:else}<span class="err">✕ Unreachable</span>{/if}
					· separate from the embedding server, which is under <a href="/admin/settings?tab=connections#ai-servers">Connections</a>.
				{/if}
			</p>
			<div class="fld">
				<div class="lblrow">
					<span class="lbl">Model</span>
					<span class="sp"></span>
					<span class="lbl" title={checkedAt ? `Asked the server at ${new Date(checkedAt).toLocaleTimeString()}` : ''}>
						{refreshing ? 'Asking the server…' : checkedAt ? `Checked ${new Date(checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : 'From the last page load'}
					</span>
					<button class="ghost re" onclick={refreshModels} disabled={refreshing} aria-label="Ask the server for its models again" title="Ask the server again">↻</button>
				</div>
				<select bind:value={s.synthesisModel} onchange={saveModel} aria-label="Synthesis model">
					{#if missing || (!writers.length && s.synthesisModel)}
						<option value={s.synthesisModel}>{s.synthesisModel}{missing ? ' (not on this server)' : ''}</option>
					{/if}
					{#each writers as m (m.name)}
						<option value={m.name}>{m.name}{describe(m) ? ` — ${describe(m)}` : ''}</option>
					{/each}
				</select>
				{#if missing}
					<p class="hint err">This model isn't installed on {status.host}. The writer fails until you pick another or run <code>ollama pull {s.synthesisModel}</code> there.</p>
				{:else if status.connected && checkedAt && !writers.length}
					<p class="hint err">The server has no models that can write. Pull one with <code>ollama pull</code>.</p>
				{/if}
			</div>
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
			<p class="hint">Columns it rewrites, in board order. The same switch is on Board columns and each column's Edit sheet. YouTube videos always publish as they are, whatever their column.</p>
			<div class="chips">
				{#each boardColumns as c (c.key)}
					{#if c.kind === 'wire'}
						<span class="chip locked" style:--cc={columnColor(c.name, ov?.layout.colors[c.key])} title="Wire holds X and Telegram posts, which always publish as posted.">
							<i></i>{c.name}<span class="mono small">as posted</span>
						</span>
					{:else}
						<button
							class="chip"
							class:on={!c.disableAi}
							class:hid={ov?.layout.hidden.includes(c.key)}
							style:--cc={columnColor(c.name, ov?.layout.colors[c.key])}
							title={c.kind === 'general' ? 'General: articles from sources with no column' : ov?.layout.hidden.includes(c.key) ? 'Hidden from the board' : ''}
							onclick={() => toggleColumn(c)}
						>
							<i></i>{c.name}<span class="mono small">{c.disableAi ? 'no AI' : 'AI'}</span>
						</button>
					{/if}
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
	.lblrow {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 5px;
	}
	.lblrow .lbl {
		margin: 0;
	}
	.re {
		min-height: 22px;
		padding: 0 6px;
	}
	.chip.locked {
		border-style: dashed;
		cursor: default;
	}
	.chip.hid {
		opacity: 0.6;
	}
	.hint.err {
		color: var(--dn);
	}
	code {
		font-family: var(--mono);
		font-size: 11px;
	}
</style>
