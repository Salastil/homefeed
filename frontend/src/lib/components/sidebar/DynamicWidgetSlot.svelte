<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getBackendUrl } from '$lib/config';

	// Renders an uploaded widget's custom UI — a pre-built, framework-agnostic JS bundle
	// (not raw Svelte source, which can't be compiled in the browser without shipping a
	// compiler) served from /widget-assets/<id>/* and loaded via an ordinary dynamic
	// import(), which is why this works live for a widget uploaded after the page's own
	// bundle was built — no Fastify route registration is involved at all, unlike the
	// widget's own custom *API* routes, which do need a backend restart (see
	// widgets/install.ts's notes on that).
	let { id, displayName, frontendEntry }: { id: string; displayName: string; frontendEntry: string } = $props();

	let container: HTMLDivElement | undefined = $state();
	let error = $state<string | null>(null);
	let cleanup: (() => void) | void;

	onMount(async () => {
		try {
			const url = `${getBackendUrl()}/widget-assets/${id}/${frontendEntry}`;
			// @vite-ignore — the URL is only known at runtime (a widget uploaded after this
			// page's own bundle was built), so Vite can't statically analyze this import.
			const mod = await import(/* @vite-ignore */ url);
			if (typeof mod.default?.mount !== 'function') {
				throw new Error('module has no default-exported mount(container, ctx)');
			}
			if (container) {
				cleanup = mod.default.mount(container, { id, displayName, apiBase: getBackendUrl() });
			}
		} catch (err) {
			error = (err as Error).message;
		}
	});

	onDestroy(() => cleanup?.());
</script>

<div class="widget">
	{#if error}
		<div class="head"><span class="title">{displayName}</span></div>
		<p class="empty">Failed to load: {error}</p>
	{/if}
	<div bind:this={container}></div>
</div>

<style>
	.widget {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 14px;
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}
	.title {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
	}
	.empty {
		font-size: 12px;
		color: var(--text-muted);
		margin: 8px 0 0;
	}
</style>
