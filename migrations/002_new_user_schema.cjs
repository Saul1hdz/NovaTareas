const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'novatareas.db'));

// Limpiar datos existentes
db.exec(`DELETE FROM subtasks;`);
db.exec(`DELETE FROM tasks;`);
db.exec(`DELETE FROM users;`);
console.log('✔ Datos anteriores eliminados');

const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);

if (!userCols.includes('full_name')) {
  db.exec('ALTER TABLE users ADD COLUMN full_name TEXT;');
  console.log('✔ users.full_name agregado');
}
if (!userCols.includes('email')) {
  db.exec('ALTER TABLE users ADD COLUMN email TEXT;');
  console.log('✔ users.email agregado');
}
if (!userCols.includes('user_type')) {
  db.exec("ALTER TABLE users ADD COLUMN user_type TEXT DEFAULT 'comun';");
  console.log('✔ users.user_type agregado');
}
if (!userCols.includes('avatar_url')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT;');
  console.log('✔ users.avatar_url agregado');
}
if (!userCols.includes('telefono')) {
  db.exec('ALTER TABLE users ADD COLUMN telefono TEXT;');
  console.log('✔ users.telefono agregado');
}
if (!userCols.includes('telegram_chat_id')) {
  db.exec('ALTER TABLE users ADD COLUMN telegram_chat_id TEXT;');
  console.log('✔ users.telegram_chat_id agregado');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS security_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    q1_index INTEGER NOT NULL,
    q1_answer TEXT NOT NULL,
    q2_index INTEGER NOT NULL,
    q2_answer TEXT NOT NULL,
    recovery_attempts INTEGER DEFAULT 0,
    last_attempt_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);
console.log('✔ Tabla security_questions creada/verificada');

const taskCols = db.prepare('PRAGMA table_info(tasks)').all().map(c => c.name);

if (!taskCols.includes('observations')) {
  db.exec('ALTER TABLE tasks ADD COLUMN observations TEXT;');
  console.log('✔ tasks.observations agregado');
}
if (!taskCols.includes('what_worked')) {
  db.exec('ALTER TABLE tasks ADD COLUMN what_worked TEXT;');
  console.log('✔ tasks.what_worked agregado');
}
if (!taskCols.includes('what_failed')) {
  db.exec('ALTER TABLE tasks ADD COLUMN what_failed TEXT;');
  console.log('✔ tasks.what_failed agregado');
}
if (!taskCols.includes('reminder_sent')) {
  db.exec('ALTER TABLE tasks ADD COLUMN reminder_sent INTEGER DEFAULT 0;');
  console.log('✔ tasks.reminder_sent agregado');
}

db.close();
console.log('\nMigración 002 completada.');