<script lang="ts">
	import '../lib/styles/app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { invalidateAll, invalidate } from '$app/navigation';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import PrivateAccessModal from '$lib/components/PrivateAccessModal.svelte';
	import Sidebar from '$lib/components/sidebar/Sidebar.svelte';
	import { logoutPrivateAccess } from '$lib/privateAccess';
	import { slugify } from '$lib/format';
	import type { LayoutData } from './$types';

	let { children, data }: { children: any; data: LayoutData } = $props();

	let showLoginModal = $state(false);

	// Weather/Stocks/PoE2/Bookmarks are all backend-polled on their own cadence (15m-1h) —
	// without this, a tab left open never sees those updates, since SvelteKit only re-runs
	// a load() on navigation or explicit invalidation, never on a timer by itself. Scoped
	// to this layout's own 'app:sidebar' dependency (see +layout.ts) rather than
	// invalidateAll(), so it doesn't also re-run page-level loads — e.g. the home feed's
	// own pagination state would otherwise reset every refresh.
	onMount(() => {
		const interval = setInterval(() => invalidate('app:sidebar'), 5 * 60_000);
		return () => clearInterval(interval);
	});

	// Admin pages already use full page width for their own tab UI — the sidebar's utility
	// widgets don't belong there, unlike every reader-facing route (home, category,
	// article, event, more, weather).
	const showSidebar = $derived(!$page.url.pathname.startsWith('/admin'));

	async function handleLockClick() {
		if (data.privateAccess.authenticated) {
			await logoutPrivateAccess();
			await invalidateAll();
		} else {
			showLoginModal = true;
		}
	}

	async function handleLoginSuccess() {
		showLoginModal = false;
		await invalidateAll();
	}

	// "Top stories" is a real Category row (it drives synthesis queue priority) but
	// isn't itself a filterable category — it always means "everything, chronological",
	// i.e. the homepage. Every other admin-defined category gets its own /category/:slug
	// page, unless it's flagged "spillover" (see MergeTab.svelte's category priority
	// list) — those collapse into a single trailing "More »" tab instead, so the nav
	// doesn't get too wide or wrap once there are more than a handful of categories.
	//
	// A tracked item is a displayed category too, just backed by a source+keyword
	// filter instead of manual per-source category checkboxes, and periodically
	// AI-recapped — see EventsTab.svelte. Active ones get their own /event/:id tab,
	// appended after the regular categories, unless marked spillover — same "More »"
	// collapse as an overflow category, see /more's +page.ts.
	const primaryCategories = $derived(data.categories.filter((c) => !c.isSpillover));
	const spilloverCategories = $derived(data.categories.filter((c) => c.isSpillover));
	const primaryEvents = $derived(data.events.filter((e) => !e.isSpillover));
	const spilloverEvents = $derived(data.events.filter((e) => e.isSpillover));

	const navItems = $derived([
		...primaryCategories.map((cat) => ({
			label: cat.name,
			href: cat.name.toLowerCase() === 'top stories' ? '/' : `/category/${slugify(cat.name)}`
		})),
		...primaryEvents.map((event) => ({ label: event.name, href: `/event/${event.id}` })),
		...(spilloverCategories.length > 0 || spilloverEvents.length > 0 ? [{ label: 'More »', href: '/more' }] : [])
	]);

	function isActive(href: string): boolean {
		if (href === '/') return $page.url.pathname === '/';
		return $page.url.pathname.startsWith(href);
	}
</script>

<header class="masthead">
	<div class="page masthead-inner">
		<div class="brand">
			<span class="brand-name">Homefeed</span>
			<span class="brand-tag">self-hosted</span>
		</div>
		<nav class="tabs">
			{#each navItems as item}
				<a class="tab" class:active={isActive(item.href)} href={item.href}>{item.label}</a>
			{/each}
		</nav>
		<div class="controls">
			<ThemeToggle />
			{#if data.privateAccess?.configured}
				<button
					class="lock-btn"
					onclick={handleLockClick}
					aria-label={data.privateAccess.authenticated ? 'Log out of private categories' : 'Log in to private categories'}
					title={data.privateAccess.authenticated ? 'Log out of private categories' : 'Log in to private categories'}
				>
					{#if data.privateAccess.authenticated}
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
							<rect x="5" y="11" width="14" height="10" rx="2" />
							<path d="M8 11V7a4 4 0 0 1 7.75-1.5" />
						</svg>
					{:else}
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
							<rect x="5" y="11" width="14" height="10" rx="2" />
							<path d="M8 11V7a4 4 0 0 1 8 0v4" />
						</svg>
					{/if}
				</button>
			{/if}
			{#if data.adminPanelEnabled}
				<a class="cog" href="/admin/settings" aria-label="Admin settings" title="Admin settings">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
						<circle cx="12" cy="12" r="3" />
						<path
							d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
						/>
					</svg>
				</a>
			{/if}
		</div>
	</div>
</header>

{#if showLoginModal}
	<PrivateAccessModal onClose={() => (showLoginModal = false)} onSuccess={handleLoginSuccess} />
{/if}

<main class="page" class:with-sidebar={showSidebar}>
	<div class="main-col">
		{@render children()}
	</div>
	{#if showSidebar}
		<Sidebar weather={data.weather} stocks={data.stocks} bookmarks={data.bookmarks} poe2={data.poe2} widgetsEnabled={data.widgetsEnabled} />
	{/if}
</main>

<style>
	.masthead {
		border-bottom: 2px solid var(--text-primary);
	}
	.masthead-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
		padding-top: 20px;
		padding-bottom: 12px;
	}
	.brand {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.brand-name {
		font-family: var(--font-voice);
		font-size: 28px;
		font-weight: 500;
		letter-spacing: -0.5px;
	}
	.brand-tag {
		font-size: 11px;
		color: var(--text-muted);
		border: 0.5px solid var(--border);
		padding: 2px 6px;
		border-radius: var(--radius);
	}
	.tabs {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.tab {
		font-size: 13px;
		color: var(--text-secondary);
		padding: 6px 12px;
		border-radius: var(--radius);
	}
	.tab:hover {
		text-decoration: none;
		background: var(--surface-1);
	}
	.tab.active {
		background: var(--pill-bg);
		color: var(--pill-text);
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.lock-btn {
		display: flex;
		align-items: center;
		color: var(--text-secondary);
		padding: 4px;
		border-radius: var(--radius);
		background: transparent;
		border: none;
	}
	.lock-btn:hover {
		background: var(--surface-1);
		color: var(--text-primary);
	}
	.cog {
		display: flex;
		align-items: center;
		color: var(--text-secondary);
		padding: 4px;
		border-radius: var(--radius);
	}
	.cog:hover {
		text-decoration: none;
		background: var(--surface-1);
		color: var(--text-primary);
	}
	.page.with-sidebar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		gap: 32px;
		align-items: start;
	}
	.main-col {
		min-width: 0; /* keeps wide content, e.g. tweet media grids, from forcing the track wider */
	}
	@media (max-width: 900px) {
		.page.with-sidebar {
			grid-template-columns: 1fr;
		}
	}
</style>
