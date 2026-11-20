<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource-variable/newsreader';
	import '@fontsource-variable/newsreader/opsz.css';
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/500.css';
	import '../lib/styles/app.css';
	import '../lib/styles/admin.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { invalidateAll, invalidate } from '$app/navigation';
	import PrivateAccessModal from '$lib/components/PrivateAccessModal.svelte';
	import TopBar from '$lib/components/shell/TopBar.svelte';
	import WidgetRow from '$lib/components/shell/WidgetRow.svelte';
	import TickerStrip from '$lib/components/shell/TickerStrip.svelte';
	import { logoutPrivateAccess } from '$lib/privateAccess';
	import { poll, startClock } from '$lib/live.svelte';
	import { admin, checkAdmin } from '$lib/adminSession.svelte';
	import CommandPalette from '$lib/components/admin/CommandPalette.svelte';
	import BoardEditor from '$lib/components/board/edit/BoardEditor.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: any; data: LayoutData } = $props();

	let showLoginModal = $state(false);

	// The widgets (weather, markets, PoE2, bookmarks) are backend-polled on their own
	// cadences; re-reading them here every minute keeps a tab that's been open for days
	// current without re-running page loads. Scoped to the layout's own 'app:sidebar'
	// dependency (see +layout.ts) so the board's own state is untouched.
	onMount(() => {
		startClock();
		// Admin-only tools (board edit mode, the ⌘K palette) appear only once the saved admin
		// key has been checked against the backend; signing in or out in another tab re-checks.
		checkAdmin(data.adminPanelEnabled);
		const onStorage = (e: StorageEvent) => e.key === 'homefeed:adminApiKey' && checkAdmin(data.adminPanelEnabled);
		window.addEventListener('storage', onStorage);
		const stop = poll(() => invalidate('app:sidebar'), 60_000);
		return () => {
			stop();
			window.removeEventListener('storage', onStorage);
		};
	});

	// Edit mode belongs to the board: leaving it ends edit mode.
	$effect(() => {
		if ($page.url.pathname !== '/' && admin.editing) {
			admin.editing = false;
			admin.sheet = null;
		}
	});

	function onKey(e: KeyboardEvent) {
		if (!admin.valid) return;
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			admin.palette = !admin.palette;
		}
	}
	const toggleEdit = () => {
		admin.editing = !admin.editing;
		if (!admin.editing) admin.sheet = null;
	};

	// Issue #1: the top bar and widget row are on screen on every page and the page itself
	// never scrolls - each page fills the space under them. The admin panel is the one
	// exception: no widgets, and an ordinary scrolling page.
	const isAdmin = $derived($page.url.pathname.startsWith('/admin'));

	// Markets and PoE2 live in the ticker strip under the widget row (issue #1, comment 622,
	// option B); each appears only while its widget is enabled.
	const ticker = $derived(data.widgetsEnabled.ticker ?? []);
	const tickerStocks = $derived(ticker.includes('stocks') ? data.stocks : { ...data.stocks, tickers: [] });
	const tickerPoe2 = $derived(ticker.includes('poe2') ? data.poe2 : { ...data.poe2, entries: [] });

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
</script>

{#if isAdmin}
	<div class="admin-shell">
		<TopBar widgets={data.widgetsEnabled} privateAccess={data.privateAccess} adminPanelEnabled={data.adminPanelEnabled} onLock={handleLockClick} onPalette={() => (admin.palette = true)} />
		<main class="admin-main">{@render children()}</main>
	</div>
{:else}
	<div class="app">
		<TopBar
			widgets={data.widgetsEnabled}
			privateAccess={data.privateAccess}
			adminPanelEnabled={data.adminPanelEnabled}
			onLock={handleLockClick}
			onPalette={() => (admin.palette = true)}
			onEdit={$page.url.pathname === '/' ? toggleEdit : undefined}
		/>
		<WidgetRow
			widgets={data.widgetsEnabled}
			weather={data.weather}
			stocks={data.stocks}
			bookmarks={data.bookmarks}
			poe2={data.poe2}
			weatherActive={$page.url.pathname.startsWith('/weather')}
		/>
		{#if tickerStocks.tickers.length || tickerPoe2.entries.length}<TickerStrip stocks={tickerStocks} poe2={tickerPoe2} />{/if}
		<main class="content">{@render children()}</main>
	</div>
{/if}

<svelte:window onkeydown={onKey} />

{#if admin.valid && !isAdmin}
	<BoardEditor />
{/if}
{#if admin.valid && admin.palette}
	<CommandPalette />
{/if}

{#if showLoginModal}
	<PrivateAccessModal onClose={() => (showLoginModal = false)} onSuccess={handleLoginSuccess} />
{/if}

<style>
	.app {
		height: calc(100vh / var(--ui-zoom));
		height: calc(100dvh / var(--ui-zoom));
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px 16px 14px;
		overflow: hidden;
	}
	.content {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.admin-shell {
		padding: 12px 16px 0;
	}
	.admin-shell :global(.top) {
		margin-bottom: 18px;
	}
	/* Phones: there's no fixed board to fit, so the page scrolls normally there. */
	@media (max-width: 760px) {
		.app {
			height: auto;
			min-height: calc(100dvh / var(--ui-zoom));
			overflow: visible;
			padding: 10px 12px;
		}
	}
</style>
