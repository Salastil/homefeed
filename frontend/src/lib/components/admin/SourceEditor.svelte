<script lang="ts">
	/**
	 * One source's settings, or a new source added from a pasted link (issue #1: B3's card
	 * panel, and the board's column sheet). Adding starts from "Add by URL": the backend works
	 * out the type, name and feed url, and says if a source already reads it.
	 */
	import type { AdminSource } from '$lib/adminTypes';
	import {
		addSource,
		clearSourceContent,
		deleteSource,
		detectSource,
		pollSourceNow,
		reissueSourceContent,
		updateSource,
		type DetectedSource
	} from '$lib/adminApi';
	import { untrack } from 'svelte';
	import { relTime } from '$lib/text';

	type Col = { name: string; color: string };
	let {
		source = null,
		columns,
		presetColumns = [],
		presetInput = '',
		onSaved,
		onDeleted,
		onOpen,
		onClose
	}: {
		/** null = adding a new source. */
		source?: AdminSource | null;
		/** The categories a source can feed, in board order, with their colours. */
		columns: Col[];
		presetColumns?: string[];
		presetInput?: string;
		onSaved: (s: AdminSource) => void;
		onDeleted?: (id: string) => void;
		/** Jump to another source (the one a pasted link already belongs to). */
		onOpen?: (id: string) => void;
		onClose: () => void;
	} = $props();

	const TYPES: { v: AdminSource['type']; label: string }[] = [
		{ v: 'rss', label: 'RSS' },
		{ v: 'api', label: 'API' },
		{ v: 'telegram', label: 'Telegram' },
		{ v: 'youtube', label: 'YouTube' },
		{ v: 'nitter', label: 'Nitter' }
	];
	const URL_LABEL: Record<AdminSource['type'], string> = {
		rss: 'Feed URL',
		api: 'URL',
		telegram: 'Channel (@name or t.me link, public channels only)',
		youtube: 'Channel (@handle, /channel/UC… or channel ID)',
		nitter: 'Nitter list or user RSS URL'
	};
	const POLLS = [5, 15, 60];
	const TYPE_SHORT: Record<string, string> = { rss: 'RSS', api: 'API', youtube: 'YT', nitter: 'X', telegram: 'TG' };

	const blank = () => ({ name: '', type: 'rss' as AdminSource['type'], url: '', category: [] as string[], pollIntervalMinutes: 15 });
	let form = $state(blank());
	let paste = $state('');
	let detected = $state<DetectedSource | null>(null);
	let detecting = $state(false);
	let detectError = $state<string | null>(null);
	let busy = $state<string | null>(null);
	let message = $state<{ text: string; bad?: boolean } | null>(null);
	let current = $state<AdminSource | null>(null);

	const fromSource = (s: AdminSource) => ({ name: s.name, type: s.type, url: s.url ?? '', category: [...s.category], pollIntervalMinutes: s.pollIntervalMinutes });

	// Reset whenever a different source (or "add") is opened - and only then: the reset itself
	// reads form state, which must not make typing re-run it.
	$effect(() => {
		const s = source;
		untrack(() => {
			current = s;
			message = null;
			detected = null;
			detectError = null;
			if (s) {
				form = fromSource(s);
			} else {
				form = { ...blank(), category: [...presetColumns] };
				paste = presetInput;
				if (presetInput) detect();
			}
		});
	});

	const dirty = $derived(
		!!current &&
			(form.name !== current.name ||
				form.type !== current.type ||
				form.url !== (current.url ?? '') ||
				form.pollIntervalMinutes !== current.pollIntervalMinutes ||
				form.category.join('\u0000') !== current.category.join('\u0000'))
	);
	const polls = $derived(POLLS.includes(form.pollIntervalMinutes) ? POLLS : [...POLLS, form.pollIntervalMinutes].sort((a, b) => a - b));
	const known = $derived(new Set(columns.map((c) => c.name)));
	// Categories a source carries that aren't board columns (an old tag): kept, shown as-is.
	const extra = $derived(form.category.filter((c) => !known.has(c)));

	function toggleCol(name: string) {
		form.category = form.category.includes(name) ? form.category.filter((c) => c !== name) : [...form.category, name];
	}

	async function detect() {
		const input = paste.trim();
		if (!input) return;
		detecting = true;
		detectError = null;
		detected = null;
		try {
			const d = await detectSource(input);
			detected = d;
			form = { ...form, name: d.name, type: d.type, url: d.url };
		} catch (err) {
			detectError = (err as Error).message;
		} finally {
			detecting = false;
		}
	}

	async function act(label: string, fn: () => Promise<void>) {
		busy = label;
		message = null;
		try {
			await fn();
		} catch (err) {
			message = { text: (err as Error).message, bad: true };
		} finally {
			busy = null;
		}
	}

	const save = () =>
		act('save', async () => {
			if (!form.name.trim() || !form.url.trim()) throw new Error('A source needs a name and a URL.');
			const payload = { name: form.name.trim(), type: form.type, url: form.url.trim(), category: form.category, pollIntervalMinutes: form.pollIntervalMinutes };
			if (current) {
				current = await updateSource(current.id, payload);
				message = { text: 'Saved.' };
				onSaved(current);
			} else {
				const created = await addSource(payload);
				onSaved(created);
			}
		});

	const pollNow = () =>
		act('poll', async () => {
			const { ingested, source: s } = await pollSourceNow(current!.id);
			current = s;
			message = { text: s.lastError ? 'Polled, and it failed again.' : ingested > 0 ? `${ingested} new item(s).` : 'Up to date, nothing new.', bad: !!s.lastError };
			onSaved(s);
		});

	const togglePause = () =>
		act('pause', async () => {
			current = await updateSource(current!.id, { enabled: !current!.enabled });
			onSaved(current);
		});

	const clear = () => {
		if (!confirm(`Clear everything "${current!.name}" has ingested so it repopulates fresh? The source itself stays.`)) return;
		return act('clear', async () => {
			const r = await clearSourceContent(current!.id);
			message = { text: `Cleared ${r.itemsDeleted} item(s) and ${r.articlesDeleted} article(s).` };
		});
	};

	const republish = () => {
		if (!confirm(`Rebuild "${current!.name}"'s published articles from the raw items already stored? Nothing is re-fetched; articles merged with other sources are left alone.`)) return;
		return act('reissue', async () => {
			const r = await reissueSourceContent(current!.id);
			message = { text: `Deleted ${r.articlesDeleted} article(s), requeued ${r.itemsRequeued} item(s). They republish within about a minute.` };
		});
	};

	const remove = () => {
		if (!confirm(`Delete "${current!.name}"? Everything it ingested, and any article made only from it, is deleted too.`)) return;
		return act('delete', async () => {
			await deleteSource(current!.id);
			onDeleted?.(current!.id);
		});
	};
</script>

<div class="ed">
	<div class="eh">
		{#if current}<span class="tb">{TYPE_SHORT[current.type] ?? current.type}</span>{/if}
		<div class="et">
			<b>{current ? current.name : 'Add a source'}</b>
			{#if current}<span class="sub">{current.enabled ? 'Polled' : 'Paused'} every {current.pollIntervalMinutes} min</span>{/if}
		</div>
		<button class="ghost" aria-label="Close" onclick={onClose}>✕</button>
	</div>

	{#if current}
		<div class="health" class:bad={!!current.lastError}>
			<div class="row">
				<i class="dot" class:bad={!!current.lastError} class:off={!current.enabled}></i>
				<b>{current.lastError ? 'Failing' : current.enabled ? 'Healthy' : 'Paused'}</b>
				<span class="sub">· {current.lastPolledAt ? `last poll ${relTime(current.lastPolledAt, Date.now())}` : 'not polled yet'}</span>
			</div>
			{#if current.lastError}
				<div class="errbox">{current.lastError}</div>
				{#if current.type === 'nitter'}<a href="/admin/settings?tab=connections#nitter">Check the Nitter connection →</a>{/if}
				{#if current.type === 'telegram'}<a href="/admin/settings?tab=connections#telegram">Check the Telegram account →</a>{/if}
			{/if}
			<div class="row">
				<button class="btn" onclick={pollNow} disabled={!!busy}>{busy === 'poll' ? 'Polling…' : 'Poll now'}</button>
				<button class="btn" onclick={togglePause} disabled={!!busy}>{current.enabled ? 'Pause' : 'Resume'}</button>
			</div>
		</div>
	{:else}
		<div class="fld">
			<label class="lbl" for="src-paste">Paste a link: a feed, a site, a YouTube channel, a t.me channel or an x.com profile</label>
			<form class="row" onsubmit={(e) => (e.preventDefault(), detect())}>
				<input id="src-paste" class="mono grow" bind:value={paste} placeholder="https://…" onpaste={() => setTimeout(detect)} />
				<button class="btn" type="submit" disabled={detecting || !paste.trim()}>{detecting ? 'Looking…' : 'Find'}</button>
			</form>
		</div>
		{#if detectError}<p class="err small">{detectError}</p>{/if}
		{#if detected}
			<div class="found">
				<b>{detected.found}</b> · type and name filled in below.
				{#if detected.note}<div>{detected.note}</div>{/if}
				{#if detected.existing}
					<div class="err">
						Already a source{detected.existing.category.length ? `, in ${detected.existing.category.join(', ')}` : ''}.
						{#if onOpen}<button class="link" onclick={() => onOpen!(detected!.existing!.id)}>Open {detected.existing.name}</button>{/if}
					</div>
				{/if}
			</div>
		{/if}
	{/if}

	<div class="form">
		<label class="fld"><span class="lbl">Name</span><input bind:value={form.name} /></label>
		<div class="fld">
			<span class="lbl">Type</span>
			<div class="seg">
				{#each TYPES as t (t.v)}<button class:on={form.type === t.v} onclick={() => (form.type = t.v)}>{t.label}</button>{/each}
			</div>
		</div>
		<label class="fld"><span class="lbl">{URL_LABEL[form.type]}</span><input class="mono" bind:value={form.url} /></label>
		<div class="fld">
			<span class="lbl">Columns · none means Wire (posts) or General (articles)</span>
			<div class="chips">
				{#each columns as c (c.name)}
					<button class="chip" class:on={form.category.includes(c.name)} style:--cc={c.color} onclick={() => toggleCol(c.name)}><i></i>{c.name}</button>
				{/each}
				{#each extra as c (c)}
					<button class="chip on" title="Not a board column" onclick={() => toggleCol(c)}>{c} ✕</button>
				{/each}
			</div>
		</div>
		<div class="fld">
			<span class="lbl">Poll every</span>
			<div class="seg">
				{#each polls as p (p)}<button class:on={form.pollIntervalMinutes === p} onclick={() => (form.pollIntervalMinutes = p)}>{p === 60 ? '1 hour' : `${p} min`}</button>{/each}
			</div>
		</div>
		<div class="row">
			{#if current}
				<button class="btn pri" onclick={save} disabled={!!busy || !dirty}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
				{#if dirty}<button class="ghost" onclick={() => (form = fromSource(current!))}>Revert</button>{/if}
			{:else}
				<button class="btn pri" onclick={save} disabled={!!busy || !form.name.trim() || !form.url.trim()}>{busy === 'save' ? 'Adding…' : 'Add source'}</button>
				<button class="ghost" onclick={onClose}>Cancel</button>
			{/if}
		</div>
		{#if message}<p class="small" class:err={message.bad} class:ok={!message.bad}>{message.text}</p>{/if}
	</div>

	{#if current}
		<details class="repair">
			<summary>Repair and delete</summary>
			<div class="col">
				<button class="btn left" onclick={clear} disabled={!!busy}>Clear content <span class="sub">· delete its items and articles, keep the source</span></button>
				<button class="btn left" onclick={republish} disabled={!!busy}>Republish from raw items <span class="sub">· nothing re-fetched</span></button>
				<button class="btn danger left" onclick={remove} disabled={!!busy}>Delete source…</button>
			</div>
		</details>
	{/if}
</div>

<style>
	.ed {
		display: flex;
		flex-direction: column;
	}
	.eh {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding-bottom: 12px;
		margin-bottom: 12px;
		border-bottom: 1px solid var(--bd);
	}
	.eh .tb {
		margin-top: 6px;
	}
	.et {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.et b {
		font-family: var(--serif);
		font-size: 21px;
		font-weight: 500;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}
	.et .sub {
		font-size: 12px;
	}
	.health {
		display: flex;
		flex-direction: column;
		gap: 9px;
		padding: 12px;
		margin-bottom: 14px;
		border-radius: 10px;
		background: var(--s2);
		border: 1px solid var(--bd);
	}
	.health.bad {
		border-color: color-mix(in srgb, var(--dn) 40%, var(--bd));
	}
	.health a {
		font-size: 12px;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	form.row {
		flex-wrap: nowrap;
	}
	.found {
		margin-bottom: 14px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.link {
		background: none;
		border: 0;
		padding: 0;
		color: var(--acc);
		font-size: 12px;
		text-decoration: underline;
	}
	.small {
		font-size: 12px;
		margin: 8px 0 0;
	}
	.repair {
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid var(--bd);
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 10px;
	}
	.left {
		text-align: left;
	}
	.left .sub {
		font-size: 11.5px;
	}
</style>
