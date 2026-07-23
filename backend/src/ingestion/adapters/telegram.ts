// Telegram is its own ingestion module: unlike every other adapter (rss/nitter/
// youtube — all stateless per-call HTTP fetches), this one rides a long-lived
// authenticated MTProto connection (see telegram/client.ts) owned outside this file.
// Each message (or grouped album) becomes its own article via publishDirect — see
// pipeline/publish.ts and queue/priorityQueue.ts, which route telegram-sourced items
// straight there rather than through the LLM clustering/synthesis pipeline, same
// reasoning as YouTube/Nitter: merging two unrelated channel posts into one
// AI-rewritten story wouldn't make sense the way merging two outlets' coverage of the
// same event does.
//
// Media is deliberately NOT downloaded here — Telegram has no public hotlinkable media
// URL, so unlike every field pulled from the message itself, media can only be resolved
// by re-authenticating to Telegram, which the admin's configured telegramMediaMode
// (self-host vs. proxy) governs. This adapter only records *references* (message id,
// kind, mime type, dimensions) — see pipeline/publish.ts's resolveTelegramMedia for
// where those refs turn into an actual servable url.

import type { Api } from 'telegram';
import type { Source, TelegramMediaRef } from '../../storage/db/types.js';
import type { SourceAdapter, FetchedItem } from './base.js';
import { logger } from '../../storage/db/logs.js';
import { getClient, fetchChannelMessages } from '../../telegram/client.js';

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

function videoDimensions(document: { attributes?: { className?: string; w?: number; h?: number }[] } | undefined) {
	const attr = document?.attributes?.find((a) => a.className === 'DocumentAttributeVideo');
	return { width: attr?.w ?? null, height: attr?.h ?? null };
}

function photoDimensions(photo: { sizes?: { w?: number; h?: number }[] } | undefined) {
	const largest = photo?.sizes?.reduce<{ w?: number; h?: number } | undefined>(
		(best, size) => (!best || (size.w ?? 0) > (best.w ?? 0) ? size : best),
		undefined
	);
	return { width: largest?.w ?? null, height: largest?.h ?? null };
}

/** A reference to a single message's attached media, if any — no download, just what's needed to resolve it later. */
function refForMessage(message: TgMessage): TelegramMediaRef | null {
	if (message.video) {
		const doc = message.video as unknown as { mimeType?: string; attributes?: { className?: string; w?: number; h?: number }[] };
		const { width, height } = videoDimensions(doc);
		return { type: 'video', messageId: String(message.id), mimeType: doc.mimeType ?? null, width, height };
	}
	if (message.gif) {
		const doc = message.gif as unknown as { mimeType?: string; attributes?: { className?: string; w?: number; h?: number }[] };
		const { width, height } = videoDimensions(doc);
		return { type: 'gif', messageId: String(message.id), mimeType: doc.mimeType ?? null, width, height };
	}
	if (message.photo) {
		const { width, height } = photoDimensions(message.photo as unknown as { sizes?: { w?: number; h?: number }[] });
		return { type: 'photo', messageId: String(message.id), mimeType: null, width, height };
	}
	return null;
}

interface ForwardOrigin {
	name: string;
	/** Null when the origin has no public handle (e.g. a private channel/user, or a sender who hid their identity) — the card then falls back to showing just the name, with no avatar. */
	username: string | null;
}

/**
 * Detects a forwarded message and resolves where it came from. GramJS's `message.forward`
 * wraps the raw fwdFrom header using entities Telegram already sent alongside the same
 * getMessages response (the whole point of that header is letting clients show forward
 * attribution without a separate resolve call) — `.chat` is the origin channel/group,
 * `.sender` the origin user. Falls back to fwdFrom.fromName for the rarer case where the
 * origin has no resolvable identity (e.g. a user who hid their account from forwards).
 */
function detectForward(message: TgMessage): ForwardOrigin | null {
	const fwd = message.fwdFrom;
	if (!fwd) return null;

	const chat = message.forward?.chat as { title?: string; username?: string } | undefined;
	if (chat) return { name: chat.title ?? chat.username ?? 'Unknown', username: chat.username ?? null };

	const sender = message.forward?.sender as { firstName?: string; lastName?: string; username?: string } | undefined;
	if (sender) {
		const name = [sender.firstName, sender.lastName].filter(Boolean).join(' ') || sender.username || 'Unknown';
		return { name, username: sender.username ?? null };
	}

	return { name: fwd.fromName ?? 'Unknown', username: null };
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
		// This is always the channel we polled — used for the permalink and, on a forward,
		// as the "Forwarded by @X" attribution — never the identity actually displayed.
		const pollingChannelUsername: string | undefined = entity?.username;
		if (!pollingChannelUsername) {
			logger.warn('telegram', `"${source.name}" has no public username — private channels aren't supported yet, skipping`);
			return [];
		}
		const pollingChannelName: string = entity?.title ?? pollingChannelUsername;

		const items: FetchedItem[] = [];

		for (const group of groupMessages(messages)) {
			const primary = group.find((m) => m.message) ?? group[0];
			const text = primary.message ?? '';
			const firstLine = text.split('\n')[0].trim();

			const media: TelegramMediaRef[] = [];
			for (const message of group) {
				if (media.length >= MAX_TELEGRAM_MEDIA) break;
				const ref = refForMessage(message);
				if (ref) media.push(ref);
			}

			if (!text && media.length === 0) continue; // nothing worth publishing (e.g. a service message)

			// A forward displays as if it were authored by the ORIGIN channel/user — same
			// treatment as a retweet, where tweet.authorName is always the original tweet's
			// author, never the retweeter — with a "Forwarded by @<polled channel>" line
			// (repostedByHandle) taking the place of the retweeter's own attribution.
			const origin = detectForward(primary);
			const channelName = origin?.name ?? pollingChannelName;
			const channelUsername = origin ? origin.username : pollingChannelUsername;
			const repostedByHandle = origin ? pollingChannelUsername : null;

			items.push({
				title: firstLine || `Message from ${pollingChannelName}`,
				summary: text.slice(0, 500),
				body: text || null,
				images: [],
				videos: [],
				link: `https://t.me/${pollingChannelUsername}/${group[0].id}`,
				publishedAt: new Date(primary.date * 1000).toISOString(),
				telegramMessage: {
					channelName,
					channelUsername,
					sourceChannelUsername: pollingChannelUsername,
					messageId: String(group[0].id),
					media,
					repostedByHandle
				},
				raw: { messageIds: group.map((m) => m.id) }
			});
		}

		return items;
	}
};
