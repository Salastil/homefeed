<script lang="ts">
	import type { PageData } from './$types';
	import { timeAgo, formatDayHeading } from '$lib/format';

	let { data }: { data: PageData } = $props();
	const weather = $derived(data.weather);
	const unitLabel = $derived(weather.unit === 'celsius' ? 'C' : 'F');

	// The hourly list covers today's remaining hours (starting from the current hour, which
	// keeps shrinking as the day goes on) through the end of tomorrow (see weather/client.ts) —
	// grouping by calendar day and labeling each group with both a name and its date is what
	// actually answers "which day is this hour in", rather than leaving it to be inferred from
	// the hour-of-day alone (ambiguous for anything after midnight, and easy to misread near
	// the boundary either way).
	function dayLabel(d: Date): string {
		const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
		const diffDays = Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000);
		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Tomorrow';
		return d.toLocaleDateString([], { weekday: 'long' });
	}

	function dayDate(d: Date): string {
		return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
	}

	const hourlyGroups = $derived.by(() => {
		const groups: { label: string; date: string; hours: typeof weather.hourly }[] = [];
		for (const hour of weather.hourly) {
			const d = new Date(hour.time);
			const label = dayLabel(d);
			const last = groups[groups.length - 1];
			if (last && last.label === label) last.hours.push(hour);
			else groups.push({ label, date: dayDate(d), hours: [hour] });
		}
		return groups;
	});

	// Hovering an hour previews THAT hour's numbers in the stat panel; leaving the strip
	// falls back to live current conditions. Kept as the hour's timestamp rather than the
	// object itself so it survives `weather` being replaced by a background refresh
	// mid-hover (the same object identity wouldn't).
	let hoveredTime = $state<string | null>(null);
	const hoveredHour = $derived(hoveredTime ? (weather.hourly.find((h) => h.time === hoveredTime) ?? null) : null);

	// The panel shows either a forecast hour or the live reading, and those don't carry the
	// same fields — `current` has feelsLike/sunrise/sunset, an hour doesn't. Everything the
	// panel actually renders is normalized here so the markup below stays a single branchless
	// block rather than two near-duplicate copies.
	const panel = $derived.by(() => {
		const c = weather.current;
		if (hoveredHour) {
			return {
				heading: new Date(hoveredHour.time).toLocaleTimeString([], { weekday: 'short', hour: 'numeric' }),
				conditionText: hoveredHour.conditionText,
				humidity: hoveredHour.humidity,
				precipitationChance: hoveredHour.precipitationChance,
				windSpeed: hoveredHour.windSpeed,
				windDirection: hoveredHour.windDirection,
				pressure: hoveredHour.pressure,
				isForecast: true
			};
		}
		return {
			heading: 'Now',
			conditionText: c?.conditionText ?? '',
			humidity: c?.humidity ?? 0,
			precipitationChance: c?.precipitationChance ?? 0,
			windSpeed: c?.windSpeed ?? 0,
			windDirection: c?.windDirection ?? '',
			pressure: c?.pressure ?? 0,
			isForecast: false
		};
	});
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

	{#if weather.summary}
		<p class="summary">{weather.summary}</p>
	{/if}

	<div class="conditions-panel" class:previewing={panel.isForecast}>
		<div class="panel-head">
			<span class="panel-heading">{panel.heading}</span>
			<span class="panel-condition">{panel.conditionText}</span>
		</div>
		<div class="conditions-grid">
			<div class="stat">
				<span class="stat-label">Humidity</span>
				<span class="stat-value">{panel.humidity}%</span>
			</div>
			<div class="stat">
				<span class="stat-label">Precip. chance</span>
				<span class="stat-value">{panel.precipitationChance}%</span>
			</div>
			<div class="stat">
				<span class="stat-label">Wind</span>
				<span class="stat-value">{panel.windDirection} {Math.round(panel.windSpeed)} {weather.windUnit}</span>
			</div>
			<div class="stat">
				<span class="stat-label">Pressure</span>
				<span class="stat-value">{panel.pressure} {weather.pressureUnit}</span>
			</div>
			<!-- Sunrise/sunset are properties of the day, not of an hour — they stay put while
			     the hovered-hour values above them change, rather than blanking out. -->
			<div class="stat">
				<span class="stat-label">Sunrise</span>
				<span class="stat-value">{new Date(weather.current.sunrise).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
			</div>
			<div class="stat">
				<span class="stat-label">Sunset</span>
				<span class="stat-value">{new Date(weather.current.sunset).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
			</div>
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
		{#each hourlyGroups as group, i (group.label + group.hours[0]?.time)}
			<div class="hourly-day" class:divider={i > 0}>
				<div class="hourly-day-head">
					<span class="hourly-day-label">{group.label}</span>
					<span class="hourly-day-date">{group.date}</span>
				</div>
				<div
					class="hourly-strip"
					role="group"
					aria-label="Hourly forecast for {group.label}, {group.date}"
					onmouseleave={() => (hoveredTime = null)}
				>
					{#each group.hours as hour (hour.time)}
						{@const isNow = hour.time === weather.hourly[0]?.time}
						<button
							type="button"
							class="hour-col"
							class:now={isNow}
							class:hovered={hoveredTime === hour.time}
							onmouseenter={() => (hoveredTime = hour.time)}
							onfocus={() => (hoveredTime = hour.time)}
							onblur={() => (hoveredTime = null)}
						>
							<span class="hour-time">{isNow ? 'Now' : new Date(hour.time).toLocaleTimeString([], { hour: 'numeric' })}</span>
							<span class="hour-icon">{hour.icon}</span>
							<span class="hour-temp">{Math.round(hour.temp)}°</span>
						</button>
					{/each}
				</div>
			</div>
		{/each}
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
		margin: 20px 0 16px;
	}
	.summary {
		font-size: 14px;
		color: var(--text-secondary);
		line-height: 1.6;
		max-width: 560px;
		margin: 0 0 28px;
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
	/* Blue is this page's own accent for "the hour you're pointing at", deliberately distinct
	   from the app-wide bronze --*-accent that marks the CURRENT hour — the two mark
	   different things and are frequently on screen together, so they can't share a color.
	   Scoped here rather than added to the global palette since nothing else uses them. */
	.conditions-panel {
		--hour-hover-bg: #e8f0fb;
		--hour-hover-border: #4a7fc1;
		--hour-hover-text: #2c5c96;
	}
	.hourly-strip {
		--hour-hover-bg: #e8f0fb;
		--hour-hover-border: #4a7fc1;
		--hour-hover-text: #2c5c96;
	}
	:global(:root[data-theme='dark']) .conditions-panel,
	:global(:root[data-theme='dark']) .hourly-strip {
		--hour-hover-bg: #22303f;
		--hour-hover-border: #5b8fd0;
		--hour-hover-text: #8fb8e8;
	}
	.conditions-panel {
		max-width: 640px;
		margin-bottom: 28px;
		padding: 16px;
		background: var(--surface-1);
		border-radius: 12px;
		border: 1.5px solid transparent;
		transition: border-color 0.12s ease;
	}
	.conditions-panel.previewing {
		border-color: var(--hour-hover-border);
	}
	.panel-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
		margin-bottom: 14px;
	}
	.panel-heading {
		font-size: 13px;
		font-weight: 500;
	}
	.conditions-panel.previewing .panel-heading {
		color: var(--hour-hover-text);
	}
	.panel-condition {
		font-size: 12px;
		color: var(--text-muted);
	}
	.conditions-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		gap: 16px;
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
	.hourly-day {
		margin-bottom: 18px;
	}
	.hourly-day:last-child {
		margin-bottom: 0;
	}
	.hourly-day.divider {
		padding-top: 18px;
		border-top: 0.5px solid var(--border);
	}
	.hourly-day-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 10px;
	}
	.hourly-day-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
	}
	.hourly-day-date {
		font-size: 11px;
		color: var(--text-muted);
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
		padding: 6px 0;
		border-radius: var(--radius);
		/* Became a <button> for keyboard reachability — strip the UA/global button chrome so
		   it still renders as a plain cell. */
		background: transparent;
		border: 1.5px solid transparent;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.hour-col.now {
		background: var(--bg-accent);
		border-color: var(--border-accent);
	}
	.hour-col.now .hour-time {
		color: var(--text-accent);
		font-weight: 500;
	}
	/* Listed after .now so hovering the current hour shows the blue preview state too —
	   otherwise the one cell you can't preview would be the current one. */
	.hour-col.hovered {
		background: var(--hour-hover-bg);
		border-color: var(--hour-hover-border);
	}
	.hour-col.hovered .hour-time {
		color: var(--hour-hover-text);
		font-weight: 500;
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
