import { randomUUID } from 'node:crypto';
import type { InferenceProvider } from '../inference/provider.js';
import type { Cluster } from './clustering.js';
import { synthesizeArticle } from './synthesis.js';
import { selectBestImage, faviconUrlFor } from './image-selection.js';
import { downloadAndStore, promoteToPublished, storeMediaBuffer } from '../storage/media/index.js';
import { downloadMessageMedia, downloadChannelAvatar } from '../telegram/client.js';
import { logger } from '../storage/db/logs.js';
import * as articles from '../storage/db/articles.js';
import * as tags from '../storage/db/tags.js';
import * as sources from '../storage/db/sources.js';
import type { GlobalSettings, MergedArticle, ContentItem, TweetMediaItem, TelegramMediaItem, TelegramMediaRef } from '../storage/db/types.js';

const FOLLOW_UP_LOOKBACK_DAYS = 3;

function uniqueCategories(items: ContentItem[]): string[] {
	const cats = new Set<string>();
	for (const item of items) {
		const source = sources.getSource(item.sourceId);
		for (const cat of source?.category ?? []) cats.add(cat);
	}
	return [...cats];
}

/** An article shows on the homepage if any of its contributing sources opted into "Push to Top Stories?". */
function anyPushesToTopStories(items: ContentItem[]): boolean {
	return items.some((item) => sources.getSource(item.sourceId)?.pushToTopStories ?? false);
}

/** Takes the first line of the synthesized body as a working title until a dedicated title-generation step exists. */
function deriveTitle(body: string): string {
	const firstLine = body.split('\n')[0];
	return firstLine.length > 100 ? firstLine.slice(0, 97) + '…' : firstLine;
}

/**
 * Resolves the hero image for a regular (non-tweet) article: try the best candidate
 * from the source items, download and locally host it; if there isn't one, fall back
 * to the site's favicon rather than leaving the article with no art at all. Tweets
 * never reach this function — see resolveTweetMediaUrl below, which applies the
 * admin-configured Nitter media mode instead of always downloading, and skips the
 * favicon fallback entirely (a Nitter instance's own favicon slapped onto an
 * image-less tweet reads as a mistake, not a placeholder; TweetCard.svelte already
 * handles no-image tweets gracefully with no image at all).
 */
async function resolveHeroImage(
	items: ContentItem[],
	primaryLink: string
): Promise<{ heroImage: MergedArticle['heroImage']; storedMediaId: string | null }> {
	const selected = selectBestImage(items);

	if (selected) {
		const stored = await downloadAndStore(selected.url, 'published', {});
		if (stored) {
			return {
				heroImage: { url: stored.servedPath, sourceItemId: selected.sourceItemId, selectionReason: selected.selectionReason },
				storedMediaId: stored.id
			};
		}
		// Download failed — fall back to the hotlinked URL rather than losing the image entirely.
		return { heroImage: selected, storedMediaId: null };
	}

	const favicon = faviconUrlFor(primaryLink);
	if (favicon) {
		const stored = await downloadAndStore(favicon, 'published', {});
		if (stored) {
			return {
				heroImage: { url: stored.servedPath, sourceItemId: items[0]?.id ?? '', selectionReason: 'Site favicon — no article image available' },
				storedMediaId: stored.id
			};
		}
	}

	return { heroImage: null, storedMediaId: null };
}

/**
 * Applies the admin-configured Nitter media mode (Retention tab) to a single
 * externally-hosted tweet media URL — an attached photo or the author's avatar.
 * 'self-host' downloads and serves it locally like any other article image;
 * 'proxy' routes it through this server's own /media/proxy route so only this
 * server's IP is ever exposed to Twitter/the Nitter instance's CDN (the
 * "anonymity" the admin asked for) without persisting anything to disk; 'direct'
 * hotlinks the original URL unchanged, the cheapest option with no server involvement.
 */
async function resolveTweetMediaUrl(
	url: string,
	mode: GlobalSettings['nitterMediaMode']
): Promise<{ url: string; storedMediaId: string | null }> {
	if (mode === 'direct') return { url, storedMediaId: null };

	if (mode === 'proxy') {
		return { url: `/media/proxy?url=${encodeURIComponent(url)}`, storedMediaId: null };
	}

	const stored = await downloadAndStore(url, 'published', {});
	if (stored) return { url: stored.servedPath, storedMediaId: stored.id };
	// Download failed — fall back to hotlinking rather than losing the media entirely.
	return { url, storedMediaId: null };
}

/**
 * Resolves every attached photo/video/gif's url — and, for video/gif, its poster
 * thumbnail — through the admin's chosen Nitter media mode. Order and item count are
 * preserved; TweetCard.svelte renders this array directly, there's no separate
 * "hero image" concept for tweets the way there is for regular articles.
 */
async function resolveTweetMedia(
	media: TweetMediaItem[],
	mode: GlobalSettings['nitterMediaMode']
): Promise<{ media: TweetMediaItem[]; storedMediaIds: string[] }> {
	const storedMediaIds: string[] = [];
	const resolved: TweetMediaItem[] = [];

	for (const item of media) {
		const url = await resolveTweetMediaUrl(item.url, mode);
		if (url.storedMediaId) storedMediaIds.push(url.storedMediaId);

		let thumbnailUrl = item.thumbnailUrl;
		if (thumbnailUrl) {
			const resolvedThumb = await resolveTweetMediaUrl(thumbnailUrl, mode);
			thumbnailUrl = resolvedThumb.url;
			if (resolvedThumb.storedMediaId) storedMediaIds.push(resolvedThumb.storedMediaId);
		}

		resolved.push({ ...item, url: url.url, thumbnailUrl });
	}

	return { media: resolved, storedMediaIds };
}

function guessTelegramExtension(mimeType: string | null, kind: 'photo' | 'video' | 'gif'): string {
	if (mimeType?.includes('png')) return '.png';
	if (mimeType?.includes('webp')) return '.webp';
	if (mimeType?.includes('jpeg') || mimeType?.includes('jpg')) return '.jpg';
	if (mimeType?.includes('mp4')) return '.mp4';
	return kind === 'photo' ? '.jpg' : '.mp4';
}

/**
 * Resolves a single Telegram media reference into a servable url per the admin's
 * chosen telegramMediaMode (Retention tab). Unlike Nitter — which starts from an
 * already-public CDN URL — Telegram media only exists behind the authenticated MTProto
 * session, so there's no 'direct' hotlink option: 'self-host' downloads it now (via the
 * live session) and stores it locally exactly like every other self-hosted image;
 * 'proxy' doesn't touch Telegram at all here, it just builds a url the live
 * telegram-proxy route resolves (via that same session) on each view.
 */
async function resolveTelegramMediaUrl(
	channelUsername: string,
	ref: TelegramMediaRef,
	mode: GlobalSettings['telegramMediaMode']
): Promise<{ item: TelegramMediaItem; storedMediaId: string | null } | null> {
	if (mode === 'proxy') {
		const url = `/media/telegram-proxy?channel=${encodeURIComponent(channelUsername)}&message=${encodeURIComponent(ref.messageId)}&type=${ref.type}`;
		return { item: { type: ref.type, url, thumbnailUrl: null, width: ref.width, height: ref.height }, storedMediaId: null };
	}

	try {
		const buffer = await downloadMessageMedia(channelUsername, ref.messageId);
		if (!buffer) return null;
		const ext = guessTelegramExtension(ref.mimeType, ref.type);
		const stored = storeMediaBuffer(buffer, ext, `telegram-message:${channelUsername}:${ref.messageId}`, 'published', {});
		return { item: { type: ref.type, url: stored.servedPath, thumbnailUrl: null, width: ref.width, height: ref.height }, storedMediaId: stored.id };
	} catch (err) {
		logger.error('telegram', `Failed to self-host media for message ${ref.messageId}: ${(err as Error).message}`);
		return null;
	}
}

/** Resolves every attached photo/video/gif ref for one message — order preserved, failed items dropped rather than leaving a broken entry. */
async function resolveTelegramMedia(
	channelUsername: string,
	refs: TelegramMediaRef[],
	mode: GlobalSettings['telegramMediaMode']
): Promise<{ media: TelegramMediaItem[]; storedMediaIds: string[] }> {
	const media: TelegramMediaItem[] = [];
	const storedMediaIds: string[] = [];
	for (const ref of refs) {
		const resolved = await resolveTelegramMediaUrl(channelUsername, ref, mode);
		if (resolved) {
			media.push(resolved.item);
			if (resolved.storedMediaId) storedMediaIds.push(resolved.storedMediaId);
		}
	}
	return { media, storedMediaIds };
}

async function resolveTelegramAvatarUrl(
	channelUsername: string,
	mode: GlobalSettings['telegramMediaMode']
): Promise<{ url: string | null; storedMediaId: string | null }> {
	if (mode === 'proxy') {
		return { url: `/media/telegram-proxy?channel=${encodeURIComponent(channelUsername)}&avatar=1`, storedMediaId: null };
	}
	try {
		const buffer = await downloadChannelAvatar(channelUsername);
		if (!buffer) return { url: null, storedMediaId: null };
		const stored = storeMediaBuffer(buffer, '.jpg', `telegram-avatar:${channelUsername}`, 'published', {});
		return { url: stored.servedPath, storedMediaId: stored.id };
	} catch (err) {
		logger.error('telegram', `Failed to self-host avatar for "${channelUsername}": ${(err as Error).message}`);
		return { url: null, storedMediaId: null };
	}
}

/**
 * Publishes a single item as-is, with no AI calls at all — used when the AI service
 * isn't reachable (e.g. Ollama hasn't been set up yet, per the "assume it arrives
 * after the backend launches" requirement). No rewriting, no tag extraction, no
 * embedding. This is deliberately a lesser version of the real pipeline: once Ollama
 * is available, newly-ingested items get the full embed/cluster/synthesize treatment
 * and can be linked as follow-ups to these passthrough articles via the normal
 * tag-based thread detection — but these earlier articles aren't retroactively
 * rewritten or merged with anything after the fact.
 */
export async function publishDirect(item: ContentItem, settings: GlobalSettings): Promise<MergedArticle> {
	const category = uniqueCategories([item]);
	const storedMediaIds: string[] = [];

	// Tweets and Telegram messages never get a "hero image" — their own card components
	// render tweet.media / telegramMessage.media directly.
	let heroImage: MergedArticle['heroImage'] = null;
	if (!item.tweet && !item.telegramMessage) {
		const resolved = await resolveHeroImage([item], item.link);
		heroImage = resolved.heroImage;
		if (resolved.storedMediaId) storedMediaIds.push(resolved.storedMediaId);
	}

	const video = item.videos[0]
		? { url: item.videos[0].url, provider: item.videos[0].provider, embedUrl: item.videos[0].embedHtml, sourceItemId: item.id }
		: null;

	let tweet: MergedArticle['tweet'] = null;
	if (item.tweet) {
		let avatarUrl: string | null = null;
		if (item.tweet.avatarUrl) {
			const resolved = await resolveTweetMediaUrl(item.tweet.avatarUrl, settings.nitterMediaMode);
			avatarUrl = resolved.url;
			if (resolved.storedMediaId) storedMediaIds.push(resolved.storedMediaId);
		}
		const resolvedMedia = await resolveTweetMedia(item.tweet.media, settings.nitterMediaMode);
		storedMediaIds.push(...resolvedMedia.storedMediaIds);
		tweet = {
			authorName: item.tweet.authorName,
			authorHandle: item.tweet.authorHandle,
			avatarUrl,
			sourceItemId: item.id,
			media: resolvedMedia.media
		};
	}

	let telegramMessage: MergedArticle['telegramMessage'] = null;
	if (item.telegramMessage) {
		const { channelUsername } = item.telegramMessage;
		const avatar = await resolveTelegramAvatarUrl(channelUsername, settings.telegramMediaMode);
		if (avatar.storedMediaId) storedMediaIds.push(avatar.storedMediaId);
		const resolvedMedia = await resolveTelegramMedia(channelUsername, item.telegramMessage.media, settings.telegramMediaMode);
		storedMediaIds.push(...resolvedMedia.storedMediaIds);
		telegramMessage = {
			channelName: item.telegramMessage.channelName,
			channelUsername,
			channelAvatarUrl: avatar.url,
			sourceItemId: item.id,
			media: resolvedMedia.media,
			forwardedFrom: item.telegramMessage.forwardedFrom
		};
	}

	const article = await articles.insertArticle({
		title: item.title,
		body: item.body || item.summary,
		heroImage,
		video,
		tweet,
		telegramMessage,
		category,
		geo: item.geo,
		eventId: item.eventId,
		sourceCount: 1,
		sources: [
			{
				itemId: item.id,
				sourceName: sources.getSource(item.sourceId)?.name ?? 'Unknown source',
				link: item.link,
				publishedAt: item.publishedAt
			}
		],
		// Passthrough articles show the original feed date — only AI-synthesized/merged
		// articles get a "modified" publish timeframe reflecting when the merge happened.
		publishedAt: item.publishedAt,
		updatedAt: item.publishedAt,
		mergeConfidence: 1.0,
		tags: [], // no LLM available to extract tags yet — backfilling these later is a reasonable future improvement
		threadId: randomUUID(),
		previousArticleId: null,
		nextArticleId: null,
		topStories: anyPushesToTopStories([item])
	});

	for (const id of storedMediaIds) promoteToPublished(id, article.id);
	return article;
}

/**
 * Publishing is always automatic — there's no draft/review state (see schema doc).
 * A cluster of size 1 publishes as-is via the same path; synthesizeArticle lightly
 * rewrites rather than merges when there's only one source.
 */
export async function publishCluster(
	provider: InferenceProvider,
	settings: GlobalSettings,
	cluster: Cluster,
	opts: { eventId?: string } = {}
): Promise<MergedArticle> {
	const items = cluster.items;

	const { body, tagLabels } = await synthesizeArticle(provider, settings.selectedModels.synthesis, items);

	const resolvedTags = [];
	for (const label of tagLabels) {
		try {
			const embedding = await provider.embed(label, { model: settings.selectedModels.embedding });
			resolvedTags.push(tags.resolveOrCreateTag(label, embedding, settings.tagDedupThreshold));
		} catch (err) {
			logger.error('synthesis', `Tag embedding failed for "${label}": ${(err as Error).message}`);
		}
	}
	const tagIds = resolvedTags.map((t) => t.id);

	const { heroImage, storedMediaId } = await resolveHeroImage(items, items[0]?.link ?? '');
	const videoItem = items.find((i) => i.videos.length > 0);
	const video = videoItem
		? {
				url: videoItem.videos[0].url,
				provider: videoItem.videos[0].provider,
				embedUrl: videoItem.videos[0].embedHtml,
				sourceItemId: videoItem.id
			}
		: null;

	const category = uniqueCategories(items);
	const geo = items.find((i) => i.geo)?.geo ?? null;

	const itemSources = items.map((item) => ({
		itemId: item.id,
		sourceName: sources.getSource(item.sourceId)?.name ?? 'Unknown source',
		link: item.link,
		publishedAt: item.publishedAt
	}));

	// Follow-up detection: only links to a previous article if enough time AND enough
	// new corroborating sources have passed the admin's thresholds (see MergeTab).
	// Otherwise this cluster just becomes its own independent thread — holding items
	// in a "pending, not yet enough to follow up" state is a reasonable future
	// improvement but adds a queue state this MVP doesn't have yet.
	const previous = tagIds.length > 0 ? articles.findRecentArticleByTags(tagIds, FOLLOW_UP_LOOKBACK_DAYS) : null;
	let threadId: string = randomUUID();
	let previousArticleId: string | null = null;

	if (previous) {
		const hoursSince = (Date.now() - new Date(previous.publishedAt).getTime()) / 3600_000;
		const previousLinks = new Set(previous.sources.map((s) => s.link));
		const newSourceCount = itemSources.filter((s) => !previousLinks.has(s.link)).length;

		if (hoursSince >= settings.followUpMinHoursSinceLast && newSourceCount >= settings.followUpMinNewSources) {
			threadId = previous.threadId;
			previousArticleId = previous.id;
		}
	}

	const now = new Date().toISOString();
	const article = articles.insertArticle({
		title: deriveTitle(body),
		body,
		heroImage,
		video,
		tweet: null, // tweets never reach clustering — see priorityQueue.ts's direct-publish bypass
		telegramMessage: null, // telegram messages never reach clustering either — same bypass
		category,
		geo,
		eventId: opts.eventId ?? items[0]?.eventId ?? null,
		sourceCount: items.length,
		sources: itemSources,
		publishedAt: now,
		updatedAt: now,
		mergeConfidence: items.length > 1 ? 0.8 : 1.0,
		tags: tagIds,
		threadId,
		previousArticleId,
		nextArticleId: null,
		topStories: anyPushesToTopStories(items)
	});

	if (storedMediaId) {
		promoteToPublished(storedMediaId, article.id);
	}

	return article;
}
