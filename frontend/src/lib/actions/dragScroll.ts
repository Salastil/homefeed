/**
 * A row too wide for its box that the user can grab and drag sideways (issue #3: the storyline
 * chips on a busy day). The mouse wheel scrolls it sideways too; touch screens scroll it
 * natively. A drag doesn't count as a click on the chip it started on. While there is more
 * to see on a side, the row gets `data-more-left` / `data-more-right` so it can fade that edge.
 */
export function dragScroll(node: HTMLElement) {
	const THRESHOLD = 4;
	let startX = 0;
	let startLeft = 0;
	let pointer: number | null = null;
	let dragged = false;

	const edges = () => {
		const max = node.scrollWidth - node.clientWidth;
		node.toggleAttribute('data-more-left', node.scrollLeft > 1);
		node.toggleAttribute('data-more-right', node.scrollLeft < max - 1);
	};

	const down = (e: PointerEvent) => {
		if (e.pointerType !== 'mouse' || e.button !== 0) return;
		if (node.scrollWidth <= node.clientWidth) return;
		pointer = e.pointerId;
		startX = e.clientX;
		startLeft = node.scrollLeft;
		dragged = false;
	};
	const move = (e: PointerEvent) => {
		if (pointer !== e.pointerId) return;
		const dx = e.clientX - startX;
		if (!dragged && Math.abs(dx) < THRESHOLD) return;
		if (!dragged) {
			dragged = true;
			try {
				node.setPointerCapture(e.pointerId);
			} catch {
				/* the pointer is already gone */
			}
			node.style.cursor = 'grabbing';
			node.style.userSelect = 'none';
		}
		// clientX is in screen pixels; scrollLeft in the zoomed page's (see --ui-zoom).
		const zoom = (node as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
		node.scrollLeft = startLeft - dx / zoom;
	};
	const up = (e: PointerEvent) => {
		if (pointer !== e.pointerId) return;
		pointer = null;
		node.style.cursor = '';
		node.style.userSelect = '';
		if (node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
	};
	// The click that ends a drag lands on whatever chip is under the pointer: swallow it.
	const click = (e: MouseEvent) => {
		if (!dragged) return;
		dragged = false;
		e.preventDefault();
		e.stopPropagation();
	};
	const wheel = (e: WheelEvent) => {
		if (node.scrollWidth <= node.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
		e.preventDefault();
		node.scrollLeft += e.deltaY;
	};

	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', up);
	node.addEventListener('click', click, true);
	node.addEventListener('wheel', wheel, { passive: false });
	node.addEventListener('scroll', edges, { passive: true });
	const ro = new ResizeObserver(edges);
	ro.observe(node);
	const mo = new MutationObserver(edges);
	mo.observe(node, { childList: true, subtree: true });
	edges();

	return {
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', up);
			node.removeEventListener('click', click, true);
			node.removeEventListener('wheel', wheel);
			node.removeEventListener('scroll', edges);
			ro.disconnect();
			mo.disconnect();
		}
	};
}
