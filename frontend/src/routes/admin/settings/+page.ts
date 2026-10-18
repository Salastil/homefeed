import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import {
	getSettings,
	getSources,
	getEvents,
	getModels,
	getAiStatus,
	getTelegramStatus,
	getLogs,
	getStockTickers,
	getStocksConfig,
	getAdminBookmarks,
	getBookmarksConfig,
	getPoe2Watchlist,
	getWeatherConfig,
	listWidgets
} from '$lib/adminApi';
import { getPoe2 } from '$lib/api';
import type { ModelCatalog, AiStatusBySlot, TelegramStatus } from '$lib/adminTypes';

const EMPTY_MODELS: ModelCatalog = { embedding: [], synthesis: [] };

export const load: PageLoad = async ({ fetch }) => {
	try {
		const [
			settings,
			sources,
			events,
			logs,
			stockTickers,
			stocksConfig,
			bookmarks,
			bookmarksConfig,
			poe2Watchlist,
			weatherConfig,
			poe2,
			installedWidgets
		] = await Promise.all([
			getSettings(fetch),
			getSources(fetch),
			getEvents(fetch),
			getLogs({}, fetch),
			getStockTickers(fetch),
			getStocksConfig(fetch),
			getAdminBookmarks(fetch),
			getBookmarksConfig(fetch),
			getPoe2Watchlist(fetch),
			getWeatherConfig(fetch),
			getPoe2(fetch),
			listWidgets(fetch)
		]);

		// The AI service (Ollama) may not be running yet, or may be switched off on purpose -
		// that must not take down the settings page, and must not hold it up either: an
		// unreachable host costs a full connection timeout, and awaiting it here made every
		// tab wait for it (10-15s with the AI server down). So these are started now but NOT
		// awaited; only the Models tab uses them and it awaits them itself, showing
		// "unreachable" if they fail. Each promise handles its own failure, so neither can
		// reject unobserved.
		const models: Promise<ModelCatalog> = getModels(fetch).catch(() => EMPTY_MODELS);
		const aiStatus: Promise<AiStatusBySlot> = getAiStatus(fetch).catch(() => ({
			embedding: { connected: false, host: settings.embeddingServiceHost, port: settings.embeddingServicePort, ramGB: null, gpu: null },
			synthesis: { connected: false, host: settings.synthesisServiceHost, port: settings.synthesisServicePort, ramGB: null, gpu: null }
		}));

		const telegramStatus: TelegramStatus = await getTelegramStatus(fetch).catch(
			() => ({ credentialsConfigured: false, connected: false, phone: null })
		);

		return {
			settings,
			sources,
			events,
			models,
			aiStatus,
			telegramStatus,
			logs,
			stockTickers,
			stocksConfig,
			bookmarks,
			bookmarksConfig,
			poe2Watchlist,
			weatherConfig,
			poe2,
			installedWidgets
		};
	} catch (err) {
		if ((err as { status?: number }).status === 401) {
			throw redirect(302, '/admin/login?redirectTo=/admin/settings');
		}
		throw err;
	}
};
