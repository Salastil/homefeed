// The only module that touches storage/crypto.ts for Telegram data — everything else
// (telegram/client.ts, the admin routes) goes through these functions and never sees
// ciphertext or handles encryption itself.

import { db } from '../storage/db/index.js';
import { encrypt, decrypt } from '../storage/crypto.js';

interface TelegramCredentialsRow {
	api_id_enc: string | null;
	api_hash_enc: string | null;
	session_enc: string | null;
	phone_enc: string | null;
}

function getRow(): TelegramCredentialsRow {
	return db.prepare('SELECT * FROM telegram_credentials WHERE id = 1').get() as unknown as TelegramCredentialsRow;
}

export function saveApiCredentials(apiId: number, apiHash: string): void {
	db.prepare('UPDATE telegram_credentials SET api_id_enc = ?, api_hash_enc = ? WHERE id = 1').run(
		encrypt(String(apiId)),
		encrypt(apiHash)
	);
}

export function getApiCredentials(): { apiId: number; apiHash: string } | null {
	const row = getRow();
	if (!row.api_id_enc || !row.api_hash_enc) return null;
	return { apiId: Number(decrypt(row.api_id_enc)), apiHash: decrypt(row.api_hash_enc) };
}

export function saveSession(sessionString: string, phone: string): void {
	db.prepare('UPDATE telegram_credentials SET session_enc = ?, phone_enc = ? WHERE id = 1').run(
		encrypt(sessionString),
		encrypt(phone)
	);
}

export function getSession(): { sessionString: string; phone: string } | null {
	const row = getRow();
	if (!row.session_enc || !row.phone_enc) return null;
	return { sessionString: decrypt(row.session_enc), phone: decrypt(row.phone_enc) };
}

/** Logout — clears the session/phone only, keeps API ID/hash so re-login doesn't need them re-entered. */
export function clearSession(): void {
	db.prepare('UPDATE telegram_credentials SET session_enc = NULL, phone_enc = NULL WHERE id = 1').run();
}
