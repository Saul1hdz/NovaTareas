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
  safeEqualStrings,
  safeErrorSummary,
} from '../src/lib/security.js';

describe('primitivas de seguridad', () => {
  it('compara secretos sin aceptar longitudes o valores distintos', () => {
    expect(safeEqualStrings('secreto-123', 'secreto-123')).toBe(true);
    expect(safeEqualStrings('secreto-123', 'secreto-124')).toBe(false);
    expect(safeEqualStrings('corto', 'mucho-mas-largo')).toBe(false);
  });

  it('bloquea una clave al superar su límite', () => {
    const key = `test-${crypto.randomUUID()}`;
    expect(consumeRateLimit('test', key, 2, 60_000).allowed).toBe(true);
    expect(consumeRateLimit('test', key, 2, 60_000).allowed).toBe(true);
    const blocked = consumeRateLimit('test', key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
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
