<script lang="ts">
	import type { PageData } from './$types';
	import { timeAgo, formatDayHeading } from '$lib/format';

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
			<div class="temp-row">
				<span class="temp">{Math.round(weather.current.temp)}°{unitLabel}</span>
				<span class="feels-like">Feels like {Math.round(weather.current.feelsLike)}°</span>
			</div>
			<span class="condition">{weather.current.conditionText}</span>
			<span class="updated">Updated {timeAgo(weather.updatedAt ?? '')}</span>
		</div>
	</div>

	<div class="conditions-grid">
		<div class="stat">
			<span class="stat-label">Humidity</span>
			<span class="stat-value">{weather.current.humidity}%</span>
		</div>
		<div class="stat">
			<span class="stat-label">Precip. chance</span>
			<span class="stat-value">{weather.current.precipitationChance}%</span>
		</div>
		<div class="stat">
			<span class="stat-label">Wind</span>
			<span class="stat-value">{weather.current.windDirection} {Math.round(weather.current.windSpeed)} {weather.windUnit}</span>
		</div>
		<div class="stat">
			<span class="stat-label">Pressure</span>
			<span class="stat-value">{weather.current.pressure} {weather.pressureUnit}</span>
		</div>
		<div class="stat">
			<span class="stat-label">Sunrise</span>
			<span class="stat-value">{new Date(weather.current.sunrise).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
		</div>
		<div class="stat">
			<span class="stat-label">Sunset</span>
			<span class="stat-value">{new Date(weather.current.sunset).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
		</div>
	</div>

	{#if weather.alerts.length > 0}
		<div class="section">
			<span class="section-title">Weather alerts</span>
			<div class="alerts-list">
				{#each weather.alerts as alert (alert.id)}
					<div class="alert-row severity-{alert.severity.toLowerCase()}">
						<div class="alert-head">
							<span class="alert-event">{alert.event}</span>
							<span class="alert-expires">Until {new Date(alert.expires).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
						</div>
						<p class="alert-headline">{alert.headline}</p>
					</div>
				{/each}
			</div>
		</div>
	{/if}

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
					<span class="day-name">{formatDayHeading(day.date)}</span>
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
	.temp-row {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.temp {
		font-size: 40px;
		font-weight: 500;
	}
	.feels-like {
		font-size: 13px;
		color: var(--text-muted);
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
	.conditions-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		gap: 16px;
		max-width: 640px;
		margin-bottom: 28px;
		padding: 16px;
		background: var(--surface-1);
		border-radius: 12px;
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.stat-label {
		font-size: 11px;
		color: var(--text-muted);
	}
	.stat-value {
		font-size: 15px;
		font-weight: 500;
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
	.alerts-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-width: 640px;
	}
	.alert-row {
		border-left: 3px solid var(--text-muted);
		background: var(--surface-1);
		border-radius: 0 var(--radius) var(--radius) 0;
		padding: 10px 14px;
	}
	.alert-row.severity-extreme,
	.alert-row.severity-severe {
		border-left-color: var(--text-danger);
	}
	.alert-row.severity-moderate {
		border-left-color: var(--border-accent);
	}
	.alert-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}
	.alert-event {
		font-size: 13px;
		font-weight: 500;
	}
	.alert-expires {
		font-size: 11px;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.alert-headline {
		font-size: 12px;
		color: var(--text-secondary);
		margin: 4px 0 0;
	}
	.hourly-strip {
		display: grid;
		grid-template-columns: repeat(12, 1fr);
		gap: 14px 8px;
	}
	.hour-col {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
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
	@media (max-width: 640px) {
		.hourly-strip {
			grid-template-columns: repeat(6, 1fr);
		}
	}
	.daily-list {
		display: flex;
		flex-direction: column;
		max-width: 640px;
	}
	.day-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px 14px;
		padding: 10px 0;
		border-top: 0.5px solid var(--border);
	}
	.day-row:first-child {
		border-top: none;
	}
	.day-name {
		font-size: 13px;
		font-weight: 500;
		white-space: nowrap;
		flex: 1 0 auto;
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
