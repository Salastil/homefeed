<script lang="ts">
	/**
	 * Sources & columns (issue #1, mockup B3, accepted). Every board column lists the sources
	 * that feed it, in board order, as cards. Drag a card to another column to move it there
	 * (hold Shift to add it to that column as well); a card dropped on Wire or General leaves
	 * the column it came from. Clicking a card opens its settings in the side panel, which
	 * stays in view however far down the page the card is - the scrolling problem the old
	 * Sources list had. "Add by URL" (and each column's +) starts from a pasted link.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import type { AdminSource } from '$lib/adminTypes';
	import { getBoardOverview, getSources, updateSource, type BoardOverview } from '$lib/adminApi';
	import { columnColor } from '$lib/text';
	import { boardChanged } from '$lib/adminSession.svelte';
	import SourceEditor from './SourceEditor.svelte';

	let ov = $state<BoardOverview | null>(null);
	let sources = $state<AdminSource[]>([]);
	let error = $state<string | null>(null);
	let query = $state('');
	let onlyFailing = $state(false);
	/** The side panel: a source's id, or "add" (with the column it was opened from, if any). */
	let panel = $state<{ id: string } | { add: true; column: string | null; input: string } | null>(null);
	let dragId = $state<string | null>(null);
	let dragFrom = $state<string | null>(null);
	let dropKey = $state<string | null>(null);
	let saving = $state(false);

	async function load() {
		try {
			[ov, sources] = await Promise.all([getBoardOverview(), getSources()]);
			error = null;
		} catch (err) {
			error = (err as Error).message;
		}
	}
	onMount(async () => {
		await load();
		// Links from the ⌘K palette and the board: ?source=<id> opens one, ?add=<link> starts adding it.
		const q = $page.url.searchParams;
		if (q.get('source')) panel = { id: q.get('source')! };
		else if (q.has('add')) panel = { add: true, column: q.get('column'), input: q.get('add') ?? '' };
	});

	type Lane = { key: string; kind: 'category' | 'wire' | 'general'; name: string; color: string; hidden: boolean; cards: AdminSource[] };
	const isPostType = (s: AdminSource) => s.type === 'nitter' || s.type === 'telegram';

	const lanes = $derived.by((): Lane[] => {
		if (!ov) return [];
		const info = new Map(ov.columns.map((c) => [c.key, c]));
		const names = new Set(ov.columns.filter((c) => c.kind === 'category').map((c) => c.name));
		const order = [...ov.layout.slots.flatMap((s) => s.columns), ...ov.layout.hidden];
		for (const c of ov.columns) if (!order.includes(c.key)) order.push(c.key);
		return order
			.map((key) => info.get(key))
			.filter((c) => !!c)
			.map((c) => ({
				key: c!.key,
				kind: c!.kind,
				name: c!.name,
				color: columnColor(c!.name, ov!.layout.colors[c!.key]),
				hidden: ov!.layout.hidden.includes(c!.key),
				cards: sources
					.filter((s) =>
						c!.kind === 'category'
							? s.category.includes(c!.name)
							: !s.category.some((x) => names.has(x)) && (c!.kind === 'wire' ? isPostType(s) : !isPostType(s))
					)
					.sort((a, b) => Number(!!b.lastError) - Number(!!a.lastError) || a.name.localeCompare(b.name))
			}));
	});
	const editorColumns = $derived(lanes.filter((l) => l.kind === 'category').map((l) => ({ name: l.name, color: l.color })));
	const failing = $derived(sources.filter((s) => s.lastError));
	const q = $derived(query.trim().toLowerCase());
	const matches = (s: AdminSource) =>
		(!onlyFailing || !!s.lastError) && (!q || s.name.toLowerCase().includes(q) || (s.url ?? '').toLowerCase().includes(q) || s.type.includes(q));
	const selectedId = $derived(panel && 'id' in panel ? panel.id : null);
	const selected = $derived(selectedId ? (sources.find((s) => s.id === selectedId) ?? null) : null);
	const TYPE_SHORT: Record<string, string> = { rss: 'RSS', api: 'API', youtube: 'YT', nitter: 'X', telegram: 'TG' };

	function sub(s: AdminSource): string {
		if (s.lastError) return `failing · ${s.lastError}`;
		if (!s.enabled) return 'paused';
		return `every ${s.pollIntervalMinutes === 60 ? 'hour' : `${s.pollIntervalMinutes} min`}`;
	}
	const alsoIn = (s: AdminSource, lane: Lane) => s.category.filter((c) => c !== lane.name && lanes.some((l) => l.kind === 'category' && l.name === c));

	// ---- drag and drop ----
	function onDragStart(e: DragEvent, s: AdminSource, lane: Lane) {
		dragId = s.id;
		dragFrom = lane.key;
		e.dataTransfer?.setData('text/plain', s.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
	}
	function onDragOver(e: DragEvent, lane: Lane) {
		if (!dragId || lane.key === dragFrom) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = e.shiftKey && lane.kind === 'category' ? 'copy' : 'move';
		dropKey = lane.key;
	}
	function endDrag() {
		dragId = null;
		dragFrom = null;
		dropKey = null;
	}
	async function onDrop(e: DragEvent, to: Lane) {
		e.preventDefault();
		const s = sources.find((x) => x.id === dragId);
		const from = lanes.find((l) => l.key === dragFrom);
		const add = e.shiftKey;
		endDrag();
		if (!s || !from || from.key === to.key) return;
		let category = [...s.category];
		if (!add && from.kind === 'category') category = category.filter((c) => c !== from.name);
		if (to.kind === 'category' && !category.includes(to.name)) category.push(to.name);
		if (category.join('\u0000') === s.category.join('\u0000')) return;
		saving = true;
		try {
			const updated = await updateSource(s.id, { category });
			sources = sources.map((x) => (x.id === s.id ? updated : x));
			ov = await getBoardOverview();
			boardChanged();
		} catch (err) {
			error = (err as Error).message;
		} finally {
			saving = false;
		}
	}

	function saved(s: AdminSource) {
		const exists = sources.some((x) => x.id === s.id);
		sources = exists ? sources.map((x) => (x.id === s.id ? s : x)) : [...sources, s];
		panel = { id: s.id };
		getBoardOverview().then((o) => (ov = o));
		boardChanged();
	}
	function deleted(id: string) {
		sources = sources.filter((x) => x.id !== id);
		panel = null;
		boardChanged();
	}
</script>

<div class="adm sm">
	<div class="top">
		<div class="intro">
			<h1>Sources &amp; columns</h1>
			<p class="sub">
				{sources.length} sources in {lanes.filter((l) => l.kind === 'category').length} columns{failing.length ? ` · ${failing.length} failing` : ''}.
				Drag a card to move it to another column; hold <kbd>Shift</kbd> to add it there as well. Order, colours and rotation are on
				<a href="/admin/settings?tab=board">Board columns</a>.
			</p>
		</div>
		<div class="row tools">
			<input class="find" bind:value={query} placeholder="Find a source" aria-label="Find a source" />
			{#if failing.length}
				<button class="btn" class:danger={!onlyFailing} class:pri={onlyFailing} onclick={() => (onlyFailing = !onlyFailing)}>Failing · {failing.length}</button>
			{/if}
			<button class="btn pri" onclick={() => (panel = { add: true, column: null, input: '' })}>+ Add by URL</button>
		</div>
	</div>
	{#if error}<p class="err">{error}</p>{/if}

	{#if !ov}
		<p class="hint">Loading…</p>
	{:else}
		<div class="wrap">
			<div class="lanes" class:busy={saving}>
				{#each lanes as lane (lane.key)}
					<section
						class="lane"
						class:builtin={lane.kind !== 'category'}
						class:drop={dropKey === lane.key}
						style:--cc={lane.color}
						aria-label={lane.name}
						ondragover={(e) => onDragOver(e, lane)}
						ondragleave={() => dropKey === lane.key && (dropKey = null)}
						ondrop={(e) => onDrop(e, lane)}
					>
						<div class="lh">
							<i></i>
							<b>{lane.name}</b>
							<span class="n">{lane.cards.length || ''}</span>
							<span class="sp"></span>
							{#if lane.kind === 'category'}
								<button class="ghost plus" aria-label="Add a source to {lane.name}" title="Add a source to {lane.name}" onclick={() => (panel = { add: true, column: lane.name, input: '' })}>+</button>
							{/if}
						</div>
						{#if lane.kind === 'wire'}<span class="note">Posts (X, Telegram) from sources with no column</span>{/if}
						{#if lane.kind === 'general'}<span class="note">Articles from sources with no column</span>{/if}
						{#if lane.hidden}<span class="note">Not on the board · its own page only</span>{/if}
						{#each lane.cards as s (s.id)}
							{@const also = alsoIn(s, lane)}
							<button
								class="card"
								class:sel={selectedId === s.id}
								class:dim={!matches(s)}
								class:ghosted={dragId === s.id}
								draggable="true"
								ondragstart={(e) => onDragStart(e, s, lane)}
								ondragend={endDrag}
								onclick={() => (panel = { id: s.id })}
							>
								<span class="c1"><i class="dot" class:bad={!!s.lastError} class:off={!s.enabled}></i><span class="nm">{s.name}</span><span class="tb">{TYPE_SHORT[s.type] ?? s.type}</span></span>
								<span class="c2" class:err={!!s.lastError}>{sub(s)}</span>
								{#if also.length}<span class="c2">also in {also.join(', ')}</span>{/if}
							</button>
						{/each}
						{#if dropKey === lane.key}
							<div class="dz">{lane.kind === 'category' ? 'Drop to feed ' + lane.name : 'Drop to take it out of ' + (lanes.find((l) => l.key === dragFrom)?.name ?? 'its column')}</div>
						{/if}
					</section>
				{/each}
			</div>

			{#if panel}
				<aside class="panel side" aria-label="Source settings">
					{#if 'add' in panel}
						<SourceEditor
							source={null}
							columns={editorColumns}
							presetColumns={panel.column ? [panel.column] : []}
							presetInput={panel.input}
							onSaved={saved}
							onOpen={(id) => (panel = { id })}
							onClose={() => (panel = null)}
						/>
					{:else if selected}
						<SourceEditor source={selected} columns={editorColumns} onSaved={saved} onDeleted={deleted} onClose={() => (panel = null)} />
					{:else}
						<p class="hint">That source no longer exists.</p>
					{/if}
				</aside>
			{/if}
		</div>
	{/if}
</div>

<style>
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 14px;
		margin-bottom: 16px;
	}
	.intro {
		flex: 1 1 520px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.intro .sub {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.5;
		max-width: 760px;
	}
	.find {
		width: 220px;
	}
	.wrap {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: flex-start;
	}
	.lanes {
		flex: 999 1 560px;
		min-width: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 12px;
		align-items: start;
	}
	.lanes.busy {
		opacity: 0.7;
	}
	.lane {
		border: 1px solid var(--bd);
		background: var(--s1);
		border-radius: 12px;
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 7px;
		min-height: 110px;
	}
	.lane.builtin {
		background: transparent;
		border-style: dashed;
	}
	.lane.drop {
		border-color: var(--cc);
		box-shadow: 0 0 0 1px var(--cc);
	}
	.lh {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 2px 2px;
	}
	.lh i {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		background: var(--cc);
	}
	.lh b {
		font-weight: 600;
	}
	.n {
		font-size: 11.5px;
		color: var(--tx2);
	}
	.plus {
		padding: 1px 8px;
		min-height: 24px;
	}
	.note {
		font-size: 11px;
		color: var(--tx2);
		padding: 0 2px 2px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 2px;
		align-items: stretch;
		text-align: left;
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--s2);
		border: 1px solid var(--bd);
		cursor: grab;
		font-size: 13px;
	}
	.card:hover {
		border-color: var(--tx3);
	}
	.card.sel {
		border-color: var(--acc);
		box-shadow: inset 2px 0 0 var(--acc);
	}
	.card.dim {
		opacity: 0.3;
	}
	.card.ghosted {
		opacity: 0.35;
	}
	.c1 {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.nm {
		flex: 1;
		min-width: 0;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.c2 {
		font-size: 11.5px;
		color: var(--tx2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.c2.err {
		color: var(--dn);
	}
	.dz {
		border: 1.5px dashed var(--cc);
		border-radius: 8px;
		padding: 9px 10px;
		color: var(--tx2);
		font-size: 12px;
		text-align: center;
	}
	.side {
		flex: 1 1 340px;
		max-width: 430px;
		position: sticky;
		top: 16px;
		max-height: calc(100vh / var(--ui-zoom) - 32px);
		overflow: auto;
		margin: 0;
	}
	@media (max-width: 760px) {
		.side {
			position: static;
			max-height: none;
			max-width: none;
		}
	}
</style>
