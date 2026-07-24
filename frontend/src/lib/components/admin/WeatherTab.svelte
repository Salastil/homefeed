<script lang="ts">
	import type { AdminSettings } from '$lib/adminTypes';
	import { updateSettings, geocodeLocation } from '$lib/adminApi';
	import { timeAgo } from '$lib/format';
	import SaveStatus from './SaveStatus.svelte';

	let { settings }: { settings: AdminSettings } = $props();

	let weather = $state({ ...settings.weather });
	let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveTimer: ReturnType<typeof setTimeout>;

	let query = $state('');
	let searching = $state(false);
	let searchError = $state<string | null>(null);
	let results = $state<Awaited<ReturnType<typeof geocodeLocation>>>([]);

	function scheduleSave() {
		status = 'saving';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			try {
				await updateSettings({ weather });
				status = 'saved';
				setTimeout(() => (status = 'idle'), 1500);
			} catch {
				status = 'error';
			}
		}, 500);
	}

	async function handleSearch() {
		if (!query.trim()) return;
		searching = true;
		searchError = null;
		try {
			results = await geocodeLocation(query.trim());
			if (results.length === 0) searchError = 'No matches found';
		} catch {
			searchError = 'Geocoding service unreachable';
		} finally {
			searching = false;
		}
	}

	function selectResult(r: (typeof results)[number]) {
		weather.locationName = r.admin1 ? `${r.name}, ${r.admin1}` : r.name;
		weather.latitude = r.latitude;
		weather.longitude = r.longitude;
		results = [];
		query = '';
		scheduleSave();
	}

	const units: { label: string; value: 'celsius' | 'fahrenheit' }[] = [
		{ label: '°F', value: 'fahrenheit' },
		{ label: '°C', value: 'celsius' }
	];

	const windUnits: { label: string; value: 'mph' | 'kph' }[] = [
		{ label: 'mph', value: 'mph' },
		{ label: 'kph', value: 'kph' }
	];

	const pressureUnits: { label: string; value: 'inHg' | 'hPa' }[] = [
		{ label: 'inHg', value: 'inHg' },
		{ label: 'hPa', value: 'hPa' }
	];
</script>

<div class="panel">
	<div class="head">
		<span class="panel-title">Location</span>
		<SaveStatus {status} />
	</div>
	<p class="hint">Powers the sidebar weather widget and the /weather page — searched via Open-Meteo's free geocoding lookup.</p>
	<div class="search-row">
		<input
			type="text"
			bind:value={query}
			onkeydown={(e) => e.key === 'Enter' && handleSearch()}
			placeholder="City name, e.g. Chicago"
		/>
		<button onclick={handleSearch} disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
	</div>
	{#if searchError}
		<p class="hint" style="color: var(--text-danger);">{searchError}</p>
	{/if}
	{#if results.length > 0}
		<div class="results">
			{#each results as r}
				<button class="result-row" onclick={() => selectResult(r)}>
					{r.name}{r.admin1 ? `, ${r.admin1}` : ''}{r.country ? ` — ${r.country}` : ''}
				</button>
			{/each}
		</div>
	{/if}

	<div class="current-row">
		<span class="usage-label">
			{#if weather.locationName}
				Configured: {weather.locationName}
			{:else}
				No location configured yet
			{/if}
		</span>
	</div>

	<div class="field-label">Temperature</div>
	<div class="pill-row">
		{#each units as unit}
			<button
				class="pill"
				class:active={weather.unit === unit.value}
				onclick={() => {
					weather.unit = unit.value;
					scheduleSave();
				}}
			>
				{unit.label}
			</button>
		{/each}
	</div>

	<div class="field-label">Wind speed</div>
	<div class="pill-row">
		{#each windUnits as unit}
			<button
				class="pill"
				class:active={weather.windUnit === unit.value}
				onclick={() => {
					weather.windUnit = unit.value;
					scheduleSave();
				}}
			>
				{unit.label}
			</button>
		{/each}
	</div>

	<div class="field-label">Pressure</div>
	<div class="pill-row">
		{#each pressureUnits as unit}
			<button
				class="pill"
				class:active={weather.pressureUnit === unit.value}
				onclick={() => {
					weather.pressureUnit = unit.value;
					scheduleSave();
				}}
			>
				{unit.label}
			</button>
		{/each}
	</div>

	<p class="hint" style="margin-top: 14px; margin-bottom: 0;">
		{#if weather.current}
			Currently showing: {Math.round(weather.current.temp)}° (feels like {Math.round(weather.current.feelsLike)}°) ·
			{weather.current.conditionText} (updated {timeAgo(weather.updatedAt ?? '')})
		{:else}
			Not showing any data yet — configure a location above, it polls immediately.
		{/if}
	</p>
</div>

<style>
	.panel {
		background: var(--surface-1);
		border-radius: 12px;
		padding: 16px;
		margin-bottom: 14px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}
	.panel-title {
		font-size: 13px;
		font-weight: 500;
	}
	.hint {
		font-size: 12px;
		color: var(--text-secondary);
		margin: 4px 0 12px;
	}
	.search-row {
		display: flex;
		gap: 8px;
	}
	.search-row input {
		flex: 1;
	}
	.results {
		display: flex;
		flex-direction: column;
		margin-top: 8px;
		border-radius: var(--radius);
		overflow: hidden;
		border: 0.5px solid var(--border);
	}
	.result-row {
		text-align: left;
		font-size: 12px;
		padding: 8px 10px;
		background: var(--surface-2);
		border: none;
		border-radius: 0;
	}
	.result-row:hover {
		background: var(--bg-accent);
	}
	.current-row {
		margin-top: 12px;
	}
	.usage-label {
		font-size: 12px;
		color: var(--text-muted);
	}
	.field-label {
		font-size: 11px;
		color: var(--text-muted);
		margin: 12px 0 6px;
	}
	.pill-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.pill {
		font-size: 12px;
		padding: 6px 12px;
		border-radius: var(--radius);
		border: 0.5px solid var(--border);
		background: var(--surface-2);
		color: var(--text-secondary);
	}
	.pill.active {
		background: var(--pill-bg);
		color: var(--pill-text);
		border-color: var(--pill-bg);
	}
</style>
