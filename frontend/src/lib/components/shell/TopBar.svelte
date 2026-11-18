<script lang="ts">
	import type { WidgetsEnabled } from '$lib/types';
	import { clock } from '$lib/live.svelte';
	import ThemeToggle from '../ThemeToggle.svelte';
	import DynamicWidgetSlot from '../sidebar/DynamicWidgetSlot.svelte';
	import { admin } from '$lib/adminSession.svelte';

	let {
		widgets,
		privateAccess,
		adminPanelEnabled,
		onLock,
		onPalette,
		onEdit
	}: {
		widgets: WidgetsEnabled;
		privateAccess: { configured: boolean; authenticated: boolean } | undefined;
		adminPanelEnabled: boolean;
		onLock: () => void;
		/** Signed-in admin only: open the ⌘K palette. */
		onPalette?: () => void;
		/** Signed-in admin, on the board only: toggle board edit mode. */
		onEdit?: () => void;
	} = $props();

	const time = $derived(new Date(clock.now));
	const hhmm = $derived(`${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`);
	const day = $derived(time.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }));
	const barWidgets = $derived((widgets.topBar ?? []).map((id) => widgets.pluggable.find((p) => p.id === id)).filter((w) => !!w && !!w.frontendEntry));
</script>

<header class="top">
	<a class="brand" href="/">
		<b>Homefeed</b>
		<span class="clock"><b>{hhmm}</b> {day}</span>
	</a>
	<div class="bar-widgets">
		{#each barWidgets as w (w!.id)}
			<DynamicWidgetSlot id={w!.id} displayName={w!.displayName} frontendEntry={w!.frontendEntry!} layout="bar" />
		{/each}
	</div>
	<div class="ctl">
		{#if admin.valid}
			{#if admin.editing}<span class="editing"><i></i>Editing the board · changes save as you go</span>{/if}
			{#if onPalette}
				<button class="adminbtn" onclick={onPalette} title="Find any setting (Ctrl+K)"><kbd>Ctrl</kbd><kbd>K</kbd></button>
			{/if}
			{#if onEdit}
				<button class="adminbtn" class:on={admin.editing} onclick={onEdit}>{admin.editing ? 'Done' : 'Edit'}</button>
			{/if}
		{/if}
		<ThemeToggle />
		{#if privateAccess?.configured}
			<button
				class="icon"
				onclick={onLock}
				aria-label={privateAccess.authenticated ? 'Log out of private categories' : 'Log in to private categories'}
				title={privateAccess.authenticated ? 'Log out of private categories' : 'Log in to private categories'}
			>
				<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
					<rect x="5" y="11" width="14" height="10" rx="2" />
					<path d={privateAccess.authenticated ? 'M8 11V7a4 4 0 0 1 7.75-1.5' : 'M8 11V7a4 4 0 0 1 8 0v4'} />
				</svg>
			</button>
		{/if}
		{#if adminPanelEnabled}
			<a class="icon" href="/admin/settings" aria-label="Admin settings" title="Admin settings">
				<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
					<circle cx="12" cy="12" r="3" />
					<path
						d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
					/>
				</svg>
			</a>
		{/if}
	</div>
</header>

<style>
	.top {
		display: flex;
		align-items: center;
		gap: 16px;
		flex: none;
	}
	.brand {
		display: flex;
		align-items: baseline;
		gap: 12px;
		flex: none;
		color: var(--tx);
	}
	.brand:hover {
		text-decoration: none;
	}
	.brand > b {
		font-family: var(--serif);
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.3px;
	}
	.clock {
		font-family: var(--mono);
		font-size: 12.5px;
		color: var(--tx2);
	}
	.clock b {
		color: var(--tx);
		font-weight: 500;
	}
	.bar-widgets {
		flex: 0 1 720px;
		min-width: 0;
	}
	.ctl {
		margin-left: auto;
		display: flex;
		gap: 13px;
		align-items: center;
		color: var(--tx2);
		flex: none;
	}
	.adminbtn {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 12px;
		padding: 4px 10px;
		border-radius: 7px;
		border: 1px solid var(--bd);
		background: var(--s1);
		color: var(--tx2);
	}
	.adminbtn:hover {
		color: var(--tx);
	}
	.adminbtn.on {
		background: var(--tx);
		border-color: var(--tx);
		color: var(--s0);
	}
	.adminbtn kbd {
		border: 0;
		padding: 0 1px;
		color: inherit;
	}
	.editing {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--acc);
	}
	.editing i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--acc);
	}
	.icon {
		display: flex;
		align-items: center;
		color: var(--tx2);
		padding: 4px;
		border-radius: 6px;
		background: transparent;
		border: 0;
	}
	.icon:hover {
		color: var(--tx);
		background: var(--s1);
		text-decoration: none;
	}
</style>
