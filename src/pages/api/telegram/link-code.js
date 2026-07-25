export const prerender = false;

import { getUser } from '../../../lib/auth.js';
import { getDb, withTransaction } from '../../../lib/db.js';
import {
  createTelegramLinkCode,
  hashTelegramLinkCode,
  TELEGRAM_LINK_TTL_MS,
} from '../../../lib/telegramLink.js';
import { consumeRateLimit, getClientIp } from '../../../lib/security.js';

export const POST = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const limit = await consumeRateLimit(
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
  const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TTL_MS);
  const db = getDb();

  await withTransaction(async (tx) => {
    await tx.prepare('DELETE FROM telegram_link_codes WHERE user_id = $1 OR expires_at < NOW()')
      .run(user.userId);
    await tx.prepare(`
      INSERT INTO telegram_link_codes (user_id, code_hash, expires_at)
      VALUES ($1, $2, $3)
    `).run(user.userId, hashTelegramLinkCode(code), expiresAt);
  }, db);

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
