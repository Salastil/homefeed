<script lang="ts">
	/**
	 * The web search box in the top bar - a built-in widget since issue #3 (it used to be the
	 * uploaded "searchbar" widget). DuckDuckGo, Google and Bing, plus any engines the admin
	 * adds under Widgets → Search. The chosen engine is remembered in this browser; "/" jumps
	 * to the box; a search opens in a new tab.
	 */
	import { getBackendUrl } from '$lib/config';

	type Engine = { id: string; name: string; urlTemplate: string };
	const BUILTIN: Engine[] = [
		{ id: 'duckduckgo', name: 'DuckDuckGo', urlTemplate: 'https://duckduckgo.com/?q=%s' },
		{ id: 'google', name: 'Google', urlTemplate: 'https://www.google.com/search?q=%s' },
		{ id: 'bing', name: 'Bing', urlTemplate: 'https://www.bing.com/search?q=%s' }
	];
	// Same key the uploaded widget used, so the engine people picked carries over.
	const SELECTED_KEY = 'homefeed:searchWidget:selectedEngine';

	let custom = $state<Engine[]>([]);
	const engines = $derived([...BUILTIN, ...custom]);
	let selected = $state('duckduckgo');
	let query = $state('');
	let input: HTMLInputElement | undefined = $state();

	$effect(() => {
		try {
			const stored = localStorage.getItem(SELECTED_KEY);
			if (stored) selected = stored;
		} catch {
			/* private mode: start on the first engine */
		}
		fetch(`${getBackendUrl()}/api/widget/searchbar/engines`)
			.then((r) => (r.ok ? r.json() : []))
			.then((list) => {
				if (Array.isArray(list)) custom = list;
			})
			.catch(() => {
				/* the three built-in engines still work */
			});
	});
	// An engine the admin has since removed falls back to the first one.
	const engine = $derived(engines.find((e) => e.id === selected) ?? engines[0]);

	function pick(id: string) {
		selected = id;
		try {
			localStorage.setItem(SELECTED_KEY, id);
		} catch {
			/* best effort */
		}
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const q = query.trim();
		if (!q || !engine) return;
		window.open(engine.urlTemplate.replace('%s', encodeURIComponent(q)), '_blank', 'noopener,noreferrer');
		query = '';
	}

	function onKey(e: KeyboardEvent) {
		if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		e.preventDefault();
		input?.focus();
	}
</script>

<svelte:window onkeydown={onKey} />

<form class="search" onsubmit={submit} role="search">
	<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
	<input bind:this={input} bind:value={query} type="text" placeholder="Search the web" aria-label="Search the web" />
	<select value={engine?.id} onchange={(e) => pick(e.currentTarget.value)} aria-label="Search engine">
		{#each engines as en (en.id)}<option value={en.id}>{en.name}</option>{/each}
	</select>
	<span class="key" title="Press / to search">/</span>
</form>

<style>
	.search {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 36px;
		padding: 0 8px 0 34px;
		border: 1px solid var(--bd);
		border-radius: 9px;
		background: var(--s1);
	}
	.search:focus-within {
		border-color: var(--acc);
	}
	.ic {
		position: absolute;
		left: 11px;
		top: 50%;
		transform: translateY(-50%);
		width: 15px;
		height: 15px;
		fill: none;
		stroke: var(--tx3);
		stroke-width: 2;
		stroke-linecap: round;
		pointer-events: none;
	}
	input {
		flex: 1;
		min-width: 0;
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		font-size: 13.5px;
		outline: none;
		box-shadow: none;
	}
	select {
		flex: none;
		width: auto;
		max-width: 140px;
		height: 24px;
		padding: 0 6px;
		font-size: 11.5px;
		border-radius: 6px;
		border: 1px solid var(--bd);
		background: var(--s2);
		color: var(--tx2);
	}
	.key {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--tx3);
		border: 1px solid var(--bd);
		border-radius: 5px;
		padding: 0 6px;
		line-height: 18px;
	}
	@media (max-width: 760px) {
		.key {
			display: none;
		}
	}
</style>
