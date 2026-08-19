export const prerender = false;

import { getDb } from '../../lib/db.js';
import { createSessionCookie, createToken } from '../../lib/auth.js';
import {
  consumeEmailVerificationToken,
  markEmailVerified,
} from '../../lib/emailVerification.js';
import { safeErrorSummary } from '../../lib/security.js';

/**
 * Confirma el correo de una cuenta recién registrada.
 *
 * - GET con `?token=` lo usa el enlace del correo: consume el token, marca el
 *   correo como verificado y redirige al dashboard con sesión iniciada.
 * - POST con `{ token }` lo usa el frontend para confirmar sin redirección.
 *
 * El token es de un solo uso y expira a las 24 horas; el flujo reutiliza el
 * mismo patrón hash-consume que la recuperación de contraseña.
 */
export const GET = async ({ request, redirect }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  if (!token) return json({ error: 'Token requerido.' }, 400);

  const result = await verifyTokenConsume(token, request);
  if (result.error) return json({ error: result.error }, 400);

  return redirect('/dashboard', 303);
};

export const POST = async ({ request }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const { token } = body ?? {};
  if (typeof token !== 'string' || !token || token.length > 100) {
    return json({ error: 'Token requerido.' }, 400);
  }

  const result = await verifyTokenConsume(token, request);
  if (result.error) return json({ error: result.error }, 400);

  return json({
    ok: true,
    'Set-Cookie': result.setCookie,
  }, 200);
};

async function verifyTokenConsume(token, request) {
  const db = getDb();
  try {
    const userId = await consumeEmailVerificationToken(db, token);
    if (!userId) {
      return { error: 'El enlace de verificación expiró o ya fue usado. Solicita uno nuevo.' };
    }
    const user = await db.prepare('SELECT * FROM users WHERE id = $1').get(userId);
    if (!user) return { error: 'La cuenta ya no existe.' };

    await markEmailVerified(db, userId);
    const sessionToken = await createToken(user.id, user.username, user.session_version);
    return { setCookie: createSessionCookie(sessionToken, request) };
  } catch (err) {
    console.error('[verify-email]', safeErrorSummary(err));
    return { error: 'Error interno del servidor.' };
  }
}

function json(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
