import * as settingsDb from '../storage/db/settings.js';
import { logger } from '../storage/db/logs.js';
import { fetchForecast, fetchActiveAlerts } from './client.js';

// Called on a schedule (see queue/scheduler.ts) and immediately after the admin changes
// the weather location/units (see api/admin.ts) — writes straight into global_settings'
// weather_* columns via settingsDb, same singleton-row approach as retention.
export async function pollWeatherNow(): Promise<void> {
	const { weather } = settingsDb.getSettings();
	if (weather.latitude === null || weather.longitude === null) {
		// No location configured yet — not an error, just nothing to do.
		return;
	}

	let forecastUpdate: Partial<typeof weather> = {};
	let forecastSucceeded = false;
	try {
		const { current, hourly, daily } = await fetchForecast(
			weather.latitude,
			weather.longitude,
			weather.unit,
			weather.windUnit,
			weather.pressureUnit
		);
		forecastUpdate = { current, hourly, daily };
		forecastSucceeded = true;
	} catch (err) {
		// Leave the existing cache untouched — a stale forecast beats a blank widget.
		logger.error('weather', `Forecast poll failed: ${(err as Error).message}`);
	}

	// Fetched independently of the forecast — the NWS only covers the US, so this fails
	// reliably (and expectedly) for every non-US location. A failure here shouldn't
	// touch the forecast update above, and unlike a stale forecast, a stale alert that's
	// since expired is worse to keep showing than none at all — clear to empty on failure.
	let alerts = weather.alerts;
	try {
		alerts = await fetchActiveAlerts(weather.latitude, weather.longitude);
	} catch (err) {
		alerts = [];
		logger.warn('weather', `Alerts poll failed (expected outside the US): ${(err as Error).message}`);
	}

	settingsDb.updateSettings({
		weather: {
			...weather,
			...forecastUpdate,
			alerts,
			updatedAt: forecastSucceeded ? new Date().toISOString() : weather.updatedAt
		}
	});
}
