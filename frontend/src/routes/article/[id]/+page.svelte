<script lang="ts">
	/**
	 * Article / single post page (accepted pane F/G/H). The reading panel is the only thing
	 * on the screen that scrolls: a thin progress line along its top and a pinned title bar
	 * once the headline has scrolled away. The rail on the right shows the storyline the
	 * item belongs to (a vertical timeline around "you are here") - or related articles when
	 * it isn't part of one - and the source.
	 */
	import type { PageData } from './$types';
	import type { LiteArticle } from '$lib/types';
	import { resolveMediaUrl } from '$lib/config';
	import { clock } from '$lib/live.svelte';
	import { agoShort, authorOf, categoryColor, cleanPost, fullTime, headlineOf, initials, isPost, KIND_ICON, KIND_LABEL, kindOf, paragraphs, relTime, storyColor, until } from '$lib/text';
	import PostTiles from '$lib/components/tiles/PostTiles.svelte';
	import { openLightbox } from '$lib/lightbox.svelte';
	import { hideBroken } from '$lib/actions/hideBroken';

	let { data }: { data: PageData } = $props();
	const a = $derived(data.article);
	const ctx = $derived(data.context);
	const story = $derived(ctx.storyline);
	const post = $derived(isPost(a));
	// The display helpers take a board item; give the full article the source name they expect.
	const item = $derived({ ...a, sourceName: a.sources[0]?.sourceName ?? '' });
	const kind = $derived(kindOf(item));
	const who = $derived(authorOf(item));
	const sourceName = $derived(a.sources[0]?.sourceName ?? (post ? who.name : 'Source'));
	const original = $derived(a.sources[0]?.link ?? null);
	const host = $derived.by(() => {
		if (a.tweet) return 'x.com';
		if (a.telegramMessage) return 't.me';
		try {
			return new URL(original ?? '').hostname.replace(/^www\./, '');
		} catch {
			return '';
		}
	});
	const section = $derived(a.category[0] ?? (post ? 'Wire' : 'General'));

	// Article text: the first paragraph becomes the standfirst under the headline.
	const paras = $derived(paragraphs(a.body));
	const dek = $derived(!post && !a.video && paras.length > 1 ? paras[0] : null);
	const bodyParas = $derived(dek ? paras.slice(1) : paras.length ? paras : a.body ? [a.body] : []);
	const minutes = $derived(Math.max(1, Math.round(a.body.split(/\s+/).length / 230)));
	const postText = $derived(post ? cleanPost(a.body || a.title) : '');
	const allMedia = $derived(a.tweet?.media ?? a.telegramMessage?.media ?? []);
	const media = $derived(allMedia.slice(0, 4));
	// Every photo in the post (not just the four shown) goes into the lightbox's film strip.
	const photos = $derived(allMedia.filter((m) => m.type === 'photo').map((m) => ({ url: resolveMediaUrl(m.url) })));
	const youtube = $derived(a.video?.provider === 'youtube' ? (a.video.embedUrl ?? a.video.url) : null);
	const nativeVideo = $derived(a.video && !youtube ? resolveMediaUrl(a.video.url) : null);

	// Storyline rail: up to 9 updates centred on this one.
	const WINDOW = 9;
	const ordered = $derived(story ? [...story.members].sort((x, y) => x.publishedAt.localeCompare(y.publishedAt)) : []);
	const here = $derived(ordered.findIndex((m) => m.id === a.id));
	const win = $derived.by(() => {
		if (!ordered.length) return { list: [] as LiteArticle[], before: 0, after: 0 };
		const centre = here < 0 ? ordered.length - 1 : here;
		let start = Math.max(0, centre - Math.floor(WINDOW / 2));
		const end = Math.min(ordered.length, start + WINDOW);
		start = Math.max(0, end - WINDOW);
		return { list: ordered.slice(start, end), before: start, after: ordered.length - end };
	});
	const eventId = $derived(story?.scope.startsWith('event:') ? story.scope.slice(6) : null);
	const storyHref = $derived(story ? (eventId ? `/event/${eventId}` : `/storyline/${story.id}`) : '');
	const color = $derived(story ? storyColor(eventId ?? story.id) : 'var(--acc)');
	// Single posts show their neighbours in the storyline as tiles under the post.
	const neighbours = $derived.by(() => {
		if (!post || !ordered.length) return [];
		const others = ordered.filter((m) => m.id !== a.id);
		const t = new Date(a.publishedAt).getTime();
		return others
			.map((m) => ({ m, d: Math.abs(new Date(m.publishedAt).getTime() - t) }))
			.sort((x, y) => x.d - y.d)
			.slice(0, 6)
			.map((x) => x.m)
			.sort((x, y) => x.publishedAt.localeCompare(y.publishedAt));
	});

	// Reading progress and the pinned title bar.
	let reader: HTMLElement | undefined = $state();
	let headline: HTMLElement | undefined = $state();
	let progress = $state(0);
	let pinned = $state(false);
	function onScroll() {
		if (!reader) return;
		const max = reader.scrollHeight - reader.clientHeight;
		progress = max > 0 ? reader.scrollTop / max : 0;
		pinned = !!headline && reader.scrollTop > headline.offsetTop + headline.offsetHeight;
	}
	$effect(() => {
		void a.id;
		if (reader) reader.scrollTop = 0;
		progress = 0;
		pinned = false;
	});

	const lightboxTitle = $derived(post ? `${who.name}${who.handle ? ` ${who.handle}` : ''}` : sourceName);
	function openImage(url: string) {
		const at = photos.findIndex((p) => p.url === resolveMediaUrl(url));
		openLightbox(photos, Math.max(0, at), lightboxTitle);
	}
</script>

<svelte:head><title>{post ? headlineOf(item) : a.title} · Homefeed</title></svelte:head>

<div class="apage">
	<nav class="crumbs">
		<a class="back" href="/">← Board</a>
		<span>{section}</span><span class="sep">›</span><span>{post ? who.handle || who.name : sourceName}</span>
	</nav>

	<div class="cols">
		<section class="panel card">
			<div class="prog"><i style:width="{progress * 100}%"></i></div>
			<div class="pin" class:show={pinned}>
				<span class="pk">{section}</span>
				<b>{post ? headlineOf(item) : a.title}</b>
				<span class="pm" title={fullTime(a.publishedAt)}>{sourceName} · {relTime(a.publishedAt, clock.now)}</span>
			</div>
			<div class="reader" bind:this={reader} onscroll={onScroll}>
				<article class:post>
					<div class="kick">
						<span class="sec" style:color={categoryColor(section)}>{section}</span>
						<span class="kb k-{kind}">{@html KIND_ICON[kind]}{KIND_LABEL[kind]}</span>
						{#if a.isRecap}<span class="pill trk">AI recap</span>{/if}
						{#if a.sourceCount > 1}<span class="merged">merged from {a.sourceCount} sources</span>{/if}
					</div>

					{#if post}
						<div class="author">
							{#if who.avatar}<img class="av" src={who.avatar} alt="" />{:else}<span class="av ini">{initials(who.name)}</span>{/if}
							<div>
								<b>{who.name}</b>
								<span>{who.handle}{who.handle ? ' · ' : ''}<time datetime={a.publishedAt} title={fullTime(a.publishedAt)}>{relTime(a.publishedAt, clock.now)}</time></span>
							</div>
							{#if original}<a class="orig" href={original} target="_blank" rel="noreferrer">View on {host} ↗</a>{/if}
						</div>
						{#if a.tweet?.repostedByHandle || a.telegramMessage?.repostedByHandle}
							<div class="repost">🔁 Reposted by @{a.tweet?.repostedByHandle ?? a.telegramMessage?.repostedByHandle}</div>
						{/if}
						<blockquote bind:this={headline} class:long={postText.length > 220}>{postText || a.title}</blockquote>
						{#if media.length}
							<div class="gallery" class:multi={media.length > 1}>
								{#each media as m (m.url)}
									{#if m.type === 'photo'}
										<button class="gm" onclick={() => openImage(m.url)} aria-label="Open image"><img src={resolveMediaUrl(m.url)} alt="" use:hideBroken={'.gm'} /></button>
									{:else if m.type === 'gif'}
										<video class="gm" src={resolveMediaUrl(m.url)} autoplay loop muted playsinline></video>
									{:else}
										<!-- svelte-ignore a11y_media_has_caption -->
										<video class="gm" controls preload="metadata" poster={m.thumbnailUrl ? resolveMediaUrl(m.thumbnailUrl) : undefined} src={resolveMediaUrl(m.url)}></video>
									{/if}
								{/each}
							</div>
						{/if}
						{#if a.tweet?.quotedTweet}
							{@const q = a.tweet.quotedTweet}
							<a class="quoted" href={q.link} target="_blank" rel="noreferrer">
								<b>{q.authorName}</b> <span>@{q.authorHandle}</span>
								<p>{q.text}</p>
								{#if q.imageUrl}<img src={resolveMediaUrl(q.imageUrl)} alt="" />{/if}
							</a>
						{/if}
						<p class="note">A single post — there is no article behind it.</p>
					{:else}
						<h1 bind:this={headline}>{a.title}</h1>
						{#if dek}<p class="dek">{dek}</p>{/if}
						<div class="byline">
							<span class="av ini">{initials(sourceName)}</span>
							<b>{sourceName}</b>
							<span><time datetime={a.publishedAt} title={fullTime(a.publishedAt)}>{relTime(a.publishedAt, clock.now)}</time></span>
							{#if a.updatedAt !== a.publishedAt}<span title={fullTime(a.updatedAt)}>· updated {relTime(a.updatedAt, clock.now)}</span>{/if}
							<span>{minutes} min read</span>
							{#if original}<a class="orig" href={original} target="_blank" rel="noreferrer">Open original ↗</a>{/if}
						</div>
						{#if youtube}
							<div class="yt"><iframe src={youtube} title={a.title} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>
						{:else if nativeVideo}
							<div class="vid">
								<!-- svelte-ignore a11y_media_has_caption -->
								<video controls preload="metadata" poster={a.heroImage ? resolveMediaUrl(a.heroImage.url) : undefined} src={nativeVideo}></video>
							</div>
						{:else if a.heroImage}
							<figure>
								<button class="hero" aria-label="Open image" onclick={() => a.heroImage && openLightbox([{ url: resolveMediaUrl(a.heroImage.url) }], 0, sourceName)}>
									<img src={resolveMediaUrl(a.heroImage.url)} alt="" use:hideBroken={'figure'} />
								</button>
								<figcaption>Image · {sourceName}</figcaption>
							</figure>
						{/if}
						<div class="body">
							{#each bodyParas as p, i (i)}<p>{p}</p>{/each}
						</div>
					{/if}

					{#if data.tagLabels.length}
						<div class="tags">
							{#each data.tagLabels as tag (tag.id)}<a href="/tag/{tag.slug}">{tag.label}</a>{/each}
						</div>
					{/if}
					{#if data.nextArticle}
						<a class="thread" href="/article/{data.nextArticle.id}">→ Newer coverage: <b>{data.nextArticle.title}</b></a>
					{/if}
					{#if data.previousArticle}
						<a class="thread" href="/article/{data.previousArticle.id}">← Earlier coverage: <b>{data.previousArticle.title}</b></a>
					{/if}
					{#if a.sources.length > 1}
						<div class="sources">
							<span>Sources</span>
							{#each a.sources as s, i (i)}<a href={s.link} target="_blank" rel="noreferrer">{s.sourceName}</a>{/each}
						</div>
					{/if}
				</article>

				{#if neighbours.length}
					<section class="around">
						<div class="ah">Around this post in the storyline <em>{neighbours.length} of {ordered.length - 1} other updates</em></div>
						<div class="atiles" class:one={neighbours.length <= 3}><PostTiles items={neighbours} compact /></div>
					</section>
				{/if}
			</div>
		</section>

		<aside class="rail">
			{#if story}
				<div class="sc card" style:--sc={color}>
					<div class="sk">
						{#if eventId}
							<span class="pill trk">TRACKED</span><span>development of a tracked event</span>
						{:else}
							<span class="pill" class:live={story.state === 'live'} class:cool={story.state !== 'live'}>{#if story.state === 'live'}<i></i>{/if}{story.state === 'live' ? 'LIVE' : story.state === 'cooling' ? `COOLING · ${until(story.closesAt, clock.now)}` : 'CLOSED'}</span><span>part of a storyline</span>
						{/if}
					</div>
					<a class="stt" href={storyHref}>{story.tag || story.label}</a>
					<div class="sm">{story.itemCount} updates · {story.sourceCount} sources · <span title={fullTime(story.firstItemAt)}>started {relTime(story.firstItemAt, clock.now)}</span> · <span title={fullTime(story.lastItemAt)}>latest {relTime(story.lastItemAt, clock.now)}</span></div>
					<ol class="vt">
						{#if win.before}<li class="more">+{win.before} earlier</li>{/if}
						{#each win.list as m (m.id)}
							{@const mk = kindOf(m)}
							<li class:me={m.id === a.id}>
								<span class="tm" title={fullTime(m.publishedAt)}>{agoShort(m.publishedAt, clock.now)}</span>
								<span class="dot"></span>
								<a href="/article/{m.id}">
									<span class="vtt">{headlineOf(m)}</span>
									<span class="vs"><i class="kb k-{mk}">{@html KIND_ICON[mk]}</i>{isPost(m) ? authorOf(m).handle || authorOf(m).name : m.sourceName}{m.id === a.id ? ' · you are here' : ''}</span>
								</a>
							</li>
						{/each}
						{#if win.after}<li class="more">+{win.after} later</li>{/if}
					</ol>
					<a class="open" href={storyHref}>Open {eventId ? 'event' : 'storyline'} timeline →</a>
				</div>
			{:else if ctx.related.length}
				<div class="sc card rel">
					<div class="sk"><span>More in {section}</span></div>
					{#each ctx.related as r (r.id)}
						<a class="ri" href="/article/{r.id}">
							<span class="tm" title={fullTime(r.publishedAt)}>{agoShort(r.publishedAt, clock.now)}</span>
							<span><b>{r.title}</b><i>{r.sourceName}</i></span>
						</a>
					{/each}
				</div>
			{/if}
			<div class="src card">
				<div class="sk"><span>Source</span></div>
				<div class="sr">
					{#if post && who.avatar}<img class="av" src={who.avatar} alt="" />{:else}<span class="av ini">{initials(post ? who.name : sourceName)}</span>{/if}
					<div><b>{post ? who.name : sourceName}</b><span>{post && who.handle ? `${host}/${who.handle.slice(1)}` : host}</span></div>
					{#if original}<a class="orig" href={original} target="_blank" rel="noreferrer">{post ? 'View post' : 'Open original'} ↗</a>{/if}
				</div>
			</div>
		</aside>
	</div>
</div>

<style>
	.apage {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.crumbs {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12.5px;
		color: var(--tx3);
		flex: none;
	}
	.back {
		border: 1px solid var(--bd);
		border-radius: 7px;
		padding: 4px 10px;
	}
	.cols {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 440px;
		gap: 16px;
	}
	.panel {
		position: relative;
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	.prog {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 2px;
		z-index: 3;
	}
	.prog i {
		display: block;
		height: 100%;
		background: var(--acc);
	}
	.pin {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 24px;
		background: color-mix(in srgb, var(--s1) 94%, transparent);
		backdrop-filter: blur(6px);
		border-bottom: 1px solid var(--bd);
		transform: translateY(-100%);
		transition: transform 0.18s ease;
	}
	.pin.show {
		transform: none;
	}
	.pin b {
		flex: 1;
		min-width: 0;
		font-family: var(--serif);
		font-size: 16px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pk {
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--tx3);
	}
	.pm {
		font-size: 11.5px;
		color: var(--tx3);
		white-space: nowrap;
	}
	.reader {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 30px 24px 60px;
		scrollbar-width: thin;
	}
	article {
		max-width: 820px;
		margin: 0 auto;
		/* Media at the top of an item stops at about 40% of the screen, so the opening of the
		   text is on screen with it (issue #3). */
		--media-h: min(420px, calc(40dvh / var(--ui-zoom)));
	}
	.kick {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}
	.sec {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.merged {
		font-size: 11.5px;
		color: var(--tx3);
	}
	h1 {
		margin: 0 0 14px;
		font-family: var(--serif);
		font-size: 42px;
		line-height: 1.12;
		font-weight: 600;
		letter-spacing: -0.5px;
	}
	.dek {
		margin: 0 0 18px;
		font-family: var(--serif);
		font-size: 20px;
		line-height: 1.5;
		color: var(--tx2);
	}
	.byline,
	.author {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 12.5px;
		color: var(--tx3);
		flex-wrap: wrap;
	}
	.byline {
		padding: 12px 0;
		border-top: 1px solid var(--bd);
		border-bottom: 1px solid var(--bd);
		margin-bottom: 22px;
	}
	.byline b {
		color: var(--tx);
		font-weight: 600;
	}
	.av {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		object-fit: cover;
		flex: none;
	}
	.ini {
		display: grid;
		place-items: center;
		background: var(--s2);
		color: var(--tx2);
		font-size: 10.5px;
		font-weight: 700;
	}
	.orig {
		margin-left: auto;
		font-size: 12.5px;
		white-space: nowrap;
	}
	.author .av {
		width: 46px;
		height: 46px;
		border-radius: 50%;
	}
	.author div {
		display: flex;
		flex-direction: column;
	}
	.author b {
		font-size: 16px;
		color: var(--tx);
	}
	.author span {
		font-family: var(--mono);
		font-size: 12px;
	}
	.repost {
		margin-top: 10px;
		font-size: 12px;
		color: var(--tx3);
	}
	blockquote {
		margin: 22px 0 18px;
		padding: 2px 0 2px 24px;
		border-left: 3px solid var(--c-wire);
		font-family: var(--serif);
		font-size: 32px;
		line-height: 1.32;
		font-weight: 500;
	}
	blockquote.long {
		font-size: 23px;
		line-height: 1.45;
	}
	.gallery {
		display: grid;
		gap: 8px;
		margin: 0 0 18px;
	}
	.gallery.multi {
		grid-template-columns: 1fr 1fr;
	}
	.gm {
		display: block;
		width: 100%;
		max-height: var(--media-h);
		padding: 0;
		border: 0;
		border-radius: 10px;
		overflow: hidden;
		background: #000;
		object-fit: contain;
		cursor: zoom-in;
	}
	video.gm {
		cursor: default;
	}
	.gm img {
		width: 100%;
		max-height: var(--media-h);
		object-fit: contain;
		display: block;
	}
	.quoted {
		display: block;
		border: 1px solid var(--bd);
		border-radius: 10px;
		padding: 12px 14px;
		margin-bottom: 18px;
		color: inherit;
		font-size: 13px;
	}
	.quoted span {
		color: var(--tx3);
	}
	.quoted p {
		margin: 6px 0 0;
		line-height: 1.5;
	}
	.quoted img {
		margin-top: 8px;
		max-width: 100%;
		max-height: 260px;
		border-radius: 8px;
	}
	.note {
		font-size: 12.5px;
		color: var(--tx3);
	}
	figure {
		margin: 0 0 24px;
	}
	.hero {
		display: block;
		width: 100%;
		padding: 0;
		border: 0;
		border-radius: 10px;
		background: transparent;
		cursor: zoom-in;
	}
	figure img {
		width: 100%;
		max-height: var(--media-h);
		object-fit: cover;
		border-radius: 10px;
		display: block;
		background: var(--s2);
	}
	figcaption {
		font-size: 11.5px;
		color: var(--tx3);
		margin-top: 7px;
	}
	.yt {
		position: relative;
		aspect-ratio: 16 / 9;
		max-width: calc(var(--media-h) * 16 / 9);
		border-radius: 10px;
		overflow: hidden;
		background: #000;
		margin-bottom: 24px;
	}
	.yt iframe {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border: 0;
	}
	.vid {
		width: fit-content;
		max-width: 100%;
		border-radius: 10px;
		overflow: hidden;
		background: #000;
		margin-bottom: 24px;
	}
	.vid video {
		display: block;
		height: var(--media-h);
		width: auto;
		max-width: 100%;
		object-fit: contain;
	}
	.body p {
		margin: 0 0 18px;
		font-family: var(--serif);
		font-size: 19px;
		line-height: 1.65;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 26px 0 16px;
	}
	.tags a {
		font-size: 12px;
		padding: 4px 11px;
		border: 1px solid var(--bd);
		border-radius: 99px;
		color: var(--tx2);
	}
	.thread {
		display: block;
		margin-bottom: 10px;
		padding: 11px 14px;
		border-radius: 9px;
		background: color-mix(in srgb, var(--acc) 10%, transparent);
		font-size: 13px;
	}
	.thread b {
		font-weight: 500;
	}
	.sources {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		padding-top: 14px;
		margin-top: 12px;
		border-top: 1px solid var(--bd);
		font-size: 12.5px;
	}
	.sources span {
		color: var(--tx3);
	}
	.around {
		max-width: 1100px;
		margin: 26px auto 0;
	}
	.ah {
		font-size: 11.5px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--tx2);
		margin-bottom: 10px;
	}
	.ah em {
		font-style: normal;
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
		color: var(--tx3);
		margin-left: 8px;
	}
	.atiles {
		height: 480px;
	}
	.atiles.one {
		height: 250px;
	}
	.rail {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-height: 0;
	}
	.sc {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		padding: 14px 18px;
		border-left: 3px solid var(--sc, var(--bd));
		overflow: hidden;
	}
	.sc.rel {
		border-left-color: var(--bd);
	}
	.sk {
		display: flex;
		align-items: center;
		gap: 9px;
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--tx3);
	}
	.stt {
		display: block;
		margin-top: 9px;
		font-family: var(--serif);
		font-size: 22px;
		font-weight: 600;
		line-height: 1.2;
		color: var(--tx);
	}
	.sm {
		font-size: 12px;
		color: var(--tx3);
		margin: 5px 0 12px;
	}
	.vt {
		list-style: none;
		margin: 0;
		padding: 0;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		position: relative;
	}
	.vt li {
		display: grid;
		grid-template-columns: 52px 16px minmax(0, 1fr);
		gap: 4px;
		padding: 6px 0;
		position: relative;
	}
	.vt li.me {
		background: color-mix(in srgb, var(--sc) 12%, transparent);
		border-radius: 6px;
	}
	.vt li.more {
		display: block;
		padding: 4px 0 4px 64px;
		font-family: var(--mono);
		font-size: 11px;
		color: var(--tx3);
	}
	.vt .tm {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--tx3);
		padding-top: 2px;
	}
	.vt .me .tm {
		color: var(--sc);
	}
	.dot {
		position: relative;
	}
	.dot::before {
		content: '';
		position: absolute;
		left: 6px;
		top: -6px;
		bottom: -6px;
		width: 2px;
		background: color-mix(in srgb, var(--sc) 35%, var(--bd));
	}
	.dot::after {
		content: '';
		position: absolute;
		left: 2px;
		top: 4px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--s1);
		border: 2px solid var(--sc);
		box-sizing: border-box;
	}
	.me .dot::after {
		background: var(--sc);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc) 30%, transparent);
	}
	.vt a {
		color: inherit;
		min-width: 0;
	}
	.vt a:hover {
		text-decoration: none;
	}
	.vt a:hover .vtt {
		text-decoration: underline;
	}
	.vtt {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-size: 13px;
		line-height: 1.35;
	}
	.me .vtt {
		font-weight: 600;
	}
	.vs {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 2px;
		font-size: 11px;
		color: var(--tx3);
		white-space: nowrap;
		overflow: hidden;
	}
	.vs .kb {
		padding: 1px 3px;
	}
	.vs .kb :global(svg) {
		width: 9px;
		height: 9px;
	}
	.open {
		padding-top: 10px;
		margin-top: 6px;
		border-top: 1px solid var(--bd);
		font-size: 12.5px;
	}
	.ri {
		display: grid;
		grid-template-columns: 52px minmax(0, 1fr);
		gap: 6px;
		padding: 9px 0;
		border-bottom: 1px solid var(--bd);
		color: inherit;
	}
	.ri .tm {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--tx3);
	}
	.ri b {
		display: block;
		font-family: var(--serif);
		font-size: 14px;
		font-weight: 600;
		line-height: 1.3;
	}
	.ri i {
		font-style: normal;
		font-size: 11px;
		color: var(--tx3);
	}
	.src {
		flex: none;
		padding: 12px 18px;
	}
	.sr {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 9px;
	}
	.sr div {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.sr b {
		font-size: 13.5px;
	}
	.sr span {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--tx3);
	}
	.sr .av {
		border-radius: 50%;
	}
	/* Phones: one column - the article, then the storyline / related rail under it - and the
	   page itself scrolls (see +layout.svelte), so the reader's own scroll, progress line and
	   pinned title bar step aside. */
	@media (max-width: 760px) {
		.crumbs {
			flex-wrap: wrap;
			row-gap: 4px;
		}
		.cols {
			flex: none;
			grid-template-columns: minmax(0, 1fr);
			gap: 12px;
		}
		.panel {
			overflow: visible;
		}
		.prog,
		.pin {
			display: none;
		}
		.reader {
			overflow: visible;
			padding: 18px 16px 24px;
		}
		.kick {
			flex-wrap: wrap;
		}
		h1 {
			font-size: 28px;
			letter-spacing: -0.3px;
		}
		.dek {
			font-size: 17px;
		}
		.body p {
			font-size: 17px;
			line-height: 1.6;
		}
		blockquote {
			margin: 16px 0 14px;
			padding-left: 14px;
			font-size: 22px;
		}
		blockquote.long {
			font-size: 18px;
		}
		.orig {
			margin-left: 0;
		}
		.gallery.multi {
			grid-template-columns: minmax(0, 1fr);
		}
		.atiles,
		.atiles.one {
			height: auto;
		}
		.sc {
			flex: none;
		}
	}
</style>
