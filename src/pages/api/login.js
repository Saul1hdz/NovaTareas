export const prerender = false;

import { getDb } from '../../lib/db.js';
import {
  createSessionCookie,
  createToken,
  verifyPassword,
} from '../../lib/auth.js';
import {
  consumeRateLimit,
  getClientIp,
  resetRateLimit,
} from '../../lib/security.js';
import { isEmailVerified } from '../../lib/emailVerification.js';
import { emailVerificationRequired } from '../../lib/mailer.js';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const POST = async ({ request }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  const { email, password } = body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return json({ error: 'Correo y contraseña son requeridos.' }, 400);
  }
  if (email.length > 254 || password.length > 128) {
    return json({ error: 'Credenciales inválidas' }, 401);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const ip = getClientIp(request);
  const emailLimit = await consumeRateLimit('login-email', normalizedEmail, 5, LOGIN_WINDOW_MS);
  const ipLimit = await consumeRateLimit('login-ip', ip, 20, LOGIN_WINDOW_MS);

  if (!emailLimit.allowed || !ipLimit.allowed) {
    const retryAfter = Math.max(emailLimit.retryAfterSeconds, ipLimit.retryAfterSeconds);
    return json(
      { error: 'Demasiados intentos. Intenta nuevamente más tarde.' },
      429,
      { 'Retry-After': String(retryAfter) }
    );
  }

  const db = getDb();
  const user = await db.prepare('SELECT * FROM users WHERE email = $1').get(normalizedEmail);
  if (!user || !await verifyPassword(password, user.password_hash)) {
    return json({ error: 'Credenciales inválidas' }, 401);
  }

  // Si la política de verificación está activa, las cuentas nuevas deben
  // confirmar su correo antes de iniciar sesión. Las cuentas viejas (NULL)
  // se consideran verificadas por compatibilidad.
  if (emailVerificationRequired() && !isEmailVerified(user)) {
    return json(
      { error: 'Debes verificar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.' },
      403
    );
  }

  await resetRateLimit('login-email', normalizedEmail);
  await resetRateLimit('login-ip', ip);
  const token = await createToken(user.id, user.username, user.session_version);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': createSessionCookie(token, request),
    },
  });
};

function json(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
