import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPostgresCompatDatabase } from '../db/runtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.join(__dirname, '..', '..', 'novatareas.db');
export const databaseEngine = process.env.DATABASE_ENGINE === 'postgres'
  ? 'postgres'
  : 'sqlite';
export const isPostgres = databaseEngine === 'postgres';
export const db = isPostgres
  ? createPostgresCompatDatabase(process.env.DATABASE_URL?.trim())
  : new Database(path.resolve(process.env.NOVATAREAS_DB_PATH || defaultDbPath));

if (!isPostgres) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

export function getDb() { return db; }

export async function withTransaction(callback, database = db) {
  if (isPostgres) return database.transaction(callback);

  database.exec('BEGIN');
  try {
    const result = await callback(database);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export async function closeDb() {
  if (isPostgres) await db.close();
  else db.close();
}

// ─── Usuarios ─────────────────────────────────────────────────────────────────

export async function getUserById(id) {
  return await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export async function getUserByEmail(email) {
  return await db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
}

export async function getUserByUsername(username) {
  return await db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export async function getUserByTelegramChatId(chatId) {
  return await db.prepare('SELECT * FROM users WHERE telegram_chat_id = ?').get(String(chatId));
}

export async function linkTelegram(userId, chatId) {
  await db.prepare('UPDATE users SET telegram_chat_id = ? WHERE id = ?')
    .run(chatId ? String(chatId) : null, userId);
}

// ─── Preguntas de seguridad ───────────────────────────────────────────────────

export async function getSecurityQuestions(userId) {
  return await db.prepare('SELECT * FROM security_questions WHERE user_id = ?').get(userId);
}

export async function saveSecurityQuestions(userId, q1Index, q1Answer, q2Index, q2Answer) {
  await db.prepare(`
    INSERT INTO security_questions (user_id, q1_index, q1_answer, q2_index, q2_answer)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      q1_index=excluded.q1_index, q1_answer=excluded.q1_answer,
      q2_index=excluded.q2_index, q2_answer=excluded.q2_answer,
      recovery_attempts=0
  `).run(userId, q1Index, q1Answer.toLowerCase().trim(), q2Index, q2Answer.toLowerCase().trim());
}

export async function incrementRecoveryAttempts(userId) {
  await db.prepare(`
    UPDATE security_questions SET recovery_attempts = recovery_attempts + 1, last_attempt_at = ?
    WHERE user_id = ?
  `).run(Date.now(), userId);
}

export async function resetRecoveryAttempts(userId) {
  await db.prepare('UPDATE security_questions SET recovery_attempts = 0 WHERE user_id = ?').run(userId);
}

// ─── Tareas ───────────────────────────────────────────────────────────────────

export async function getTasksByUser(userId) {
  return await db.prepare(`
    SELECT t.*, c.name AS category_name
    FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.user_id = ? ORDER BY t.due_date ASC
  `).all(userId);
}

export async function getTaskById(taskId, userId) {
  return await db.prepare(`
    SELECT t.*, c.name AS category_name
    FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.id = ? AND t.user_id = ?
  `).get(taskId, userId);
}

export async function getArchivedTasksWithObservations(userId) {
  return await db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND archived = 1
    AND (observations IS NOT NULL OR what_worked IS NOT NULL OR what_failed IS NOT NULL)
    ORDER BY created_at DESC
  `).all(userId);
}

export async function getUsersWithDueTasks(windowMinutes = 30) {
  const query = isPostgres ? `
    SELECT t.id AS task_id, t.title, t.due_date,
           u.id AS user_id, u.telegram_chat_id
    FROM tasks t JOIN users u ON t.user_id = u.id
    WHERE u.telegram_chat_id IS NOT NULL
      AND t.reminder_sent = FALSE AND t.completed = FALSE
      AND t.reminder_at IS NOT NULL
      AND t.reminder_at >= CURRENT_TIMESTAMP
      AND t.reminder_at <= CURRENT_TIMESTAMP + (? * INTERVAL '1 minute')
  ` : `
    SELECT t.id AS task_id, t.title, t.due_date,
           u.id AS user_id, u.telegram_chat_id
    FROM tasks t JOIN users u ON t.user_id = u.id
    WHERE u.telegram_chat_id IS NOT NULL
      AND t.reminder_sent = 0 AND t.completed = 0
      AND t.reminder_at IS NOT NULL
      AND datetime(t.reminder_at) >= datetime('now')
      AND datetime(t.reminder_at) <= datetime('now', '+' || ? || ' minutes')
  `;
  return await db.prepare(query).all(windowMinutes);
}

export async function getPendingTasksForUser(userId) {
  return await db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND archived = 0 AND status != 'completada'
    ORDER BY CASE priority WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END,
             due_date ASC
  `).all(userId);
}

export async function markReminderSent(taskId) {
  await db.prepare('UPDATE tasks SET reminder_sent = 1 WHERE id = ?').run(taskId);
}

// ─── Categorías ───────────────────────────────────────────────────────────────

export async function getCategoriesByUser(userId) {
  return await db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY name ASC').all(userId);
}
