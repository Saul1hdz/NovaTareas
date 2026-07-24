import 'dotenv/config';
import { sendReminders } from '../src/lib/telegramBot.js';
import { safeErrorSummary } from '../src/lib/security.js';

const WINDOW_MINUTES = parseInt(process.env.REMINDER_WINDOW_MINUTES || '30', 10);

(async () => {
  try {
    console.log(`[scheduler] ${new Date().toISOString()} - Verificando tareas próximas (ventana: ${WINDOW_MINUTES} min)`);
    await sendReminders(WINDOW_MINUTES);
    console.log('[scheduler] Listo.');
  } catch (err) {
    console.error('[scheduler] Error:', safeErrorSummary(err));
    process.exit(1);
  }
})();
