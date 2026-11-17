/**
 * Shows only the rows that fit: hides every row whose bottom edge falls below the container's,
 * then reports how many it hid (for a "+N older not shown" footer). Re-runs when the container
 * resizes, the `key` it's given changes (new data), web fonts arrive, or an image inside it
 * finishes loading. The first row is never hidden, so a very short container still shows
 * something.
 */
export function fitRows(node: HTMLElement, params: { key: unknown; selector?: string; onHidden?: (n: number) => void }) {
	let current = params;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastHidden = -1;

	const run = () => {
		clearTimeout(timer);
		// A timer, not requestAnimationFrame: rAF never fires in a background tab or a headless
		// capture, which would leave every row showing.
		timer = setTimeout(() => {
			const rows = [...node.querySelectorAll<HTMLElement>(current.selector ?? ':scope > [data-row]')];
			for (const r of rows) r.style.display = '';
			const limit = node.getBoundingClientRect().bottom + 1;
			let cut = rows.length;
			for (let i = 1; i < rows.length; i++) {
				if (rows[i].getBoundingClientRect().bottom > limit) {
					cut = i;
					break;
				}
			}
			for (let i = cut; i < rows.length; i++) rows[i].style.display = 'none';
			const hidden = rows.length - cut;
			if (hidden !== lastHidden) {
				lastHidden = hidden;
				current.onHidden?.(hidden);
			}
		}, 16);
	};

	const onLoad = (e: Event) => {
		if ((e.target as Element | null)?.tagName === 'IMG') run();
	};
	const ro = new ResizeObserver(run);
	ro.observe(node);
	node.addEventListener('load', onLoad, true);
	run();
	document.fonts?.ready.then(run);

	return {
		update(next: typeof params) {
			const changed = next.key !== current.key;
			current = next;
			if (changed) lastHidden = -1;
			run();
		},
		destroy() {
			ro.disconnect();
			node.removeEventListener('load', onLoad, true);
			clearTimeout(timer);
		}
	};
}
