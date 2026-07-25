import { createDatabase } from '../db/client.js';

export const db = createDatabase(process.env.DATABASE_URL?.trim());

export function getDb() { return db; }

export async function withTransaction(callback, database = db) {
  return database.transaction(callback);
}

export async function closeDb() {
  await db.close();
}

// ─── Usuarios ─────────────────────────────────────────────────────────────────

export async function getUserById(id) {
  return await db.prepare('SELECT * FROM users WHERE id = $1').get(id);
}

export async function getUserByEmail(email) {
  return await db.prepare('SELECT * FROM users WHERE email = $1').get(email.toLowerCase().trim());
}

export async function getUserByUsername(username) {
  return await db.prepare('SELECT * FROM users WHERE username = $1').get(username);
}

export async function getUserByTelegramChatId(chatId) {
  return await db.prepare('SELECT * FROM users WHERE telegram_chat_id = $1').get(String(chatId));
}

export async function linkTelegram(userId, chatId) {
  await db.prepare('UPDATE users SET telegram_chat_id = $1 WHERE id = $2')
    .run(chatId ? String(chatId) : null, userId);
}

// ─── Preguntas de seguridad ───────────────────────────────────────────────────

export async function getSecurityQuestions(userId) {
  return await db.prepare('SELECT * FROM security_questions WHERE user_id = $1').get(userId);
}

export async function saveSecurityQuestions(userId, q1Index, q1Answer, q2Index, q2Answer) {
  await db.prepare(`
    INSERT INTO security_questions (user_id, q1_index, q1_answer, q2_index, q2_answer)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT(user_id) DO UPDATE SET
      q1_index=excluded.q1_index, q1_answer=excluded.q1_answer,
      q2_index=excluded.q2_index, q2_answer=excluded.q2_answer,
      recovery_attempts=0
  `).run(userId, q1Index, q1Answer.toLowerCase().trim(), q2Index, q2Answer.toLowerCase().trim());
}

export async function incrementRecoveryAttempts(userId) {
  await db.prepare(`
    UPDATE security_questions
    SET recovery_attempts = recovery_attempts + 1, last_attempt_at = NOW()
    WHERE user_id = $1
  `).run(userId);
}

export async function resetRecoveryAttempts(userId) {
  await db.prepare('UPDATE security_questions SET recovery_attempts = 0 WHERE user_id = $1').run(userId);
}

// ─── Tareas ───────────────────────────────────────────────────────────────────

export async function getTasksByUser(userId) {
  // NULLS LAST explícito: PostgreSQL coloca los nulos al final en ASC y SQLite
  // los ponía primero. Se fija el criterio para que no dependa del motor.
  return await db.prepare(`
    SELECT t.*, c.name AS category_name
    FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.user_id = $1 ORDER BY t.due_date ASC NULLS LAST
  `).all(userId);
}

export async function getTaskById(taskId, userId) {
  return await db.prepare(`
    SELECT t.*, c.name AS category_name
    FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.id = $1 AND t.user_id = $2
  `).get(taskId, userId);
}

export async function getArchivedTasksWithObservations(userId) {
  return await db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = $1 AND archived
    AND (observations IS NOT NULL OR what_worked IS NOT NULL OR what_failed IS NOT NULL)
    ORDER BY created_at DESC
  `).all(userId);
}

export async function getUsersWithDueTasks(windowMinutes = 30) {
  // El cast de $1 es obligatorio: sin él PostgreSQL no puede resolver el
  // operador entre un parámetro sin tipo y INTERVAL.
  return await db.prepare(`
    SELECT t.id AS task_id, t.title, t.due_date,
           u.id AS user_id, u.telegram_chat_id
    FROM tasks t JOIN users u ON t.user_id = u.id
    WHERE u.telegram_chat_id IS NOT NULL
      AND NOT t.reminder_sent AND NOT t.completed
      AND t.reminder_at IS NOT NULL
      AND t.reminder_at >= CURRENT_TIMESTAMP
      AND t.reminder_at <= CURRENT_TIMESTAMP + ($1::int * INTERVAL '1 minute')
  `).all(windowMinutes);
}

export async function getPendingTasksForUser(userId) {
  return await db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = $1 AND NOT archived AND status != 'completada'
    ORDER BY CASE priority WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END,
             due_date ASC NULLS LAST
  `).all(userId);
}

export async function markReminderSent(taskId) {
  await db.prepare('UPDATE tasks SET reminder_sent = TRUE WHERE id = $1').run(taskId);
}

// ─── Categorías ───────────────────────────────────────────────────────────────

export async function getCategoriesByUser(userId) {
  return await db.prepare('SELECT * FROM categories WHERE user_id = $1 ORDER BY name ASC').all(userId);
}
