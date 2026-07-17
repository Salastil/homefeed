import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { getSettings, getSources, getEvents, getModels, getAiStatus, getLogs } from '$lib/adminApi';
import type { ModelCatalog, AiStatus } from '$lib/adminTypes';

const EMPTY_MODELS: ModelCatalog = { embedding: [], image: [], synthesis: [] };

export const load: PageLoad = async ({ fetch }) => {
	try {
		const [settings, sources, events, logs] = await Promise.all([
			getSettings(fetch),
			getSources(fetch),
			getEvents(fetch),
			getLogs({}, fetch)
		]);

		// The AI service (Ollama) may not be running yet — that shouldn't take down the
		// whole settings page, just leave the Models/Connections tabs showing "unreachable".
		let models: ModelCatalog = EMPTY_MODELS;
		let aiStatus: AiStatus = { connected: false, host: settings.aiServiceHost, port: settings.aiServicePort, ramGB: 0, gpu: 'unknown' };
		try {
			[models, aiStatus] = await Promise.all([getModels(fetch), getAiStatus(fetch)]);
		} catch {
			// swallow — surfaced instead via aiStatus.connected in the UI
		}

		return { settings, sources, events, models, aiStatus, logs };
	} catch (err) {
		if ((err as { status?: number }).status === 401) {
			throw redirect(302, '/admin/login?redirectTo=/admin/settings');
		}
		throw err;
	}
};
