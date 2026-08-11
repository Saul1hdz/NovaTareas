import { describe, expect, it } from 'vitest';
import {
  clearSessionCookie,
  createOAuthState,
  createSessionCookie,
  createToken,
  verifyOAuthState,
  verifyToken,
} from '../src/lib/auth.js';
import {
  consumeRateLimit,
  resetRateLimit,
  safeEqualStrings,
  safeErrorSummary,
} from '../src/lib/security.js';
import { getDb } from '../src/lib/db.js';

describe('primitivas de seguridad', () => {
  it('compara secretos sin aceptar longitudes o valores distintos', () => {
    expect(safeEqualStrings('secreto-123', 'secreto-123')).toBe(true);
    expect(safeEqualStrings('secreto-123', 'secreto-124')).toBe(false);
    expect(safeEqualStrings('corto', 'mucho-mas-largo')).toBe(false);
  });

  it('bloquea una clave al superar su límite', async () => {
    const key = `test-${crypto.randomUUID()}`;
    expect((await consumeRateLimit('test', key, 2, 60_000)).allowed).toBe(true);
    expect((await consumeRateLimit('test', key, 2, 60_000)).allowed).toBe(true);
    const blocked = await consumeRateLimit('test', key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('cuenta cada clave por separado y permite reiniciarla', async () => {
    const key = `test-${crypto.randomUUID()}`;
    const otra = `test-${crypto.randomUUID()}`;
    await consumeRateLimit('test', key, 1, 60_000);
    expect((await consumeRateLimit('test', key, 1, 60_000)).allowed).toBe(false);
    // Una clave distinta conserva su cupo completo.
    expect((await consumeRateLimit('test', otra, 1, 60_000)).allowed).toBe(true);

    await resetRateLimit('test', key);
    expect((await consumeRateLimit('test', key, 1, 60_000)).allowed).toBe(true);
  });

  it('mantiene el recuento fuera del proceso, en la base de datos', async () => {
    // Es la razón de existir de este cambio: antes vivía en un Map y cualquier
    // reinicio devolvía la cuota completa.
    const key = `test-${crypto.randomUUID()}`;
    await consumeRateLimit('persistencia', key, 5, 60_000);
    const row = await getDb().prepare(
      'SELECT COUNT(*)::int AS total FROM rate_limit_hits WHERE scope = $1 AND subject = $2'
    ).get('persistencia', key);
    expect(row.total).toBe(1);
  });

  it('no permite superar el máximo con solicitudes concurrentes', async () => {
    const db = getDb();
    const key = `concurrente-${crypto.randomUUID()}`;
    await db.query(`
      CREATE OR REPLACE FUNCTION test_delay_rate_limit_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_sleep(0.05);
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER test_delay_rate_limit_insert
      BEFORE INSERT ON rate_limit_hits
      FOR EACH ROW EXECUTE FUNCTION test_delay_rate_limit_insert();
    `);

    try {
      const results = await Promise.all(
        Array.from({ length: 12 }, () => consumeRateLimit('concurrencia', key, 3, 60_000))
      );
      expect(results.filter(result => result.allowed)).toHaveLength(3);
      expect(results.filter(result => !result.allowed)).toHaveLength(9);
    } finally {
      await db.query('DROP TRIGGER IF EXISTS test_delay_rate_limit_insert ON rate_limit_hits');
      await db.query('DROP FUNCTION IF EXISTS test_delay_rate_limit_insert()');
    }
  });

  it('normaliza namespace y sujeto según los límites de la tabla', async () => {
    const namespace = `scope-${'n'.repeat(80)}`;
    const subject = `subject-${'s'.repeat(240)}`;

    expect((await consumeRateLimit(namespace, subject, 1, 60_000)).allowed).toBe(true);

    const stored = await getDb().prepare(`
      SELECT scope, subject
      FROM rate_limit_hits
      WHERE scope = $1 AND subject = $2
    `).get(namespace.slice(0, 60), subject.slice(0, 200));
    expect(stored.scope).toHaveLength(60);
    expect(stored.subject).toHaveLength(200);

    await resetRateLimit(namespace, subject);
    const remaining = await getDb().prepare(`
      SELECT COUNT(*)::int AS total
      FROM rate_limit_hits
      WHERE scope = $1 AND subject = $2
    `).get(namespace.slice(0, 60), subject.slice(0, 200));
    expect(remaining.total).toBe(0);
  });

  it('firma sesiones con versión y vencimiento', async () => {
    const token = await createToken(7, 'Usuario', 3);
    const payload = await verifyToken(token);
    expect(payload.userId).toBe(7);
    expect(payload.sessionVersion).toBe(3);
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('firma y valida el state de Google OAuth', async () => {
    const state = await createOAuthState(9);
    const payload = await verifyOAuthState(state);
    expect(payload.userId).toBe(9);
    expect(payload.aud).toBe('google-oauth');
    expect(await verifyOAuthState(`${state}alterado`)).toBeNull();
  });

  it('configura cookies locales y HTTPS con atributos explícitos', () => {
    const localRequest = new Request('http://127.0.0.1:4321/api/login');
    const secureRequest = new Request('https://demo.example/api/login');

    expect(createSessionCookie('abc', localRequest)).toContain('HttpOnly');
    expect(createSessionCookie('abc', localRequest)).toContain('SameSite=Lax');
    expect(createSessionCookie('abc', localRequest)).not.toContain('Secure');
    expect(createSessionCookie('abc', secureRequest)).toContain('Secure');
    expect(clearSessionCookie(secureRequest)).toContain('Max-Age=0');
  });

  it('resume errores externos sin registrar URLs ni credenciales', () => {
    const secret = 'secreto-que-no-debe-aparecer';
    const summary = safeErrorSummary({
      name: 'ExternalError',
      message: `falló https://proveedor.test/?token=${secret}`,
      response: { status: 401, config: { headers: { Authorization: secret } } },
    });
    expect(summary).toBe('HTTP 401');
    expect(summary).not.toContain(secret);
  });
});
