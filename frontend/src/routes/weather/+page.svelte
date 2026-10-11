<script lang="ts">
	import type { PageData } from './$types';
	import { timeAgo, formatDayHeading } from '$lib/format';
	import type { WeatherHourEntry, WeatherCurrentConditions } from '$lib/types';

	let { data }: { data: PageData } = $props();
	const weather = $derived(data.weather);
	const unitLabel = $derived(weather.unit === 'celsius' ? 'C' : 'F');

	// ---- Timeline bar ------------------------------------------------------------------
	// One bar for the whole hourly forecast (today's remaining hours through the end of
	// tomorrow - see weather/client.ts), the way MerrySky draws it: consecutive hours that
	// look alike merge into a single labelled stretch, with the time and temperature on an
	// axis underneath. Moving along it previews that hour in the card above.
	const KIND_LABELS: Record<string, string> = {
		clear: 'Clear',
		partly: 'Partly cloudy',
		cloudy: 'Cloudy',
		fog: 'Fog',
		'light-rain': 'Light rain',
		rain: 'Rain',
		freezing: 'Freezing rain',
		snow: 'Snow',
		storm: 'Thunderstorm'
	};

	const hourCount = $derived(weather.hourly.length);

	// Every local midnight inside the window, whether or not it earned a tick label - the
	// label can be skipped for crowding, but the day change should still show on the bar.
	const midnights = $derived(
		weather.hourly.flatMap((hour, index) => (index > 0 && new Date(hour.time).getHours() === 0 ? [index] : []))
	);

	// `unknown` only exists for the few seconds after a deploy, before the first poll refills
	// a cache that predates conditionKind - drawn as a neutral, unlabelled stretch rather
	// than claiming a sky it doesn't know.
	const segments = $derived.by(() => {
		const out: { kind: string; count: number }[] = [];
		for (const hour of weather.hourly) {
			const kind = hour.conditionKind ?? 'unknown';
			const last = out[out.length - 1];
			if (last && last.kind === kind) last.count++;
			else out.push({ kind, count: 1 });
		}
		return out;
	});

	// A label every six hours, with midnight shown as the weekday so it doubles as the "which
	// day is this" marker the old Today/Tomorrow headings were for. Hours near either end are
	// skipped so a label never collides with "Now" or runs off the right edge.
	const ticks = $derived.by(() => {
		const out: { index: number; label: string; temp: number; isNow: boolean; midnight: boolean; minor: boolean }[] = [];
		weather.hourly.forEach((hour, index) => {
			const at = new Date(hour.time);
			const hourOfDay = at.getHours();
			if (index === 0) {
				out.push({ index, label: 'Now', temp: hour.temp, isNow: true, midnight: false, minor: false });
			} else if (hourOfDay % 6 === 0 && index >= 2 && index < hourCount - 1) {
				const midnight = hourOfDay === 0;
				out.push({
					index,
					label: midnight ? at.toLocaleDateString([], { weekday: 'short' }) : at.toLocaleTimeString([], { hour: 'numeric' }),
					temp: hour.temp,
					isNow: false,
					midnight,
					// On a phone only every twelfth hour has room for a label.
					minor: hourOfDay % 12 !== 0
				});
			}
		});
		return out;
	});

	// Hovering an hour previews THAT hour's numbers in the stat panel; leaving the strip
	// falls back to live current conditions. Kept as the hour's timestamp rather than the
	// object itself so it survives `weather` being replaced by a background refresh
	// mid-hover (the same object identity wouldn't).
	let hoveredTime = $state<string | null>(null);
	const hoveredHour = $derived(hoveredTime ? (weather.hourly.find((h) => h.time === hoveredTime) ?? null) : null);

	const cursorIndex = $derived(hoveredTime ? weather.hourly.findIndex((h) => h.time === hoveredTime) : -1);

	let trackEl = $state<HTMLElement | null>(null);
	// Not rendered, so a plain variable rather than state.
	let scrubbing = false;
	// A finger lifting off the bar would otherwise snap straight back to "now" and leave no
	// time to read what it landed on, so touch and pen selections stay put until dismissed.
	let pinned = $state(false);

	function resetPreview() {
		hoveredTime = null;
		pinned = false;
	}

	function previewAt(clientX: number) {
		if (!trackEl || hourCount === 0) return;
		const rect = trackEl.getBoundingClientRect();
		const index = Math.min(hourCount - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * hourCount)));
		hoveredTime = weather.hourly[index].time;
	}

	function onTrackPointerDown(event: PointerEvent) {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		scrubbing = true;
		// Keeps the drag tracking after the pointer leaves the bar, which a thumb will. It throws
		// if the pointer has already gone inactive, which just means no capture - not an error
		// worth losing the preview over.
		try {
			trackEl?.setPointerCapture(event.pointerId);
		} catch {
			/* no capture */
		}
		previewAt(event.clientX);
	}

	function onTrackPointerMove(event: PointerEvent) {
		// A mouse previews on plain hover; touch and pen only while pressed, otherwise a finger
		// that is just scrolling the page past the bar would scrub it too.
		if (event.pointerType === 'mouse' || scrubbing) previewAt(event.clientX);
	}

	function onTrackPointerEnd(event: PointerEvent) {
		if (!scrubbing) return;
		scrubbing = false;
		if (event.pointerType !== 'mouse') pinned = true;
	}

	function onTrackPointerLeave(event: PointerEvent) {
		if (event.pointerType === 'mouse' && !scrubbing && !pinned) hoveredTime = null;
	}

	// Left/right step an hour, page keys six, Home/End jump to the ends, Escape returns to now -
	// the keyboard route to what the old row of per-hour buttons made reachable by Tab.
	function onTrackKeydown(event: KeyboardEvent) {
		const last = hourCount - 1;
		if (last < 0) return;
		const current = Math.max(0, cursorIndex);
		let next: number;
		if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(last, current + 1);
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(0, current - 1);
		else if (event.key === 'PageUp') next = Math.min(last, current + 6);
		else if (event.key === 'PageDown') next = Math.max(0, current - 6);
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = last;
		else if (event.key === 'Escape') {
			resetPreview();
			return;
		} else return;
		event.preventDefault();
		hoveredTime = weather.hourly[next].time;
	}

	function onTrackBlur() {
		if (!pinned) hoveredTime = null;
	}

	// Snow depth is conventionally centimetres where rain is millimetres, so the label
	// depends on WHAT is falling, not just the configured unit. Imperial uses inches for both.
	function precipUnitLabel(isSnow: boolean): string {
		if (weather.precipUnit !== 'mm') return 'in';
		return isSnow ? 'cm' : 'mm';
	}

	// Hundredths for inches and centimetres (0.05" of rain is a real reading); whole
	// millimetres, where a decimal is below the forecast's own resolution. Anything that
	// would round to zero while the row still says rain is falling is shown as "<" the
	// smallest step instead - "0.0 in" beside a drizzle icon reads as a contradiction.
	function formatPrecip(amount: number, isSnow: boolean): string {
		if (weather.precipUnit === 'mm' && !isSnow) {
			const mm = Math.round(amount);
			return mm === 0 ? '<1' : String(mm);
		}
		if (amount < 0.01) return '<0.01';
		return amount.toFixed(2).replace(/0$/, '');
	}

	// Past ~10 miles visibility stops mattering for comfort, and the forecast model will
	// happily report 40+. Capping the display matches how observations are conventionally
	// reported ("10 mi") and keeps it from looking inflated next to the other sources
	// people compare this against.
	const visibilityCap = $derived(weather.windUnit === 'mph' ? 10 : 16);
	function formatVisibility(value: number | null | undefined): string {
		if (value === null || value === undefined) return '—';
		const unit = weather.windUnit === 'mph' ? 'mi' : 'km';
		return value >= visibilityCap ? `${visibilityCap}+ ${unit}` : `${value} ${unit}`;
	}

	// NWS tops its ceiling forecast out at 25,000 ft, so that figure means "nothing lower
	// than this", not "exactly 25,000".
	function formatCeiling(feet: number | null | undefined): string {
		if (feet === null || feet === undefined) return '—';
		return feet >= 25_000 ? '25,000+ ft' : `${feet.toLocaleString()} ft`;
	}

	// The ceiling comes from NWS, so it only exists for US locations. Elsewhere every hour is
	// null and a row of dashes would be worse than no row at all — but where it DOES exist,
	// the row stays put for every hour (showing a dash for any gap) so the grid doesn't
	// reshuffle underneath the pointer as it moves across the strip.
	const hasCeilingData = $derived(
		(weather.current?.cloudCeilingFt ?? null) !== null || weather.hourly.some((h) => (h.cloudCeilingFt ?? null) !== null)
	);

	function humidityTone(level: number | undefined): 'ideal' | 'mild' | 'poor' {
		const distance = Math.abs(level ?? 0);
		return distance === 0 ? 'ideal' : distance <= 2 ? 'mild' : 'poor';
	}

	// Once the sun is down the first row's day is over, so it reads "Tonight" and shows only
	// the night - the same way AccuWeather's list opens - instead of describing hours that have
	// already happened. Today's row is the first (the backend lists days from today), and
	// current.sunset is today's sunset.
	const isTonight = $derived(weather.current ? Date.now() >= new Date(weather.current.sunset).getTime() : false);

	// The card shows either a forecast hour or the live reading. Both carry every field it
	// renders (the backend builds them with one shared function), so the markup below is a
	// single branchless block rather than two near-duplicate copies. `?.` and `?? ` throughout
	// are for the window right after a deploy, when the cached forecast predates these fields
	// and has to render as dashes rather than "NaN" until the next poll refills it.
	const view = $derived.by(() => {
		const src: WeatherHourEntry | WeatherCurrentConditions | null = hoveredHour ?? weather.current;
		return {
			isForecast: hoveredHour !== null,
			heading: hoveredHour
				? new Date(hoveredHour.time).toLocaleTimeString([], { weekday: 'short', hour: 'numeric' })
				: 'Now',
			icon: src?.icon ?? '',
			temp: src?.temp ?? null,
			feelsLike: src?.feelsLike ?? null,
			conditionText: src?.conditionText ?? '',
			humidity: src?.humidity ?? null,
			precipitationChance: src?.precipitationChance ?? null,
			precipAmount: src?.precipAmount ?? 0,
			precipIsSnow: src?.precipIsSnow ?? false,
			windSpeed: src?.windSpeed ?? null,
			windGust: src?.windGust ?? null,
			windDirection: src?.windDirection ?? '',
			pressure: src?.pressure ?? null,
			cloudCover: src?.cloudCover ?? null,
			visibility: src?.visibility ?? null,
			dewPoint: src?.dewPoint ?? null,
			indoorHumidity: src?.indoorHumidity ?? null,
			indoorHumidityLabel: src?.indoorHumidityLabel ?? '',
			indoorHumidityLevel: src?.indoorHumidityLevel,
			cloudCeilingFt: src?.cloudCeilingFt ?? null
		};
	});

	const dash = (value: number | null, format: (n: number) => string): string => (value === null ? '—' : format(value));

	const stats = $derived.by(() => {
		const v = view;
		const rows: { label: string; value: string; note?: string; tone?: string; wide?: boolean }[] = [
			{ label: 'Wind', value: v.windSpeed === null ? '—' : `${v.windDirection} ${Math.round(v.windSpeed)} ${weather.windUnit}` },
			{ label: 'Wind gusts', value: dash(v.windGust, (n) => `${Math.round(n)} ${weather.windUnit}`) },
			// Indoor humidity is two columns wide, so it sits after an even number of items: on the
			// 4-column desktop grid it then fills the rest of the first row, and on the 2-column
			// phone grid it gets a row of its own with nothing stranded beside it.
			{
				label: 'Indoor humidity',
				value: dash(v.indoorHumidity, (n) => `${n}%`),
				note: v.indoorHumidityLabel,
				tone: humidityTone(v.indoorHumidityLevel),
				wide: true
			},
			{ label: 'Humidity', value: dash(v.humidity, (n) => `${n}%`) },
			{ label: 'Dew point', value: dash(v.dewPoint, (n) => `${Math.round(n)}°${unitLabel}`) },
			{ label: 'Pressure', value: dash(v.pressure, (n) => `${n} ${weather.pressureUnit}`) },
			{ label: 'Cloud cover', value: dash(v.cloudCover, (n) => `${n}%`) },
			{ label: 'Visibility', value: formatVisibility(v.visibility) }
		];
		if (hasCeilingData) rows.push({ label: 'Cloud ceiling', value: formatCeiling(v.cloudCeilingFt) });
		rows.push(
			{ label: 'Precip. chance', value: dash(v.precipitationChance, (n) => `${n}%`) },
			// Always present, "None" when dry, rather than appearing only when something falls —
			// a row that comes and goes shifts everything after it as the pointer crosses hours.
			{
				label: v.precipIsSnow ? 'Snowfall' : 'Rainfall',
				value: v.precipAmount > 0 ? `${formatPrecip(v.precipAmount, v.precipIsSnow)} ${precipUnitLabel(v.precipIsSnow)}` : 'None'
			},
			// Sunrise/sunset are properties of the day, not of an hour — they stay put while
			// the hovered-hour values change, rather than blanking out.
			{ label: 'Sunrise', value: formatTime(weather.current?.sunrise) },
			{ label: 'Sunset', value: formatTime(weather.current?.sunset) }
		);
		return rows;
	});

	function formatTime(iso: string | undefined): string {
		return iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
	}
</script>

{#if !weather.current}
	<div class="head">
		<span class="title">Weather</span>
		{#if weather.locationName}
			<span class="location">{weather.locationName}</span>
		{/if}
	</div>
	<p class="empty">Not configured yet — set a location in the admin panel's Weather tab.</p>
{:else}
	<!-- One card for both the live reading and the hour being pointed at: hovering a cell in
	     the hourly strip below swaps every number here, header included, and leaving the
	     strip restores the live reading. -->
	<section class="weather-card" class:previewing={view.isForecast} aria-label="Weather conditions">
		<div class="head">
			<span class="title">Weather</span>
			{#if weather.locationName}
				<span class="location">{weather.locationName}</span>
			{/if}
			<span class="when">
				{#if view.isForecast}{view.heading} · forecast{:else}Updated {timeAgo(weather.updatedAt ?? '')}{/if}
			</span>
		</div>
		<div class="current">
			<span class="icon">{view.icon}</span>
			<div class="readout">
				<div class="temp-row">
					<span class="temp">{view.temp === null ? '—' : Math.round(view.temp)}°{unitLabel}</span>
					{#if view.feelsLike !== null}
						<span class="feels-like">Feels like {Math.round(view.feelsLike)}°</span>
					{/if}
				</div>
				<span class="condition">{view.conditionText}</span>
			</div>
		</div>
		{#if hourCount > 0}
			<div class="timeline">
				<div class="timeline-head">
					<span>Next {hourCount} hours</span>
					{#if pinned}
						<button type="button" class="timeline-reset" onclick={resetPreview}>Back to now</button>
					{/if}
				</div>
				<div class="timeline-body">
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div
						class="track"
						bind:this={trackEl}
						role="slider"
						tabindex="0"
						aria-label="Hourly forecast timeline"
						aria-orientation="horizontal"
						aria-valuemin={0}
						aria-valuemax={hourCount - 1}
						aria-valuenow={Math.max(0, cursorIndex)}
						aria-valuetext={cursorIndex >= 0 && view.temp !== null
							? `${view.heading}, ${view.conditionText}, ${Math.round(view.temp)} degrees`
							: 'Now'}
						onpointerdown={onTrackPointerDown}
						onpointermove={onTrackPointerMove}
						onpointerup={onTrackPointerEnd}
						onpointercancel={onTrackPointerEnd}
						onpointerleave={onTrackPointerLeave}
						onkeydown={onTrackKeydown}
						onblur={onTrackBlur}
					>
						{#each segments as segment}
							<div class="segment k-{segment.kind}" style:flex-grow={segment.count}>
								<!-- A single hour is too narrow to carry a word. -->
								{segment.count >= 2 ? (KIND_LABELS[segment.kind] ?? '') : ''}
							</div>
						{/each}
						{#each midnights as index (index)}
							<span class="divider" style:left="{(index / hourCount) * 100}%"></span>
						{/each}
					</div>
					{#if cursorIndex >= 0}
						<span class="cursor" style:left="{((cursorIndex + 0.5) / hourCount) * 100}%"></span>
					{/if}
					<div class="axis" aria-hidden="true">
						{#each ticks as tick (tick.index)}
							<span class="tick" class:now={tick.isNow} class:minor={tick.minor} style:left="{(tick.index / hourCount) * 100}%">
								<span class="tick-label">{tick.label}</span>
								<span class="tick-temp">{Math.round(tick.temp)}°</span>
							</span>
						{/each}
					</div>
				</div>
			</div>
		{/if}
		<div class="conditions-grid">
			{#each stats as stat (stat.label)}
				<div class="stat" class:wide={stat.wide}>
					<span class="stat-label">{stat.label}</span>
					<span class="stat-value">
						{stat.value}{#if stat.note}<span class="stat-note tone-{stat.tone}">· {stat.note}</span>{/if}
					</span>
				</div>
			{/each}
		</div>
	</section>

	{#if weather.summary}
		<p class="summary">{weather.summary}</p>
	{/if}

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
		<span class="section-title">7-day forecast</span>
		<div class="daily-list">
			{#each weather.daily as day, i (day.date)}
				{@const tonight = i === 0 && isTonight}
				{@const low = day.nightLow ?? day.tempMin}
				{@const chance = tonight ? day.nightPrecipitationChance : day.precipitationChance}
				<div class="day-row">
					<div class="day-top">
						<span class="day-name">
							{tonight ? 'Tonight' : formatDayHeading(day.date)}
							{#if tonight}<span class="day-date">{formatDayHeading(day.date)}</span>{/if}
						</span>
						<span class="day-range">
							{#if tonight}{Math.round(low)}° Lo{:else}{Math.round(day.tempMax)}° / {Math.round(low)}°{/if}
						</span>
						{#if chance !== null && chance !== undefined}
							<span class="day-precip" title="Chance of precipitation">💧 {chance}%</span>
						{/if}
					</div>
					{#if !tonight}
						<div class="day-line">
							<span class="day-icon">{day.icon}</span>
							<span class="day-text">{day.conditionText}</span>
						</div>
					{/if}
					<!-- Empty on a forecast cached before nights were described; the row then just
					     shows its day line until the next poll, a few seconds after any deploy. -->
					{#if day.nightDescription}
						<div class="day-line night">
							<span class="day-icon">{day.nightIcon}</span>
							<span class="day-text">{tonight ? '' : 'Night: '}{day.nightDescription}</span>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.head {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 12px;
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
	/* Blue is this page's own accent for "the hour you're pointing at", deliberately distinct
	   from the app-wide bronze --*-accent that marks the CURRENT hour — the two mark
	   different things and are frequently on screen together, so they can't share a color.
	   Scoped here rather than added to the global palette since nothing else uses them. */
	.weather-card {
		--hour-hover-bg: #e8f0fb;
		--hour-hover-border: #4a7fc1;
		--hour-hover-text: #2c5c96;
	}
	:global(:root[data-theme='dark']) .weather-card {
		--hour-hover-bg: #22303f;
		--hour-hover-border: #5b8fd0;
		--hour-hover-text: #8fb8e8;
	}
	.weather-card {
		max-width: 640px;
		margin: 20px 0 20px;
		padding: 16px;
		background: var(--surface-1);
		border-radius: 12px;
		border: 1.5px solid transparent;
		transition: border-color 0.12s ease;
	}
	.weather-card.previewing {
		border-color: var(--hour-hover-border);
	}
	/* The title row lives inside the card now, so it drops the page-level top margin and
	   the title steps down a size to sit comfortably in a card rather than over a page. */
	.weather-card .head {
		margin: 0 0 14px;
	}
	.weather-card .title {
		font-size: 22px;
	}
	/* Pushed to the far edge so it reads as the card's status, not part of the title. While
	   previewing it names the hour being shown, in the same blue as the card's border. */
	.when {
		margin-left: auto;
		font-size: 12px;
		color: var(--text-muted);
	}
	.weather-card.previewing .when {
		color: var(--hour-hover-text);
		font-weight: 500;
	}
	.current {
		display: flex;
		align-items: center;
		gap: 16px;
		margin: 0 0 18px;
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
	.timeline {
		margin: 0 0 20px;
	}
	.timeline-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 6px;
		font-size: 11px;
		color: var(--text-muted);
	}
	.timeline-reset {
		font-size: 11px;
		padding: 0;
		background: none;
		border: none;
		color: var(--hour-hover-text);
		text-decoration: underline;
		cursor: pointer;
	}
	.timeline-body {
		position: relative;
	}
	.track {
		position: relative;
		display: flex;
		height: 40px;
		border-radius: 8px;
		overflow: hidden;
		cursor: crosshair;
		user-select: none;
		-webkit-user-select: none;
		/* Horizontal drags belong to the scrubber, vertical ones still scroll the page. */
		touch-action: pan-y;
		box-shadow: inset 0 0 0 0.5px var(--border);
	}
	.track:focus-visible {
		outline: 2px solid var(--hour-hover-border);
		outline-offset: 2px;
	}
	.segment {
		flex: 0 1 0;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 4px;
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--seg-fg);
		background: var(--seg-bg);
	}
	/* Same palette in light and dark: the bar is a data colour scale, and these are chosen so
	   each pairs with its own text colour rather than with the surface behind it. */
	.k-clear {
		--seg-bg: #f2f4f8;
		--seg-fg: #3c4452;
	}
	.k-partly {
		--seg-bg: #d9dee7;
		--seg-fg: #3c4452;
	}
	.k-cloudy {
		--seg-bg: #b8c0cd;
		--seg-fg: #2f3745;
	}
	.k-fog {
		--seg-bg: #cdd6d4;
		--seg-fg: #34403e;
	}
	.k-light-rain {
		--seg-bg: #86a9dd;
		--seg-fg: #0f2340;
	}
	.k-rain {
		--seg-bg: #3f76c0;
		--seg-fg: #ffffff;
	}
	.k-freezing {
		--seg-bg: #6fb7c9;
		--seg-fg: #0b2a33;
	}
	.k-snow {
		--seg-bg: #aed6f1;
		--seg-fg: #123b5a;
	}
	.k-storm {
		--seg-bg: #6a56b3;
		--seg-fg: #ffffff;
	}
	.k-unknown {
		--seg-bg: #cdd2db;
		--seg-fg: transparent;
	}
	/* Midnight, so the day change is visible on the bar itself. */
	.divider {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: rgba(0, 0, 0, 0.3);
		pointer-events: none;
	}
	/* White with a dark outline: a hover-blue line would vanish against the blue rain segments. */
	.cursor {
		position: absolute;
		top: -3px;
		height: 46px;
		width: 2px;
		margin-left: -1px;
		border-radius: 1px;
		background: #ffffff;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55);
		pointer-events: none;
	}
	.axis {
		position: relative;
		height: 42px;
		margin-top: 4px;
	}
	.tick {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		font-size: 11px;
		line-height: 1.3;
		white-space: nowrap;
	}
	.tick::before {
		content: '';
		width: 1px;
		height: 5px;
		margin-bottom: 3px;
		background: var(--border);
	}
	.tick.now {
		transform: none;
		align-items: flex-start;
	}
	.tick.now::before {
		background: var(--border-accent);
		width: 2px;
	}
	.tick.now .tick-label {
		color: var(--text-accent);
		font-weight: 500;
	}
	.tick-label {
		color: var(--text-muted);
	}
	.tick-temp {
		font-size: 12px;
		color: var(--text-secondary);
	}
	@media (max-width: 520px) {
		.tick.minor {
			display: none;
		}
	}
	.conditions-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		/* The two-wide indoor-humidity cell can land at the end of a row with one column left;
		   dense packing backfills that hole with the next cell instead of leaving a gap. */
		grid-auto-flow: dense;
		gap: 16px;
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	/* Indoor humidity carries a description after its number, which needs the room. */
	.stat.wide {
		grid-column: span 2;
	}
	.stat-label {
		font-size: 11px;
		color: var(--text-muted);
	}
	.stat-value {
		font-size: 15px;
		font-weight: 500;
	}
	/* Svelte trims leading whitespace inside an element, so a literal space here would vanish —
	   the gap after the number has to be margin. */
	.stat-note {
		font-size: 13px;
		margin-left: 6px;
	}
	.tone-ideal {
		color: var(--text-success);
	}
	.tone-mild {
		color: var(--text-accent);
	}
	.tone-poor {
		color: var(--text-danger);
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
	.daily-list {
		display: flex;
		flex-direction: column;
		max-width: 640px;
	}
	.day-row {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px 0;
		border-top: 0.5px solid var(--border);
	}
	.day-row:first-child {
		border-top: none;
	}
	.day-top {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 14px;
	}
	.day-name {
		font-size: 13px;
		font-weight: 500;
		flex: 1 1 auto;
	}
	.day-date {
		font-weight: 400;
		color: var(--text-muted);
		margin-left: 8px;
	}
	.day-range {
		font-size: 13px;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.day-precip {
		font-size: 12px;
		color: var(--text-muted);
		white-space: nowrap;
		min-width: 54px;
		text-align: right;
	}
	.day-line {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.day-icon {
		font-size: 20px;
		width: 28px;
		text-align: center;
		flex-shrink: 0;
	}
	.day-text {
		font-size: 13px;
		color: var(--text-secondary);
	}
	/* The night line is the quieter of the two. */
	.day-line.night .day-icon {
		font-size: 16px;
	}
	.day-line.night .day-text {
		color: var(--text-muted);
	}
</style>
