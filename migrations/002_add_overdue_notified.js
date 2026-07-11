const Database = require('better-sqlite3');
const path     = require('path');

const db = new Database(path.join(__dirname, '..', 'novatareas.db'));

try {
  db.prepare(`ALTER TABLE tasks ADD COLUMN overdue_notified INTEGER NOT NULL DEFAULT 0`).run();
  console.log(' Columna overdue_notified agregada correctamente.');
} catch (err) {
  if (err.message.includes('duplicate column name')) {
    console.log('ℹ  La columna overdue_notified ya existe, no se hizo nada.');
  } else {
    console.error(' Error en la migración:', err.message);
    process.exit(1);
  }
}

db.close();
