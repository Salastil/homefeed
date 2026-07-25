import type { PageLoad } from './$types';

// The sidebar's WeatherWidget (see +layout.svelte/Sidebar.svelte) already fetches this
// same data via the root layout load — no need for a second fetch here.
export const load: PageLoad = async ({ parent }) => {
	const { weather } = await parent();
	return { weather };
};
