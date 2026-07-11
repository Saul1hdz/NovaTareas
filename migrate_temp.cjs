const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('novatareas.db');

const cols = db.prepare('PRAGMA table_info(users)').all();
const names = cols.map(c => c.name);

if (!names.includes('telefono')) {
  db.exec('ALTER TABLE users ADD COLUMN telefono TEXT');
  console.log('✔ telefono agregado');
} else {
  console.log('  telefono ya existe');
}

if (!names.includes('telegram_chat_id')) {
  db.exec('ALTER TABLE users ADD COLUMN telegram_chat_id TEXT');
  console.log('✔ telegram_chat_id agregado');
} else {
  console.log('  telegram_chat_id ya existe');
}

const cols2 = db.prepare('PRAGMA table_info(tasks)').all();
const names2 = cols2.map(c => c.name);

if (!names2.includes('reminder_sent')) {
  db.exec('ALTER TABLE tasks ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0');
  console.log('✔ reminder_sent agregado');
} else {
  console.log('  reminder_sent ya existe');
}

db.close();
console.log('Migracion completada.');