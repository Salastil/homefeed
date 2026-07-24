import * as settingsDb from '../storage/db/settings.js';
import { logger } from '../storage/db/logs.js';
import { fetchForecast } from './client.js';

// Called on a schedule (see queue/scheduler.ts) and immediately after the admin changes
// the weather location/unit (see api/admin.ts) — writes straight into global_settings'
// weather_* columns via settingsDb, same singleton-row approach as retention.
export async function pollWeatherNow(): Promise<void> {
	const { weather } = settingsDb.getSettings();
	if (weather.latitude === null || weather.longitude === null) {
		// No location configured yet — not an error, just nothing to do.
		return;
	}
	try {
		const { current, hourly, daily } = await fetchForecast(weather.latitude, weather.longitude, weather.unit);
		settingsDb.updateSettings({
			weather: { ...weather, current, hourly, daily, updatedAt: new Date().toISOString() }
		});
	} catch (err) {
		// Leave the existing cache untouched — a stale forecast beats a blank widget.
		logger.error('weather', `Poll failed: ${(err as Error).message}`);
	}
}
