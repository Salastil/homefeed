import type { LayoutLoad } from './$types';
import { getCategories, getEvents, getWeather, getStocks, getBookmarks, getPoe2, getWidgetsEnabled } from '$lib/api';
import { getPrivateAccessStatus } from '$lib/privateAccess';
import { dev } from '$app/environment';
import type { Weather } from '$lib/types';

/**
 * Dev-only mockup data (issue #1): ?mockAlerts=1 adds a Frost Advisory for tonight, =2 also a
 * Red Flag Warning for this afternoon - written to fit a clear, dry day with a cold night.
 * Never active in production builds.
 */
function withMockAlerts(weather: Weather, which: string | null): Weather {
	if (!dev || !which) return weather;
	const at = (dayOffset: number, hour: number) => {
		const d = new Date();
		d.setDate(d.getDate() + dayOffset);
		d.setHours(hour, 0, 0, 0);
		return d.toISOString();
	};
	const frost = {
		id: 'mock-frost',
		event: 'Frost Advisory',
		severity: 'Minor',
		headline: 'Frost Advisory issued for Delaware County',
		onset: at(1, 1),
		ends: at(1, 9),
		expires: at(1, 9),
		description: 'Temperatures as low as 33 will result in frost formation. Frost could harm sensitive outdoor vegetation.',
		instruction: 'Take steps now to protect tender plants from the cold.',
		areaDesc: 'Delaware; Philadelphia; Chester',
		senderName: 'NWS Mount Holly NJ'
	};
	const flag = {
		id: 'mock-redflag',
		event: 'Red Flag Warning',
		severity: 'Severe',
		headline: 'Red Flag Warning until 7 PM this evening',
		onset: at(0, 11),
		ends: at(0, 19),
		expires: at(0, 19),
		description: 'Northwest winds 15 to 20 mph with gusts up to 35 mph and humidity as low as 22 percent will create critical fire weather.',
		instruction: 'Avoid outdoor burning and anything that could start a fire; any fire that starts could spread quickly.',
		areaDesc: 'Delaware; Philadelphia; Montgomery; Chester',
		senderName: 'NWS Mount Holly NJ'
	};
	const freeze = {
		id: 'mock-freeze',
		event: 'Freeze Watch',
		severity: 'Moderate',
		headline: 'Freeze Watch issued for Wednesday night',
		onset: at(1, 23),
		ends: at(2, 9),
		expires: at(2, 9),
		description: 'Sub-freezing temperatures as low as 28 possible. Frost and freeze conditions could kill crops and other sensitive vegetation.',
		instruction: 'Take steps now to protect tender plants from the cold and protect outdoor pipes.',
		areaDesc: 'Delaware; Chester; Montgomery',
		senderName: 'NWS Mount Holly NJ'
	};
	return { ...weather, alerts: which === '3' ? [frost, freeze, flag] : which === '2' ? [flag, frost] : [frost] };
}

// Named so the layout can be re-fetched on its own (see +layout.svelte's periodic
// invalidate('app:sidebar')) without disturbing page-level loads — e.g. the home feed's
// own pagination state, which a blanket invalidateAll() would reset every refresh.
export const load: LayoutLoad = async ({ fetch, data, depends, url }) => {
	depends('app:sidebar');
	const [categories, events, privateAccess, weather, stocks, bookmarks, poe2, widgetsEnabled] = await Promise.all([
		getCategories(fetch),
		getEvents(fetch),
		getPrivateAccessStatus(fetch),
		getWeather(fetch),
		getStocks(fetch),
		getBookmarks(fetch),
		getPoe2(fetch),
		getWidgetsEnabled(fetch)
	]);
	// Tracked events are a displayed category like any other (see MergeTab/EventsTab) —
	// only active ones show up as browsable, same as a paused/disabled category wouldn't.
	return {
		...data,
		categories,
		events: events.filter((e) => e.active),
		privateAccess,
		weather: withMockAlerts(weather, url.searchParams.get('mockAlerts')),
		stocks,
		bookmarks,
		poe2,
		widgetsEnabled
	};
};
