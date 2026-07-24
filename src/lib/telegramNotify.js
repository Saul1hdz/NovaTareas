import { safeErrorSummary } from './security.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE  = `https://api.telegram.org/bot${BOT_TOKEN}`;

function escapeTelegramHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Utilidad base ────────────────────────────────────────────────────────────

async function sendMessage(chatId, text) {
  if (!chatId || !BOT_TOKEN) return;
  try {
    const res = await fetch(`${API_BASE}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) {
      console.error('[telegramNotify] Telegram rechazó sendMessage:', res.status);
    }
  } catch (err) {
    console.error('[telegramNotify] Fallo de red');
  }
}

// Formatea "YYYY-MM-DD" o timestamp en texto legible
function formatDate(due_date) {
  if (!due_date) return null;
  try {
    // Si es número (timestamp ms) o string numérico
    if (!isNaN(Number(due_date))) {
      return new Date(Number(due_date)).toLocaleDateString('es-SV', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
    }
    // Si es "YYYY-MM-DD"
    const [y, m, d] = String(due_date).split('-');
    return new Date(y, m - 1, d).toLocaleDateString('es-SV', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return String(due_date);
  }
}

const PRIORITY_EMOJI = {
  urgente: '🔴',
  alta:    '🟠',
  media:   '🟡',
  baja:    '🟢',
};

// ─── 1. Nueva tarea ───────────────────────────────────────────────────────────

/**
 * Llama esto después de insertar una tarea nueva.
 * @param {string|number} chatId  - telegram_chat_id del usuario
 * @param {object} task           - { title, description, priority, due_date }
 */
export async function notifyTaskCreated(chatId, task) {
  const { title, description, priority = 'media', due_date } = task;
  const emoji    = PRIORITY_EMOJI[priority] || '🟡';
  const dateLine = due_date ? `\n📅 Vence: <b>${formatDate(due_date)}</b>` : '';
  const descLine = description ? `\n📄 ${escapeTelegramHtml(description)}` : '';

  await sendMessage(
    chatId,
    `🆕 <b>Tarea creada</b>\n\n` +
    `📌 ${escapeTelegramHtml(title)}${descLine}${dateLine}\n` +
    `${emoji} Prioridad: <b>${escapeTelegramHtml(priority)}</b>`
  );
}

// ─── 2. Tarea completada ──────────────────────────────────────────────────────

/**
 * Llama esto cuando el usuario marca una tarea como "completada".
 * @param {string|number} chatId
 * @param {object} task - { title, due_date }
 */
export async function notifyTaskCompleted(chatId, task) {
  const { title, due_date } = task;
  const dateLine = due_date ? ` (vencía el ${formatDate(due_date)})` : '';

  await sendMessage(
    chatId,
    `✅ <b>¡Tarea completada!</b>\n\n` +
    `📌 <b>${escapeTelegramHtml(title)}</b>${dateLine}\n\n` +
    `¡Buen trabajo! Sigue así 💪`
  );
}

// ─── 3. Tarea urgente ─────────────────────────────────────────────────────────

/**
 * Llama esto cuando una tarea se marca como prioridad "urgente"
 * o cuando se crea directamente como urgente.
 * @param {string|number} chatId
 * @param {object} task - { title, description, due_date }
 */
export async function notifyTaskUrgent(chatId, task) {
  const { title, description, due_date } = task;
  const dateLine = due_date
    ? `\n📅 Vence: <b>${formatDate(due_date)}</b>`
    : '\n📅 Sin fecha límite definida';
  const descLine = description ? `\n📄 ${escapeTelegramHtml(description)}` : '';

  await sendMessage(
    chatId,
    `🔴 <b>¡Tarea urgente!</b>\n\n` +
    `Esta tarea necesita tu atención inmediata:\n\n` +
    `📌 <b>${escapeTelegramHtml(title)}</b>${descLine}${dateLine}\n\n` +
    `⚡ Prioridad: <b>URGENTE</b> — actúa cuanto antes.`
  );
}

// ─── 4. Recordatorios de vencimiento próximo (para cron job) ─────────────────

/**
 * Envía recordatorios a usuarios con tareas próximas a vencer.
 * Ejecutar cada X minutos mediante un endpoint protegido o script externo.
 *
 * Requiere importar getUsersWithDueTasks y markReminderSent desde db.js.
 *
 * @param {Function} getUsersWithDueTasks - función de db.js
 * @param {Function} markReminderSent     - función de db.js
 * @param {number}   windowMinutes        - ventana de anticipación (default: 30)
 */
export async function notifyReminders(getUsersWithDueTasks, markReminderSent, windowMinutes = 30) {
  const dueTasks = getUsersWithDueTasks(windowMinutes);

  for (const row of dueTasks) {
    const formatted = formatDate(row.due_date);
    try {
      await sendMessage(
        row.telegram_chat_id,
        `⏰ <b>Recordatorio</b>\n\n` +
        `Tu tarea vence pronto:\n\n` +
        `📌 <b>${escapeTelegramHtml(row.title)}</b>\n` +
        `🗓️ Vence: <b>${formatted}</b>\n\n` +
        `¡No olvides completarla a tiempo!`
      );
      markReminderSent(row.task_id);
    } catch (err) {
      console.error('[telegramNotify] Error recordatorio:', safeErrorSummary(err));
    }
  }

  return dueTasks.length;
}

// ─── 5. Alertas de tareas vencidas (para cron job) ───────────────────────────

/**
 * Envía alertas de tareas que ya vencieron y no fueron completadas.
 * Llama esto desde el mismo cron job que notifyReminders.
 *
 * @param {import('better-sqlite3').Database} db - instancia de la DB
 */
export async function notifyOverdueTasks(db) {
  const now = new Date();
  // Calcular "hoy" como string YYYY-MM-DD
  const todayStr = now.toISOString().slice(0, 10);

  const overdue = db.prepare(`
    SELECT t.id AS task_id, t.title, t.due_date, t.priority,
           u.telegram_chat_id
    FROM tasks t
    JOIN users u ON t.user_id = u.id
    WHERE u.telegram_chat_id IS NOT NULL
      AND t.completed = 0
      AND t.archived  = 0
      AND t.overdue_notified = 0
      AND t.due_date IS NOT NULL
      AND t.due_date < ?
  `).all(todayStr);

  for (const row of overdue) {
    const emoji = PRIORITY_EMOJI[row.priority] || '🟡';
    try {
      await sendMessage(
        row.telegram_chat_id,
        `🔴 <b>Tarea vencida</b>\n\n` +
        `La siguiente tarea ya pasó su fecha límite:\n\n` +
        `📌 <b>${escapeTelegramHtml(row.title)}</b>\n` +
        `📅 Venció: <b>${formatDate(row.due_date)}</b>\n` +
        `${emoji} Prioridad: <b>${escapeTelegramHtml(row.priority)}</b>\n\n` +
        `⚠️ Complétala o reagéndala desde el dashboard.`
      );
      // Marcar para no volver a notificar
      db.prepare('UPDATE tasks SET overdue_notified = 1 WHERE id = ?').run(row.task_id);
    } catch (err) {
      console.error('[telegramNotify] Error vencida:', safeErrorSummary(err));
    }
  }

  return overdue.length;
}
