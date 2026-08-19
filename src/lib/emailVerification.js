import { createHash, randomBytes } from 'node:crypto';

/**
 * Verificación de correo al registrarse.
 *
 * Sigue el mismo patrón que `recovery_tokens`: el token se guarda hasheado en
 * PostgreSQL (sha256 hex), es de un solo uso y expira. El enlace que recibe el
 * usuario por correo consume el token con `consumeEmailVerificationToken`.
 *
 * Para cuentas creadas antes de esta función, `email_verified_at` es NULL pero
 * se tratan como verificadas: la exigencia real la decide `emailVerificationRequired()`
 * en cada flujo (registro y login), y esa política solo aplica a cuentas nuevas.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** Crea un token de verificación para el usuario y devuelve el token en claro. */
export async function createEmailVerificationToken(db, userId) {
  const token = randomBytes(32).toString('base64url');
  await db.prepare(`
    INSERT INTO email_verification_tokens (token_hash, user_id, expires_at)
    VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 millisecond'))
  `).run(hashToken(token), userId, TOKEN_TTL_MS);
  return token;
}

/** Consume el token si es válido. Devuelve el user_id o null. Es de un solo uso. */
export async function consumeEmailVerificationToken(db, token) {
  const row = await db.prepare(`
    UPDATE email_verification_tokens
    SET used_at = NOW()
    WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
    RETURNING user_id
  `).get(hashToken(token));
  return row?.user_id ?? null;
}

/** Marca el correo del usuario como verificado. */
export async function markEmailVerified(db, userId) {
  await db.prepare(`
    UPDATE users SET email_verified_at = NOW() WHERE id = $1
  `).run(userId);
}

/** ¿La cuenta debe considerarse verificada? Las viejas (NULL) sí. */
export function isEmailVerified(user) {
  if (!user) return false;
  // Las cuentas creadas antes de esta función no tienen marca: se consideran
  // verificadas porque la política nueva solo aplica a registros posteriores.
  return user.email_verified_at !== null && user.email_verified_at !== undefined;
}
