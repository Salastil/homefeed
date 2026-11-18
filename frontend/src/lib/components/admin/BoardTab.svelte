<script lang="ts">
	/**
	 * Board tab (issue #1, comment 625): every feed is a column - the categories plus the
	 * built-in Wire and General. The list order is the board's left-to-right order (and the AI
	 * writer's queue order); columns can share a position and rotate; each has a colour,
	 * on-board / private / AI switches, and a panel for its name and the sources that feed it.
	 * Replaces the old Category priority list. Saves on every change.
	 */
	import { onMount } from 'svelte';
	import {
		createCategory,
		deleteCategory,
		getBoardOverview,
		updateCategory,
		updateSettings,
		type BoardLayoutCfg,
		type BoardOverview
	} from '$lib/adminApi';
	import { COLUMN_SWATCHES, columnColor } from '$lib/text';
	import * as ops from '$lib/boardLayoutOps';
	import { admin } from '$lib/adminSession.svelte';
	import { slugify } from '$lib/format';
	import SaveStatus from './SaveStatus.svelte';

	let ov = $state<BoardOverview | null>(null);
	let layout = $state<BoardLayoutCfg | null>(null);
	let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let error = $state<string | null>(null);
	let selected = $state<string | null>(null);
	let newName = $state('');

	async function load() {
		try {
			ov = await getBoardOverview();
			layout = $state.snapshot(ov.layout) as BoardLayoutCfg;
		} catch (err) {
			error = (err as Error).message;
		}
	}
	onMount(load);

	const info = $derived(new Map((ov?.columns ?? []).map((c) => [c.key, c])));
	const selectedInfo = $derived(selected ? (info.get(selected) ?? null) : null);
	const colorOf = (key: string) => columnColor(info.get(key)?.name, layout?.colors[key]);

	async function run(fn: () => Promise<unknown>) {
		status = 'saving';
		error = null;
		try {
			await fn();
			status = 'saved';
			setTimeout(() => (status = 'idle'), 1500);
		} catch (err) {
			status = 'error';
			error = /409/.test((err as Error).message) ? 'Another column already has that name.' : (err as Error).message;
		}
	}

	function saveLayout(next: BoardLayoutCfg) {
		next.slots = next.slots.filter((s) => s.columns.length > 0);
		layout = next;
		return run(async () => {
			await updateSettings({ boardLayout: next });
			ov = await getBoardOverview();
		});
	}
	const copy = (): BoardLayoutCfg => structuredClone($state.snapshot(layout)!);

	// ---- arranging (each op returns a new layout; see lib/boardLayoutOps.ts) ----
	const moveSlot = (i: number, to: number) => saveLayout(ops.moveSlot(copy(), i, to));
	const rotateWithNext = (i: number) => saveLayout(ops.rotateWithNext(copy(), i));
	const ownColumn = (i: number, key: string) => saveLayout(ops.ownColumn(copy(), i, key));
	const moveWithin = (i: number, k: number, dir: -1 | 1) => saveLayout(ops.moveWithin(copy(), i, k, dir));
	const setRotate = (i: number, secs: number) => saveLayout(ops.setRotate(copy(), i, secs));
	const toggleBoard = (key: string) => saveLayout(ops.toggleBoard(copy(), key));
	const setColor = (key: string, c: string) => saveLayout(ops.setColor(copy(), key, c));
	function setAuto(field: 'autoRotateQuiet' | 'autoFold', v: boolean) {
		const next = copy();
		next[field] = v;
		saveLayout(next);
	}

	// Drag a position onto another to move it there (above or below, by where it's dropped).
	let dragFrom = $state<number | null>(null);
	let dropAt = $state<{ i: number; after: boolean } | null>(null);
	function onDragOver(e: DragEvent, i: number) {
		if (dragFrom === null) return;
		e.preventDefault();
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		dropAt = { i, after: e.clientY > r.top + r.height / 2 };
	}
	function onDrop(e: DragEvent) {
		e.preventDefault();
		if (dragFrom !== null && dropAt) {
			let to = dropAt.i + (dropAt.after ? 1 : 0);
			if (dragFrom < to) to--;
			moveSlot(dragFrom, to);
		}
		dragFrom = null;
		dropAt = null;
	}

	// ---- column settings ----
	function patchCategory(id: string, patch: { name?: string; isPrivate?: boolean; disableAi?: boolean }) {
		return run(async () => {
			ov = await updateCategory(id, patch);
		});
	}
	async function addColumn() {
		const name = newName.trim();
		if (!name) return;
		await run(async () => {
			await createCategory(name);
			newName = '';
			ov = await getBoardOverview();
			layout = $state.snapshot(ov.layout) as BoardLayoutCfg;
		});
	}
	async function removeColumn(key: string) {
		const c = info.get(key);
		if (!c?.id) return;
		if (!confirm(`Delete the "${c.name}" column? Its sources stay; they just stop being tagged ${c.name}. Published articles keep the tag.`)) return;
		selected = null;
		await run(async () => {
			await deleteCategory(c.id!);
			await updateSettings({ boardLayout: ops.removeKey(copy(), key) });
			ov = await getBoardOverview();
			layout = $state.snapshot(ov.layout) as BoardLayoutCfg;
		});
	}

	const fedBy = (key: string) => {
		const c = info.get(key);
		if (!c) return '';
		if (c.kind === 'wire') return `Posts with no category · ${c.sources.length} channels`;
		if (c.kind === 'general') return `Articles with no category${c.sources.length ? ` · ${c.sources.join(', ')}` : ''}`;
		return c.sources.length ? c.sources.join(', ') : 'No sources yet';
	};
	const ROTATE = [10, 15, 20, 30, 45, 60];
	// Each column's number in board order (rotating members counted one by one).
	const numbers = $derived(new Map((layout?.slots ?? []).flatMap((s) => s.columns).map((k, i) => [k, i + 1])));
	const feedHref = (c: { kind: string; name: string }) => (c.kind === 'category' ? `/category/${slugify(c.name)}` : `/feed/${c.kind}`);
</script>

{#snippet sw(on: boolean, label: string, onclick: (() => void) | null)}
	{#if onclick}
		<button class="tg" class:on aria-pressed={on} {onclick}><span class="sw"></span>{label}</button>
	{:else}
		<span class="tg na" title="Not applicable to built-in columns">—</span>
	{/if}
{/snippet}

{#snippet row(key: string, n: number | string, slotIndex: number, inGroup: boolean, k: number, groupSize: number)}
	{@const c = info.get(key)}
	{#if c}
		<div class="row" class:sel={selected === key} class:off={layout?.hidden.includes(key)} style:--cc={colorOf(key)}>
			<span class="num">{n}</span>
			<button class="nm" onclick={() => (selected = selected === key ? null : key)}>
				<i></i><b>{c.name}</b><span class="kind">{c.kind === 'category' ? 'Category' : 'Built-in'}</span>
			</button>
			<span class="src" title={fedBy(key)}>{fedBy(key)}</span>
			{@render sw(!layout?.hidden.includes(key), 'Board', () => toggleBoard(key))}
			{@render sw(c.isPrivate, 'Private', c.id ? () => patchCategory(c.id!, { isPrivate: !c.isPrivate }) : null)}
			<span class:aioff={!admin.aiWriterEnabled} title={admin.aiWriterEnabled ? '' : 'The AI writer is off, so no column is rewritten'}>{@render sw(!c.disableAi, 'AI', c.id ? () => patchCategory(c.id!, { disableAi: !c.disableAi }) : null)}</span>
			<span class="act">
				{#if inGroup}
					<button aria-label="Earlier in rotation" disabled={k === 0} onclick={() => moveWithin(slotIndex, k, -1)}>↑</button>
					<button aria-label="Later in rotation" disabled={k === groupSize - 1} onclick={() => moveWithin(slotIndex, k, 1)}>↓</button>
					<button class="txt" onclick={() => ownColumn(slotIndex, key)}>Own column</button>
				{/if}
			</span>
		</div>
	{/if}
{/snippet}

{#if error}<p class="err">{error}</p>{/if}

{#if !ov || !layout}
	<p class="hint">Loading…</p>
{:else}
	<div class="wrap" class:open={!!selectedInfo}>
		<div>
			<div class="panel">
				<div class="ph"><span class="pt">Board preview</span><SaveStatus {status} /></div>
				<p class="hint">
					Left to right, as the home board lays out. Drag a position in the list below to move it; <b>Rotate with next</b> makes two
					positions share one column that rotates.
				</p>
				<div class="pv" style:grid-template-columns="repeat({Math.max(1, layout.slots.length)}, minmax(0, 1fr))">
					{#each layout.slots as s, i (i + s.columns.join())}
						<div class="pc" style:--cc={colorOf(s.columns[0])}>
							{info.get(s.columns[0])?.name}
							{#if s.columns.length > 1}<em>+ {s.columns.slice(1).map((k) => info.get(k)?.name).join(', ')} · rotating</em>{/if}
							<i></i><i></i><i></i><i></i>
						</div>
					{/each}
				</div>
				<div class="pvnote">
					<span>{layout.slots.length} positions, 4 items each</span>
					<span>{layout.autoFold ? 'On a narrower screen, columns fold into a rotating one from the right' : 'Folding is off: narrow screens squeeze every column'}</span>
				</div>
			</div>

			<div class="panel">
				<span class="pt">Columns</span>
				<p class="hint">
					Every feed is a column: your categories, plus the built-in <b>Wire</b> (posts with no category) and <b>General</b> (articles
					with no category). This order is the board's order and also the order the AI writer works through its queue. Click a column's
					name to rename it, pick its colour or choose which sources feed it.
				</p>
				<div class="lh"><span>#</span><span>Column</span><span>Fed by</span><span>On board</span><span>Private</span><span>AI rewrite</span><span></span></div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="list" ondragleave={() => (dropAt = null)}>
					{#each layout.slots as s, i (i + s.columns.join())}
						<div
							class="slot"
							class:dropb={dropAt?.i === i && !dropAt.after}
							class:dropa={dropAt?.i === i && dropAt.after}
							draggable="true"
							ondragstart={() => (dragFrom = i)}
							ondragend={() => ((dragFrom = null), (dropAt = null))}
							ondragover={(e) => onDragOver(e, i)}
							ondrop={onDrop}
						>
							{#if s.columns.length > 1}
								<div class="grp">
									<div class="gh">
										<span class="grip" title="Drag to move">⋮⋮</span>
										<b>Position {i + 1} · rotating</b>
										<span>rotate every</span>
										<select value={s.rotateSeconds} onchange={(e) => setRotate(i, Number(e.currentTarget.value))}>
											{#each ROTATE.includes(s.rotateSeconds) ? ROTATE : [...ROTATE, s.rotateSeconds].sort((a, b) => a - b) as v (v)}<option value={v}>{v} s</option>{/each}
										</select>
										<span class="gsp"></span>
										<span class="arrows"><button aria-label="Move left" disabled={i === 0} onclick={() => moveSlot(i, i - 1)}>▲</button><button aria-label="Move right" disabled={i === layout.slots.length - 1} onclick={() => moveSlot(i, i + 1)}>▼</button></span>
									</div>
									{#each s.columns as key, k (key)}
										{@render row(key, numbers.get(key) ?? '', i, true, k, s.columns.length)}
									{/each}
								</div>
							{:else}
								<div class="single">
									<span class="grip" title="Drag to move">⋮⋮</span>
									{@render row(s.columns[0], numbers.get(s.columns[0]) ?? '', i, false, 0, 1)}
									<span class="arrows"><button aria-label="Move up" disabled={i === 0} onclick={() => moveSlot(i, i - 1)}>▲</button><button aria-label="Move down" disabled={i === layout.slots.length - 1} onclick={() => moveSlot(i, i + 1)}>▼</button></span>
								</div>
							{/if}
							{#if i < layout.slots.length - 1}
								<div class="join"><button onclick={() => rotateWithNext(i)}>↕ rotate with next</button></div>
							{/if}
						</div>
					{/each}
				</div>
				{#if layout.hidden.length}
					<div class="sub">Not on the board · reachable from their own page</div>
					{#each layout.hidden as key (key)}
						<div class="single"><span class="grip"></span>{@render row(key, '–', -1, false, 0, 1)}<span class="arrows"></span></div>
					{/each}
				{/if}
				<form class="add" onsubmit={(e) => (e.preventDefault(), addColumn())}>
					<input placeholder="New column name…" bind:value={newName} />
					<button type="submit" disabled={!newName.trim()}>+ Add column</button>
				</form>
			</div>

			<div class="panel">
				<span class="pt">Automatic rotation</span>
				<label class="chk">
					<input type="checkbox" checked={layout.autoRotateQuiet} onchange={(e) => setAuto('autoRotateQuiet', e.currentTarget.checked)} />
					<span>Move quiet columns into the rotating column<em>A column with nothing new in 48 hours joins the rotation until something arrives.</em></span>
				</label>
				<label class="chk">
					<input type="checkbox" checked={layout.autoFold} onchange={(e) => setAuto('autoFold', e.currentTarget.checked)} />
					<span>Fold columns that don't fit the screen into the rotating column<em>Right-most first; Wire and General fold last.</em></span>
				</label>
			</div>
		</div>

		{#if selectedInfo}
			{@const c = selectedInfo}
			<aside class="drawer" style:--cc={colorOf(c.key)}>
				<div class="dh"><span class="pt">{c.name}</span><span class="kind">{c.kind === 'category' ? 'Category' : 'Built-in'}</span><button class="x" aria-label="Close" onclick={() => (selected = null)}>✕</button></div>
				{#if c.id}
					<div class="fld">
						<label for="colname">Name</label>
						<input id="colname" value={c.name} onchange={(e) => e.currentTarget.value.trim() && patchCategory(c.id!, { name: e.currentTarget.value.trim() })} />
					</div>
				{/if}
				<div class="fld">
					<span class="lbl">Colour</span>
					<div class="cols">
						{#each COLUMN_SWATCHES as sw (sw)}
							<button class="swc" class:on={layout.colors[c.key] === sw} style:--sc={columnColor(undefined, sw)} aria-label="Colour {sw}" onclick={() => setColor(c.key, sw)}></button>
						{/each}
					</div>
				</div>
				<div class="fld">
					<span class="lbl">Feed page</span>
					<a class="in mono" href={feedHref(c)} target="_blank" rel="noopener">{feedHref(c)} ↗</a>
				</div>
				{#if c.kind === 'category'}
					<div class="fld">
						<span class="lbl">Sources feeding this column · {c.sources.length}</span>
						<p class="hint">{c.sources.length ? c.sources.join(', ') : 'None yet.'}</p>
						<a class="in" href="/admin/settings?tab=sources">Add or move sources on Sources &amp; columns →</a>
					</div>
				{:else}
					<p class="hint">
						{c.kind === 'wire' ? 'Wire collects posts (X and Telegram) from sources with no category.' : 'General collects articles from sources with no category.'}
						Give a source a category and it moves to that column.
					</p>
				{/if}
				<div class="dact">
					<button class="pri" onclick={() => (selected = null)}>Done</button>
					<span class="gsp"></span>
					{#if c.id}<button class="danger" onclick={() => removeColumn(c.key)}>Delete column</button>{/if}
				</div>
			</aside>
		{/if}
	</div>
{/if}

<style>
	.wrap {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 18px;
	}
	.wrap.open {
		grid-template-columns: minmax(0, 1fr) 360px;
	}
	.panel {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 16px;
		margin-bottom: 14px;
	}
	.ph {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.pt {
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
	.err {
		color: var(--text-danger);
		font-size: 12.5px;
	}
	.pv {
		display: grid;
		gap: 6px;
		height: 120px;
		grid-template-rows: minmax(0, 1fr);
		padding: 8px;
		border-radius: 10px;
		background: var(--surface-0);
		border: 1px solid var(--border);
	}
	.pc {
		overflow: hidden;
		min-width: 0;
		border-radius: 6px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-top: 3px solid var(--cc);
		padding: 6px 7px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		display: flex;
		flex-direction: column;
		gap: 5px;
		white-space: nowrap;
	}
	.pc em {
		font-style: normal;
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pc i {
		display: block;
		height: 6px;
		border-radius: 2px;
		background: var(--border);
	}
	.pvnote {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 11px;
		color: var(--text-muted);
		margin-top: 6px;
	}
	.lh,
	.row {
		display: grid;
		grid-template-columns: 26px minmax(0, 1.1fr) minmax(0, 1fr) 82px 82px 82px 128px;
		gap: 10px;
		align-items: center;
	}
	.lh {
		padding: 0 44px 6px 30px;
		font-size: 10px;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.single {
		display: grid;
		grid-template-columns: 20px minmax(0, 1fr) 40px;
		gap: 6px;
		align-items: center;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--surface-2);
		padding: 7px 8px;
		margin-bottom: 4px;
	}
	.slot.dropb {
		box-shadow: 0 -2px 0 var(--acc);
	}
	.slot.dropa {
		box-shadow: 0 2px 0 var(--acc);
	}
	.grip {
		color: var(--text-muted);
		font-size: 12px;
		letter-spacing: -2px;
		cursor: grab;
	}
	.num {
		font-family: var(--mono);
		font-size: 11.5px;
		color: var(--text-muted);
	}
	.row.sel .nm b {
		color: var(--acc);
	}
	.row.off {
		opacity: 0.6;
	}
	.nm {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		text-align: left;
	}
	.nm i {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		background: var(--cc);
		flex: none;
	}
	.nm b {
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.kind {
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0 5px;
		flex: none;
	}
	.src {
		font-size: 12px;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tg {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-secondary);
		padding: 0;
		border: 0;
		background: none;
	}
	.tg.na {
		color: var(--text-muted);
	}
	.sw {
		width: 26px;
		height: 15px;
		border-radius: 8px;
		background: var(--border);
		position: relative;
		flex: none;
	}
	.sw::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background: var(--text-muted);
		transition: left 0.12s ease;
	}
	.tg.on .sw {
		background: color-mix(in srgb, var(--acc) 70%, transparent);
	}
	.tg.on .sw::after {
		left: 13px;
		background: #fff;
	}
	.act {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 2px;
	}
	.act button,
	.arrows button {
		font-size: 11px;
		padding: 1px 5px;
		background: transparent;
	}
	.act button:disabled,
	.arrows button:disabled {
		opacity: 0.3;
	}
	.arrows {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.txt {
		border: 0;
		color: var(--acc);
		white-space: nowrap;
	}
	.join {
		display: flex;
		justify-content: center;
		margin: -1px 0 3px;
	}
	.join button {
		font-size: 10.5px;
		padding: 0 10px;
		border-radius: 99px;
		border: 1px dashed var(--border);
		background: transparent;
		color: var(--text-muted);
	}
	.join button:hover {
		color: var(--acc);
		border-color: var(--acc);
	}
	.grp {
		border: 1px solid color-mix(in srgb, var(--acc) 45%, var(--border));
		border-radius: 11px;
		padding: 8px 8px 4px;
		margin: 2px 0 4px;
		background: color-mix(in srgb, var(--acc) 5%, transparent);
	}
	.gh {
		display: flex;
		align-items: center;
		gap: 9px;
		margin: 0 2px 6px;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.gh b {
		color: var(--text-primary);
		font-size: 12px;
	}
	.gh select {
		width: auto;
		font-size: 12px;
		padding: 1px 4px;
	}
	.gh .arrows {
		flex-direction: row;
	}
	.gsp {
		flex: 1;
	}
	.grp .row {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-1);
		padding: 6px 8px;
		margin-bottom: 4px;
	}
	.sub {
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin: 16px 2px 8px;
	}
	.add {
		display: flex;
		gap: 8px;
		margin-top: 12px;
	}
	.add input {
		flex: 1;
	}
	.chk {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		margin-top: 10px;
		font-size: 12.5px;
	}
	.chk input {
		width: auto;
		margin-top: 2px;
	}
	.chk em {
		display: block;
		font-style: normal;
		font-size: 11.5px;
		color: var(--text-muted);
	}
	.drawer {
		background: var(--surface-1);
		border: 1px solid var(--cc);
		border-radius: 12px;
		padding: 16px;
		align-self: start;
		position: sticky;
		top: 10px;
	}
	.dh {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.x {
		margin-left: auto;
		background: transparent;
		border: 0;
		color: var(--text-muted);
	}
	.fld {
		margin-top: 12px;
	}
	.fld label,
	.lbl {
		display: block;
		font-size: 11px;
		color: var(--text-muted);
		margin-bottom: 5px;
	}
	.in {
		display: block;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 7px 10px;
	}
	.mono {
		font-family: var(--mono);
		font-size: 12px;
	}
	.cols {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
	}
	.swc {
		width: 22px;
		height: 22px;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: var(--sc);
	}
	.swc.on {
		box-shadow:
			0 0 0 2px var(--surface-1),
			0 0 0 4px var(--text-primary);
	}
	.aioff {
		opacity: 0.45;
	}
	.dact {
		display: flex;
		gap: 8px;
		margin-top: 14px;
	}
	.pri {
		background: var(--text-primary);
		color: var(--surface-0);
		border-color: var(--text-primary);
		font-weight: 600;
	}
	.danger {
		color: var(--text-danger);
	}
</style>
