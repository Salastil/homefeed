// Generated once per process start — not persisted, not configurable via env. Every
// restart invalidates the previous key, which is the whole point: the only way to
// learn the current key is to have console/log access to the running process (see
// index.ts's startup banner), which is a meaningfully different trust boundary than a
// password someone could guess or brute-force over the network.
import { randomBytes } from 'node:crypto';

export const ADMIN_API_KEY = randomBytes(24).toString('hex');
