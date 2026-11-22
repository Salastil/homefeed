<script lang="ts">
	/**
	 * Full-screen image viewer for post photos (issue #3): the image fitted to the screen,
	 * arrows either side, a film strip of every image along the bottom, and in the top right
	 * zoom out / zoom level / zoom in, copy to clipboard, download, open in a new tab and close.
	 * Zoomed in, the image can be dragged around; the wheel zooms, a double-click toggles 2x.
	 * Keys: ← → to move, + − 0 to zoom, Esc to close.
	 */
	import { closeLightbox, lightbox } from '$lib/lightbox.svelte';

	const images = $derived(lightbox.images ?? []);
	const index = $derived(Math.min(lightbox.index, Math.max(0, images.length - 1)));
	const current = $derived(images[index]);
	const multi = $derived(images.length > 1);

	const MIN = 0.5;
	const MAX = 6;
	let scale = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let status = $state('');
	let statusTimer: ReturnType<typeof setTimeout> | undefined;

	const reset = () => {
		scale = 1;
		tx = 0;
		ty = 0;
	};
	const go = (i: number) => {
		if (!images.length) return;
		lightbox.index = (i + images.length) % images.length;
		reset();
	};
	const zoomTo = (s: number) => {
		const next = Math.min(MAX, Math.max(MIN, s));
		// Keep the same point in the middle of the screen while zooming.
		tx = (tx * next) / scale;
		ty = (ty * next) / scale;
		scale = next;
		if (scale <= 1) tx = ty = 0;
	};
	const zoomIn = () => zoomTo(scale * 1.25);
	const zoomOut = () => zoomTo(scale / 1.25);

	function flash(msg: string) {
		status = msg;
		clearTimeout(statusTimer);
		statusTimer = setTimeout(() => (status = ''), 2200);
	}

	const fileName = (url: string, type: string) => {
		const base = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || 'image').replace(/\?.*$/, '');
		if (/\.[a-z0-9]{3,4}$/i.test(base)) return base;
		return `${base}.${type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'}`;
	};

	async function fetchBlob(url: string): Promise<Blob> {
		const res = await fetch(url, { credentials: 'include' });
		if (!res.ok) throw new Error(String(res.status));
		return res.blob();
	}

	async function download() {
		if (!current) return;
		try {
			const blob = await fetchBlob(current.url);
			const href = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = href;
			a.download = fileName(current.url, blob.type);
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(href), 10_000);
			flash('Downloaded');
		} catch {
			// A host that doesn't allow reading its images from here: let the browser fetch it.
			window.open(current.url, '_blank', 'noopener,noreferrer');
		}
	}

	async function copy() {
		if (!current) return;
		try {
			const blob = await fetchBlob(current.url);
			// Clipboards take PNG everywhere; anything else is redrawn as one.
			let png = blob;
			if (blob.type !== 'image/png') {
				const bmp = await createImageBitmap(blob);
				const canvas = document.createElement('canvas');
				canvas.width = bmp.width;
				canvas.height = bmp.height;
				canvas.getContext('2d')!.drawImage(bmp, 0, 0);
				bmp.close();
				png = await new Promise<Blob>((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error('encode'))), 'image/png'));
			}
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
			flash('Copied to clipboard');
		} catch {
			flash("Couldn't copy this image");
		}
	}

	const openTab = () => current && window.open(current.url, '_blank', 'noopener,noreferrer');

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') closeLightbox();
		else if (e.key === 'ArrowRight' && multi) go(index + 1);
		else if (e.key === 'ArrowLeft' && multi) go(index - 1);
		else if (e.key === '+' || e.key === '=') zoomIn();
		else if (e.key === '-' || e.key === '_') zoomOut();
		else if (e.key === '0') reset();
		else return;
		e.preventDefault();
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		zoomTo(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
	}

	// Drag to pan while zoomed in.
	let drag: { id: number; x: number; y: number; tx: number; ty: number } | null = null;
	let moved = false;
	function down(e: PointerEvent) {
		if (scale <= 1 || e.button !== 0) return;
		drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx, ty };
		moved = false;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!drag || drag.id !== e.pointerId) return;
		const zoom = (e.currentTarget as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
		tx = drag.tx + (e.clientX - drag.x) / zoom;
		ty = drag.ty + (e.clientY - drag.y) / zoom;
		moved = true;
	}
	const up = () => (drag = null);

	// A click on the dark area around the image closes; a click on the image itself doesn't.
	let frame: HTMLElement | undefined = $state();
	function stageClick(e: MouseEvent) {
		if (moved) {
			moved = false;
			return;
		}
		if (e.target === e.currentTarget || e.target === frame) closeLightbox();
	}

	// The image is drawn as large as fits - small originals (some posts only carry a thumbnail-
	// sized copy) are scaled up rather than left as a speck in the middle of the screen.
	let fw = $state(0);
	let fh = $state(0);
	let natural = $state<{ w: number; h: number } | null>(null);
	const fitted = $derived.by(() => {
		if (!natural || !fw || !fh) return null;
		const k = Math.min(fw / natural.w, fh / natural.h);
		return { w: Math.round(natural.w * k), h: Math.round(natural.h * k) };
	});
	$effect(() => {
		void current?.url;
		natural = null;
	});

	// Keep the active thumbnail in view in a long strip.
	let strip: HTMLElement | undefined = $state();
	$effect(() => {
		void index;
		strip?.querySelector<HTMLElement>('.on')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
	});

	$effect(() => () => clearTimeout(statusTimer));
</script>

<svelte:window onkeydown={onKey} />

{#if current}
	<div class="lb" role="dialog" aria-modal="true" aria-label="Image viewer">
		<header class="bar">
			<div class="ti">
				{#if lightbox.title}<b>{lightbox.title}</b>{/if}
				{#if multi}<span class="ct">{index + 1} / {images.length}</span>{/if}
				{#if status}<span class="st">{status}</span>{/if}
			</div>
			<div class="tools">
				<button aria-label="Zoom out" title="Zoom out (−)" onclick={zoomOut} disabled={scale <= MIN}>
					<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21M7.5 10.5h6" /></svg>
				</button>
				<button class="pct" title="Back to fit (0)" onclick={reset}>{Math.round(scale * 100)}%</button>
				<button aria-label="Zoom in" title="Zoom in (+)" onclick={zoomIn} disabled={scale >= MAX}>
					<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21M7.5 10.5h6M10.5 7.5v6" /></svg>
				</button>
				<span class="sep"></span>
				<button aria-label="Copy image" title="Copy image to clipboard" onclick={copy}>
					<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
				</button>
				<button aria-label="Download" title="Download" onclick={download}>
					<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" /></svg>
				</button>
				<button aria-label="Open in new tab" title="Open in a new tab" onclick={openTab}>
					<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg>
				</button>
				<button aria-label="Close" title="Close (Esc)" onclick={closeLightbox}>
					<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
				</button>
			</div>
		</header>

		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="stage" onclick={stageClick} onwheel={onWheel}>
			<div class="frame" bind:this={frame} bind:clientWidth={fw} bind:clientHeight={fh}>
				{#key current.url}
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<img
						src={current.url}
						alt=""
						draggable="false"
						class:zoomed={scale > 1}
						class:dragging={!!drag}
						style:width={fitted ? `${fitted.w}px` : null}
						style:height={fitted ? `${fitted.h}px` : null}
						style:transform="translate({tx}px, {ty}px) scale({scale})"
						onload={(e) => { const im = e.currentTarget as HTMLImageElement; natural = { w: im.naturalWidth, h: im.naturalHeight }; }}
						onpointerdown={down}
						onpointermove={move}
						onpointerup={up}
						onpointercancel={up}
						ondblclick={() => (scale > 1 ? reset() : zoomTo(2))}
					/>
				{/key}
			</div>
			{#if multi}
				<button class="nav prev" aria-label="Previous image" onclick={() => go(index - 1)}>
					<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
				</button>
				<button class="nav next" aria-label="Next image" onclick={() => go(index + 1)}>
					<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
				</button>
			{/if}
		</div>

		{#if multi}
			<div class="strip" bind:this={strip}>
				{#each images as im, i (im.url + i)}
					<button class:on={i === index} aria-label="Image {i + 1}" onclick={() => go(i)}><img src={im.thumb ?? im.url} alt="" loading="lazy" /></button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.lb {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		flex-direction: column;
		background: rgba(5, 6, 8, 0.93);
		backdrop-filter: blur(3px);
		color: #e8e6e0;
	}
	.bar {
		flex: none;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px 14px 10px 18px;
	}
	.ti {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 12px;
		white-space: nowrap;
		overflow: hidden;
	}
	.ti b {
		font-size: 14px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ct {
		font-family: var(--mono);
		font-size: 12px;
		color: #a5a39b;
	}
	.st {
		font-size: 12px;
		color: #e2896a;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 2px;
		flex: none;
	}
	.tools button {
		width: 34px;
		height: 34px;
		padding: 0;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: #d8d6cf;
	}
	.tools button:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
	}
	.tools button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.tools .pct {
		width: auto;
		min-width: 52px;
		padding: 0 6px;
		font-family: var(--mono);
		font-size: 12px;
	}
	.sep {
		width: 1px;
		height: 20px;
		margin: 0 6px;
		background: rgba(255, 255, 255, 0.16);
	}
	svg {
		width: 19px;
		height: 19px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.stage {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		padding: 0 72px 12px;
	}
	.frame {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.stage img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		border-radius: 4px;
		user-select: none;
		transition: transform 0.12s ease;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
	}
	.stage img.zoomed {
		cursor: grab;
	}
	.stage img.dragging {
		cursor: grabbing;
		transition: none;
	}
	.nav {
		position: absolute;
		top: 50%;
		translate: 0 -50%;
		width: 46px;
		height: 46px;
		padding: 0;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 50%;
		background: rgba(30, 33, 38, 0.85);
		color: #e8e6e0;
	}
	.nav:hover {
		background: rgba(60, 64, 72, 0.95);
	}
	.nav svg {
		width: 22px;
		height: 22px;
		stroke-width: 2.2;
	}
	.prev {
		left: 14px;
	}
	.next {
		right: 14px;
	}
	.strip {
		flex: none;
		display: flex;
		justify-content: safe center;
		gap: 8px;
		padding: 8px 16px 16px;
		overflow-x: auto;
		scrollbar-width: thin;
	}
	.strip button {
		flex: none;
		width: 64px;
		height: 64px;
		padding: 0;
		border: 2px solid transparent;
		border-radius: 8px;
		overflow: hidden;
		background: #16191e;
		opacity: 0.55;
	}
	.strip button:hover {
		opacity: 0.9;
	}
	.strip button.on {
		border-color: #e2896a;
		opacity: 1;
	}
	.strip img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	@media (max-width: 760px) {
		.stage {
			padding: 0 8px 8px;
		}
		.nav {
			width: 38px;
			height: 38px;
		}
		.prev {
			left: 6px;
		}
		.next {
			right: 6px;
		}
		.tools button {
			width: 32px;
		}
		.sep {
			display: none;
		}
	}
</style>
