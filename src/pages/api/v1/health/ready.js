import { getDb } from '../../../../lib/db.js';
import { safeErrorSummary } from '../../../../lib/security.js';

export const prerender = false;

/**
 * Sonda de disponibilidad para orquestadores y proxies inversos.
 *
 * A diferencia de /api/v1/health, que informa del estado de los proveedores de
 * IA y siempre responde 200 porque existe un fallback por reglas, esta ruta
 * comprueba la dependencia sin la cual la aplicación no puede servir nada: la
 * base de datos. Un contenedor con PostgreSQL caído debe salir del balanceador.
 */
export async function GET() {
  const started = Date.now();

  try {
    await getDb().prepare('SELECT 1 AS ok').get();
  } catch (error) {
    console.error('[health/ready]', safeErrorSummary(error));
    return json({
      status: 'unavailable',
      checks: { database: false },
      timestamp: new Date().toISOString(),
    }, 503);
  }

  return json({
    status: 'ok',
    checks: { database: true },
    latency_ms: Date.now() - started,
    timestamp: new Date().toISOString(),
  }, 200);
}

function json(body, status) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
