<script lang="ts">
	/**
	 * Storylines: the board's storyline panel (rows, rotation) and the embedding-only grouping
	 * behind it (join similarity, shared-name check, lifecycle, tracked-event developments).
	 * Saves on change, like the other tabs.
	 */
	import type { AdminSettings, StorylineSettings } from '$lib/adminTypes';
	import { getStorylineStatus, updateSettings, type StorylineStatus } from '$lib/adminApi';
	import { poll } from '$lib/live.svelte';
	import SaveStatus from './SaveStatus.svelte';

	let { settings }: { settings: AdminSettings } = $props();

	// svelte-ignore state_referenced_locally
	let s = $state<StorylineSettings>({ ...settings.storylines });
	let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let timer: ReturnType<typeof setTimeout>;

	function save() {
		status = 'saving';
		clearTimeout(timer);
		timer = setTimeout(async () => {
			try {
				const next = await updateSettings({ storylines: s });
				s = { ...next.storylines };
				status = 'saved';
				setTimeout(() => (status = 'idle'), 1500);
			} catch {
				status = 'error';
			}
		}, 400);
	}

	// Engine status, refreshed every 10 s while this tab is open.
	let st = $state<StorylineStatus | null>(null);
	const loadStatus = async () => {
		try {
			st = await getStorylineStatus();
		} catch {
			/* keep the last reading */
		}
	};
	$effect(() => {
		loadStatus();
		return poll(loadStatus, 10_000);
	});
	const eta = (m: number) => (m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`);
	const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

	const ROTATE = [8, 10, 15, 20, 30, 45, 60];
	const ITEMS = [2, 3, 4, 5, 6];
	const SOURCES = [1, 2, 3, 4];
	const SEED = [2, 3, 6, 12, 24];
	const COOL = [0.5, 1, 2, 3, 4, 6];
	const CLOSE = [2, 3, 4, 5, 6, 8, 12, 24];
	const LIFE = [12, 18, 24, 30, 36, 48, 72];
	const EV_MAX = [1, 2, 3, 4, 6];
	const EV_CLOSE = [0.5, 1, 2, 3, 4];
	const hrs = (h: number) => (h < 1 ? `${h * 60} minutes` : `${h} ${h === 1 ? 'hour' : 'hours'}`);
	const withCurrent = (list: number[], v: number) => (list.includes(v) ? list : [...list, v].sort((a, b) => a - b));
</script>

<div class="panel">
	<span class="panel-title">Status</span>
	{#if !st}
		<p class="hint">Checking…</p>
	{:else}
		<div class="status">
			<span class="dot" class:ok={st.reachable === true} class:bad={st.reachable === false}></span>
			<b>{st.reachable === false ? 'Paused - the embedding service is unreachable' : st.reachable ? 'Grouping' : 'Starting'}</b>
			<span>{st.storylines.toLocaleString()} storylines · {st.developments.toLocaleString()} event developments</span>
		</div>
		<p class="hint">
			{st.recentPending ? `${st.recentPending} new article(s) waiting. ` : 'New articles are grouped within a minute. '}
			{#if st.backfillPending}
				<b>Historical pass:</b> {st.backfillPending.toLocaleString()} older article(s) left (from {st.backfillOldest ? day(st.backfillOldest) : '?'} on),
				{st.backfillRatePerMin ? `about ${st.backfillRatePerMin} a minute - ${eta(st.backfillEtaMinutes ?? 0)} to go.` : 'starting.'}
				It gets about 40% of each minute after new articles, so the server stays responsive.
			{:else}
				Every article has been through grouping.
			{/if}
		</p>
		{#if st.backfillPending}
			<div class="bar"><i style:width="{Math.max(1, (st.backfillDone / (st.backfillDone + st.backfillPending)) * 100)}%"></i></div>
		{/if}
	{/if}
</div>

<div class="panel">
	<div class="head"><span class="panel-title">Storyline panel</span><SaveStatus {status} /></div>
	<p class="hint">
		How many storylines the home board shows at once. Open storylines rotate through the panel on a timer; the news
		columns below get whatever height is left.
	</p>
	<span class="lbl">Rows shown at once</span>
	<div class="rows">
		{#each [1, 2, 3] as n (n)}
			<button class="rowpick" class:on={!s.hybrid && s.rows === n} onclick={() => ((s.rows = n as 1 | 2 | 3), (s.hybrid = false), save())}>
				<span class="mini">
					<i class="tb"></i>
					{#each { length: n } as _}<i class="band"></i>{/each}
					<span class="cols">{#each { length: 5 } as _}<i></i>{/each}</span>
				</span>
				<em>{n === 1 ? '1 row · columns tallest' : n === 2 ? '2 rows' : '3 rows · most storylines'}</em>
			</button>
		{/each}
		<button class="rowpick" class:on={s.hybrid} onclick={() => ((s.hybrid = true), save())}>
			<span class="mini">
				<i class="tb"></i>
				<i class="band big"></i>
				<span class="cols">{#each { length: 5 } as _}<i></i>{/each}</span>
			</span>
			<em>Hybrid · 1 large row, 2 rows at {s.hybridSwitchAt}+ open</em>
		</button>
	</div>
	{#if s.hybrid}
		<div class="grid2">
			<label>
				<span class="lbl">Switch to two rows when this many are open</span>
				<select bind:value={s.hybridSwitchAt} onchange={save}>
					{#each withCurrent([4, 6, 8, 10, 12, 15, 20], s.hybridSwitchAt) as v (v)}<option value={v}>{v} storylines</option>{/each}
				</select>
			</label>
		</div>
	{/if}
	<div class="grid2">
		<label>
			<span class="lbl">Rotate every</span>
			<select bind:value={s.rotateSeconds} onchange={save}>
				{#each withCurrent(ROTATE, s.rotateSeconds) as v (v)}<option value={v}>{v} seconds</option>{/each}
			</select>
		</label>
	</div>
	<label class="check">
		<input type="checkbox" bind:checked={s.includeEvents} onchange={save} />
		<span><b>Include tracked events in the rotation</b><em>Tracked events show as pinned storylines that never close; they rotate with the others.</em></span>
	</label>
	<label class="check">
		<input type="checkbox" bind:checked={s.jumpOnUpdate} onchange={save} />
		<span><b>Jump to a storyline when it gets a new update</b><em>At the next rotation, instead of waiting for its turn.</em></span>
	</label>
	<label class="check">
		<input type="checkbox" bind:checked={s.pauseOnHover} onchange={save} />
		<span><b>Pause rotation while the pointer is over the panel</b></span>
	</label>
</div>

<div class="panel">
	<span class="panel-title">Grouping</span>
	<p class="hint">
		Storylines are built from <b>embeddings only</b> — no text generation. Each new item is compared with open storylines;
		it joins one when it is similar enough <b>and</b> shares a specific name (place, person, organisation, route number) with
		it. Uses the embedding model set on the Models tab ({settings.selectedModels.embedding || 'none selected'}).
	</p>
	<span class="lbl">Join similarity</span>
	<div class="slider">
		<span>Loose</span>
		<input type="range" min="0.6" max="0.9" step="0.01" bind:value={s.joinSimilarity} onchange={save} />
		<span>Strict</span>
		<b>{Number(s.joinSimilarity).toFixed(2)}</b>
	</div>
	<div class="grid3">
		<label>
			<span class="lbl">Show after</span>
			<select bind:value={s.minItems} onchange={save}>
				{#each withCurrent(ITEMS, s.minItems) as v (v)}<option value={v}>{v} items</option>{/each}
			</select>
		</label>
		<label>
			<span class="lbl">From at least</span>
			<select bind:value={s.minSources} onchange={save}>
				{#each withCurrent(SOURCES, s.minSources) as v (v)}<option value={v}>{v} {v === 1 ? 'source' : 'sources'}</option>{/each}
			</select>
		</label>
		<label>
			<span class="lbl">Seed window</span>
			<select bind:value={s.seedWindowHours} onchange={save}>
				{#each withCurrent(SEED, s.seedWindowHours) as v (v)}<option value={v}>{hrs(v)}</option>{/each}
			</select>
		</label>
	</div>
	<label class="check">
		<input type="checkbox" bind:checked={s.nameGuard} onchange={save} />
		<span><b>Require a shared name to join</b><em>Stops look-alike stories (two unrelated shootings, two pedestrian crashes) from merging. Near-identical items (0.90+) join regardless.</em></span>
	</label>
</div>

<div class="panel">
	<span class="panel-title">Lifecycle</span>
	<p class="hint">
		Storylines close on their own. A closed storyline moves to "Closed today"; a matching item after that starts a new
		storyline linked to it as a continuation.
	</p>
	<div class="grid3">
		<label>
			<span class="lbl">Cooling after quiet</span>
			<select bind:value={s.coolingHours} onchange={save}>
				{#each withCurrent(COOL, s.coolingHours) as v (v)}<option value={v}>{hrs(v)}</option>{/each}
			</select>
		</label>
		<label>
			<span class="lbl">Close after quiet</span>
			<select bind:value={s.closeHours} onchange={save}>
				{#each withCurrent(CLOSE, s.closeHours) as v (v)}<option value={v}>{hrs(v)}</option>{/each}
			</select>
		</label>
		<label>
			<span class="lbl">Maximum lifetime</span>
			<select bind:value={s.maxLifetimeHours} onchange={save}>
				{#each withCurrent(LIFE, s.maxLifetimeHours) as v (v)}<option value={v}>{hrs(v)}</option>{/each}
			</select>
		</label>
	</div>
</div>

<div class="panel">
	<span class="panel-title">Tracked events</span>
	<p class="hint">
		Each active tracked item is shown as a pinned storyline: its posts are grouped into developments with the same
		embedding step. Recap articles are still written on each event's own interval when the AI writer is enabled on the
		Models tab, and appear on the event's timeline like any other post. Sources, keywords and recap interval stay on the
		Tracked items tab.
	</p>
	<span class="lbl">Development similarity</span>
	<div class="slider">
		<span>Loose</span>
		<input type="range" min="0.6" max="0.9" step="0.01" bind:value={s.eventJoinSimilarity} onchange={save} />
		<span>Strict</span>
		<b>{Number(s.eventJoinSimilarity).toFixed(2)}</b>
	</div>
	<div class="grid3">
		<label>
			<span class="lbl">Longest development</span>
			<select bind:value={s.eventMaxHours} onchange={save}>
				{#each withCurrent(EV_MAX, s.eventMaxHours) as v (v)}<option value={v}>{hrs(v)}</option>{/each}
			</select>
		</label>
		<label>
			<span class="lbl">Development ends after quiet</span>
			<select bind:value={s.eventCloseHours} onchange={save}>
				{#each withCurrent(EV_CLOSE, s.eventCloseHours) as v (v)}<option value={v}>{hrs(v)}</option>{/each}
			</select>
		</label>
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
		line-height: 1.5;
		color: var(--text-secondary);
		margin: 4px 0 12px;
	}
	.hint b {
		color: var(--text-primary);
		font-weight: 500;
	}
	.lbl {
		display: block;
		font-size: 11.5px;
		color: var(--text-muted);
		margin-bottom: 5px;
	}
	.rows {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 10px;
		margin-bottom: 14px;
	}
	.rowpick {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--surface-2);
		color: var(--text-muted);
	}
	.rowpick.on {
		border-color: var(--acc);
		color: var(--text-primary);
	}
	.mini {
		display: flex;
		flex-direction: column;
		gap: 3px;
		height: 82px;
	}
	.mini i {
		display: block;
		border-radius: 2px;
	}
	.mini .tb {
		height: 6px;
		background: var(--border);
	}
	.mini .band {
		height: 8px;
		background: color-mix(in srgb, var(--acc) 55%, transparent);
	}
	.mini .band.big {
		height: 19px;
	}
	.cols {
		flex: 1;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 3px;
	}
	.cols i {
		background: var(--border);
		opacity: 0.6;
	}
	.rowpick em {
		font-style: normal;
		font-size: 11px;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		margin-bottom: 10px;
	}
	.grid3 {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		margin-bottom: 10px;
	}
	select {
		width: 100%;
	}
	.check {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		margin-top: 10px;
		font-size: 12.5px;
	}
	.check input {
		width: auto;
		margin-top: 2px;
	}
	.check b {
		font-weight: 500;
	}
	.check em {
		display: block;
		font-style: normal;
		font-size: 11.5px;
		color: var(--text-muted);
		margin-top: 2px;
	}
	.slider {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 11px;
		color: var(--text-muted);
		margin-bottom: 14px;
	}
	.slider input {
		flex: 1;
		accent-color: var(--acc);
	}
	.status {
		display: flex;
		align-items: center;
		gap: 9px;
		margin-top: 8px;
		font-size: 12.5px;
	}
	.status b {
		font-weight: 500;
	}
	.status span:last-child {
		margin-left: auto;
		color: var(--text-muted);
		font-size: 12px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-muted);
	}
	.dot.ok {
		background: var(--up);
	}
	.dot.bad {
		background: var(--dn);
	}
	.bar {
		height: 5px;
		border-radius: 3px;
		background: var(--border);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		background: var(--acc);
	}
	.slider b {
		font-family: var(--mono);
		font-size: 13px;
		color: var(--text-primary);
		min-width: 38px;
		text-align: right;
	}
</style>
