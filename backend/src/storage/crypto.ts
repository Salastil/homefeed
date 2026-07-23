// Generic AES-256-GCM encrypt/decrypt for at-rest secrets (currently just Telegram
// credentials — see telegram/credentials.ts — but deliberately not Telegram-specific
// here, so any future sensitive field can reuse it). The key is generated once into a
// file next to the DB but not inside it, so a naive copy of just the .db file reveals
// nothing — this is "not easily retrieved," not "safe against a fully compromised
// host": anyone with full filesystem access has both files anyway, same trust model as
// every other secret in this app. The key file must be included in backups, or
// previously-saved Telegram credentials become undecryptable (fixed by logging in
// again — no other data loss).

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || './data/homefeed.db';
const KEY_PATH = path.join(path.dirname(DB_PATH), '.encryption-key');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
	if (cachedKey) return cachedKey;

	if (fs.existsSync(KEY_PATH)) {
		cachedKey = fs.readFileSync(KEY_PATH);
		return cachedKey;
	}

	const key = randomBytes(32);
	fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
	fs.writeFileSync(KEY_PATH, key, { mode: 0o600 });
	cachedKey = key;
	return cachedKey;
}

export function encrypt(plaintext: string): string {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, getKey(), iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string): string {
	const raw = Buffer.from(ciphertext, 'base64');
	const iv = raw.subarray(0, IV_LENGTH);
	const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
	const encrypted = raw.subarray(IV_LENGTH + 16);
	const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
