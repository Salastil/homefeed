<script lang="ts">
	import '../lib/styles/app.css';
	import { page } from '$app/stores';
	import { invalidateAll } from '$app/navigation';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import PrivateAccessModal from '$lib/components/PrivateAccessModal.svelte';
	import { logoutPrivateAccess } from '$lib/privateAccess';
	import { slugify } from '$lib/format';
	import type { LayoutData } from './$types';

	let { children, data }: { children: any; data: LayoutData } = $props();

	let showLoginModal = $state(false);

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
	// page. See MergeTab's category priority list for where these are managed.
	//
	// A tracked event is a displayed category too, just backed by a source+keyword
	// filter instead of manual per-source category checkboxes, and periodically
	// AI-recapped — see EventsTab.svelte. Active ones get their own /event/:id tab,
	// appended after the regular categories.
	const navItems = $derived([
		...data.categories.map((cat) => ({
			label: cat.name,
			href: cat.name.toLowerCase() === 'top stories' ? '/' : `/category/${slugify(cat.name)}`
		})),
		...data.events.map((event) => ({ label: event.name, href: `/event/${event.id}` }))
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

<main class="page">
	{@render children()}
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
</style>
