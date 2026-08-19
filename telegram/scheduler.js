import 'dotenv/config';
import { db, getUsersWithDueTasks, markReminderSent } from '../src/lib/db.js';
import { safeErrorSummary } from '../src/lib/security.js';
import {
  notifyOverdueTasks,
  notifyReminders,
  notifyTaskNudges,
} from '../src/lib/telegramNotify.js';

const WINDOW_MINUTES = parseInt(process.env.REMINDER_WINDOW_MINUTES || '30', 10);

(async () => {
  try {
    console.log(`[scheduler] ${new Date().toISOString()} - Verificando tareas próximas (ventana: ${WINDOW_MINUTES} min)`);
    const reminded = await notifyReminders(
      getUsersWithDueTasks,
      markReminderSent,
      WINDOW_MINUTES
    );
    const alerted = await notifyOverdueTasks(db);
    // Recordatorios recurrentes por prioridad. Devuelve `skipped` cuando están
    // desactivados o cuando toca callarse, para que el log lo explique en vez
    // de parecer que no había nada que enviar.
    const nudges = await notifyTaskNudges(db);
    console.log(
      `[scheduler] Listo. Recordatorios: ${reminded} | Vencidas: ${alerted} | `
      + `Recurrentes: ${nudges.sent}${nudges.skipped ? ` (omitidos: ${nudges.skipped})` : ''}`
    );
  } catch (err) {
    console.error('[scheduler] Error:', safeErrorSummary(err));
    process.exit(1);
  }
})();
