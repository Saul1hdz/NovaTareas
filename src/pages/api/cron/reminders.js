export const prerender = false;

import { db, getUsersWithDueTasks, markReminderSent } from '../../../lib/db.js';
import {
  notifyOverdueTasks,
  notifyReminders,
  notifyTaskNudges,
} from '../../../lib/telegramNotify.js';
import { safeEqualStrings, safeErrorSummary } from '../../../lib/security.js';
import { CRON_REMINDERS, recordJobRun } from '../../../lib/jobRuns.js';

const CRON_SECRET = process.env.CRON_SECRET?.trim();
const REMINDER_WINDOW_MIN = Number(process.env.REMINDER_WINDOW_MINUTES) || 30;

export async function GET({ request }) {
  if (!CRON_SECRET) {
    return json({ error: 'Servicio no configurado' }, 503);
  }

  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match || !safeEqualStrings(match[1], CRON_SECRET)) {
    return json({ error: 'No autorizado' }, 401);
  }

  try {
    const reminded = await notifyReminders(
      getUsersWithDueTasks,
      markReminderSent,
      REMINDER_WINDOW_MIN
    );
    const alerted = await notifyOverdueTasks(db);
    const nudges = await notifyTaskNudges(db);

    console.log(
      `[cron/reminders] Recordatorios: ${reminded} | Vencidas: ${alerted} | `
      + `Recurrentes: ${nudges.sent}${nudges.skipped ? ` (omitidos: ${nudges.skipped})` : ''}`
    );
    // La marca se escribe en los dos caminos, y la escribe el propio barrido
    // en vez de una capa exterior: es la única prueba de que este código llegó
    // a ejecutarse. Sin ella, `/api/v1/health/jobs` no puede distinguir un cron
    // que trabaja de uno que nadie instaló.
    await recordJobRun(CRON_REMINDERS, {
      ok: true,
      summary: {
        reminders_sent: reminded,
        overdue_alerts: alerted,
        recurring_nudges_sent: nudges.sent,
        recurring_nudges_skipped: nudges.skipped || 0,
        window_minutes: REMINDER_WINDOW_MIN,
      },
    });

    return json({
      ok: true,
      reminders_sent: reminded,
      overdue_alerts: alerted,
      recurring_nudges_sent: nudges.sent,
      recurring_nudges_skipped: nudges.skipped || null,
      window_minutes: REMINDER_WINDOW_MIN,
      timestamp: new Date().toISOString(),
    }, 200);
  } catch (error) {
    console.error('[cron/reminders] Error:', safeErrorSummary(error));
    // Un barrido que revienta también deja rastro: si solo se registrara el
    // éxito, un cron que falla siempre se vería igual que uno que no existe.
    // El resumen guarda la clase del error, nunca su mensaje, que puede llevar
    // datos de un usuario.
    await recordJobRun(CRON_REMINDERS, {
      ok: false,
      summary: { error: safeErrorSummary(error) },
    });
    return json({ error: 'Error interno del servidor' }, 500);
  }
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
