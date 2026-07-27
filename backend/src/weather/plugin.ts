import type { WidgetPlugin } from '../widgets/types.js';
import * as settingsDb from '../storage/db/settings.js';
import { geocodeLocation } from './client.js';
import { pollWeatherNow } from './poller.js';

// Built-in sidebar "Weather" widget — thin wrapper so it funnels into the same
// scheduler/route-registration loop as pluggable widgets (see widgets/registry.ts), while
// its config/cache stay on global_settings' weather_* columns exactly as before. Not going
// through the upload/delete lifecycle — see widgets/types.ts and the plan's "built-in vs
// pluggable" split; no migrate()/uninstall() since its schema isn't moving.
export const weatherPlugin: WidgetPlugin = {
	id: 'weather',
	displayName: 'Weather',
	version: '1.0.0',

	poll: {
		intervalMs: 45 * 60_000,
		run: pollWeatherNow
	},

	registerPublicRoutes(app) {
		app.get('/api/weather', async () => settingsDb.getSettings().weather);
	},

	registerAdminRoutes(app) {
		app.get('/api/admin/weather/geocode', async (req, reply) => {
			const { query } = req.query as { query?: string };
			if (!query || !query.trim()) return reply.code(400).send({ error: 'query required' });
			try {
				return await geocodeLocation(query.trim());
			} catch (err) {
				return reply.code(502).send({ error: `Geocoding service unreachable: ${(err as Error).message}` });
			}
		});
	}
};
