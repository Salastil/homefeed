import type { WidgetPlugin } from '../types.js';
import { logger } from '../../storage/db/logs.js';
import { geocodeLocation } from './client.js';
import * as weatherDb from './db.js';
import { pollWeatherNow } from './poll.js';

// Sidebar "Weather" widget — config (location/units) and cache (forecast) live entirely in
// widget_kv (see db.ts); no bespoke table needed. Built-in and non-deletable (source:
// 'builtin' in installed_widgets), but otherwise a full WidgetPlugin like an uploaded one.
export const weatherPlugin: WidgetPlugin = {
	id: 'weather',
	displayName: 'Weather',
	version: '1.0.0',

	poll: {
		intervalMs: 45 * 60_000,
		run: pollWeatherNow
	},

	registerPublicRoutes(app) {
		app.get('/api/widget/weather', async () => ({ ...weatherDb.getConfig(), ...weatherDb.getCache() }));
	},

	registerAdminRoutes(app) {
		// Returns config + cache together (same shape as the public route) so the admin
		// tab can show "currently showing X" status alongside the location/unit form.
		app.get('/api/admin/widget/weather', async () => ({ ...weatherDb.getConfig(), ...weatherDb.getCache() }));

		app.patch('/api/admin/widget/weather', async (req) => {
			weatherDb.setConfig(req.body as any);
			// Poll immediately rather than waiting for the next scheduler tick (up to 45
			// minutes) — the admin just changed the location/unit and expects to see it reflected.
			pollWeatherNow().catch((err) => logger.error('weather', `Immediate poll failed: ${err.message}`));
			return { ...weatherDb.getConfig(), ...weatherDb.getCache() };
		});

		app.get('/api/admin/widget/weather/geocode', async (req, reply) => {
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
