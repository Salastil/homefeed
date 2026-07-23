<script lang="ts">
	import type { MergedArticle } from '$lib/types';
	import { timeAgo, exactTime } from '$lib/format';
	import { resolveMediaUrl } from '$lib/config';

	let { article }: { article: MergedArticle } = $props();

	const sourceLabel = $derived(article.sources[0]?.sourceName ?? 'Telegram');
	// article.telegramMessage.media is undefined for messages published before this field
	// existed — older rows in the DB weren't backfilled, so this can't assume it's always an array.
	const media = $derived(article.telegramMessage?.media?.slice(0, 4) ?? []);
	// The card's own href — clicking the frame goes to the original message on Telegram,
	// not our internal article page (there's no separate "full article" for a message anyway).
	const messageUrl = $derived(article.sources[0]?.link ?? `/article/${article.id}`);

	// A <video controls> click must not fall through to the card's own <a> navigation
	// (play/pause/scrub would otherwise just open the message in a new tab instead).
	function stopVideoNav(e: MouseEvent) {
		e.preventDefault();
	}

	// A photo click opens the image itself in a new tab, rather than the message link the
	// rest of the card points to.
	function openImage(e: MouseEvent, url: string) {
		e.preventDefault();
		window.open(resolveMediaUrl(url), '_blank', 'noopener,noreferrer');
	}
</script>

<a class="telegram-card" href={messageUrl} target="_blank" rel="noreferrer">
	{#if article.telegramMessage?.repostedByHandle}
		<div class="forward-line">↪️ Forwarded by @{article.telegramMessage.repostedByHandle}</div>
	{/if}
	<div class="meta">
		<span>{article.category[0] ?? ''}</span>
		<span>&middot;</span>
		<span>{sourceLabel}</span>
		<span>&middot;</span>
		<span>✈ Telegram</span>
	</div>
	<div class="channel-row">
		{#if article.telegramMessage?.channelAvatarUrl}
			<img class="avatar" src={resolveMediaUrl(article.telegramMessage.channelAvatarUrl)} alt="" loading="lazy" />
		{:else}
			<div class="avatar placeholder"></div>
		{/if}
		<span class="name">{article.telegramMessage?.channelName}</span>
		{#if article.telegramMessage?.channelUsername}
			<span class="handle">@{article.telegramMessage.channelUsername}</span>
		{/if}
	</div>
	<div class="text">{article.body}</div>
	{#if media.length > 0}
		<div class="media-grid" data-count={media.length}>
			{#each media as item, i (item.url)}
				<div class="media-cell" class:span-2={media.length === 3 && i === 0}>
					{#if item.type === 'video' || item.type === 'gif'}
						<video
							class="media-el"
							controls
							preload="metadata"
							playsinline
							loop={item.type === 'gif'}
							muted={item.type === 'gif'}
							poster={item.thumbnailUrl ? resolveMediaUrl(item.thumbnailUrl) : undefined}
							onclick={stopVideoNav}
						>
							<source src={resolveMediaUrl(item.url)} type="video/mp4" />
						</video>
					{:else}
						<button type="button" class="media-btn" onclick={(e) => openImage(e, item.url)}>
							<img class="media-el" src={resolveMediaUrl(item.url)} alt="" loading="lazy" />
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
	<div class="time">{timeAgo(article.publishedAt)} &middot; {exactTime(article.publishedAt)}</div>
</a>

<style>
	.telegram-card {
		display: block;
		border: 0.5px solid var(--border);
		border-radius: 12px;
		padding: 14px;
		margin-bottom: 12px;
		background: var(--surface-2);
		color: inherit;
	}
	.telegram-card:hover {
		text-decoration: none;
		border-color: var(--border-accent);
	}
	.forward-line {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 10px;
	}
	.meta {
		font-size: 11px;
		color: var(--text-accent);
		display: flex;
		gap: 6px;
		margin-bottom: 10px;
	}
	.channel-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}
	.avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
		background: var(--surface-1);
	}
	.avatar.placeholder {
		display: block;
	}
	.name {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.handle {
		font-size: 13px;
		color: var(--text-muted);
	}
	.text {
		font-size: 14px;
		line-height: 1.5;
		color: var(--text-primary);
		white-space: pre-line;
		margin-bottom: 8px;
	}
	/* Fixed cell heights, same 1/2/3/4-item grid shapes as TweetCard.svelte — see that
	   component for the reasoning (a tall portrait photo/video shouldn't dictate the
	   whole card's height). */
	.media-grid {
		display: grid;
		gap: 3px;
		border-radius: var(--radius);
		overflow: hidden;
		margin-bottom: 8px;
		background: var(--surface-1);
	}
	.media-grid[data-count='1'] {
		grid-template-columns: 1fr;
		height: 380px;
	}
	.media-grid[data-count='2'] {
		grid-template-columns: 1fr 1fr;
		height: 240px;
	}
	.media-grid[data-count='3'] {
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
		height: 300px;
	}
	.media-grid[data-count='4'] {
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
		height: 300px;
	}
	.media-cell {
		overflow: hidden;
	}
	.media-cell.span-2 {
		grid-row: 1 / 3;
	}
	.media-btn {
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
	}
	.media-el {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		background: var(--surface-1);
	}
	.time {
		font-size: 11px;
		color: var(--text-muted);
	}
</style>
