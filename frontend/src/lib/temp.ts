/**
 * Temperature colour scale (accepted in issue #1): blue at or below freezing, light blue at
 * 45°F, white in the high 50s, then yellow, orange and red near 100°F. Fixed anchors, so a
 * temperature always has the same colour whatever range a chart happens to show.
 */
const STOPS: [number, [number, number, number]][] = [
	[32, [61, 127, 224]],
	[45, [143, 192, 240]],
	[58, [242, 240, 234]],
	[72, [245, 207, 82]],
	[86, [240, 138, 60]],
	[100, [224, 64, 44]]
];

export function toF(t: number, unit: 'celsius' | 'fahrenheit'): number {
	return unit === 'celsius' ? t * 1.8 + 32 : t;
}

export function tempColor(tF: number): string {
	let c = STOPS[0][1];
	if (tF >= STOPS[STOPS.length - 1][0]) c = STOPS[STOPS.length - 1][1];
	else if (tF > STOPS[0][0]) {
		for (let i = 0; i < STOPS.length - 1; i++) {
			const [t0, c0] = STOPS[i];
			const [t1, c1] = STOPS[i + 1];
			if (tF >= t0 && tF <= t1) {
				const f = (tF - t0) / (t1 - t0);
				c = [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f)) as [number, number, number];
				break;
			}
		}
	}
	return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * Stops for a vertical SVG gradient (gradientUnits="userSpaceOnUse") running from y(100°F)
 * at offset 0 to y(32°F) at offset 1 - wherever the line is drawn, its colour matches the
 * temperature at that height. `y` maps a temperature in the chart's own unit to SVG y.
 */
export function gradientSpan(y: (t: number) => number, unit: 'celsius' | 'fahrenheit'): { y1: number; y2: number; stops: { offset: number; color: string }[] } {
	const fromF = (f: number) => (unit === 'celsius' ? (f - 32) / 1.8 : f);
	return {
		y1: y(fromF(100)),
		y2: y(fromF(32)),
		stops: [...STOPS].reverse().map(([f]) => ({ offset: (100 - f) / 68, color: tempColor(f) }))
	};
}

export const SCALE_CSS = `linear-gradient(90deg, ${STOPS.map(([f]) => tempColor(f)).join(', ')})`;

/** A temperature colour for text: the scale colour, mixed toward the text colour on light themes so 58°F white stays legible. */
export function tempInk(tF: number): string {
	return `color-mix(in srgb, ${tempColor(tF)} var(--temp-ink), var(--tx))`;
}
