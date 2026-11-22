/**
 * A list panel that scrolls (issue #3, option A): reports how many rows (`[data-row]`) have
 * scrolled up out of view, so the panel can offer a "back to top" pill, and goes back to the
 * top by itself after `idleMs` without a scroll or the pointer over it - a page left open
 * returns to the newest items. Call `toTop(node)` from the pill.
 */
export function scrollList(node: HTMLElement, params: { onAbove?: (n: number) => void; idleMs?: number } = {}) {
	let current = params;
	let lastActive = Date.now();
	let lastAbove = -1;

	const report = () => {
		let above = 0;
		if (node.scrollTop > 4) {
			const top = node.getBoundingClientRect().top + 1;
			for (const r of node.querySelectorAll<HTMLElement>(':scope > [data-row]')) {
				if (r.getBoundingClientRect().bottom <= top) above++;
				else break;
			}
			// Scrolled, but less than a whole row: still worth offering the way back.
			above = Math.max(above, 1);
		}
		if (above !== lastAbove) {
			lastAbove = above;
			current.onAbove?.(above);
		}
	};
	const touch = () => (lastActive = Date.now());
	const onScroll = () => {
		touch();
		report();
	};

	node.addEventListener('scroll', onScroll, { passive: true });
	node.addEventListener('pointermove', touch, { passive: true });
	node.addEventListener('wheel', touch, { passive: true });
	const timer = setInterval(() => {
		if (node.scrollTop > 0 && Date.now() - lastActive > (current.idleMs ?? 60_000)) toTop(node);
	}, 5000);
	// New rows arriving on a poll shift what's above the fold.
	const mo = new MutationObserver(report);
	mo.observe(node, { childList: true });
	report();

	return {
		update(next: typeof params) {
			current = next;
			lastAbove = -1;
			report();
		},
		destroy() {
			node.removeEventListener('scroll', onScroll);
			node.removeEventListener('pointermove', touch);
			node.removeEventListener('wheel', touch);
			clearInterval(timer);
			mo.disconnect();
		}
	};
}

export function toTop(node: HTMLElement | undefined) {
	node?.scrollTo({ top: 0, behavior: 'smooth' });
}
