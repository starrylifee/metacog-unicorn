import { createHash, randomBytes } from 'node:crypto';

export const CHAT_SESSION_COOKIE = 'metacog_chat_session';

export function createChatSessionToken() {
  return randomBytes(32).toString('hex');
}

export function hashChatSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
