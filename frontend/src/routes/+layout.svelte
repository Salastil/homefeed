<script lang="ts">
	import '@fontsource-variable/inter';
	import '@fontsource-variable/newsreader';
	import '@fontsource-variable/newsreader/opsz.css';
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/500.css';
	import '../lib/styles/app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { invalidateAll, invalidate } from '$app/navigation';
	import PrivateAccessModal from '$lib/components/PrivateAccessModal.svelte';
	import TopBar from '$lib/components/shell/TopBar.svelte';
	import WidgetRow from '$lib/components/shell/WidgetRow.svelte';
	import TickerStrip from '$lib/components/shell/TickerStrip.svelte';
	import { dev } from '$app/environment';
	import { logoutPrivateAccess } from '$lib/privateAccess';
	import { poll, startClock } from '$lib/live.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: any; data: LayoutData } = $props();

	let showLoginModal = $state(false);

	// The widgets (weather, markets, PoE2, bookmarks) are backend-polled on their own
	// cadences; re-reading them here every minute keeps a tab that's been open for days
	// current without re-running page loads. Scoped to the layout's own 'app:sidebar'
	// dependency (see +layout.ts) so the board's own state is untouched.
	onMount(() => {
		startClock();
		return poll(() => invalidate('app:sidebar'), 60_000);
	});

	// Issue #1: the top bar and widget row are on screen on every page and the page itself
	// never scrolls - each page fills the space under them. The admin panel is the one
	// exception: no widgets, and an ordinary scrolling page.
	const isAdmin = $derived($page.url.pathname.startsWith('/admin'));

	// Dev-only mockup switch for the ticker strip (issue #1, comment 622): ?ticker=top|below|storylines
	// shows the strip there and turns the Markets/PoE2 slot into an empty one. Not in production builds.
	const tickerMock = $derived(dev ? $page.url.searchParams.get('ticker') : null);
	const rowWidgets = $derived(
		tickerMock
			? {
					...data.widgetsEnabled,
					slots: (data.widgetsEnabled.slots ?? []).map((s) =>
						s.widgets.some((w) => w === 'stocks' || w === 'poe2') ? { ...s, widgets: ['empty'] } : s
					)
				}
			: data.widgetsEnabled
	);

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
		<TopBar widgets={data.widgetsEnabled} privateAccess={data.privateAccess} adminPanelEnabled={data.adminPanelEnabled} onLock={handleLockClick} />
		<main class="admin-main">{@render children()}</main>
	</div>
{:else}
	<div class="app">
		<TopBar widgets={data.widgetsEnabled} privateAccess={data.privateAccess} adminPanelEnabled={data.adminPanelEnabled} onLock={handleLockClick} />
		{#if tickerMock === 'top'}<TickerStrip stocks={data.stocks} poe2={data.poe2} />{/if}
		<WidgetRow
			widgets={rowWidgets}
			weather={data.weather}
			stocks={data.stocks}
			bookmarks={data.bookmarks}
			poe2={data.poe2}
			weatherActive={$page.url.pathname.startsWith('/weather')}
		/>
		{#if tickerMock === 'below'}<TickerStrip stocks={data.stocks} poe2={data.poe2} />{/if}
		<main class="content">{@render children()}</main>
	</div>
{/if}

{#if showLoginModal}
	<PrivateAccessModal onClose={() => (showLoginModal = false)} onSuccess={handleLoginSuccess} />
{/if}

<style>
	.app {
		height: 100vh;
		height: 100dvh;
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
			min-height: 100dvh;
			overflow: visible;
			padding: 10px 12px;
		}
	}
</style>
