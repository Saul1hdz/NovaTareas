import { timingSafeEqual } from 'node:crypto';
import { getDb } from './db.js';

export function safeEqualStrings(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'local';
}

/**
 * Límite de intentos por ventana deslizante, respaldado por PostgreSQL.
 *
 * Antes vivía en un Map del proceso: cada reinicio devolvía la cuota completa y
 * con dos instancias el límite efectivo se multiplicaba. Al estar en la base, el
 * recuento es el mismo para todos los procesos y sobrevive a los despliegues.
 */
export async function consumeRateLimit(namespace, key, maxAttempts, windowMs) {
  const db = getDb();
  const subject = String(key).slice(0, 200);
  const windowSeconds = Math.ceil(windowMs / 1000);

  // El registro más antiguo dentro de la ventana marca cuándo se libera cupo.
  const current = await db.prepare(`
    SELECT COUNT(*)::int AS hits,
           MIN(created_at) AS oldest
    FROM rate_limit_hits
    WHERE scope = $1 AND subject = $2
      AND created_at > NOW() - ($3::int * INTERVAL '1 second')
  `).get(namespace, subject, windowSeconds);

  if (current.hits >= maxAttempts) {
    const freesAt = new Date(current.oldest).getTime() + windowMs;
    const retryAfterMs = Math.max(1000, freesAt - Date.now());
    return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
  }

  await db.prepare(
    'INSERT INTO rate_limit_hits (scope, subject) VALUES ($1, $2)'
  ).run(namespace, subject);

  // Barrido perezoso: evita que la tabla crezca sin límite sin necesitar cron.
  await db.prepare(`
    DELETE FROM rate_limit_hits
    WHERE scope = $1 AND created_at < NOW() - ($2::int * INTERVAL '1 second')
  `).run(namespace, windowSeconds * 4);

  return { allowed: true, retryAfterSeconds: 0 };
}

export async function resetRateLimit(namespace, key) {
  await getDb().prepare(
    'DELETE FROM rate_limit_hits WHERE scope = $1 AND subject = $2'
  ).run(namespace, String(key).slice(0, 200));
}

export function safeErrorSummary(error) {
  const status = Number(error?.response?.status ?? error?.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    return `HTTP ${status}`;
  }

  const code = String(error?.code || '').trim();
  if (/^[A-Z0-9_-]{1,40}$/i.test(code)) return `código ${code}`;

  const name = String(error?.name || '').trim();
  if (/^[A-Z][A-Za-z0-9]{0,39}(Error)?$/.test(name)) return name;

  return 'error externo';
}
