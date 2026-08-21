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
 * Responde 503 en cuanto un trabajo deja de estar sano —porque se quedó atrás o
 * porque su último intento reventó—, para que un vigilante externo lo detecte
 * con `curl -f` sin necesidad de leer el JSON. El aviso lo da ese vigilante y
 * no la propia aplicación: quien avisa no puede ser quien está caído.
 *
 * `status` y el `reason` de cada trabajo separan los dos motivos, que se
 * investigan en sitios distintos: `stale` manda a mirar el crontab del
 * servidor y `failing` los logs de la aplicación. Un fallo pasajero —un
 * timeout de Telegram— pondrá esto en rojo durante un ciclo y se resolverá
 * solo quince minutos después; ese ruido es el precio aceptado por no ser
 * ciego ante un fallo permanente, y por eso no hay contador de intentos
 * consecutivos que lo suavice.
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

  const motivos = Object.values(jobs).map(job => job.reason);
  // El orden importa: un trabajo que no corre tapa a uno que corre y falla,
  // porque es el que hay que investigar primero.
  const status = motivos.includes('stale')
    ? 'stale'
    : (motivos.includes('failing') ? 'failing' : 'ok');

  return json({
    status,
    jobs,
    timestamp: new Date().toISOString(),
  }, status === 'ok' ? 200 : 503);
}

function json(body, status) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
