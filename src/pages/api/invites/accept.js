import { getDb, withTransaction } from '../../../lib/db.js';
import { getUser } from '../../../lib/auth.js';
import { consumeRateLimit, getClientIp } from '../../../lib/security.js';
import { redeemInvite } from '../../../lib/collaboration.js';

// Los tokens son de 24 bytes aleatorios, así que adivinarlos es inviable; la
// cuota está para que nadie use el endpoint como sonda masiva.
const ACCEPT_MAX = 30;
const ACCEPT_WINDOW = 15 * 60 * 1000;

export const POST = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const limit = await consumeRateLimit(
    'invite-accept-ip',
    getClientIp(request),
    ACCEPT_MAX,
    ACCEPT_WINDOW,
  );
  if (!limit.allowed) {
    return json(
      { error: 'Demasiados intentos. Intenta nuevamente más tarde.' },
      429,
      { 'Retry-After': String(limit.retryAfterSeconds) },
    );
  }

  const result = await redeemInvite(getDb(), withTransaction, body?.token, user.userId);
  if (result.error) return json({ error: result.error }, result.status);

  return json({
    ok: true,
    task_id: result.taskId,
    title: result.title,
    role: result.role,
    already_member: result.alreadyMember,
  }, 200);
};

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}
