<script lang="ts">
	import type { PageData } from './$types';
	import { timeAgo } from '$lib/format';

	let { data }: { data: PageData } = $props();
	const weather = $derived(data.weather);
	const unitLabel = $derived(weather.unit === 'celsius' ? 'C' : 'F');
</script>

<div class="head">
	<span class="title">Weather</span>
	{#if weather.locationName}
		<span class="location">{weather.locationName}</span>
	{/if}
</div>

{#if !weather.current}
	<p class="empty">Not configured yet — set a location in the admin panel's Weather tab.</p>
{:else}
	<div class="current">
		<span class="icon">{weather.current.icon}</span>
		<div class="readout">
			<span class="temp">{Math.round(weather.current.temp)}°{unitLabel}</span>
			<span class="condition">{weather.current.conditionText}</span>
			<span class="updated">Updated {timeAgo(weather.updatedAt ?? '')}</span>
		</div>
	</div>

	<div class="section">
		<span class="section-title">Hourly</span>
		<div class="hourly-strip">
			{#each weather.hourly as hour (hour.time)}
				<div class="hour-col">
					<span class="hour-time">{new Date(hour.time).toLocaleTimeString([], { hour: 'numeric' })}</span>
					<span class="hour-icon">{hour.icon}</span>
					<span class="hour-temp">{Math.round(hour.temp)}°</span>
				</div>
			{/each}
		</div>
	</div>

	<div class="section">
		<span class="section-title">7-day forecast</span>
		<div class="daily-list">
			{#each weather.daily as day (day.date)}
				<div class="day-row">
					<span class="day-name">{new Date(day.date).toLocaleDateString([], { weekday: 'short' })}</span>
					<span class="day-icon">{day.icon}</span>
					<span class="day-condition">{day.conditionText}</span>
					<span class="day-range">{Math.round(day.tempMax)}° / {Math.round(day.tempMin)}°</span>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.head {
		display: flex;
		align-items: baseline;
		gap: 12px;
		margin: 24px 0 8px;
	}
	.title {
		font-family: var(--font-voice);
		font-size: 26px;
		font-weight: 500;
	}
	.location {
		font-size: 14px;
		color: var(--text-muted);
	}
	.empty {
		font-size: 13px;
		color: var(--text-muted);
	}
	.current {
		display: flex;
		align-items: center;
		gap: 16px;
		margin: 20px 0 28px;
	}
	.icon {
		font-size: 64px;
		line-height: 1;
	}
	.readout {
		display: flex;
		flex-direction: column;
	}
	.temp {
		font-size: 40px;
		font-weight: 500;
	}
	.condition {
		font-size: 15px;
		color: var(--text-secondary);
	}
	.updated {
		font-size: 11px;
		color: var(--text-muted);
		margin-top: 4px;
	}
	.section {
		margin-bottom: 28px;
	}
	.section-title {
		display: block;
		font-size: 14px;
		font-weight: 500;
		margin-bottom: 12px;
	}
	.hourly-strip {
		display: flex;
		gap: 18px;
		overflow-x: auto;
		padding-bottom: 6px;
	}
	.hour-col {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}
	.hour-time {
		font-size: 11px;
		color: var(--text-muted);
	}
	.hour-icon {
		font-size: 22px;
	}
	.hour-temp {
		font-size: 13px;
	}
	.daily-list {
		display: flex;
		flex-direction: column;
		max-width: 480px;
	}
	.day-row {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 0;
		border-top: 0.5px solid var(--border);
	}
	.day-row:first-child {
		border-top: none;
	}
	.day-name {
		font-size: 13px;
		font-weight: 500;
		width: 40px;
	}
	.day-icon {
		font-size: 20px;
		width: 28px;
	}
	.day-condition {
		font-size: 13px;
		color: var(--text-secondary);
		flex: 1;
	}
	.day-range {
		font-size: 13px;
		color: var(--text-muted);
		white-space: nowrap;
	}
</style>
