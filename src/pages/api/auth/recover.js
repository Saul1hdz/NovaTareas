export const prerender = false;

import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../../../lib/db.js';
import {
  consumeRateLimit,
  getClientIp,
} from '../../../lib/security.js';
import { sendPasswordResetEmail, smtpConfigured } from '../../../lib/mailer.js';

const LOCK_WINDOW_MS = 15 * 60 * 1000;
const TOKEN_TTL_MS = 15 * 60 * 1000;

// Los tokens se guardan hasheados en PostgreSQL, no en memoria del proceso.
// Antes, cualquier reinicio —incluido un despliegue— invalidaba una
// recuperación en curso, y con más de una instancia fallaba de forma aleatoria.
// Guardar el hash evita además que un volcado de la base permita usarlos.
function hashRecoveryToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function createRecoveryToken(db, userId) {
  const token = randomBytes(32).toString('base64url');
  await db.prepare(`
    INSERT INTO recovery_tokens (token_hash, user_id, expires_at)
    VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 millisecond'))
  `).run(hashRecoveryToken(token), userId, TOKEN_TTL_MS);
  return token;
}

/** Consume el token si es válido. Devuelve el usuario o null. Es de un solo uso. */
async function consumeRecoveryToken(db, token) {
  const row = await db.prepare(`
    UPDATE recovery_tokens
    SET used_at = NOW()
    WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
    RETURNING user_id
  `).get(hashRecoveryToken(token));
  return row?.user_id ?? null;
}

export const POST = async ({ request }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'El cuerpo debe ser un objeto JSON.' }, 400);
  }

  const { action, email, token, new_password } = body;
  const ip = getClientIp(request);
  const ipLimit = await consumeRateLimit('recovery-ip', ip, 40, LOCK_WINDOW_MS);
  if (!ipLimit.allowed) return rateLimitResponse(ipLimit.retryAfterSeconds);

  const db = getDb();
  await removeExpiredTokens(db);

  if (action === 'request_email_reset') {
    if (typeof email !== 'string' || !email || email.length > 254) {
      return json({ error: 'Correo requerido.' }, 400);
    }

    const normalizedEmail = email.toLowerCase().trim();
    const ipLimit = await consumeRateLimit('recovery-email-ip', ip, 5, LOCK_WINDOW_MS);
    if (!ipLimit.allowed) return rateLimitResponse(ipLimit.retryAfterSeconds);

    // Respuesta genérica aunque el correo no exista, para no revelar cuentas.
    if (!smtpConfigured()) {
      return json({ ok: true, via_email: false }, 200);
    }

    const user = await db.prepare('SELECT id, full_name FROM users WHERE email = $1')
      .get(normalizedEmail);
    if (user) {
      const token = await createRecoveryToken(db, user.id);
      await sendPasswordResetEmail({
        to: normalizedEmail,
        token,
        name: user.full_name,
      });
    }
    return json({ ok: true, via_email: true }, 200);
  }

  if (action === 'reset_password') {
    if (typeof token !== 'string' || !token || token.length > 100 ||
        typeof new_password !== 'string' || !new_password || new_password.length > 128) {
      return json({ error: 'Token y nueva contraseña requeridos.' }, 400);
    }

    const recoveredUserId = await consumeRecoveryToken(db, token);
    if (!recoveredUserId) {
      return json({ error: 'El enlace de recuperación expiró. Intenta de nuevo.' }, 400);
    }

    if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(new_password)) {
      return json({ error: 'La contraseña debe tener mínimo 8 caracteres, incluir letras y números.' }, 400);
    }

    const hash = await bcrypt.hash(new_password, 10);
    await db.prepare(`
      UPDATE users
      SET password_hash = $1, session_version = session_version + 1
      WHERE id = $2
    `).run(hash, recoveredUserId);

    return json({ ok: true, message: 'Contraseña restablecida exitosamente.' }, 200);
  }

  return json({ error: 'Acción no válida.' }, 400);
};

/**
 * Los tokens caducados se descartan por su columna `expires_at`, así que basta
 * con borrarlos de vez en cuando para que la tabla no crezca.
 */
async function removeExpiredTokens(db) {
  await db.prepare(
    "DELETE FROM recovery_tokens WHERE expires_at < NOW() - INTERVAL '1 day'"
  ).run();
}

function rateLimitResponse(retryAfterSeconds) {
  return json(
    { error: 'Demasiados intentos. Intenta nuevamente más tarde.' },
    429,
    { 'Retry-After': String(retryAfterSeconds) }
  );
}

function json(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
