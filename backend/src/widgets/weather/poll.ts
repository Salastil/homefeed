import { logger } from '../../storage/db/logs.js';
import { fetchForecast, fetchActiveAlerts } from './client.js';
import * as weatherDb from './db.js';
import type { WeatherCache } from './db.js';

// Called on a schedule (see queue/scheduler.ts, via plugin.poll) and immediately after the
// admin changes the weather location/units (see plugin.ts's admin routes) — writes into
// the widget's own widget_kv cache entry via weatherDb, same singleton-cache approach as
// before, just no longer riding on global_settings.
export async function pollWeatherNow(): Promise<void> {
	const config = weatherDb.getConfig();
	if (config.latitude === null || config.longitude === null) {
		// No location configured yet — not an error, just nothing to do.
		return;
	}

	const cache = weatherDb.getCache();
	let forecastUpdate: Partial<WeatherCache> = {};
	let forecastSucceeded = false;
	try {
		const { current, hourly, daily } = await fetchForecast(
			config.latitude,
			config.longitude,
			config.unit,
			config.windUnit,
			config.pressureUnit
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
	let alerts = cache.alerts;
	try {
		alerts = await fetchActiveAlerts(config.latitude, config.longitude);
	} catch (err) {
		alerts = [];
		logger.warn('weather', `Alerts poll failed (expected outside the US): ${(err as Error).message}`);
	}

	weatherDb.setCache({
		...forecastUpdate,
		alerts,
		updatedAt: forecastSucceeded ? new Date().toISOString() : cache.updatedAt
	});
}
