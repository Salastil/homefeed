import type { PageLoad } from './$types';
import { getBoard, getStorylines } from '$lib/api';
import type { StorylinesResponse } from '$lib/types';

const EMPTY: StorylinesResponse = {
	settings: { rows: 2, rotateSeconds: 15, jumpOnUpdate: true, pauseOnHover: true, closeHours: 5 },
	storylines: [],
	events: [],
	closedToday: 0
};

export const load: PageLoad = async ({ fetch }) => {
	// A storyline failure shouldn't take the columns down with it (or the other way round).
	const [board, storylines] = await Promise.all([getBoard(fetch).catch(() => ({ columns: [] })), getStorylines(fetch).catch(() => EMPTY)]);
	return { board, storylines };
};
