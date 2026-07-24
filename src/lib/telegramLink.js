import { createHmac, randomBytes } from 'node:crypto';

export const TELEGRAM_LINK_TTL_MS = 10 * 60 * 1000;

function secret() {
  if (!process.env.SECRET_KEY) {
    throw new Error('SECRET_KEY es obligatorio para vincular Telegram.');
  }
  return process.env.SECRET_KEY;
}

export function normalizeTelegramLinkCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function hashTelegramLinkCode(code) {
  return createHmac('sha256', secret())
    .update(normalizeTelegramLinkCode(code))
    .digest('hex');
}

export function createTelegramLinkCode() {
  return randomBytes(6).toString('base64url').toUpperCase();
}
