<script lang="ts">
	import type { Weather } from '$lib/types';
	import { gradientSpan, toF, tempInk } from '$lib/temp';
	import { parseDateOnly } from '$lib/format';

	let { weather, active = false }: { weather: Weather; active?: boolean } = $props();

	const W = 260;
	const H = 46;
	const cur = $derived(weather.current);
	const hours = $derived(weather.hourly.slice(0, 24));
	const temps = $derived(hours.map((h) => h.temp));
	const lo = $derived(temps.length ? Math.min(...temps) : 0);
	const hi = $derived(temps.length ? Math.max(...temps) : 1);
	const y = (t: number) => 6 + (H - 12) * (1 - (t - lo) / Math.max(1, hi - lo));
	const x = (i: number) => (i * W) / Math.max(1, hours.length - 1);
	const line = $derived(hours.map((h, i) => `${x(i).toFixed(1)},${y(h.temp).toFixed(1)}`).join(' '));
	const area = $derived(`0,${H} ${line} ${W},${H}`);
	const grad = $derived(gradientSpan(y, weather.unit));
	const peak = $derived(temps.indexOf(hi));
	const place = $derived((weather.locationName ?? '').split(',')[0]);
	const days = $derived(weather.daily.slice(1, 5));
</script>

{#if cur}
	<a class="wx" class:active href="/weather" title="Open the forecast">
		<div class="now">
			<div class="tp"><span class="ic">{cur.icon}</span>{Math.round(cur.temp)}°</div>
			<div class="cd">
				{cur.conditionText} · feels {Math.round(cur.feelsLike)}°<br />
				{cur.windDirection} {Math.round(cur.windSpeed)} {weather.windUnit}{place ? ` · ${place}` : ''}
			</div>
		</div>
		<div class="fc">
			<div class="curve">
				<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
					<defs>
						<linearGradient id="wx-mini" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={grad.y1} y2={grad.y2}>
							{#each grad.stops as s}<stop offset={s.offset} stop-color={s.color} />{/each}
						</linearGradient>
					</defs>
					<polygon points={area} style="fill:url(#wx-mini)" opacity="0.16" />
					<polyline points={line} fill="none" stroke="var(--temp-case)" stroke-width="4" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
					<polyline points={line} style="stroke:url(#wx-mini)" fill="none" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
				</svg>
				{#if hours.length}
					<span class="peak" style:left="{(peak / Math.max(1, hours.length - 1)) * 100}%" style:color={tempInk(toF(hi, weather.unit))}>{Math.round(hi)}°</span>
				{/if}
			</div>
			<div class="days">
				{#each days as d (d.date)}
					<span><em>{parseDateOnly(d.date).toLocaleDateString([], { weekday: 'short' })}</em> {d.icon} {Math.round(d.tempMax)}°</span>
				{/each}
			</div>
		</div>
		{#if active}<span class="open">Forecast open</span>{/if}
	</a>
{:else}
	<a class="wx empty" href="/weather">Weather not configured yet</a>
{/if}

<style>
	.wx {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 18px;
		align-items: center;
		height: 100%;
		color: inherit;
		position: relative;
	}
	.wx:hover {
		text-decoration: none;
	}
	.tp {
		font-size: 34px;
		font-weight: 600;
		letter-spacing: -1.2px;
		line-height: 1;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.ic {
		font-size: 30px;
	}
	.cd {
		font-size: 11.5px;
		color: var(--tx2);
		margin-top: 7px;
		line-height: 1.5;
		white-space: nowrap;
	}
	.curve {
		position: relative;
		height: 50px;
	}
	svg {
		width: 100%;
		height: 46px;
		display: block;
		margin-top: 4px;
	}
	.peak {
		position: absolute;
		top: -8px;
		transform: translateX(-50%);
		font-family: var(--mono);
		font-size: 10px;
	}
	.days {
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		color: var(--tx2);
		margin-top: 4px;
		white-space: nowrap;
		overflow: hidden;
	}
	.days em {
		font-style: normal;
		color: var(--tx3);
	}
	.open {
		position: absolute;
		right: 0;
		top: -2px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--acc);
	}
	.empty {
		display: grid;
		place-items: center;
		color: var(--tx3);
	}
</style>
