export const prerender = false;

import { db, getUsersWithDueTasks, markReminderSent } from '../../../lib/db.js';
import { notifyReminders, notifyOverdueTasks } from '../../../lib/telegramNotify.js';
import { safeEqualStrings, safeErrorSummary } from '../../../lib/security.js';

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

    console.log(`[cron/reminders] Recordatorios: ${reminded} | Vencidas: ${alerted}`);
    return json({
      ok: true,
      reminders_sent: reminded,
      overdue_alerts: alerted,
      window_minutes: REMINDER_WINDOW_MIN,
      timestamp: new Date().toISOString(),
    }, 200);
  } catch (error) {
    console.error('[cron/reminders] Error:', safeErrorSummary(error));
    return json({ error: 'Error interno del servidor' }, 500);
  }
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
