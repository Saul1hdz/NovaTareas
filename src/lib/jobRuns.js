import { db } from './db.js';

/**
 * Marca de vida de los trabajos programados.
 *
 * Un trabajo programado que deja de ejecutarse no produce ningún síntoma: no
 * hay error, no hay reinicio, no hay petición fallida. Solo silencio. Aquí se
 * convierte ese silencio en un dato que envejece, para que una sonda pueda
 * mirarlo.
 */

export const CRON_REMINDERS = 'cron_reminders';

/**
 * Los trabajos que se vigilan, con cada cuánto deberían correr.
 *
 * `staleAfterMinutes` son tres ciclos: con uno solo, cualquier reinicio del
 * contenedor o un barrido que tarde de más dispararía una alerta falsa, y una
 * alerta que se ignora es peor que no tenerla.
 */
export const WATCHED_JOBS = {
  [CRON_REMINDERS]: {
    expectedEveryMinutes: 15,
    staleAfterMinutes: 45,
  },
};

/**
 * Deja constancia de un barrido, haya terminado bien o mal.
 *
 * Nunca lanza: registrar la marca no puede tumbar el trabajo que la produce.
 * Un fallo al escribirla se ve igual que un trabajo muerto —la marca envejece—
 * que es exactamente el lado seguro por el que equivocarse.
 */
export async function recordJobRun(job, { ok, summary = {} }, database = db) {
  try {
    await database.prepare(`
      INSERT INTO job_runs (job, last_run_at, last_ok, last_summary)
      VALUES ($1, NOW(), $2, $3::jsonb)
      ON CONFLICT (job) DO UPDATE SET
        last_run_at = EXCLUDED.last_run_at,
        last_ok = EXCLUDED.last_ok,
        last_summary = EXCLUDED.last_summary
    `).run(job, Boolean(ok), JSON.stringify(summary ?? {}));
  } catch (error) {
    console.error(`[job_runs] No se pudo registrar "${job}":`, error?.code || error?.name || 'error');
  }
}

/** Las marcas guardadas, indexadas por trabajo. */
export async function getJobRuns(database = db) {
  const rows = await database
    .prepare('SELECT job, last_run_at, last_ok, last_summary FROM job_runs')
    .all();
  return new Map(rows.map(row => [row.job, row]));
}

/**
 * Estado de cada trabajo vigilado en un instante dado.
 *
 * La decisión importante está en la rama sin marca: un trabajo que **nunca** se
 * ha ejecutado está `stale`, no `ok`. Ese era el caso real —cero ejecuciones en
 * toda la historia del despliegue—, así que darlo por bueno construiría una
 * sonda que reproduce el fallo que pretende detectar.
 *
 * `reason` dice por qué un trabajo no está sano, y son dos cosas distintas que
 * se investigan en sitios distintos:
 *
 * | `reason`  | Qué pasa | Dónde se mira |
 * |---|---|---|
 * | `stale`   | Lleva demasiado sin ejecutarse, o no lo ha hecho nunca | El crontab del servidor |
 * | `failing` | Se ejecuta puntual, pero el último intento reventó | Los logs de la aplicación |
 * | `null`    | Corrió hace poco y terminó bien | Nada que hacer |
 *
 * Un trabajo que revienta cada ciclo tampoco está haciendo su trabajo: nadie
 * recibe sus avisos, igual que si no existiera. Por eso `failing` también
 * cuenta como no sano, aunque la marca sea de hace dos minutos.
 *
 * Cuando se dan los dos a la vez manda `stale`: si lleva una hora sin
 * ejecutarse, que su último intento fallara es historia vieja.
 */
export function summarizeJobs(marcas, ahora = new Date()) {
  const jobs = {};

  for (const [job, config] of Object.entries(WATCHED_JOBS)) {
    const marca = marcas.get(job);

    if (!marca) {
      jobs[job] = {
        last_run_at: null,
        minutes_ago: null,
        expected_every_minutes: config.expectedEveryMinutes,
        stale: true,
        reason: 'stale',
        last_ok: null,
        last_summary: null,
      };
      continue;
    }

    const lastRunAt = new Date(marca.last_run_at);
    const edadMs = ahora.getTime() - lastRunAt.getTime();
    const stale = edadMs > config.staleAfterMinutes * 60_000;

    jobs[job] = {
      last_run_at: lastRunAt.toISOString(),
      minutes_ago: Math.floor(edadMs / 60_000),
      expected_every_minutes: config.expectedEveryMinutes,
      stale,
      reason: stale ? 'stale' : (marca.last_ok === false ? 'failing' : null),
      last_ok: marca.last_ok,
      last_summary: marca.last_summary ?? null,
    };
  }

  return jobs;
}
