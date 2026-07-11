const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', '..', 'novatareas.db'));

function getUserByTelegramChatId(chatId) {
  return db.prepare('SELECT * FROM users WHERE telegram_chat_id = ?').get(String(chatId));
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ? OR username = ?')
    .get(email.toLowerCase().trim(), email.trim());
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
  const now = Date.now();
  const limit = now + windowMinutes * 60 * 1000;
  return db.prepare(`
    SELECT t.id AS task_id, t.title, t.due_date, u.id AS user_id, u.telegram_chat_id
    FROM tasks t JOIN users u ON t.user_id = u.id
    WHERE u.telegram_chat_id IS NOT NULL
      AND t.reminder_sent = 0 AND t.completed = 0
      AND t.due_date IS NOT NULL
      AND CAST(t.due_date AS INTEGER) >= ?
      AND CAST(t.due_date AS INTEGER) <= ?
  `).all(now, limit);
}

function markReminderSent(taskId) {
  db.prepare('UPDATE tasks SET reminder_sent = 1 WHERE id = ?').run(taskId);
}

module.exports = {
  db,
  getUserByTelegramChatId,
  getUserByEmail,
  linkTelegram,
  getTasksByUser,
  getCategoriesByUser,
  getUsersWithDueTasks,
  markReminderSent,
};