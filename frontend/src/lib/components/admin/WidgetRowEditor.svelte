<script lang="ts">
	/**
	 * Arranges the widget row under the top bar: which widgets sit in which position, and
	 * which share a position as a carousel (e.g. Markets and PoE2). Mirrors the backend's
	 * resolveWidgetSlots so what's shown here is what the board shows. Saves on change.
	 */
	import type { AdminSettings, InstalledWidget } from '$lib/adminTypes';
	import { updateSettings } from '$lib/adminApi';
	import SaveStatus from './SaveStatus.svelte';

	type Slot = { widgets: string[]; rotateSeconds: number };
	let {
		settings,
		installed,
		order,
		titles
	}: { settings: AdminSettings; installed: InstalledWidget[]; order: string[]; titles: Record<string, string> } = $props();

	const TOP_BAR = new Set(['searchbar']);
	const enabledIds = $derived(order.filter((id) => installed.find((w) => w.id === id)?.enabled && !TOP_BAR.has(id)));

	function resolve(saved: Slot[], ids: string[]): Slot[] {
		const on = new Set(ids);
		let out: Slot[];
		if (saved.length) out = saved.map((s) => ({ widgets: s.widgets.filter((w) => on.has(w)), rotateSeconds: s.rotateSeconds || 8 }));
		else {
			out = [];
			for (const id of ids) {
				if (id === 'poe2' && on.has('stocks')) continue;
				out.push({ widgets: id === 'stocks' && on.has('poe2') ? ['stocks', 'poe2'] : [id], rotateSeconds: 8 });
			}
		}
		const placed = new Set(out.flatMap((s) => s.widgets));
		for (const id of ids) if (!placed.has(id)) out.push({ widgets: [id], rotateSeconds: 8 });
		return out.filter((s) => s.widgets.length);
	}

	// svelte-ignore state_referenced_locally
	let saved = $state<Slot[]>(settings.widgetSlots ?? []);
	const slots = $derived(resolve(saved, enabledIds));
	let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

	async function commit(next: Slot[]) {
		saved = next.filter((s) => s.widgets.length);
		status = 'saving';
		try {
			await updateSettings({ widgetSlots: saved });
			status = 'saved';
			setTimeout(() => (status = 'idle'), 1500);
		} catch {
			status = 'error';
		}
	}
	const copy = () => slots.map((s) => ({ widgets: [...s.widgets], rotateSeconds: s.rotateSeconds }));
	function moveSlot(i: number, dir: -1 | 1) {
		const next = copy();
		const j = i + dir;
		if (j < 0 || j >= next.length) return;
		[next[i], next[j]] = [next[j], next[i]];
		commit(next);
	}
	function mergeNext(i: number) {
		const next = copy();
		if (!next[i + 1]) return;
		next[i].widgets.push(...next[i + 1].widgets);
		next.splice(i + 1, 1);
		commit(next);
	}
	function splitOut(i: number, id: string) {
		const next = copy();
		next[i].widgets = next[i].widgets.filter((w) => w !== id);
		next.splice(i + 1, 0, { widgets: [id], rotateSeconds: 8 });
		commit(next);
	}
	function moveWithin(i: number, k: number, dir: -1 | 1) {
		const next = copy();
		const w = next[i].widgets;
		const j = k + dir;
		if (j < 0 || j >= w.length) return;
		[w[k], w[j]] = [w[j], w[k]];
		commit(next);
	}
	function setRotate(i: number, secs: number) {
		const next = copy();
		next[i].rotateSeconds = secs;
		commit(next);
	}
	const reset = () => commit([]);
	const name = (id: string) => titles[id] ?? installed.find((w) => w.id === id)?.displayName ?? id;
</script>

<div class="panel">
	<div class="head"><span class="panel-title">Widget row</span><SaveStatus {status} /></div>
	<p class="hint">
		The row of widgets under the top bar, shown on every page except this admin panel. Widgets sharing a position rotate
		like a carousel (pausing while the pointer is over them); Markets also turns its own pages when it has more tickers than
		fit. Search sits in the top bar. Turn widgets on or off below.
	</p>
	<div class="row">
		{#each slots as slot, i (slot.widgets.join())}
			<div class="slot">
				<div class="sh">
					<b>Position {i + 1}</b>
					<span class="sp"></span>
					<button aria-label="Move left" disabled={i === 0} onclick={() => moveSlot(i, -1)}>‹</button>
					<button aria-label="Move right" disabled={i === slots.length - 1} onclick={() => moveSlot(i, 1)}>›</button>
				</div>
				{#each slot.widgets as id, k (id)}
					<div class="chip">
						<span>{name(id)}</span>
						<span class="sp"></span>
						{#if slot.widgets.length > 1}
							<button aria-label="Earlier in rotation" disabled={k === 0} onclick={() => moveWithin(i, k, -1)}>↑</button>
							<button aria-label="Later in rotation" disabled={k === slot.widgets.length - 1} onclick={() => moveWithin(i, k, 1)}>↓</button>
							<button class="txt" onclick={() => splitOut(i, id)}>Own position</button>
						{/if}
					</div>
				{/each}
				<div class="sf">
					{#if slot.widgets.length > 1 || slot.widgets.includes('stocks')}
						<label>
							Rotate every
							<select value={slot.rotateSeconds} onchange={(e) => setRotate(i, Number(e.currentTarget.value))}>
								{#each [5, 8, 10, 15, 20, 30, 60] as v (v)}<option value={v}>{v}s</option>{/each}
							</select>
						</label>
					{/if}
					<span class="sp"></span>
					{#if i < slots.length - 1}<button class="txt" onclick={() => mergeNext(i)}>Merge with next →</button>{/if}
				</div>
			</div>
		{/each}
	</div>
	{#if saved.length}<button class="txt reset" onclick={reset}>Reset to the default arrangement</button>{/if}
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
	.row {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 10px;
	}
	.slot {
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface-2);
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.sh,
	.chip,
	.sf {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
	}
	.sh b {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.sp {
		flex: 1;
	}
	.chip {
		border: 1px solid var(--border);
		border-radius: 7px;
		padding: 5px 8px;
		background: var(--surface-1);
	}
	button {
		font-size: 12px;
		padding: 1px 6px;
		background: transparent;
	}
	button:disabled {
		opacity: 0.35;
	}
	.txt {
		border: 0;
		color: var(--acc);
		padding: 1px 2px;
	}
	.sf {
		margin-top: auto;
		color: var(--text-muted);
	}
	.sf select {
		width: auto;
		font-size: 12px;
		padding: 2px 4px;
	}
	.reset {
		margin-top: 10px;
	}
</style>
