import { APP_TIME_ZONE } from './appTime.js';

/**
 * Recordatorios recurrentes por Telegram, con la frecuencia que marca la
 * prioridad de la tarea.
 *
 * Es distinto de lo que ya existía. `reminder_sent` controla un aviso único
 * antes del vencimiento y `overdue_notified` uno único al vencer; esto insiste
 * mientras la tarea siga viva, que es lo que pidió el equipo: cuanto más
 * urgente, más seguido.
 *
 * Dos frenos deliberados, porque «urgente cada hora» son 24 mensajes al día:
 *
 * 1. **Interruptor apagado por defecto.** El bot corre en producción con
 *    usuarios reales; desplegar esto no debe empezar a escribirles solo.
 * 2. **Horas de silencio.** Sin ellas, una tarea urgente avisa a las 3 de la
 *    madrugada. Se calculan en la zona horaria de la aplicación, no en UTC.
 */

/** Horas entre recordatorios para cada prioridad. */
export const DEFAULT_NUDGE_HOURS = {
  urgente: 1,
  alta: 3,
  media: 5,
  baja: 6,
};

const QUIET_FROM_DEFAULT = 22; // 22:00
const QUIET_TO_DEFAULT = 7;    // 07:00

export function nudgesEnabled() {
  return process.env.TASK_NUDGES_ENABLED === 'true';
}

/** Un número de entorno solo se acepta si es un entero razonable. */
function horaValida(valor, porDefecto, { min = 1, max = 168 } = {}) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= min && numero <= max ? numero : porDefecto;
}

export function nudgeHours() {
  return {
    urgente: horaValida(process.env.NUDGE_HOURS_URGENTE, DEFAULT_NUDGE_HOURS.urgente),
    alta: horaValida(process.env.NUDGE_HOURS_ALTA, DEFAULT_NUDGE_HOURS.alta),
    media: horaValida(process.env.NUDGE_HOURS_MEDIA, DEFAULT_NUDGE_HOURS.media),
    baja: horaValida(process.env.NUDGE_HOURS_BAJA, DEFAULT_NUDGE_HOURS.baja),
  };
}

export function quietHours() {
  return {
    from: horaValida(process.env.NUDGE_QUIET_FROM, QUIET_FROM_DEFAULT, { min: 0, max: 23 }),
    to: horaValida(process.env.NUDGE_QUIET_TO, QUIET_TO_DEFAULT, { min: 0, max: 23 }),
  };
}

/**
 * Hora del día (0-23) en la zona de la aplicación, no en la del servidor.
 *
 * `hourCycle: 'h23'` es obligatorio: con `hour12: false` el formateador usa el
 * ciclo h24 y devuelve **24** a medianoche en lugar de 0. Con un tramo de
 * silencio como 00:00-07:00, ese 24 no cae dentro y el bot avisaría justo a
 * medianoche, que es lo contrario de lo que se quiere. El `% 24` deja la
 * garantía escrita aunque cambie la implementación de Intl.
 */
export function hourInAppTimeZone(date = new Date()) {
  const formato = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    hourCycle: 'h23',
  });
  return Number(formato.format(date)) % 24;
}

/**
 * ¿Toca callarse? El tramo cruza la medianoche (22:00 → 07:00), así que no
 * basta con comparar `from <= hora < to`.
 */
export function isQuietHour(date = new Date()) {
  const { from, to } = quietHours();
  if (from === to) return false; // tramo vacío: nunca se calla
  const hora = hourInAppTimeZone(date);
  return from < to
    ? hora >= from && hora < to
    : hora >= from || hora < to;
}

/**
 * Tareas a las que les toca recordatorio.
 *
 * La cuenta arranca en `created_at` cuando todavía no se ha avisado nunca: si
 * arrancara en «nunca», una tarea recién creada recibiría el primer aviso en el
 * siguiente barrido, a los pocos minutos de escribirla.
 */
export async function getTasksNeedingNudge(db, limite = 200) {
  const horas = nudgeHours();
  return db.prepare(`
    SELECT t.id AS task_id, t.title, t.priority, t.due_date, t.last_nudge_at,
           u.id AS user_id, u.telegram_chat_id
    FROM tasks t
    JOIN users u ON u.id = t.user_id
    WHERE u.telegram_chat_id IS NOT NULL
      AND NOT t.archived
      AND NOT t.completed
      AND COALESCE(t.last_nudge_at, t.created_at) <= CURRENT_TIMESTAMP - (
        CASE t.priority
          WHEN 'urgente' THEN $1::int
          WHEN 'alta'    THEN $2::int
          WHEN 'media'   THEN $3::int
          ELSE                $4::int
        END * INTERVAL '1 hour'
      )
    ORDER BY CASE t.priority
               WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4
             END,
             COALESCE(t.last_nudge_at, t.created_at) ASC
    LIMIT $5::int
  `).all(horas.urgente, horas.alta, horas.media, horas.baja, limite);
}

export async function markNudgeSent(db, taskId) {
  await db.prepare(
    'UPDATE tasks SET last_nudge_at = CURRENT_TIMESTAMP WHERE id = $1'
  ).run(taskId);
}
