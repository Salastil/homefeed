<script lang="ts">
	import { onMount } from 'svelte';
	import { getTheme, initTheme, toggleTheme } from '$lib/theme.svelte';

	onMount(() => {
		initTheme();
	});
</script>

<button
	class="toggle"
	class:dark={getTheme() === 'dark'}
	onclick={toggleTheme}
	aria-label={`Switch to ${getTheme() === 'dark' ? 'light' : 'dark'} theme`}
	title={`Switch to ${getTheme() === 'dark' ? 'light' : 'dark'} theme`}
>
	<span class="icon sun">☀</span>
	<span class="icon moon">☾</span>
	<span class="thumb"></span>
</button>

<style>
	.toggle {
		position: relative;
		width: 46px;
		height: 24px;
		border-radius: 12px;
		border: 0.5px solid var(--border);
		background: var(--surface-1);
		padding: 0;
		display: flex;
		align-items: center;
		cursor: pointer;
	}
	.icon {
		position: absolute;
		font-size: 11px;
		top: 50%;
		transform: translateY(-50%);
		line-height: 1;
		color: var(--text-muted);
	}
	.sun {
		left: 6px;
	}
	.moon {
		right: 6px;
	}
	.thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--pill-bg);
		transition: transform 0.15s ease;
	}
	.toggle.dark .thumb {
		transform: translateX(22px);
	}
</style>
