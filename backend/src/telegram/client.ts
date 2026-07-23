// Singleton GramJS client + login state machine. Unlike every other adapter (rss/
// nitter/youtube — all stateless per-call HTTP fetches), Telegram needs one long-lived
// authenticated MTProto connection reused across every poll — this module owns that
// connection and the interactive phone/code/2FA login flow that produces it, consumed
// by three call sites: the adapter (getClient/fetchChannelMessages), the admin login
// routes (startLogin/verifyCode/verifyPassword/logout/getStatus), and startup
// (initFromSavedSession).

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { computeCheck } from 'telegram/Password.js';
import * as credentials from './credentials.js';
import { logger } from '../storage/db/logs.js';

interface PendingLogin {
	client: TelegramClient;
	phoneNumber: string;
	phoneCodeHash: string;
	phase: 'code-sent' | 'password-needed';
}

let client: TelegramClient | null = null;
let connectedPhone: string | null = null;
let pendingLogin: PendingLogin | null = null;

export function telegramConfigured(): boolean {
	return credentials.getApiCredentials() !== null;
}

function newClient(sessionString = ''): TelegramClient {
	const creds = credentials.getApiCredentials();
	if (!creds) throw new Error('Telegram API credentials have not been saved yet');
	return new TelegramClient(new StringSession(sessionString), creds.apiId, creds.apiHash, {
		connectionRetries: 5
	});
}

/** Called from index.ts's main() right after migrate() — reconnects a saved session, if any. */
export async function initFromSavedSession(): Promise<void> {
	const session = credentials.getSession();
	if (!session) return;

	try {
		const c = newClient(session.sessionString);
		await c.connect();
		client = c;
		connectedPhone = session.phone;
		logger.info('telegram', `Reconnected as ${session.phone}`);
	} catch (err) {
		// A network blip or transient failure shouldn't force a re-login — only an
		// explicit logout() clears the saved session. Leaving client null here means the
		// adapter just fails soft (same as before this feature existed) until the next
		// restart or a manual reconnect.
		client = null;
		connectedPhone = null;
		logger.error('telegram', `Failed to reconnect saved session: ${(err as Error).message}`);
	}
}

export function getClient(): TelegramClient | null {
	return client;
}

export function getStatus(): { credentialsConfigured: boolean; connected: boolean; phone: string | null } {
	return {
		credentialsConfigured: telegramConfigured(),
		connected: client !== null,
		phone: connectedPhone
	};
}

export function saveApiCredentials(apiId: number, apiHash: string): void {
	credentials.saveApiCredentials(apiId, apiHash);
}

export async function startLogin(phoneNumber: string): Promise<void> {
	if (!telegramConfigured()) throw new Error('Save Telegram API ID/hash before logging in');

	const creds = credentials.getApiCredentials()!;
	const loginClient = newClient();
	await loginClient.connect();

	const sent = await loginClient.sendCode({ apiId: creds.apiId, apiHash: creds.apiHash }, phoneNumber);
	pendingLogin = { client: loginClient, phoneNumber, phoneCodeHash: sent.phoneCodeHash, phase: 'code-sent' };
}

/** Returns 'connected' or 'password-needed' depending on whether this account has 2FA enabled. */
export async function verifyCode(code: string): Promise<'connected' | 'password-needed'> {
	if (!pendingLogin || pendingLogin.phase !== 'code-sent') throw new Error('No login in progress — start again');

	try {
		await pendingLogin.client.invoke(
			new Api.auth.SignIn({
				phoneNumber: pendingLogin.phoneNumber,
				phoneCodeHash: pendingLogin.phoneCodeHash,
				phoneCode: code
			})
		);
		await completeLogin(pendingLogin.client, pendingLogin.phoneNumber);
		return 'connected';
	} catch (err) {
		if ((err as { errorMessage?: string }).errorMessage === 'SESSION_PASSWORD_NEEDED') {
			pendingLogin.phase = 'password-needed';
			return 'password-needed';
		}
		pendingLogin = null;
		throw err;
	}
}

export async function verifyPassword(password: string): Promise<void> {
	if (!pendingLogin || pendingLogin.phase !== 'password-needed') throw new Error('No password step in progress — start again');

	try {
		const passwordInfo = await pendingLogin.client.invoke(new Api.account.GetPassword());
		const passwordSrpCheck = await computeCheck(passwordInfo, password);
		await pendingLogin.client.invoke(new Api.auth.CheckPassword({ password: passwordSrpCheck }));
		await completeLogin(pendingLogin.client, pendingLogin.phoneNumber);
	} catch (err) {
		pendingLogin = null;
		throw err;
	}
}

async function completeLogin(loginClient: TelegramClient, phoneNumber: string): Promise<void> {
	const sessionString = loginClient.session.save() as unknown as string;
	credentials.saveSession(sessionString, phoneNumber);
	client = loginClient;
	connectedPhone = phoneNumber;
	pendingLogin = null;
	logger.info('telegram', `Logged in as ${phoneNumber}`);
}

export async function logout(): Promise<void> {
	if (client) {
		try {
			await client.invoke(new Api.auth.LogOut());
		} catch (err) {
			logger.error('telegram', `Logout call failed (clearing local session anyway): ${(err as Error).message}`);
		}
		await client.disconnect();
	}
	client = null;
	connectedPhone = null;
	pendingLogin = null;
	credentials.clearSession();
}

/** Used by the adapter — resolves a channel and fetches its most recent messages. */
export async function fetchChannelMessages(channelIdentifier: string, limit: number) {
	if (!client) throw new Error('Telegram client not connected');
	const entity = await client.getEntity(channelIdentifier);
	const messages = await client.getMessages(entity, { limit });
	return { entity, messages };
}

/**
 * Re-fetches a single message by id and downloads its attached media — used by
 * pipeline/publish.ts (self-host mode, at publish time) and the live telegram-proxy
 * route (proxy mode, on every view). Telegram media has no public URL; this
 * authenticated call is the only way to get the bytes.
 */
export async function downloadMessageMedia(channelUsername: string, messageId: string): Promise<Buffer | null> {
	if (!client) throw new Error('Telegram client not connected');
	const entity = await client.getEntity(channelUsername);
	const [message] = await client.getMessages(entity, { ids: [Number(messageId)] });
	if (!message) return null;
	const buffer = await message.downloadMedia();
	return buffer && typeof buffer !== 'string' ? buffer : null;
}

/** Downloads a channel's current avatar — same on-demand, no-public-URL reasoning as downloadMessageMedia. */
export async function downloadChannelAvatar(channelUsername: string): Promise<Buffer | null> {
	if (!client) throw new Error('Telegram client not connected');
	const entity = await client.getEntity(channelUsername);
	const photo = await client.downloadProfilePhoto(entity);
	return photo && typeof photo !== 'string' ? photo : null;
}
