/**
 * The image lightbox's open state (issue #3). Anything showing post photos calls
 * openLightbox(); the layout renders the one <Lightbox> while it's set.
 */
export interface LightboxImage {
	/** Full-size image, already resolved to an absolute URL. */
	url: string;
	/** Smaller copy for the film strip; the full image when there's none. */
	thumb?: string;
}

export const lightbox = $state<{ images: LightboxImage[] | null; index: number; title: string }>({ images: null, index: 0, title: '' });

export function openLightbox(images: LightboxImage[], index = 0, title = '') {
	if (!images.length) return;
	lightbox.images = images;
	lightbox.index = Math.min(Math.max(0, index), images.length - 1);
	lightbox.title = title;
}

export function closeLightbox() {
	lightbox.images = null;
	lightbox.index = 0;
	lightbox.title = '';
}
