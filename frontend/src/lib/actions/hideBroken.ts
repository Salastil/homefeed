/**
 * For an <img> whose file can't be loaded (a hotlinked image that has since gone, a cached
 * file that aged out): hides the image's box instead of leaving an empty frame (issue #3).
 * `target` is a selector for the ancestor to hide - the thumbnail's wrapper - or, given a
 * function, is called instead so a component can swap in its own "no image" state.
 */
export function hideBroken(img: HTMLImageElement, target: string | (() => void) = '') {
	let current = target;
	const hide = () => {
		if (typeof current === 'function') return current();
		const box = current ? (img.closest(current) as HTMLElement | null) : img;
		if (box) box.style.display = 'none';
	};
	// An image that failed before the action ran (cached 404, SSR markup) never fires 'error'.
	if (img.complete && img.currentSrc && img.naturalWidth === 0) hide();
	img.addEventListener('error', hide);
	return {
		update(next: string | (() => void) = '') {
			current = next;
		},
		destroy() {
			img.removeEventListener('error', hide);
		}
	};
}
