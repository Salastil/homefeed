// Loaded via a runtime dynamic import() from /widget-assets/searchbar/frontend.mjs
// (see DynamicWidgetSlot.svelte) — plain framework-agnostic JS, no build step, no access
// to the host app's Svelte/TS tooling. Base input/select/button styling comes for free
// from the host page's own global stylesheet (frontend/src/lib/styles/app.css) since this
// renders into the same document; only layout specific to this widget is added below.
//
// Custom engines are admin-managed now (see the "Search" section in the admin panel's
// Widgets tab, backed by GET /api/widget/searchbar/engines) rather than something a
// visitor adds per-browser — only which engine is currently selected stays local, since
// that's a personal preference, not shared configuration.

const BUILTIN_ENGINES = [
	{ id: 'duckduckgo', name: 'DuckDuckGo', urlTemplate: 'https://duckduckgo.com/?q=%s' },
	{ id: 'google', name: 'Google', urlTemplate: 'https://www.google.com/search?q=%s' },
	{ id: 'bing', name: 'Bing', urlTemplate: 'https://www.bing.com/search?q=%s' }
];

const SELECTED_KEY = 'homefeed:searchWidget:selectedEngine';

const STYLE_ID = 'hf-searchbar-widget-style';
const STYLE = `
.hf-search-title { display: block; font-size: 12px; font-weight: 500; color: var(--text-muted); margin-bottom: 8px; }
.hf-search-row { display: flex; gap: 6px; }
.hf-search-select { flex-shrink: 0; max-width: 42%; }
.hf-search-input { flex: 1; min-width: 0; }
/* Top-bar layout (ctx.layout === 'bar'): one pill-shaped box, engine picker at the right. */
.hf-search.bar { height: 100%; display: flex; align-items: center; }
.hf-search.bar .hf-search-row { position: relative; align-items: center; gap: 8px; width: 100%; height: 36px;
  padding: 0 8px 0 34px; border: 1px solid var(--bd, var(--border)); border-radius: 9px; background: var(--s1, var(--surface-1)); }
.hf-search.bar .hf-search-row:focus-within { border-color: var(--acc, var(--border-accent)); }
.hf-search.bar .hf-search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); width: 15px; height: 15px; color: var(--tx3, var(--text-muted)); pointer-events: none; }
.hf-search.bar .hf-search-input { order: 1; border: 0; background: transparent; padding: 0; height: 100%; font-size: 13.5px; outline: none; box-shadow: none; }
.hf-search.bar .hf-search-select { order: 2; width: auto; max-width: 140px; height: 24px; padding: 0 6px; font-size: 11.5px; border-radius: 6px;
  border: 1px solid var(--bd, var(--border)); background: var(--s2, var(--surface-2)); color: var(--tx2, var(--text-secondary)); }
.hf-search.bar .hf-search-key { order: 3; font-family: var(--mono, monospace); font-size: 11px; color: var(--tx3, var(--text-muted));
  border: 1px solid var(--bd, var(--border)); border-radius: 5px; padding: 0 6px; line-height: 18px; }
`;

function ensureStyle() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = STYLE;
	document.head.appendChild(style);
}

function el(tag, props, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(props ?? {})) {
		if (key === 'class') node.className = value;
		else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
		else if (value !== undefined && value !== null) node.setAttribute(key, value);
	}
	for (const child of children) {
		if (child == null) continue;
		node.append(child instanceof Node ? child : document.createTextNode(String(child)));
	}
	return node;
}

// localStorage can throw (full quota, strict privacy mode) — same defensive pattern as
// adminAuth.ts's getApiKey/setApiKey: read/write fail quietly, the widget just falls back
// to the first engine each time rather than breaking.
function loadSelectedEngineId() {
	try {
		return localStorage.getItem(SELECTED_KEY);
	} catch {
		return null;
	}
}

function saveSelectedEngineId(id) {
	try {
		localStorage.setItem(SELECTED_KEY, id);
	} catch {
		// best-effort
	}
}

function mount(container, ctx) {
	ensureStyle();

	let customEngines = [];
	const allEngines = () => [...BUILTIN_ENGINES, ...customEngines];

	const select = el('select', { class: 'hf-search-select', 'aria-label': 'Search engine' });
	const input = el('input', { type: 'text', class: 'hf-search-input', placeholder: 'Search…', 'aria-label': 'Search query' });

	function renderSelectOptions() {
		const engines = allEngines();
		const previouslySelected = select.value;
		select.textContent = '';
		for (const engine of engines) {
			select.append(el('option', { value: engine.id }, engine.name));
		}
		const stored = loadSelectedEngineId();
		const target = engines.some((e) => e.id === previouslySelected)
			? previouslySelected
			: engines.some((e) => e.id === stored)
				? stored
				: engines[0]?.id;
		if (target) select.value = target;
	}
	renderSelectOptions();
	select.addEventListener('change', () => saveSelectedEngineId(select.value));

	const form = el(
		'form',
		{
			class: 'hf-search-row',
			onsubmit: (e) => {
				e.preventDefault();
				const query = input.value.trim();
				if (!query) return;
				const engine = allEngines().find((e2) => e2.id === select.value) ?? allEngines()[0];
				if (!engine) return;
				const url = engine.urlTemplate.replace('%s', encodeURIComponent(query));
				window.open(url, '_blank', 'noopener,noreferrer');
				input.value = '';
			}
		},
		select,
		input
	);

	// In the top bar there's no title; the box says what it is, and "/" jumps to it.
	const isBar = ctx.layout === 'bar';
	let onKey = null;
	if (isBar) {
		input.placeholder = 'Search the web';
		const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		icon.setAttribute('viewBox', '0 0 24 24');
		icon.setAttribute('class', 'hf-search-icon');
		icon.innerHTML = '<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
		form.prepend(icon);
		form.append(el('span', { class: 'hf-search-key', title: 'Press / to search' }, '/'));
		onKey = (e) => {
			if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
			const t = e.target;
			if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
			e.preventDefault();
			input.focus();
		};
		window.addEventListener('keydown', onKey);
	}
	const root = isBar
		? el('div', { class: 'hf-search bar' }, form)
		: el('div', { class: 'hf-search' }, el('span', { class: 'hf-search-title' }, 'Search'), form);
	container.append(root);

	// Renders with just the 3 built-ins immediately — no fetch delay before the widget is
	// usable — then adds admin-configured engines once they arrive. Silently keeps
	// built-ins-only on failure (unreachable backend, CORS, etc.) rather than erroring.
	fetch(`${ctx.apiBase}/api/widget/searchbar/engines`)
		.then((res) => (res.ok ? res.json() : []))
		.then((engines) => {
			if (Array.isArray(engines) && engines.length > 0) {
				customEngines = engines;
				renderSelectOptions();
			}
		})
		.catch(() => {
			// best-effort
		});

	return () => {
		if (onKey) window.removeEventListener('keydown', onKey);
		root.remove();
	};
}

export default { mount };
