<script lang="ts">
	/**
	 * A Tweet or Telegram message in a scrolling feed (Wire, category, tag pages) - layout C
	 * from issue #1: text on the left (clamped), the first picture or video poster in a fixed
	 * box on the right ("1 / N" when there are more), every post the same height. Clicking it
	 * opens the post's own page, where the full text and full-size media are.
	 */
	import type { MergedArticle } from '$lib/types';
	import { resolveMediaUrl } from '$lib/config';
	import { clock } from '$lib/live.svelte';
	import { cleanPost, initials, relTime } from '$lib/text';

	let { article }: { article: MergedArticle } = $props();

	const a = $derived(article);
	const who = $derived.by(() => {
		if (a.tweet) return { name: a.tweet.authorName, handle: '@' + a.tweet.authorHandle, avatar: a.tweet.avatarUrl, via: 'X' };
		const t = a.telegramMessage!;
		return { name: t.channelName, handle: t.channelUsername ? '@' + t.channelUsername : '', avatar: t.channelAvatarUrl, via: 'Telegram' };
	});
	const media = $derived(a.tweet?.media ?? a.telegramMessage?.media ?? []);

	// A video's poster: its own thumbnail, or - for Telegram posts published before posters
	// were recorded - the proxy's preview image for the same message.
	function posterOf(m: (typeof media)[number]): string | null {
		if (m.type === 'photo') return resolveMediaUrl(m.url);
		if (m.thumbnailUrl) return resolveMediaUrl(m.thumbnailUrl);
		if (m.url.includes('/media/telegram-proxy') && /[?&]type=(video|gif)\b/.test(m.url)) return resolveMediaUrl(m.url.replace(/([?&]type=)(video|gif)\b/, '$1thumb'));
		return null;
	}
	const first = $derived(media[0] ? { src: posterOf(media[0]), video: media[0].type !== 'photo' } : null);
	const text = $derived(cleanPost(a.body || a.title) || a.title);
	const quoted = $derived(a.tweet?.quotedTweet ?? null);
	const repost = $derived(a.tweet?.repostedByHandle ?? a.telegramMessage?.repostedByHandle ?? null);
	let posterFailed = $state(false);
</script>

<a class="post" class:nomedia={!first} href="/article/{a.id}">
	<div class="main">
		<div class="hd">
			{#if who.avatar}
				<img class="av" src={resolveMediaUrl(who.avatar)} alt="" loading="lazy" />
			{:else}
				<span class="av ini">{initials(who.name)}</span>
			{/if}
			<b>{who.name}</b>
			<span class="h">{who.handle}</span>
			<span class="via" class:tg={who.via === 'Telegram'}>{who.via}</span>
			<span class="tm">{relTime(a.publishedAt, clock.now)}</span>
		</div>
		{#if repost}<div class="rp">🔁 reposted by @{repost}</div>{/if}
		<p class="tx" class:short={!!quoted}>{text}</p>
		{#if quoted}<div class="q"><b>{quoted.authorName}</b> {quoted.text}</div>{/if}
	</div>
	{#if first}
		<div class="box">
			{#if first.src && !posterFailed}
				<img src={first.src} alt="" loading="lazy" onerror={() => (posterFailed = true)} />
			{:else}
				<span class="noposter">{first.video ? 'Video' : 'Image'}</span>
			{/if}
			{#if first.video}<span class="pb">▶</span>{/if}
			{#if media.length > 1}<span class="cnt">1 / {media.length}</span>{/if}
		</div>
	{/if}
</a>

<style>
	.post {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 260px;
		gap: 16px;
		height: 196px;
		padding: 12px 12px 12px 16px;
		margin-bottom: 10px;
		overflow: hidden;
		color: inherit;
		background: var(--s1);
		border: 1px solid var(--bd);
		border-radius: 11px;
	}
	.post:hover {
		text-decoration: none;
		border-color: var(--tx3);
	}
	.post.nomedia {
		grid-template-columns: minmax(0, 1fr);
		height: auto;
		max-height: 196px;
	}
	.main {
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	.hd {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		font-size: 13px;
		white-space: nowrap;
	}
	.hd b {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.h {
		color: var(--tx3);
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.via {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		border-radius: 4px;
		padding: 0 5px;
		color: var(--tx2);
		border: 1px solid var(--bd);
	}
	.via.tg {
		color: #3fa9dc;
		border-color: color-mix(in srgb, #3fa9dc 50%, transparent);
	}
	.tm {
		margin-left: auto;
		font-family: var(--mono);
		font-size: 11px;
		color: var(--tx3);
		flex: none;
	}
	.av {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		object-fit: cover;
		flex: none;
	}
	.ini {
		display: grid;
		place-items: center;
		background: var(--s3);
		color: var(--tx2);
		font-size: 9px;
		font-weight: 700;
	}
	.rp {
		font-size: 11.5px;
		color: var(--tx3);
		margin-top: 4px;
	}
	.tx {
		margin: 8px 0 0;
		font-size: 13.5px;
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 5;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.tx.short {
		-webkit-line-clamp: 3;
	}
	.q {
		margin-top: 8px;
		padding: 5px 10px;
		border-left: 2px solid var(--bd);
		font-size: 12.5px;
		color: var(--tx2);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.q b {
		color: var(--tx);
		font-weight: 600;
	}
	.box {
		position: relative;
		border-radius: 8px;
		overflow: hidden;
		background: #0b0c0e;
	}
	.box img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.noposter {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #6d6b64;
		background: repeating-linear-gradient(135deg, #121418 0 10px, #16191e 10px 20px);
	}
	.pb {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: 42px;
		height: 42px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 15px;
		color: #fff;
		background: rgba(10, 11, 13, 0.72);
	}
	.cnt {
		position: absolute;
		right: 6px;
		top: 6px;
		font-family: var(--mono);
		font-size: 11px;
		padding: 1px 6px;
		border-radius: 5px;
		background: rgba(10, 11, 13, 0.75);
		color: #fff;
	}
	/* Phones: the media shrinks to a square thumbnail beside the text, and the card takes
	   its content's height. */
	@media (max-width: 760px) {
		.post {
			grid-template-columns: minmax(0, 1fr) 96px;
			gap: 10px;
			height: auto;
			padding: 10px 10px 10px 12px;
		}
		.post.nomedia {
			max-height: none;
		}
		.box {
			align-self: start;
			aspect-ratio: 1;
			margin-top: 30px;
		}
		.tx {
			font-size: 14px;
		}
		/* The name gets the room; the handle is on the post itself. */
		.h {
			display: none;
		}
		.hd b {
			flex: 0 1 auto;
		}
	}
</style>
