// Telegram is its own ingestion module: unlike every other adapter (rss/nitter/
// youtube — all stateless per-call HTTP fetches), this one rides a long-lived
// authenticated MTProto connection (see telegram/client.ts) owned outside this file.
// Each message (or grouped album) becomes its own article via publishDirect — see
// pipeline/publish.ts and queue/priorityQueue.ts, which route telegram-sourced items
// straight there rather than through the LLM clustering/synthesis pipeline, same
// reasoning as YouTube/Nitter: merging two unrelated channel posts into one
// AI-rewritten story wouldn't make sense the way merging two outlets' coverage of the
// same event does.

import type { Api } from 'telegram';
import type { Source, TelegramMediaItem } from '../../storage/db/types.js';
import type { SourceAdapter, FetchedItem } from './base.js';
import { logger } from '../../storage/db/logs.js';
import { getClient, fetchChannelMessages } from '../../telegram/client.js';
import { storeMediaBuffer } from '../../storage/media/index.js';

/** Mirrors MAX_TWEET_MEDIA in nitter.ts — the frontend media grid only defines 1/2/3/4-item layouts. */
const MAX_TELEGRAM_MEDIA = 4;
const FETCH_LIMIT = 50;

type TgMessage = Api.Message;

/** Strips whatever shape the admin typed (@handle, t.me link, bare username) down to a bare username. */
function normalizeChannelIdentifier(raw: string): string {
	return raw
		.trim()
		.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '')
		.replace(/^@/, '')
		.replace(/\/s\/?$/, '')
		.replace(/\/+$/, '');
}

function guessExtension(mimeType: string, kind: 'photo' | 'video' | 'gif'): string {
	if (mimeType.includes('png')) return '.png';
	if (mimeType.includes('webp')) return '.webp';
	if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg';
	if (mimeType.includes('mp4')) return '.mp4';
	if (kind === 'photo') return '.jpg';
	return '.mp4';
}

/** Downloads and self-hosts a single message's attached media, if any — Telegram has no public hotlinkable media URL, so this happens immediately rather than being deferred to publish time (that authenticated access could disappear later: message deleted, channel left, session revoked). */
async function extractMedia(message: TgMessage): Promise<{ item: TelegramMediaItem; mediaId: string } | null> {
	let kind: 'photo' | 'video' | 'gif';
	let mimeType = '';
	if (message.video) {
		kind = 'video';
		mimeType = (message.video as unknown as { mimeType?: string }).mimeType ?? '';
	} else if (message.gif) {
		kind = 'gif';
		mimeType = (message.gif as unknown as { mimeType?: string }).mimeType ?? '';
	} else if (message.photo) {
		kind = 'photo';
	} else {
		return null;
	}

	const buffer = await message.downloadMedia();
	if (!buffer || typeof buffer === 'string') return null;

	const ext = guessExtension(mimeType, kind);
	const stored = storeMediaBuffer(buffer, ext, `telegram-message:${message.id}`, 'candidate', {});
	return { item: { type: kind, url: stored.servedPath, thumbnailUrl: null, width: null, height: null }, mediaId: stored.id };
}

/** Groups consecutive messages sharing a non-null groupedId (Telegram's multi-photo/video "album" concept) into one entry each. */
function groupMessages(messages: TgMessage[]): TgMessage[][] {
	const order: string[] = [];
	const groups = new Map<string, TgMessage[]>();
	for (const message of messages) {
		const key = message.groupedId ? message.groupedId.toString() : `single-${message.id}`;
		if (!groups.has(key)) {
			groups.set(key, []);
			order.push(key);
		}
		groups.get(key)!.push(message);
	}
	return order.map((key) => groups.get(key)!);
}

export const telegramAdapter: SourceAdapter = {
	async fetch(source: Source): Promise<FetchedItem[]> {
		const client = getClient();
		if (!client) {
			logger.warn('telegram', `No connected Telegram account — skipping source "${source.name}"`);
			return [];
		}
		if (!source.url) return [];

		const identifier = normalizeChannelIdentifier(source.url);
		let entity: any;
		let messages: TgMessage[];
		try {
			const result = await fetchChannelMessages(identifier, FETCH_LIMIT);
			entity = result.entity;
			messages = result.messages as unknown as TgMessage[];
		} catch (err) {
			logger.error('telegram', `Failed to resolve/fetch channel "${identifier}" for source "${source.name}": ${(err as Error).message}`);
			return [];
		}

		// Only channels with a public username get a permalink (https://t.me/<username>/<id>)
		// that means anything to a non-member — a private channel's t.me/c/<internal_id>/...
		// link would make "click to open on Telegram" mostly useless, so v1 restricts to
		// public channels and fails soft otherwise (same style as youtube.ts's resolveFeedUrl).
		const channelUsername: string | undefined = entity?.username;
		if (!channelUsername) {
			logger.warn('telegram', `"${source.name}" has no public username — private channels aren't supported yet, skipping`);
			return [];
		}
		const channelName: string = entity?.title ?? channelUsername;

		let avatarBuffer: Buffer | null = null;
		try {
			const photo = await client.downloadProfilePhoto(entity);
			if (photo && typeof photo !== 'string') avatarBuffer = photo;
		} catch (err) {
			logger.warn('telegram', `Failed to download avatar for "${channelName}": ${(err as Error).message}`);
		}

		const items: FetchedItem[] = [];

		for (const group of groupMessages(messages)) {
			const primary = group.find((m) => m.message) ?? group[0];
			const text = primary.message ?? '';
			const firstLine = text.split('\n')[0].trim();

			const media: TelegramMediaItem[] = [];
			const mediaAssetIds: string[] = [];
			for (const message of group) {
				if (media.length >= MAX_TELEGRAM_MEDIA) break;
				const extracted = await extractMedia(message);
				if (extracted) {
					media.push(extracted.item);
					mediaAssetIds.push(extracted.mediaId);
				}
			}

			let channelAvatarUrl: string | null = null;
			if (avatarBuffer) {
				const stored = storeMediaBuffer(avatarBuffer, '.jpg', `telegram-avatar:${channelUsername}`, 'candidate', {});
				channelAvatarUrl = stored.servedPath;
				mediaAssetIds.push(stored.id);
			}

			if (!text && media.length === 0) continue; // nothing worth publishing (e.g. a service message)

			items.push({
				title: firstLine || `Message from ${channelName}`,
				summary: text.slice(0, 500),
				body: text || null,
				images: [],
				videos: [],
				link: `https://t.me/${channelUsername}/${group[0].id}`,
				publishedAt: new Date(primary.date * 1000).toISOString(),
				telegramMessage: {
					channelName,
					channelUsername,
					channelAvatarUrl,
					messageId: String(group[0].id),
					media
				},
				telegramMediaAssetIds: mediaAssetIds,
				raw: { messageIds: group.map((m) => m.id) }
			});
		}

		return items;
	}
};
