<script lang="ts">
	import '../lib/styles/app.css';
	import { page } from '$app/stores';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { children } = $props();

	const categories = [
		{ label: 'Top stories', href: '/' },
		{ label: 'Local', href: '/category/local' },
		{ label: 'World', href: '/category/world' },
		{ label: 'Business', href: '/category/business' },
		{ label: 'Tech', href: '/category/tech' },
		{ label: 'Culture', href: '/category/culture' }
	];

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
			{#each categories as cat}
				<a class="tab" class:active={isActive(cat.href)} href={cat.href}>{cat.label}</a>
			{/each}
		</nav>
		<div class="controls">
			<ThemeToggle />
			<a class="cog" href="/admin/settings" aria-label="Admin settings" title="Admin settings">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
					<circle cx="12" cy="12" r="3" />
					<path
						d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
					/>
				</svg>
			</a>
		</div>
	</div>
</header>

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
