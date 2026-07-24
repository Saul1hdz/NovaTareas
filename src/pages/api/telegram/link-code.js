export const prerender = false;

import { getUser } from '../../../lib/auth.js';
import { getDb } from '../../../lib/db.js';
import {
  createTelegramLinkCode,
  hashTelegramLinkCode,
  TELEGRAM_LINK_TTL_MS,
} from '../../../lib/telegramLink.js';
import { consumeRateLimit, getClientIp } from '../../../lib/security.js';

export const POST = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const limit = consumeRateLimit(
    'telegram-link-code',
    `${user.userId}:${getClientIp(request)}`,
    5,
    10 * 60 * 1000
  );
  if (!limit.allowed) {
    return json(
      { error: 'Espera antes de generar otro código.' },
      429,
      { 'Retry-After': String(limit.retryAfterSeconds) }
    );
  }

  const code = createTelegramLinkCode();
  const expiresAt = Date.now() + TELEGRAM_LINK_TTL_MS;
  const db = getDb();

  db.transaction(() => {
    db.prepare('DELETE FROM telegram_link_codes WHERE user_id = ? OR expires_at < ?')
      .run(user.userId, Date.now());
    db.prepare(`
      INSERT INTO telegram_link_codes (user_id, code_hash, expires_at)
      VALUES (?, ?, ?)
    `).run(user.userId, hashTelegramLinkCode(code), expiresAt);
  })();

  return json({
    ok: true,
    code,
    command: `/vincular ${code}`,
    expires_in_seconds: Math.floor(TELEGRAM_LINK_TTL_MS / 1000),
  }, 201);
};

function json(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}
