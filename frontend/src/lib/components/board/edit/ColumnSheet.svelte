<script lang="ts">
	/**
	 * A board column's settings, edited where the column sits (issue #1, mockup C1): the
	 * sources feeding it (with adding by pasted link), colour, private, AI rewrite, its place
	 * in the layout, and its feed page. Every change saves at once and the board re-reads.
	 */
	import { onMount } from 'svelte';
	import type { AdminSource } from '$lib/adminTypes';
	import { deleteCategory, getBoardOverview, getSources, pollSourceNow, setColumnAi, updateCategory, updateSettings, type BoardLayoutCfg, type BoardOverview } from '$lib/adminApi';
	import * as ops from '$lib/boardLayoutOps';
	import { admin, boardChanged } from '$lib/adminSession.svelte';
	import { COLUMN_SWATCHES, columnColor, relTime } from '$lib/text';
	import { slugify } from '$lib/format';
	import SourceEditor from '$lib/components/admin/SourceEditor.svelte';

	let { columnKey }: { columnKey: string } = $props();

	let ov = $state<BoardOverview | null>(null);
	let sources = $state<AdminSource[]>([]);
	let error = $state<string | null>(null);
	let busy = $state(false);
	/** A source open in the editor, or "add" with the link that was pasted. */
	let editing = $state<{ id: string } | { add: string } | null>(null);
	let paste = $state('');
	let polling = $state<string | null>(null);

	async function load() {
		try {
			[ov, sources] = await Promise.all([getBoardOverview(), getSources()]);
		} catch (err) {
			error = (err as Error).message;
		}
	}
	onMount(load);

	const col = $derived(ov?.columns.find((c) => c.key === columnKey) ?? null);
	const names = $derived(new Set((ov?.columns ?? []).filter((c) => c.kind === 'category').map((c) => c.name)));
	const isPost = (s: AdminSource) => s.type === 'nitter' || s.type === 'telegram';
	const feeding = $derived(
		!col
			? []
			: sources
					.filter((s) => (col.kind === 'category' ? s.category.includes(col.name) : !s.category.some((x) => names.has(x)) && (col.kind === 'wire' ? isPost(s) : !isPost(s))))
					.sort((a, b) => Number(!!b.lastError) - Number(!!a.lastError) || a.name.localeCompare(b.name))
	);
	const color = $derived(col ? columnColor(col.name, ov?.layout.colors[col.key]) : 'var(--tx3)');
	const slot = $derived(ov ? ops.slotOf(ov.layout, columnKey) : -1);
	const rotating = $derived(slot >= 0 && (ov?.layout.slots[slot].columns.length ?? 0) > 1);
	const hidden = $derived(!!ov?.layout.hidden.includes(columnKey));
	const editorColumns = $derived(
		(ov?.columns ?? []).filter((c) => c.kind === 'category').map((c) => ({ name: c.name, color: columnColor(c.name, ov?.layout.colors[c.key]) }))
	);
	const TYPE_SHORT: Record<string, string> = { rss: 'RSS', api: 'API', youtube: 'YT', nitter: 'X', telegram: 'TG' };
	const aiHint = $derived(
		!admin.aiWriterEnabled
			? 'The AI writer is off, so nothing is rewritten.'
			: col?.kind === 'wire'
				? 'Merge posts about the same story into one rewritten article. Off, each post publishes as posted.'
				: 'Merge and rewrite stories in this column.'
	);
	const feedHref = $derived(col ? (col.kind === 'category' ? `/category/${slugify(col.name)}` : `/feed/${col.kind}`) : '/');

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		error = null;
		try {
			await fn();
			boardChanged();
		} catch (err) {
			error = /409/.test((err as Error).message) ? 'Another column already has that name.' : (err as Error).message;
		} finally {
			busy = false;
		}
	}
	const saveLayout = (next: BoardLayoutCfg) =>
		run(async () => {
			await updateSettings({ boardLayout: next });
			ov = await getBoardOverview();
		});
	const patch = (p: { name?: string; isPrivate?: boolean; disableAi?: boolean }) =>
		run(async () => {
			ov = await updateCategory(col!.id!, p);
		});

	async function pollNow(s: AdminSource) {
		polling = s.id;
		try {
			const r = await pollSourceNow(s.id);
			sources = sources.map((x) => (x.id === s.id ? r.source : x));
			if (r.ingested > 0) boardChanged();
		} finally {
			polling = null;
		}
	}

	async function remove() {
		if (!col?.id || !ov) return;
		if (!confirm(`Delete the "${col.name}" column? Its sources stay; they just stop feeding it.`)) return;
		const layout = ov.layout;
		await run(async () => {
			await deleteCategory(col.id!);
			await updateSettings({ boardLayout: ops.removeKey(layout, columnKey) });
		});
		admin.sheet = null;
	}

	function saved(s: AdminSource) {
		sources = sources.some((x) => x.id === s.id) ? sources.map((x) => (x.id === s.id ? s : x)) : [...sources, s];
		editing = null;
		paste = '';
		getBoardOverview().then((o) => (ov = o));
		boardChanged();
	}
</script>

{#if !ov}
	<p class="hint">{error ?? 'Loading…'}</p>
{:else if !col}
	<p class="hint">This column no longer exists.</p>
{:else if editing}
	<button class="ghost back" onclick={() => (editing = null)}>← {col.name}</button>
	{#if 'add' in editing}
		<SourceEditor
			source={null}
			columns={editorColumns}
			presetColumns={col.kind === 'category' ? [col.name] : []}
			presetInput={editing.add}
			onSaved={saved}
			onOpen={(id) => (editing = { id })}
			onClose={() => (editing = null)}
		/>
	{:else}
		{@const s = sources.find((x) => x.id === (editing as { id: string }).id)}
		{#if s}
			<SourceEditor
				source={s}
				columns={editorColumns}
				onSaved={saved}
				onDeleted={(id) => ((sources = sources.filter((x) => x.id !== id)), (editing = null), boardChanged())}
				onClose={() => (editing = null)}
			/>
		{/if}
	{/if}
{:else}
	<div class="hd" style:--cc={color}>
		<i></i>
		{#if col.id}
			<input class="name" value={col.name} aria-label="Column name" onchange={(e) => e.currentTarget.value.trim() && patch({ name: e.currentTarget.value.trim() })} />
		{:else}
			<b class="name">{col.name}</b>
		{/if}
		<span class="kind">{col.kind === 'category' ? 'Column' : 'Built-in'}</span>
	</div>
	{#if error}<p class="err small">{error}</p>{/if}

	<div class="fld">
		<span class="lbl">
			{#if col.kind === 'wire'}Posts from sources with no column · {feeding.length}{:else if col.kind === 'general'}Articles from sources with no column · {feeding.length}{:else}Sources feeding {col.name} · {feeding.length}{/if}
		</span>
		{#each feeding as s (s.id)}
			<div class="src">
				<i class="dot" class:bad={!!s.lastError} class:off={!s.enabled}></i>
				<button class="nm" onclick={() => (editing = { id: s.id })} title={s.lastError ?? ''}>{s.name}</button>
				<span class="tb">{TYPE_SHORT[s.type] ?? s.type} · {s.pollIntervalMinutes}m</span>
				<button class="ghost" onclick={() => pollNow(s)} disabled={polling === s.id} title={s.lastPolledAt ? `Last poll ${relTime(s.lastPolledAt, Date.now())}` : ''}>{polling === s.id ? '…' : 'Poll'}</button>
			</div>
			{#if s.lastError}<div class="errbox small">{s.lastError}</div>{/if}
		{:else}
			<p class="hint">None yet.</p>
		{/each}
		{#if col.kind === 'category'}
			<form onsubmit={(e) => (e.preventDefault(), paste.trim() && (editing = { add: paste.trim() }))}>
				<input class="full" bind:value={paste} placeholder="+ Paste a link to add it to {col.name}" aria-label="Add a source to {col.name}" />
			</form>
		{:else}
			<p class="hint">Give a source a column and it moves there.</p>
		{/if}
	</div>

	<div class="fld">
		<span class="lbl">Colour</span>
		<div class="sw">
			{#each COLUMN_SWATCHES as c (c)}
				<button class="swc" class:on={ov.layout.colors[col.key] === c} style:--sc={columnColor(undefined, c)} aria-label="Colour {c}" onclick={() => saveLayout(ops.setColor(ov!.layout, col.key, c))} disabled={busy}></button>
			{/each}
		</div>
	</div>

	{#if col.id}
		<label class="check">
			<input type="checkbox" checked={col.isPrivate} onchange={() => patch({ isPrivate: !col.isPrivate })} disabled={busy} />
			<span>Private<em>Only visitors who unlock private columns see it.</em></span>
		</label>
	{/if}
	<label class="check" class:muted={!admin.aiWriterEnabled}>
		<input type="checkbox" checked={!col.disableAi} onchange={() => run(async () => (ov = await setColumnAi(col, col.disableAi)))} disabled={busy} />
		<span>AI rewrite<em>{aiHint}</em></span>
	</label>

	<div class="fld">
		<span class="lbl">Place on the board</span>
		<div class="row">
			{#if hidden}
				<button class="btn" onclick={() => saveLayout(ops.toggleBoard(ov!.layout, col.key))} disabled={busy}>Show on the board</button>
			{:else}
				<button class="btn" onclick={() => saveLayout(ops.moveSlot(ov!.layout, slot, slot - 1))} disabled={busy || slot <= 0}>← Left</button>
				<button class="btn" onclick={() => saveLayout(ops.moveSlot(ov!.layout, slot, slot + 1))} disabled={busy || slot >= ov.layout.slots.length - 1}>Right →</button>
				{#if rotating}
					<button class="btn" onclick={() => saveLayout(ops.ownColumn(ov!.layout, slot, col.key))} disabled={busy}>Own column</button>
				{:else if slot < ov.layout.slots.length - 1}
					<button class="btn" onclick={() => saveLayout(ops.rotateWithNext(ov!.layout, slot))} disabled={busy}>Rotate with next</button>
				{/if}
				<button class="btn" onclick={() => saveLayout(ops.toggleBoard(ov!.layout, col.key))} disabled={busy}>Hide from board</button>
			{/if}
		</div>
	</div>

	<div class="foot">
		<a href={feedHref}>Open {feedHref} ↗</a>
		<span class="sp"></span>
		{#if col.id}<button class="ghost danger" onclick={remove} disabled={busy}>Delete column…</button>{/if}
	</div>
{/if}

<style>
	.back {
		align-self: flex-start;
		margin-bottom: 8px;
	}
	.hd {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0 30px 14px 0;
	}
	.hd i {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		background: var(--cc);
		flex: none;
	}
	.name {
		flex: 1;
		min-width: 0;
		font-family: var(--serif);
		font-size: 22px;
		font-weight: 500;
		background: transparent;
		border-color: transparent;
		padding: 2px 6px;
		margin-left: -6px;
	}
	input.name:hover,
	input.name:focus {
		border-color: var(--bd);
	}
	.kind {
		font-size: 11px;
		color: var(--tx2);
	}
	.src {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		margin-bottom: 6px;
		border: 1px solid var(--bd);
		border-radius: 8px;
		background: var(--s2);
	}
	.src .nm {
		flex: 1;
		min-width: 0;
		text-align: left;
		background: none;
		border: 0;
		padding: 0;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.src .nm:hover {
		text-decoration: underline;
	}
	.small {
		font-size: 11px;
		margin: -2px 0 8px;
	}
	form {
		margin-top: 4px;
	}
	.sw {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.swc {
		width: 24px;
		height: 24px;
		padding: 0;
		border-radius: 6px;
		background: var(--sc);
		border: 0;
	}
	.swc.on {
		box-shadow: 0 0 0 2px var(--s1), 0 0 0 4px var(--tx);
	}
	.muted {
		opacity: 0.55;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-top: 14px;
		margin-top: 6px;
		border-top: 1px solid var(--bd);
		font-size: 12px;
	}
</style>
