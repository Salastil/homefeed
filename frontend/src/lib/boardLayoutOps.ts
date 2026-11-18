/**
 * Edits to the board layout (admin Board columns page, and a column's sheet in board edit
 * mode). Each takes the current layout and returns a new one; the caller saves it with
 * updateSettings({ boardLayout }).
 */
import type { BoardLayoutCfg } from './adminApi';

// A JSON round trip rather than structuredClone: callers pass Svelte state proxies, which structuredClone refuses.
const copy = (l: BoardLayoutCfg): BoardLayoutCfg => JSON.parse(JSON.stringify(l));
const tidy = (l: BoardLayoutCfg) => ((l.slots = l.slots.filter((s) => s.columns.length > 0)), l);

/** Index of the position holding `key`, or -1 when it's hidden. */
export const slotOf = (l: BoardLayoutCfg, key: string) => l.slots.findIndex((s) => s.columns.includes(key));

export function moveSlot(l: BoardLayoutCfg, i: number, to: number): BoardLayoutCfg {
	const n = copy(l);
	if (to < 0 || to >= n.slots.length || to === i) return n;
	const [s] = n.slots.splice(i, 1);
	n.slots.splice(to, 0, s);
	return n;
}

/** Position i and the one after it share a column that rotates. */
export function rotateWithNext(l: BoardLayoutCfg, i: number): BoardLayoutCfg {
	const n = copy(l);
	if (!n.slots[i + 1]) return n;
	n.slots[i].columns.push(...n.slots[i + 1].columns);
	n.slots.splice(i + 1, 1);
	return n;
}

/** Takes `key` out of its rotating position into a position of its own: in front of the rest if it led the rotation, else right after it. */
export function ownColumn(l: BoardLayoutCfg, i: number, key: string): BoardLayoutCfg {
	const n = copy(l);
	const first = n.slots[i].columns[0] === key;
	n.slots[i].columns = n.slots[i].columns.filter((k) => k !== key);
	n.slots.splice(first ? i : i + 1, 0, { columns: [key], rotateSeconds: 20 });
	return tidy(n);
}

export function moveWithin(l: BoardLayoutCfg, i: number, k: number, dir: -1 | 1): BoardLayoutCfg {
	const n = copy(l);
	const cols = n.slots[i].columns;
	if (cols[k + dir]) [cols[k], cols[k + dir]] = [cols[k + dir], cols[k]];
	return n;
}

export function setRotate(l: BoardLayoutCfg, i: number, secs: number): BoardLayoutCfg {
	const n = copy(l);
	n.slots[i].rotateSeconds = secs;
	return n;
}

/** Hides a column from the board, or puts a hidden one back at the end. */
export function toggleBoard(l: BoardLayoutCfg, key: string): BoardLayoutCfg {
	const n = copy(l);
	if (n.hidden.includes(key)) {
		n.hidden = n.hidden.filter((k) => k !== key);
		n.slots.push({ columns: [key], rotateSeconds: 20 });
	} else {
		for (const s of n.slots) s.columns = s.columns.filter((k) => k !== key);
		n.hidden.push(key);
	}
	return tidy(n);
}

export function setColor(l: BoardLayoutCfg, key: string, c: string): BoardLayoutCfg {
	const n = copy(l);
	n.colors[key] = c;
	return n;
}

/** Forgets a deleted column everywhere in the layout. */
export function removeKey(l: BoardLayoutCfg, key: string): BoardLayoutCfg {
	const n = copy(l);
	for (const s of n.slots) s.columns = s.columns.filter((k) => k !== key);
	n.hidden = n.hidden.filter((k) => k !== key);
	delete n.colors[key];
	return tidy(n);
}
