const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const defaultDbPath = path.join(__dirname, '..', '..', 'novatareas.db');
const db = new Database(path.resolve(process.env.NOVATAREAS_DB_PATH || defaultDbPath));

function getUserByTelegramChatId(chatId) {
  return db.prepare('SELECT * FROM users WHERE telegram_chat_id = ?').get(String(chatId));
}

function linkTelegram(userId, chatId) {
  db.prepare('UPDATE users SET telegram_chat_id = ? WHERE id = ?')
    .run(chatId ? String(chatId) : null, userId);
}

function getTasksByUser(userId) {
  return db.prepare(`
    SELECT t.*, c.name AS category_name
    FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.user_id = ? ORDER BY t.due_date ASC
  `).all(userId);
}

function getCategoriesByUser(userId) {
  return db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY name ASC').all(userId);
}

function getUsersWithDueTasks(windowMinutes = 30) {
  return db.prepare(`
    SELECT t.id AS task_id, t.title, t.due_date, u.id AS user_id, u.telegram_chat_id
    FROM tasks t JOIN users u ON t.user_id = u.id
    WHERE u.telegram_chat_id IS NOT NULL
      AND t.reminder_sent = 0 AND t.completed = 0
      AND t.reminder_at IS NOT NULL
      AND datetime(t.reminder_at) >= datetime('now')
      AND datetime(t.reminder_at) <= datetime('now', '+' || ? || ' minutes')
  `).all(windowMinutes);
}

function consumeTelegramLinkCode(code, chatId) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{8}$/.test(normalized) || !process.env.SECRET_KEY) return null;

  const codeHash = crypto
    .createHmac('sha256', process.env.SECRET_KEY)
    .update(normalized)
    .digest('hex');
  const now = Date.now();

  return db.transaction(() => {
    const row = db.prepare(`
      SELECT c.id AS code_id, u.*
      FROM telegram_link_codes c
      JOIN users u ON u.id = c.user_id
      WHERE c.code_hash = ?
        AND c.used_at IS NULL
        AND c.expires_at >= ?
    `).get(codeHash, now);
    if (!row) return null;

    db.prepare('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ?')
      .run(String(chatId));
    db.prepare('UPDATE users SET telegram_chat_id = ? WHERE id = ?')
      .run(String(chatId), row.id);
    db.prepare('UPDATE telegram_link_codes SET used_at = ? WHERE id = ?')
      .run(now, row.code_id);

    return row;
  })();
}

function markReminderSent(taskId) {
  db.prepare('UPDATE tasks SET reminder_sent = 1 WHERE id = ?').run(taskId);
}

module.exports = {
  db,
  getUserByTelegramChatId,
  linkTelegram,
  consumeTelegramLinkCode,
  getTasksByUser,
  getCategoriesByUser,
  getUsersWithDueTasks,
  markReminderSent,
};
