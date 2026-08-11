import { timingSafeEqual } from 'node:crypto';
import { getDb, withTransaction } from './db.js';

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
  const scope = String(namespace).slice(0, 60);
  const subject = String(key).slice(0, 200);
  const windowSeconds = Math.ceil(windowMs / 1000);

  return withTransaction(async (tx) => {
    // Serializa únicamente la misma cuota. Sin este lock, dos procesos pueden
    // observar el mismo COUNT y aceptar en paralelo más intentos que el máximo.
    await tx.prepare(`
      SELECT pg_advisory_xact_lock(
        hashtextextended($1 || chr(31) || $2, 0)
      )
    `).run(scope, subject);

    const current = await tx.prepare(`
      SELECT COUNT(*)::int AS hits,
             MIN(created_at) AS oldest
      FROM rate_limit_hits
      WHERE scope = $1 AND subject = $2
        AND created_at > NOW() - ($3::int * INTERVAL '1 second')
    `).get(scope, subject, windowSeconds);

    if (current.hits >= maxAttempts) {
      const freesAt = new Date(current.oldest).getTime() + windowMs;
      const retryAfterMs = Math.max(1000, freesAt - Date.now());
      return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
    }

    await tx.prepare(
      'INSERT INTO rate_limit_hits (scope, subject) VALUES ($1, $2)'
    ).run(scope, subject);

    // Barrido perezoso: evita que la tabla crezca sin límite sin necesitar cron.
    await tx.prepare(`
      DELETE FROM rate_limit_hits
      WHERE scope = $1 AND created_at < NOW() - ($2::int * INTERVAL '1 second')
    `).run(scope, windowSeconds * 4);

    return { allowed: true, retryAfterSeconds: 0 };
  }, db);
}

export async function resetRateLimit(namespace, key) {
  const scope = String(namespace).slice(0, 60);
  const subject = String(key).slice(0, 200);
  await getDb().prepare(
    'DELETE FROM rate_limit_hits WHERE scope = $1 AND subject = $2'
  ).run(scope, subject);
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
