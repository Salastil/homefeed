<script lang="ts">
	/**
	 * Weather page (accepted pane I). Left: the conditions card and, under it, the hourly
	 * chart - temperature line coloured by temperature, feels-like, precipitation chance
	 * coloured by type, night shading, and the condition strip. The chart is the old hourly
	 * slider: hovering (or dragging, or arrow keys) previews that hour in the card, a touch
	 * or click pins it until "Back to now". Right: the 7-day list.
	 */
	import type { PageData } from './$types';
	import type { WeatherCurrentConditions, WeatherHourEntry } from '$lib/types';
	import { clock } from '$lib/live.svelte';
	import { parseDateOnly } from '$lib/format';
	import { gradientSpan, SCALE_CSS, tempColor, tempInk, toF } from '$lib/temp';
	import { alertLevel, sortAlerts } from '$lib/weatherAlerts';
	import WeatherAlertBand from '$lib/components/shell/WeatherAlertBand.svelte';

	let { data }: { data: PageData } = $props();

	const weather = $derived(data.weather);
	const unitLabel = $derived(weather.unit === 'celsius' ? 'C' : 'F');
	const hours = $derived(weather.hourly);
	const n = $derived(hours.length);
	const colorOf = (t: number) => tempColor(toF(t, weather.unit));
	const inkOf = (t: number) => tempInk(toF(t, weather.unit));

	// ---- Day / night -----------------------------------------------------------------------
	// Only today's sunrise and sunset are known; other days use the same times of day, which
	// is within a few minutes across a two-day window.
	const minutesOf = (iso: string) => {
		const d = new Date(iso);
		return d.getHours() * 60 + d.getMinutes();
	};
	const sunriseMin = $derived(weather.current ? minutesOf(weather.current.sunrise) : 7 * 60);
	const sunsetMin = $derived(weather.current ? minutesOf(weather.current.sunset) : 17 * 60);
	const isDay = (iso: string) => {
		const m = minutesOf(iso) + 30;
		return m >= sunriseMin && m < sunsetMin + 30;
	};

	// The backend has one 'clear' kind; the page splits it into Sunny / Clear (night).
	type DKind = 'sunny' | 'clear' | 'partly' | 'cloudy' | 'fog' | 'light-rain' | 'rain' | 'storm' | 'hail' | 'freezing' | 'sleet' | 'mix' | 'snow' | 'unknown';
	const KINDS: [DKind, string][] = [
		['sunny', 'Sunny'],
		['clear', 'Clear (night)'],
		['partly', 'Partly cloudy'],
		['cloudy', 'Cloudy'],
		['fog', 'Fog'],
		['light-rain', 'Light rain'],
		['rain', 'Rain'],
		['storm', 'Thunderstorm'],
		['hail', 'Hail'],
		['freezing', 'Freezing rain'],
		['sleet', 'Sleet'],
		['mix', 'Wintry mix'],
		['snow', 'Snow']
	];
	const LABEL = Object.fromEntries(KINDS) as Record<DKind, string>;
	const dkind = (h: WeatherHourEntry): DKind => {
		const k = h.conditionKind;
		if (!k) return 'unknown';
		if (k === 'clear') return isDay(h.time) ? 'sunny' : 'clear';
		return k;
	};
	const PCOL: Partial<Record<DKind, string>> = { snow: '#cfe0f5', mix: '#a6b8e8', sleet: '#7fb5c4', freezing: '#5fc6d6', hail: '#b9a3e3', storm: '#8a5cd0' };

	const runs = $derived.by(() => {
		const out: { kind: DKind; from: number; count: number }[] = [];
		hours.forEach((h, i) => {
			const k = dkind(h);
			const last = out.at(-1);
			if (last && last.kind === k) last.count++;
			else out.push({ kind: k, from: i, count: 1 });
		});
		return out;
	});
	const kindsPresent = $derived(new Set(runs.map((r) => r.kind)));

	// ---- Chart geometry ----------------------------------------------------------------------
	const VW = 1000;
	const PH = 210;
	const TOP = 26;
	const BOT = 150;
	const PB0 = 166;
	const PB1 = 206;
	const temps = $derived(hours.flatMap((h) => [h.temp, h.feelsLike]));
	const lo = $derived(temps.length ? Math.floor(Math.min(...temps)) - 2 : 0);
	const hi = $derived(temps.length ? Math.ceil(Math.max(...temps)) + 2 : 1);
	const X = (i: number) => ((i + 0.5) * VW) / Math.max(1, n);
	const Y = (v: number) => TOP + (BOT - TOP) * (1 - (v - lo) / Math.max(1, hi - lo));
	const line = $derived(hours.map((h, i) => `${X(i).toFixed(1)},${Y(h.temp).toFixed(1)}`).join(' '));
	const feel = $derived(hours.map((h, i) => `${X(i).toFixed(1)},${Y(h.feelsLike).toFixed(1)}`).join(' '));
	const area = $derived(n ? `${X(0).toFixed(1)},${BOT} ${line} ${X(n - 1).toFixed(1)},${BOT}` : '');
	const grad = $derived(gradientSpan(Y, weather.unit));
	const freezing = $derived(weather.unit === 'celsius' ? 0 : 32);
	const showFreeze = $derived(lo < freezing && freezing < hi);
	const nights = $derived.by(() => {
		const out: { x: number; w: number }[] = [];
		let i = 0;
		while (i < n) {
			if (!isDay(hours[i].time)) {
				let j = i;
				while (j + 1 < n && !isDay(hours[j + 1].time)) j++;
				const x0 = Math.max(0, X(i) - VW / n / 2);
				const x1 = Math.min(VW, X(j) + VW / n / 2);
				out.push({ x: x0, w: x1 - x0 });
				i = j + 1;
			} else i++;
		}
		return out;
	});
	const extremes = $derived.by(() => {
		if (!n) return [];
		let imax = 0;
		let imin = 0;
		hours.forEach((h, i) => {
			if (h.temp > hours[imax].temp) imax = i;
			if (h.temp < hours[imin].temp) imin = i;
		});
		return [...new Set([0, imax, imin])].sort((a, b) => a - b);
	});
	const DEG: Record<string, number> = { N: 180, NE: 225, E: 270, SE: 315, S: 0, SW: 45, W: 90, NW: 135 };
	const ticks = $derived(
		hours
			.map((h, i) => ({ h, i, d: new Date(h.time) }))
			.filter(({ d, i }) => d.getHours() % 3 === 0 && i < n - 1)
			.map(({ h, i, d }) => ({
				i,
				day: d.getHours() === 0,
				label: d.getHours() === 0 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleTimeString([], { hour: 'numeric' }).replace(' ', '').toLowerCase(),
				temp: h.temp,
				wind: h.windSpeed,
				deg: DEG[h.windDirection] ?? 0
			}))
	);
	const midnights = $derived(hours.flatMap((h, i) => (i > 0 && new Date(h.time).getHours() === 0 ? [i] : [])));

	// Each alert's active window, shaded on the chart (clipped to the hours shown).
	const alertSpans = $derived.by(() => {
		if (!n) return [];
		const t0 = new Date(hours[0].time).getTime();
		const xAt = (ms: number) => Math.min(VW, Math.max(0, ((ms - t0) / 3_600_000) * (VW / n)));
		const spans = sortAlerts(weather.alerts)
			.map((a) => {
				const from = a.onset ? new Date(a.onset).getTime() : clock.now;
				const to = new Date(a.ends ?? a.expires).getTime();
				return { id: a.id, event: a.event, level: alertLevel(a), x0: xAt(from), x1: xAt(to), lane: 0 };
			})
			.filter((s) => s.x1 - s.x0 > 2);
		// Overlapping windows put their labels on separate lines.
		const lanes: number[] = [];
		for (const sp of [...spans].sort((a, b) => a.x0 - b.x0)) {
			let lane = lanes.findIndex((end) => end <= sp.x0);
			if (lane < 0) lane = lanes.length;
			lanes[lane] = sp.x1;
			sp.lane = lane;
		}
		return spans.reverse();
	});

	// ---- The slider ----------------------------------------------------------------------------
	// Kept as the hour's timestamp so it survives `weather` being replaced by a background refresh.
	let hoveredTime = $state<string | null>(null);
	let pinned = $state(false);
	let scrubbing = false;
	let sliderEl = $state<HTMLElement | null>(null);
	const hovered = $derived(hoveredTime ? (hours.find((h) => h.time === hoveredTime) ?? null) : null);
	const cursor = $derived(hoveredTime ? hours.findIndex((h) => h.time === hoveredTime) : -1);

	function resetPreview() {
		hoveredTime = null;
		pinned = false;
	}
	function previewAt(clientX: number) {
		if (!sliderEl || !n) return;
		const r = sliderEl.getBoundingClientRect();
		const i = Math.min(n - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * n)));
		hoveredTime = hours[i].time;
	}
	function onDown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		scrubbing = true;
		try {
			sliderEl?.setPointerCapture(e.pointerId);
		} catch {
			/* no capture */
		}
		previewAt(e.clientX);
	}
	function onMove(e: PointerEvent) {
		if (e.pointerType === 'mouse' || scrubbing) previewAt(e.clientX);
	}
	function onUp() {
		if (!scrubbing) return;
		scrubbing = false;
		// A click or a touch pins the hour, so there's time to read it.
		pinned = true;
	}
	function onLeave(e: PointerEvent) {
		if (e.pointerType === 'mouse' && !scrubbing && !pinned) hoveredTime = null;
	}
	function onKey(e: KeyboardEvent) {
		const last = n - 1;
		if (last < 0) return;
		const c = Math.max(0, cursor);
		let next: number;
		if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(last, c + 1);
		else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, c - 1);
		else if (e.key === 'PageUp') next = Math.min(last, c + 6);
		else if (e.key === 'PageDown') next = Math.max(0, c - 6);
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = last;
		else if (e.key === 'Escape') return resetPreview();
		else return;
		e.preventDefault();
		hoveredTime = hours[next].time;
		pinned = true;
	}

	// ---- The card -------------------------------------------------------------------------------
	const src = $derived<WeatherHourEntry | WeatherCurrentConditions | null>(hovered ?? weather.current);
	const hourName = (iso: string) => new Date(iso).toLocaleTimeString([], { weekday: 'short', hour: 'numeric' });
	const inHours = $derived(hovered ? Math.max(0, Math.round((new Date(hovered.time).getTime() - clock.now) / 3_600_000)) : 0);

	function precipUnit(isSnow: boolean): string {
		if (weather.precipUnit !== 'mm') return 'in';
		return isSnow ? 'cm' : 'mm';
	}
	function formatPrecip(amount: number, isSnow: boolean): string {
		if (weather.precipUnit === 'mm' && !isSnow) {
			const mm = Math.round(amount);
			return mm === 0 ? '<1' : String(mm);
		}
		if (amount < 0.01) return '<0.01';
		return amount.toFixed(2).replace(/0$/, '');
	}
	const visCap = $derived(weather.windUnit === 'mph' ? 10 : 16);
	function formatVisibility(v: number | null | undefined): string {
		if (v === null || v === undefined) return '—';
		const u = weather.windUnit === 'mph' ? 'mi' : 'km';
		return v >= visCap ? `${visCap}+ ${u}` : `${v} ${u}`;
	}
	// NWS reports a sky with no ceiling as a negative or 25,000+ ft figure.
	function formatCeiling(ft: number | null | undefined): string | null {
		if (ft === null || ft === undefined) return null;
		if (ft < 0 || ft >= 25_000) return 'No ceiling';
		return `${ft.toLocaleString()} ft ceiling`;
	}
	const timeOf = (iso: string | undefined) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/ ?[AP]M/i, '') : '—');
	const tone = (level: number | undefined) => {
		const d = Math.abs(level ?? 0);
		return d === 0 ? 'ideal' : d <= 2 ? 'mild' : 'poor';
	};

	const stats = $derived.by(() => {
		const v = src;
		if (!v) return [];
		const ceiling = formatCeiling(v.cloudCeilingFt);
		return [
			{ k: 'Wind', v: `${v.windDirection} ${Math.round(v.windSpeed)} ${weather.windUnit}`, s: `gusts ${Math.round(v.windGust)}` },
			{ k: 'Humidity', v: `${v.humidity}%`, s: `dew point ${Math.round(v.dewPoint)}°` },
			{ k: 'Indoor humidity', v: `${v.indoorHumidity}%`, s: v.indoorHumidityLabel, tone: tone(v.indoorHumidityLevel) },
			{ k: 'Pressure', v: `${v.pressure} ${weather.pressureUnit}`, s: '' },
			{ k: 'Cloud cover', v: `${v.cloudCover}%`, s: ceiling ?? '' },
			{ k: 'Visibility', v: formatVisibility(v.visibility), s: '' },
			{
				k: 'Precipitation',
				v: `${v.precipitationChance}%`,
				s: v.precipAmount > 0 ? `${formatPrecip(v.precipAmount, v.precipIsSnow)} ${precipUnit(v.precipIsSnow)} ${v.precipIsSnow ? 'snow' : ''}`.trim() : 'none expected'
			},
			{ k: 'Sun', v: `${timeOf(weather.current?.sunrise)} – ${timeOf(weather.current?.sunset)}`, s: 'today' }
		];
	});

	// ---- 7 days ---------------------------------------------------------------------------------
	const isTonight = $derived(weather.current ? clock.now >= new Date(weather.current.sunset).getTime() : false);
	const wlo = $derived(weather.daily.length ? Math.min(...weather.daily.map((d) => d.nightLow ?? d.tempMin)) : 0);
	const whi = $derived(weather.daily.length ? Math.max(...weather.daily.map((d) => d.tempMax)) : 1);
	const pos = (t: number) => ((t - wlo) / Math.max(1, whi - wlo)) * 100;
	const updatedAgo = $derived(weather.updatedAt ? Math.max(0, Math.round((clock.now - new Date(weather.updatedAt).getTime()) / 60000)) : null);
</script>

<svelte:head><title>Weather · Homefeed</title></svelte:head>

{#if !weather.current}
	<div class="wpage">
		<p class="empty card">Not configured yet — set a location in the admin panel's Weather tab.</p>
	</div>
{:else}
	{@const cur = weather.current}
	<div class="wpage">
		<nav class="crumbs">
			<a class="back" href="/">← Board</a><span>Weather</span>{#if weather.locationName}<span class="sep">›</span><span>{weather.locationName}</span>{/if}
		</nav>
		{#if weather.alerts.length}<WeatherAlertBand alerts={weather.alerts} />{/if}
		<div class="wgrid">
			<section class="card now" class:previewing={!!hovered}>
				<div class="nh">
					{#if hovered}
						<span class="pill fc">FORECAST</span><b>{hourName(hovered.time).toUpperCase()}</b>
					{:else}
						<span class="pill live"><i></i>NOW</span>
					{/if}
					<span class="loc">{weather.locationName ?? ''}{updatedAgo !== null && !hovered ? ` · updated ${updatedAgo} min ago` : ''}</span>
					<span class="sp"></span>
					<!-- Always laid out, only hidden, so the header never changes height (comment 626). -->
					<button class="btn" class:hide={!(pinned || hovered)} tabindex={pinned || hovered ? 0 : -1} onclick={resetPreview}>Back to now</button>
				</div>
				<div class="hero">
					<div class="big">
						<div class="bt"><span class="ic">{src?.icon}</span><span class="deg" style:color={hovered ? inkOf(hovered.temp) : undefined}>{Math.round(src?.temp ?? 0)}°</span></div>
						<div class="bc">
							<b>{src?.conditionText}</b> · feels like {Math.round(src?.feelsLike ?? 0)}°{hovered ? ` · in ${inHours} ${inHours === 1 ? 'hour' : 'hours'}` : ''}
						</div>
					</div>
					<div class="cmp">
						{#if hovered}
							<div class="cmpr">
								<div><em>NOW</em><span class="ci">{cur.icon}</span><b>{Math.round(cur.temp)}°</b><i>{cur.conditionText}</i></div>
								<span class="arrow">→</span>
								<div><em>{hourName(hovered.time).toUpperCase()}</em><span class="ci">{hovered.icon}</span><b style:color={inkOf(hovered.temp)}>{Math.round(hovered.temp)}°</b><i>{hovered.conditionText}</i></div>
							</div>
							<p>
								{hovered.temp - cur.temp >= 0 ? '+' : '−'}{Math.abs(Math.round(hovered.temp - cur.temp))}° from now · wind {hovered.windDirection}
								{Math.round(hovered.windSpeed)} {weather.windUnit} · {hovered.precipitationChance}% chance of precipitation
							</p>
						{:else if weather.summary}
							<p class="sum">{weather.summary}</p>
						{/if}
					</div>
				</div>
				<div class="stats">
					{#each stats as s (s.k)}
						<div class="st">
							<span class="sk">{s.k}</span>
							<b>{s.v}</b>
							<span class="ss tone-{s.tone ?? ''}">{s.s}</span>
						</div>
					{/each}
				</div>
			</section>

			<section class="card week">
				<div class="wch">10-day forecast</div>
				{#each weather.daily as d, i (d.date)}
					{@const tonight = i === 0 && isTonight}
					{@const low = d.nightLow ?? d.tempMin}
					{@const pc = Math.max(d.precipitationChance ?? 0, d.nightPrecipitationChance ?? 0)}
					<div class="dy" class:today={i === 0}>
						<div class="dn">
							<b>{tonight ? 'Tonight' : i === 0 ? 'Today' : parseDateOnly(d.date).toLocaleDateString([], { weekday: 'long' })}</b>
							<em>{parseDateOnly(d.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</em>
						</div>
						<span class="di">{tonight ? d.nightIcon : d.icon}</span>
						<div class="dt">
							<b>{tonight ? d.nightDescription : d.conditionText}</b>
							{#if !tonight && d.nightDescription}<em>Night: {d.nightDescription} {d.nightIcon}</em>{/if}
						</div>
						<span class="dp" class:wet={pc >= 20}>{pc ? `💧 ${pc}%` : '—'}</span>
						<span class="lo" style:color={inkOf(low)}>{Math.round(low)}°</span>
						<span class="rg"><i style:left="{pos(low)}%" style:width="{Math.max(2, pos(d.tempMax) - pos(low))}%" style:background="linear-gradient(90deg, {colorOf(low)}, {colorOf(d.tempMax)})"></i></span>
						<span class="hi" style:color={inkOf(d.tempMax)}>{tonight ? '' : `${Math.round(d.tempMax)}°`}</span>
					</div>
				{/each}
				<div class="wfoot">Average of four models (GFS, ECMWF, ICON, GEM) · NWS National Blend for US locations</div>
			</section>

			{#if n}
				<section class="card hours">
					<div class="wch">
						Next {n} hours
						<span class="tscale">{weather.unit === 'celsius' ? '0°' : '32°'}<i style:background={SCALE_CSS}></i>{weather.unit === 'celsius' ? '38°' : '100°'}</span>
						<span class="legend">
							<span><i class="lt"></i>Temperature</span><span><i class="lf"></i>Feels like</span><span><i class="lp"></i>Precip chance (coloured by type)</span><span>Shaded = night</span>
						</span>
					</div>
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div
						class="slider"
						bind:this={sliderEl}
						role="slider"
						tabindex="0"
						aria-label="Hourly forecast"
						aria-valuemin={0}
						aria-valuemax={n - 1}
						aria-valuenow={Math.max(0, cursor)}
						aria-valuetext={hovered ? `${hourName(hovered.time)}, ${hovered.conditionText}, ${Math.round(hovered.temp)} degrees` : 'Now'}
						onpointerdown={onDown}
						onpointermove={onMove}
						onpointerup={onUp}
						onpointercancel={onUp}
						onpointerleave={onLeave}
						onkeydown={onKey}
					>
						<div class="plot">
							<svg viewBox="0 0 {VW} {PH}" preserveAspectRatio="none" aria-hidden="true">
								<defs>
									<linearGradient id="wx-main" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={grad.y1} y2={grad.y2}>
										{#each grad.stops as s}<stop offset={s.offset} stop-color={s.color} />{/each}
									</linearGradient>
								</defs>
								{#each ['warning', 'watch', 'advisory', 'statement'] as lv (lv)}
									<pattern id="wx-hatch-{lv}" class="hatch lv-{lv}" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
										<rect width="3" height="8" />
									</pattern>
								{/each}
								{#each nights as nt}<rect x={nt.x} y="0" width={nt.w} height={PH} class="night" />{/each}
								{#each alertSpans as al (al.id)}
									<rect x={al.x0} y="0" width={al.x1 - al.x0} height={BOT} class="alw lv-{al.level}" style="fill:url(#wx-hatch-{al.level})" />
									<rect x={al.x0} y="0" width={al.x1 - al.x0} height="3" class="alt lv-{al.level}" />
								{/each}
								<polygon points={area} class="tarea" style="fill:url(#wx-main)" />
								{#if showFreeze}<line x1="0" x2={VW} y1={Y(freezing)} y2={Y(freezing)} class="fz" />{/if}
								<polyline points={feel} class="fline" />
								<polyline points={line} class="tcase" />
								<polyline points={line} class="tline" style="stroke:url(#wx-main)" />
								<line x1="0" x2={VW} y1={PB1} y2={PB1} class="pbase" />
								{#each hours as h, i (h.time)}
									{@const ph = ((PB1 - PB0) * h.precipitationChance) / 100}
									{#if ph > 0}<rect x={X(i) - 7} y={PB1 - ph} width="14" height={ph} rx="2" fill={PCOL[dkind(h)] ?? '#3f7fd0'} />{/if}
								{/each}
							</svg>
							{#each extremes as i (i)}
								<span class="lab" style:left="{(X(i) / VW) * 100}%" style:top="{(Y(hours[i].temp) / PH) * 100}%" style:color={inkOf(hours[i].temp)}>{Math.round(hours[i].temp)}°</span>
							{/each}
							{#each alertSpans as al (al.id)}
								<span class="allab lv-{al.level}" class:end={al.x0 > VW * 0.8} style:top="{5 + al.lane * 20}px" style:left={al.x0 > VW * 0.8 ? 'auto' : `${(al.x0 / VW) * 100}%`} style:right={al.x0 > VW * 0.8 ? `${100 - (al.x1 / VW) * 100}%` : 'auto'} style:max-width="{Math.max(14, ((al.x1 - al.x0) / VW) * 100)}%">⚠ {al.event}</span>
							{/each}
							{#if showFreeze}<span class="fzlab" style:top="{(Y(freezing) / PH) * 100}%">{freezing}° freezing</span>{/if}
							{#if hovered}
								<span class="cdot" style:left="{(X(cursor) / VW) * 100}%" style:top="{(Y(hovered.temp) / PH) * 100}%" style:border-color={colorOf(hovered.temp)}></span>
								<span class="ctag" class:right={cursor > n * 0.8} class:left={cursor < n * 0.2} style:left="{(X(cursor) / VW) * 100}%" style:box-shadow="inset 0 -3px 0 {colorOf(hovered.temp)}">
									{hourName(hovered.time)} · {LABEL[dkind(hovered)] ?? hovered.conditionText} · {Math.round(hovered.temp)}°
								</span>
							{/if}
						</div>
						<div class="strip">
							{#each runs as r (r.from)}
								<div class="seg k-{r.kind}" style:flex-grow={r.count} title={LABEL[r.kind] ?? ''}><span>{r.count >= 2 ? (LABEL[r.kind] ?? '') : ''}</span></div>
							{/each}
							{#each midnights as i (i)}<span class="mid" style:left="{(i / n) * 100}%"></span>{/each}
						</div>
						<div class="ticks">
							{#each ticks as t (t.i)}
								<span class="tk" class:day={t.day} style:left="{(X(t.i) / VW) * 100}%">
									<b>{t.label}</b><em style:color={inkOf(t.temp)}>{Math.round(t.temp)}°</em><i style:transform="rotate({t.deg}deg)">↓</i><u>{Math.round(t.wind)}</u>
								</span>
							{/each}
						</div>
						{#if cursor >= 0}<span class="cur" style:left="{((cursor + 0.5) / n) * 100}%"></span>{/if}
					</div>
					<div class="key">
						{#each KINDS.filter(([k]) => kindsPresent.has(k)) as [k, l] (k)}
							<span class="kk"><i class="sw k-{k}"></i>{l}</span>
						{/each}
						<span class="hint">Hover to preview an hour · click or drag to pin · ← → step · Esc for now</span>
					</div>
				</section>
			{/if}
		</div>
	</div>
{/if}

<style>
	.wpage {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.crumbs {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12.5px;
		color: var(--tx3);
		flex: none;
	}
	.back {
		border: 1px solid var(--bd);
		border-radius: 7px;
		padding: 4px 10px;
	}
	.empty {
		padding: 20px;
		color: var(--tx3);
	}
	.wgrid {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 0.62fr);
		grid-template-rows: auto minmax(0, 1fr);
		gap: 12px;
	}
	.now {
		padding: 14px 20px 16px;
		border: 1px solid var(--bd);
		transition: border-color 0.12s ease;
		min-height: 0;
		overflow: hidden;
	}
	.now.previewing {
		border-color: var(--acc);
	}
	/* Every part of the card keeps one size whether it shows now or a previewed hour, so
	   hovering the slider never moves the chart below (issue #1, comment 626). */
	.nh {
		height: 28px;
		display: flex;
		align-items: center;
		gap: 12px;
		white-space: nowrap;
		overflow: hidden;
		font-size: 12px;
		color: var(--tx3);
	}
	.nh b {
		color: var(--tx2);
		letter-spacing: 0.06em;
		font-size: 12px;
	}
	.pill.fc {
		background: var(--acc);
		color: var(--s0);
	}
	.sp {
		flex: 1;
	}
	.btn {
		height: 26px;
		flex: none;
		font-size: 12px;
		padding: 0 11px;
		border-radius: 7px;
		background: transparent;
		color: var(--acc);
	}
	.btn.hide {
		visibility: hidden;
	}
	.hero {
		height: 120px;
		display: grid;
		grid-template-columns: 300px minmax(0, 1fr);
		gap: 28px;
		align-items: center;
		margin: 10px 0 14px;
	}
	.big {
		min-width: 0;
	}
	.bt {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.ic {
		font-size: 64px;
		line-height: 1;
	}
	.deg {
		font-size: 76px;
		font-weight: 600;
		letter-spacing: -3px;
		line-height: 1;
	}
	.bc {
		font-size: 14px;
		color: var(--tx2);
		margin-top: 6px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bc b {
		color: var(--tx);
		font-weight: 600;
	}
	.cmp {
		border: 1px solid var(--bd);
		border-radius: 10px;
		padding: 12px 16px;
		background: var(--s2);
		height: 108px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}
	.cmpr {
		display: flex;
		align-items: center;
		gap: 34px;
	}
	.cmpr div {
		display: grid;
		grid-template-columns: auto auto;
		column-gap: 8px;
		align-items: center;
	}
	.cmpr em {
		grid-column: 1 / 3;
		font-style: normal;
		font-size: 10.5px;
		letter-spacing: 0.08em;
		color: var(--tx3);
	}
	.ci {
		font-size: 24px;
	}
	.cmpr b {
		font-size: 26px;
		font-weight: 600;
	}
	.cmpr i {
		grid-column: 1 / 3;
		font-style: normal;
		font-size: 12.5px;
		color: var(--tx2);
	}
	.arrow {
		color: var(--tx3);
		font-size: 20px;
	}
	.cmp p {
		margin: 8px 0 0;
		font-size: 12.5px;
		color: var(--tx2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cmp p.sum {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.55;
		white-space: normal;
		display: -webkit-box;
		-webkit-line-clamp: 4;
		-webkit-box-orient: vertical;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
	}
	.st {
		border: 1px solid var(--bd);
		border-radius: 9px;
		padding: 9px 12px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.st .sk {
		font-size: 10.5px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--tx3);
	}
	.st b {
		font-size: 18px;
		font-weight: 600;
		white-space: nowrap;
	}
	.ss {
		font-size: 11.5px;
		color: var(--tx3);
		min-height: 1em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tone-ideal {
		color: var(--up);
	}
	.tone-mild {
		color: #d9a94e;
	}
	.tone-poor {
		color: var(--dn);
	}
	/* Alert windows on the chart: hatched in the alert's colour, with a solid top edge. */
	.lv-warning {
		--lv: #e5484d;
	}
	.lv-watch {
		--lv: #f08c3c;
	}
	.lv-advisory {
		--lv: #e0b030;
	}
	.lv-statement {
		--lv: #3fa9dc;
	}
	.hatch rect {
		fill: var(--lv);
		opacity: 0.16;
	}
	.alt {
		fill: var(--lv);
	}
	.allab.end {
		border-radius: 0 0 0 5px;
	}
	.allab {
		position: absolute;
		top: 5px;
		padding: 1px 7px;
		border-radius: 0 0 5px 0;
		font-size: 10.5px;
		font-weight: 600;
		color: var(--lv);
		background: color-mix(in srgb, var(--lv) 14%, var(--s1));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
	}
	.week {
		grid-row: 1 / 3;
		grid-column: 2;
		padding: 14px 18px;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.wch {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11.5px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--tx2);
		margin-bottom: 10px;
	}
	/* Ten days share the column's height evenly, so the list fills it at any screen height. */
	.dy {
		flex: 1 1 0;
		min-height: 44px;
		display: grid;
		grid-template-columns: 110px 40px minmax(0, 1fr) 62px 34px 110px 36px;
		gap: 10px;
		align-items: center;
		padding: 0 8px;
		border-bottom: 1px solid var(--bd);
	}

	.dy.today {
		background: var(--s2);
		border-radius: 8px;
	}
	.dn b {
		display: block;
		font-size: 14.5px;
		font-weight: 600;
	}
	.dn em,
	.dt em {
		font-style: normal;
		font-size: 11.5px;
		color: var(--tx3);
	}
	.di {
		font-size: 26px;
		text-align: center;
	}
	.dt b {
		display: block;
		font-size: 13.5px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dt em {
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dp {
		font-size: 12px;
		color: var(--tx3);
		text-align: right;
	}
	.dp.wet {
		color: #5aa7e8;
		font-weight: 600;
	}
	.lo,
	.hi {
		font-family: var(--mono);
		font-size: 13px;
	}
	.lo {
		text-align: right;
	}
	.rg {
		position: relative;
		height: 5px;
		border-radius: 3px;
		background: var(--s3);
	}
	.rg i {
		position: absolute;
		top: 0;
		bottom: 0;
		border-radius: 3px;
	}
	.wfoot {
		flex: none;
		margin-top: 6px;
		padding-top: 10px;
		font-size: 11.5px;
		color: var(--tx3);
	}
	.hours {
		padding: 14px 20px 12px;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.tscale {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: 14px;
		font-family: var(--mono);
		font-size: 10.5px;
		font-weight: 400;
		letter-spacing: 0;
		color: var(--tx3);
	}
	.tscale i {
		display: block;
		width: 120px;
		height: 6px;
		border-radius: 3px;
	}
	.legend {
		margin-left: auto;
		display: flex;
		gap: 16px;
		font-size: 11px;
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
		color: var(--tx3);
	}
	.legend span {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.legend i {
		display: inline-block;
		width: 16px;
		height: 3px;
		border-radius: 2px;
	}
	.legend .lt {
		background: linear-gradient(90deg, #3d7fe0, #f2f0ea, #e0402c);
	}
	.legend .lf {
		background: var(--tx3);
	}
	.legend .lp {
		width: 8px;
		height: 8px;
		background: #3f7fd0;
	}
	.slider {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		cursor: crosshair;
		user-select: none;
		touch-action: pan-y;
		outline: none;
	}
	.slider:focus-visible {
		box-shadow: 0 0 0 2px var(--acc);
		border-radius: 6px;
	}
	.plot {
		position: relative;
		flex: 1;
		min-height: 120px;
	}
	.plot svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.night {
		fill: var(--tx);
		opacity: 0.05;
	}
	.tarea {
		opacity: 0.2;
	}
	.tcase {
		fill: none;
		stroke: var(--temp-case);
		stroke-width: 5;
		vector-effect: non-scaling-stroke;
		stroke-linejoin: round;
	}
	.tline {
		fill: none;
		stroke-width: 3;
		vector-effect: non-scaling-stroke;
		stroke-linejoin: round;
	}
	.fline {
		fill: none;
		stroke: var(--tx3);
		stroke-width: 1.4;
		stroke-dasharray: 4 3;
		vector-effect: non-scaling-stroke;
	}
	.fz {
		stroke: #5fc6d6;
		stroke-width: 1;
		stroke-dasharray: 6 4;
		vector-effect: non-scaling-stroke;
		opacity: 0.8;
	}
	.pbase {
		stroke: var(--bd);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.lab {
		position: absolute;
		transform: translate(-50%, -140%);
		font-family: var(--mono);
		font-size: 11.5px;
		font-weight: 600;
		pointer-events: none;
	}
	.fzlab {
		position: absolute;
		right: 4px;
		transform: translateY(-120%);
		font-family: var(--mono);
		font-size: 10.5px;
		color: #5fc6d6;
		pointer-events: none;
	}
	.cdot {
		position: absolute;
		width: 12px;
		height: 12px;
		margin: -6px 0 0 -6px;
		border-radius: 50%;
		background: var(--s1);
		border: 3px solid;
		pointer-events: none;
	}
	.ctag {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		font-family: var(--mono);
		font-size: 11.5px;
		font-weight: 600;
		white-space: nowrap;
		background: var(--s1);
		border: 1px solid var(--bd);
		border-radius: 6px;
		padding: 3px 8px;
		pointer-events: none;
		z-index: 2;
	}
	.ctag.right {
		transform: translateX(-100%);
	}
	.ctag.left {
		transform: none;
	}
	.strip {
		position: relative;
		display: flex;
		height: 28px;
		margin-top: 6px;
		border-radius: 6px;
		overflow: hidden;
		flex: none;
	}
	.seg {
		position: relative;
		flex: 0 1 0;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
		border-right: 1px solid rgba(0, 0, 0, 0.28);
	}
	.seg span {
		position: relative;
		z-index: 1;
		padding: 1px 5px;
		border-radius: 4px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mid {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: rgba(0, 0, 0, 0.45);
		pointer-events: none;
	}
	/* Condition colours, the same in light and dark: a data colour scale with its own text colours. */
	.k-sunny {
		background: #f2c14e;
		color: #3a2a05;
	}
	.k-clear {
		background: #33406b;
		color: #dfe5ff;
	}
	.k-partly {
		background: #cdbb8b;
		color: #2f2a1a;
	}
	.k-cloudy {
		background: #8a8f99;
		color: #15171b;
	}
	.k-fog {
		background: repeating-linear-gradient(0deg, #a9adb8 0 3px, #959aa6 3px 6px);
		color: #1d2026;
	}
	.k-light-rain {
		background: #8fb8e0;
		color: #0e2338;
	}
	.k-rain {
		background: #2f6fc4;
		color: #fff;
	}
	.k-storm {
		background: #6b3fc0;
		color: #fff;
	}
	.k-hail {
		background:
			radial-gradient(circle, #f4f1ff 0 1.8px, transparent 2.3px) 0 0 / 7px 7px,
			#8a6bd6;
		color: #fff;
	}
	.k-hail span {
		background: rgba(60, 30, 120, 0.75);
	}
	.k-freezing {
		background: linear-gradient(135deg, #2bb3c9, #7fe0ec);
		color: #06323a;
	}
	.k-sleet {
		background:
			radial-gradient(circle, #e8f6fa 0 1.4px, transparent 1.9px) 0 0 / 6px 6px,
			#4f97ad;
		color: #fff;
	}
	.k-sleet span {
		background: rgba(20, 70, 85, 0.75);
	}
	.k-mix {
		background: repeating-linear-gradient(135deg, #5b8fd6 0 6px, #e8eef6 6px 12px);
		color: #0e2338;
	}
	.k-mix span {
		background: rgba(240, 244, 250, 0.92);
	}
	.k-snow {
		background: #eef3f9;
		color: #24324a;
	}
	.k-unknown {
		background: #8a8f99;
		color: transparent;
	}
	.ticks {
		position: relative;
		height: 62px;
		flex: none;
	}
	.tk {
		position: absolute;
		top: 6px;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		font-family: var(--mono);
		font-size: 10.5px;
		line-height: 1.35;
		color: var(--tx3);
		white-space: nowrap;
	}
	.tk b {
		font-weight: 500;
		color: var(--tx2);
	}
	.tk.day b {
		color: var(--acc);
	}
	.tk em {
		font-style: normal;
	}
	.tk i {
		font-style: normal;
		display: inline-block;
	}
	.tk u {
		text-decoration: none;
	}
	.cur {
		position: absolute;
		top: 0;
		bottom: 62px;
		width: 2px;
		margin-left: -1px;
		background: #fff;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55);
		pointer-events: none;
	}
	.key {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		padding-top: 6px;
		font-size: 11.5px;
		color: var(--tx2);
		flex: none;
	}
	.kk {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.sw {
		display: inline-block;
		width: 22px;
		height: 12px;
		border-radius: 3px;
		border: 1px solid rgba(0, 0, 0, 0.3);
	}
	.hint {
		margin-left: auto;
		color: var(--tx3);
	}
	@media (max-width: 1100px) {
		.wgrid {
			grid-template-columns: 1fr;
			grid-template-rows: none;
		}
		.week {
			grid-row: auto;
			grid-column: auto;
		}
		.stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
