<script lang="ts">
	import type { Weather } from '$lib/types';

	let { weather }: { weather: Weather } = $props();
</script>

<a class="widget" href="/weather">
	<span class="title">Weather{weather.locationName ? ` - ${weather.locationName}` : ''}</span>
	{#if weather.current}
		<div class="body">
			<span class="icon">{weather.current.icon}</span>
			<div class="readout">
				<span class="temp">{Math.round(weather.current.temp)}°{weather.unit === 'celsius' ? 'C' : 'F'}</span>
				<span class="condition">{weather.current.conditionText}</span>
				<span class="feels-like">Feels like {Math.round(weather.current.feelsLike)}°</span>
			</div>
		</div>
	{:else}
		<p class="empty">Not configured yet</p>
	{/if}
</a>

<style>
	.widget {
		display: block;
		background: var(--surface-1);
		border-radius: 12px;
		padding: 14px;
		color: inherit;
	}
	.widget:hover {
		text-decoration: none;
		background: var(--surface-2);
	}
	.title {
		display: block;
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.body {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 8px;
	}
	.icon {
		font-size: 34px;
		line-height: 1;
	}
	.readout {
		display: flex;
		flex-direction: column;
	}
	.temp {
		font-size: 22px;
		font-weight: 500;
	}
	.condition {
		font-size: 12px;
		color: var(--text-secondary);
	}
	.feels-like {
		font-size: 11px;
		color: var(--text-muted);
	}
	.empty {
		font-size: 12px;
		color: var(--text-muted);
		margin: 8px 0 0;
	}
</style>
