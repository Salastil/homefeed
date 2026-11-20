<script lang="ts">
	/**
	 * Board edit mode's overlay (issue #1, mockup C1): the sheet for whatever was picked on the
	 * board (a column, a widget-row position, the storyline panel) and a reminder of failing
	 * sources. Only mounted for a signed-in admin (see adminSession.svelte.ts).
	 */
	import { invalidate } from '$app/navigation';
	import type { AdminSettings } from '$lib/adminTypes';
	import { getSettings, getSources } from '$lib/adminApi';
	import { admin, boardChanged } from '$lib/adminSession.svelte';
	import StorylinesTab from '$lib/components/admin/StorylinesTab.svelte';
	import ColumnSheet from './ColumnSheet.svelte';
	import WidgetSheet from './WidgetSheet.svelte';

	let failing = $state<string[]>([]);
	let panelSettings = $state<AdminSettings | null>(null);

	// Failing sources, re-read whenever edit mode starts.
	$effect(() => {
		if (!admin.editing) return;
		getSources()
			.then((s) => (failing = s.filter((x) => x.lastError).map((x) => x.name)))
			.catch(() => {});
	});

	$effect(() => {
		if (admin.sheet?.kind !== 'panel') return;
		panelSettings = null;
		getSettings()
			.then((s) => (panelSettings = s))
			.catch(() => {});
	});

	function close() {
		const was = admin.sheet;
		admin.sheet = null;
		// Widget settings show through the layout's own data; the panel's through the board's.
		if (was?.kind === 'widgets') invalidate('app:sidebar');
		if (was?.kind === 'panel') boardChanged();
	}

	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || admin.palette) return;
		if (admin.sheet) close();
		else if (admin.editing) admin.editing = false;
	}
</script>

<svelte:window onkeydown={onKey} />

{#if admin.sheet}
	{#key JSON.stringify(admin.sheet)}
		<aside class="adm sheet" aria-label="Edit">
			<button class="ghost x" aria-label="Close" onclick={close}>✕</button>
			<div class="in">
				{#if admin.sheet.kind === 'column'}
					<ColumnSheet columnKey={admin.sheet.key} />
				{:else if admin.sheet.kind === 'widgets'}
					<WidgetSheet ids={admin.sheet.ids} />
				{:else if panelSettings}
					<div class="ptitle">Storyline panel</div>
					<StorylinesTab settings={panelSettings} section="panel" />
					<a class="more" href="/admin/settings?tab=storylines">Grouping and lifecycle →</a>
				{:else}
					<p class="hint">Loading…</p>
				{/if}
			</div>
		</aside>
	{/key}
{/if}

{#if admin.editing && failing.length}
	<a class="adm pill" href="/admin/settings?tab=status" title={failing.join(', ')}>
		<i class="dot bad"></i>{failing.length} source{failing.length === 1 ? '' : 's'} failing<span>Show</span>
	</a>
{/if}

<style>
	.sheet {
		position: fixed;
		top: 12px;
		right: 12px;
		bottom: 12px;
		width: min(420px, calc(100vw / var(--ui-zoom) - 24px));
		z-index: 60;
		background: var(--s1);
		border: 1px solid var(--bd);
		border-radius: 14px;
		box-shadow: -24px 0 60px rgba(0, 0, 0, 0.45);
		display: flex;
		flex-direction: column;
	}
	.x {
		position: absolute;
		top: 10px;
		right: 10px;
		z-index: 1;
	}
	.in {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 16px 18px;
		display: flex;
		flex-direction: column;
	}
	.ptitle {
		margin-right: 30px;
		font-family: var(--serif);
		font-size: 22px;
		font-weight: 500;
		margin-bottom: 12px;
	}
	.more {
		font-size: 12px;
	}
	.pill {
		position: fixed;
		left: 16px;
		bottom: 16px;
		z-index: 55;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 14px;
		border-radius: 999px;
		background: var(--s2);
		border: 1px solid var(--bd);
		color: var(--tx);
		font-size: 12px;
		box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
	}
	.pill span {
		color: var(--acc);
	}
	.pill:hover {
		text-decoration: none;
	}
</style>
