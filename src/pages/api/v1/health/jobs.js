import { getJobRuns, summarizeJobs } from '../../../../lib/jobRuns.js';
import { safeErrorSummary } from '../../../../lib/security.js';

export const prerender = false;

/**
 * Sonda del estado de los trabajos programados.
 *
 * `/api/v1/health/ready` comprueba que el servicio puede responder; esta
 * comprueba que además está haciendo su trabajo. Son cosas distintas: el cron
 * de recordatorios estuvo meses sin ejecutarse con la aplicación en verde,
 * porque un trabajo programado muerto no produce errores, produce silencio.
 *
 * Responde 503 en cuanto un trabajo se queda atrás, para que un vigilante
 * externo lo detecte con `curl -f` sin necesidad de leer el JSON. El aviso lo
 * da ese vigilante y no la propia aplicación: quien avisa no puede ser quien
 * está caído.
 *
 * No requiere autenticación, igual que `/api/v1/health/ready`: solo publica
 * marcas de tiempo y contadores, nunca datos de usuarios.
 */
export async function GET() {
  let jobs;
  try {
    jobs = summarizeJobs(await getJobRuns());
  } catch (error) {
    console.error('[health/jobs]', safeErrorSummary(error));
    return json({
      status: 'unavailable',
      error: 'No se pudo consultar el estado de los trabajos programados',
      timestamp: new Date().toISOString(),
    }, 503);
  }

  const stale = Object.values(jobs).some(job => job.stale);

  return json({
    status: stale ? 'stale' : 'ok',
    jobs,
    timestamp: new Date().toISOString(),
  }, stale ? 503 : 200);
}

function json(body, status) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
