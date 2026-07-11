export const prerender = false;

import { db, getUsersWithDueTasks, markReminderSent } from '../../../lib/db.js';
import { notifyReminders, notifyOverdueTasks } from '../../../lib/telegramNotify.js';

const CRON_SECRET         = process.env.CRON_SECRET;
const REMINDER_WINDOW_MIN = Number(process.env.REMINDER_WINDOW_MINUTES) || 30;

export async function GET({ request }) {
  // ── Verificar secret ───────────────────────────────────────────────────────
  const url    = new URL(request.url);
  const secret = url.searchParams.get('secret');

  if (CRON_SECRET && secret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
  }

  try {
    // ──  Recordatorios de tareas próximas a vencer ───────────────────────
    const reminded = await notifyReminders(
      getUsersWithDueTasks,
      markReminderSent,
      REMINDER_WINDOW_MIN
    );

    // ──  Alertas de tareas vencidas ──────────────────────────────────────
    const alerted = await notifyOverdueTasks(db);

    console.log(`[cron/reminders] Recordatorios: ${reminded} | Vencidas: ${alerted}`);

    return new Response(JSON.stringify({
      ok: true,
      reminders_sent: reminded,
      overdue_alerts: alerted,
      window_minutes: REMINDER_WINDOW_MIN,
      timestamp: new Date().toISOString(),
    }), { status: 200 });

  } catch (err) {
    console.error('[cron/reminders] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
