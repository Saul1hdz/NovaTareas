/**
 * Migración: Agrega campos telefono y telegram_chat_id a la tabla users,
 * y la columna reminder_sent a la tabla tasks para evitar recordatorios duplicados.
 *
 * Ejecutar con: node migrations/001_add_telefono_telegram.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'novatareas.db');

const db = new Database(DB_PATH);

// Habilitar WAL para mejor concurrencia
db.pragma('journal_mode = WAL');

function columnExists(table, column) {
  const info = db.pragma(`table_info(${table})`);
  return info.some((col) => col.name === column);
}

db.transaction(() => {
  // --- Tabla: users ---
  if (!columnExists('users', 'telefono')) {
    db.exec(`ALTER TABLE users ADD COLUMN telefono TEXT;`);
    console.log('✔ Columna users.telefono agregada');
  } else {
    console.log('  users.telefono ya existe, se omite');
  }

  if (!columnExists('users', 'telegram_chat_id')) {
    db.exec(`ALTER TABLE users ADD COLUMN telegram_chat_id TEXT;`);
    console.log('✔ Columna users.telegram_chat_id agregada');
  } else {
    console.log('  users.telegram_chat_id ya existe, se omite');
  }

  // --- Tabla: tasks ---
  if (!columnExists('tasks', 'reminder_sent')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0;`);
    console.log('✔ Columna tasks.reminder_sent agregada');
  } else {
    console.log('  tasks.reminder_sent ya existe, se omite');
  }
})();

db.close();
console.log('\nMigración completada.');
