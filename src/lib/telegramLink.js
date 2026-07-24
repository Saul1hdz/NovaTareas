import { createHmac, randomBytes } from 'node:crypto';
import { getDb } from './db.js';

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

export function consumeTelegramLinkCode(code, chatId, database = getDb()) {
  const normalized = normalizeTelegramLinkCode(code);
  if (!/^[A-Z0-9_-]{8}$/.test(normalized) || !process.env.SECRET_KEY) {
    return null;
  }

  const codeHash = hashTelegramLinkCode(normalized);
  const now = Date.now();

  return database.transaction(() => {
    const row = database.prepare(`
      SELECT u.*, c.id AS code_id
      FROM telegram_link_codes c
      JOIN users u ON u.id = c.user_id
      WHERE c.code_hash = ?
        AND c.used_at IS NULL
        AND c.expires_at >= ?
    `).get(codeHash, now);
    if (!row) return null;

    database.prepare('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ?')
      .run(String(chatId));
    database.prepare('UPDATE users SET telegram_chat_id = ? WHERE id = ?')
      .run(String(chatId), row.id);
    database.prepare('UPDATE telegram_link_codes SET used_at = ? WHERE id = ?')
      .run(now, row.code_id);

    const { code_id: _codeId, ...user } = row;
    return user;
  })();
}
