<script lang="ts">
	/**
	 * ⌘K / Ctrl+K palette (issue #1, mockup C2): finds any admin setting, source or action from
	 * anywhere, and adds a source from a pasted link without leaving the board. Only mounted for
	 * a signed-in admin (adminSession.svelte.ts).
	 */
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { AdminSource } from '$lib/adminTypes';
	import { addSource, detectSource, getBoardOverview, getSources, pollSourceNow, updateSettings, type BoardOverview, type DetectedSource } from '$lib/adminApi';
	import { admin, boardChanged } from '$lib/adminSession.svelte';
	import { columnColor } from '$lib/text';

	type Item = { group: string; label: string; hint?: string; tone?: 'bad' | 'ok'; run: () => void | Promise<void> };

	/** Every admin setting worth finding by name: [label, extra words, page, anchor]. */
	const SETTINGS: [string, string, string, string?][] = [
		['Sources & columns', 'feeds rss youtube telegram nitter add source columns categories', 'sources'],
		['Tracked items', 'events keywords recap developments', 'events'],
		['Board columns', 'order rotation colour color private hide fold quiet', 'board'],
		['Storyline panel', 'rows rotate jump hover hybrid', 'panel'],
		['Widgets', 'widget row weather markets stocks bookmarks poe2 radio search engines upload', 'widgets'],
		['Weather location and units', 'weather city temperature wind', 'widgets'],
		['Markets tickers', 'stocks tickers yahoo symbols', 'widgets'],
		['Bookmarks', 'links', 'widgets'],
		['Search engines', 'searchbar duckduckgo google', 'widgets'],
		['Embedding model', 'ollama embeddings nomic', 'embeddings'],
		['Tags: dedup and expiry', 'tag threshold', 'embeddings'],
		['Storyline grouping', 'join similarity shared name seed window min items sources', 'storylines'],
		['Storyline lifecycle', 'cooling close lifetime', 'storylines'],
		['AI writer', 'synthesis llm generative rewrite merge on off', 'ai'],
		['Merge strictness', 'ai writer cluster similar', 'ai'],
		['Hold before publish', 'wait ai writer', 'ai'],
		['Follow-up articles', 'ai writer', 'ai'],
		['Writing style', 'tone casual formal instructions ai writer', 'ai'],
		['Output language', 'language english ai writer', 'ai'],
		['Synthesis model and server', 'ollama model context window reasoning think ai writer', 'ai'],
		['Status and log', 'logs backlog pipeline health errors storylines status', 'status'],
		['Embedding server', 'ollama host port connection ai server', 'connections', 'ai-servers'],
		['Nitter instance', 'x twitter nitter', 'connections', 'nitter'],
		['Media from X', 'nitter twitter media proxy self-host direct', 'connections', 'nitter'],
		['fxtwitter API', 'nitter twitter enrichment fixtweet', 'connections', 'nitter'],
		['Telegram account', 'telegram login phone api hash', 'connections', 'telegram'],
		['Telegram media', 'telegram media proxy self-host', 'connections'],
		['Retention', 'storage published raw items days age', 'storage'],
		['Storage cap', 'storage size mb gb', 'storage'],
		['Clear all articles or media', 'danger wipe delete storage', 'storage'],
		['Reissue an article', 'republish article id danger', 'storage'],
		['Backup: export or import', 'backup export import zip', 'backup']
	];
	const PLACES: [string, string, string][] = [
		['Status', 'source health, storylines, storage, log', 'status'],
		['Sources & columns', 'add, move and fix sources', 'sources'],
		['Tracked items', 'keywords, sources, developments', 'events'],
		['Connections', 'embedding server, X / Nitter, Telegram', 'connections'],
		['Embeddings & tags', 'model, tag merging', 'embeddings'],
		['Storyline grouping', 'similarity, lifecycle', 'storylines'],
		['AI writer', '', 'ai'],
		['Storage', 'retention, cap, danger zone', 'storage'],
		['Backup', 'export, import', 'backup']
	];
	const TYPE_WORDS: Record<string, AdminSource['type']> = { nitter: 'nitter', x: 'nitter', twitter: 'nitter', telegram: 'telegram', youtube: 'youtube', rss: 'rss' };

	let query = $state('');
	let sel = $state(0);
	let input = $state<HTMLInputElement>();
	let sources = $state<AdminSource[]>([]);
	let ov = $state<BoardOverview | null>(null);
	let note = $state<{ text: string; bad?: boolean } | null>(null);
	let detected = $state<DetectedSource | null>(null);
	let detectError = $state<string | null>(null);
	let detecting = $state(false);
	let colSel = $state(0);

	onMount(() => {
		input?.focus();
		Promise.all([getSources(), getBoardOverview()])
			.then(([s, o]) => ((sources = s), (ov = o)))
			.catch(() => {});
	});

	const close = () => {
		admin.palette = false;
	};
	const toggleEdit = () => {
		admin.editing = !admin.editing;
		if (!admin.editing) admin.sheet = null;
		close();
	};
	const go = (tab: string, anchor?: string) => {
		close();
		goto(`/admin/settings?tab=${tab}${anchor ? `#${anchor}` : ''}`);
	};

	const q = $derived(query.trim().toLowerCase());
	// A pasted link (or @handle) switches to "add a source".
	const isLink = $derived(/^(https?:\/\/|www\.|t\.me\/|@\w)/i.test(query.trim()) || /^[\w-]+(\.[\w-]+)+\/\S*/.test(query.trim()));
	const columns = $derived(
		(ov?.columns ?? []).filter((c) => c.kind === 'category').map((c) => ({ name: c.name, color: columnColor(c.name, ov?.layout.colors[c.key]) }))
	);
	const failing = $derived(sources.filter((s) => s.lastError));

	async function pollMany(list: AdminSource[], what: string) {
		note = { text: `Polling ${list.length} ${what}…` };
		const results = await Promise.allSettled(list.map((s) => pollSourceNow(s.id)));
		const updated = new Map(results.flatMap((r) => (r.status === 'fulfilled' ? [[r.value.source.id, r.value.source] as const] : [])));
		sources = sources.map((s) => updated.get(s.id) ?? s);
		const still = [...updated.values()].filter((s) => s.lastError).length;
		note = { text: `Polled ${list.length} ${what}${still ? `; ${still} still failing` : ', all fine'}.`, bad: still > 0 };
		boardChanged();
	}

	const items = $derived.by((): Item[] => {
		if (isLink) return [];
		const out: Item[] = [];
		const onBoard = $page.url.pathname === '/';
		if (!q) {
			if (failing.length)
				out.push({ group: 'Needs attention', label: `${failing.length} source${failing.length === 1 ? '' : 's'} failing`, hint: failing.map((s) => s.name).join(', '), tone: 'bad', run: () => go('status') });
			for (const [label, hint, tab] of PLACES) out.push({ group: 'Not on the board', label, hint: tab === 'ai' ? (admin.aiWriterEnabled ? 'on' : 'off') : hint, run: () => go(tab) });
			if (onBoard) out.push({ group: 'On the board', label: admin.editing ? 'Stop editing the board' : 'Edit the board', hint: 'click a column, widget or the storyline panel', run: toggleEdit });
			return out;
		}
		const words = q.split(/\s+/);
		const hit = (text: string) => words.every((w) => text.toLowerCase().includes(w));
		for (const [label, extra, tab, anchor] of SETTINGS) if (hit(`${label} ${extra}`)) out.push({ group: 'Settings', label, hint: tab, run: () => go(tab, anchor) });
		for (const s of sources)
			if (hit(`${s.name} ${s.url ?? ''} ${s.type} ${s.category.join(' ')}`))
				out.push({
					group: 'Sources',
					label: s.name,
					hint: s.lastError ? s.lastError : s.category.join(', ') || (s.type === 'nitter' || s.type === 'telegram' ? 'Wire' : 'General'),
					tone: s.lastError ? 'bad' : 'ok',
					run: () => go(`sources&source=${s.id}`)
				});
		const type = TYPE_WORDS[q];
		if (type) {
			const list = sources.filter((s) => s.type === type);
			if (list.length) out.push({ group: 'Actions', label: `Poll every ${type === 'nitter' ? 'Nitter' : type === 'rss' ? 'RSS' : type[0].toUpperCase() + type.slice(1)} source now`, hint: `${list.length}`, run: () => pollMany(list, `${type} sources`) });
		}
		if (hit('poll failing sources retry') && failing.length) out.push({ group: 'Actions', label: 'Poll every failing source now', hint: `${failing.length}`, run: () => pollMany(failing, 'failing sources') });
		if (hit('ai writer turn on off toggle'))
			out.push({
				group: 'Actions',
				label: `Turn the AI writer ${admin.aiWriterEnabled ? 'off' : 'on'}`,
				run: async () => {
					const next = !admin.aiWriterEnabled;
					await updateSettings({ aiWriterEnabled: next });
					admin.aiWriterEnabled = next;
					note = { text: `The AI writer is ${next ? 'on' : 'off'}.` };
				}
			});
		if (onBoard && hit('edit board')) out.push({ group: 'Actions', label: admin.editing ? 'Stop editing the board' : 'Edit the board', run: toggleEdit });
		return out.slice(0, 40);
	});

	// Groups in first-seen order, each item keeping its flat index for keyboard selection.
	const grouped = $derived.by(() => {
		const map = new Map<string, { item: Item; i: number }[]>();
		items.forEach((item, i) => {
			if (!map.has(item.group)) map.set(item.group, []);
			map.get(item.group)!.push({ item, i });
		});
		return [...map.entries()];
	});

	$effect(() => {
		void q;
		sel = 0;
	});

	// Look the pasted link up shortly after typing stops.
	let timer: ReturnType<typeof setTimeout>;
	$effect(() => {
		const text = query.trim();
		const link = isLink;
		clearTimeout(timer);
		detected = null;
		detectError = null;
		if (!link) return;
		timer = setTimeout(async () => {
			detecting = true;
			try {
				const d = await detectSource(text);
				if (query.trim() === text) detected = d;
			} catch (err) {
				if (query.trim() === text) detectError = (err as Error).message;
			} finally {
				detecting = false;
			}
		}, 350);
	});

	async function addTo(column: string | null) {
		if (!detected) return;
		try {
			const created = await addSource({ name: detected.name, type: detected.type, url: detected.url, category: column ? [column] : [], pollIntervalMinutes: 15 });
			sources = [...sources, created];
			note = { text: `Added ${created.name}${column ? ` to ${column}` : ''}. Its first poll is running.` };
			query = '';
			boardChanged();
		} catch (err) {
			note = { text: (err as Error).message, bad: true };
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
			return;
		}
		if (isLink) {
			const n = columns.length + 1;
			if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), (colSel = (colSel + 1) % n));
			else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), (colSel = (colSel + n - 1) % n));
			else if (e.key === 'Enter') {
				e.preventDefault();
				if (e.shiftKey || detected?.existing) {
					close();
					goto(detected?.existing ? `/admin/settings?tab=sources&source=${detected.existing.id}` : `/admin/settings?tab=sources&add=${encodeURIComponent(query.trim())}`);
				} else addTo(columns[colSel]?.name ?? null);
			}
			return;
		}
		if (e.key === 'ArrowDown') (e.preventDefault(), (sel = Math.min(items.length - 1, sel + 1)), scrollSel());
		else if (e.key === 'ArrowUp') (e.preventDefault(), (sel = Math.max(0, sel - 1)), scrollSel());
		else if (e.key === 'Enter' && items[sel]) (e.preventDefault(), items[sel].run());
	}
	let list = $state<HTMLElement>();
	async function scrollSel() {
		await tick();
		list?.querySelector('.it.on')?.scrollIntoView({ block: 'nearest' });
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={close}></div>
<div class="adm pal" role="dialog" aria-modal="true" aria-label="Find a setting">
	<div class="q">
		<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
		<input bind:this={input} bind:value={query} onkeydown={onKey} placeholder="Find a setting, source or action, or paste a link to add it" aria-label="Search admin" />
		<kbd>esc</kbd>
	</div>

	{#if note}<div class="note" class:err={note.bad}>{note.text}</div>{/if}

	<div class="list" bind:this={list}>
		{#if isLink}
			{#if detecting && !detected}<p class="hint pad">Looking at that link…</p>{/if}
			{#if detectError}<p class="err pad">{detectError}</p>{/if}
			{#if detected}
				<div class="found pad-box">
					<b>{detected.found}</b> · {detected.name}
					{#if detected.note}<div>{detected.note}</div>{/if}
					{#if detected.existing}<div class="err">Already a source{detected.existing.category.length ? `, in ${detected.existing.category.join(', ')}` : ''}. Enter opens it.</div>{/if}
				</div>
				{#if !detected.existing}
					<div class="gh">Add as a source, into which column? <span>← → pick · Enter adds · Shift+Enter opens its settings first</span></div>
					<div class="chips pad">
						{#each columns as c, k (c.name)}
							<button class="chip" class:on={colSel === k} style:--cc={c.color} onclick={() => addTo(c.name)}><i></i>{c.name}</button>
						{/each}
						<button class="chip" class:on={colSel === columns.length} onclick={() => addTo(null)}><i></i>No column · {detected.type === 'nitter' || detected.type === 'telegram' ? 'Wire' : 'General'}</button>
					</div>
				{/if}
			{/if}
		{:else if items.length === 0}
			<p class="hint pad">{sources.length ? 'Nothing matches.' : 'Loading…'}</p>
		{:else}
			{#each grouped as [group, rows] (group)}
				<div class="gh">{group}</div>
				{#each rows as { item, i } (i)}
					<button class="it" class:on={i === sel} onmouseenter={() => (sel = i)} onclick={() => item.run()}>
						{#if item.tone}<i class="dot" class:bad={item.tone === 'bad'}></i>{/if}
						<span class="lb">{item.label}</span>
						{#if item.hint}<span class="hn" class:err={item.tone === 'bad'}>{item.hint}</span>{/if}
					</button>
				{/each}
			{/each}
		{/if}
	</div>
	<div class="foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Ctrl</kbd> <kbd>K</kbd> or <kbd>esc</kbd> close</span></div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 80;
		background: rgba(8, 9, 11, 0.5);
	}
	.pal {
		position: fixed;
		z-index: 81;
		top: calc(12vh / var(--ui-zoom));
		left: 50%;
		transform: translateX(-50%);
		width: min(620px, calc(100vw / var(--ui-zoom) - 24px));
		max-height: calc(72vh / var(--ui-zoom));
		display: flex;
		flex-direction: column;
		background: var(--s1);
		border: 1px solid var(--bd);
		border-radius: 14px;
		box-shadow: 0 30px 70px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}
	.q {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--bd);
		color: var(--tx2);
	}
	.q input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		font-size: 15px;
		padding: 4px 0;
		outline: none;
		color: var(--tx);
	}
	.note {
		padding: 8px 16px;
		font-size: 12px;
		color: var(--up);
		border-bottom: 1px solid var(--bd);
	}
	.note.err {
		color: var(--dn);
	}
	.list {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding-bottom: 6px;
	}
	.gh {
		font-size: 10.5px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--tx2);
		padding: 12px 16px 4px;
	}
	.gh span {
		text-transform: none;
		letter-spacing: 0;
		margin-left: 6px;
	}
	.it {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 16px;
		border: 0;
		border-radius: 0;
		background: transparent;
		text-align: left;
		font-size: 13px;
		color: var(--tx);
	}
	.it.on {
		background: var(--s2);
		box-shadow: inset 2px 0 0 var(--acc);
	}
	.lb {
		flex: none;
		max-width: 60%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hn {
		margin-left: auto;
		min-width: 0;
		font-size: 11.5px;
		color: var(--tx2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pad {
		padding: 8px 16px;
		margin: 0;
	}
	.pad-box {
		margin: 12px 16px 4px;
	}
	.foot {
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
		padding: 8px 16px;
		border-top: 1px solid var(--bd);
		font-size: 11.5px;
		color: var(--tx2);
	}
</style>
