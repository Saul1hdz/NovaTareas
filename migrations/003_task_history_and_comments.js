import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'novatareas.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function columnExists(table, column) {
  const info = db.pragma(`table_info(${table})`);
  return info.some(col => col.name === column);
}

function tableExists(table) {
  return db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(table) != null;
}

db.transaction(() => {

  // ── task_history ─────────────────────────────────────────────────────────
  // Registra cada cambio de campo en la tarea automáticamente
  if (!tableExists('task_history')) {
    db.exec(`
      CREATE TABLE task_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL,
        field      TEXT    NOT NULL,   -- campo que cambió: 'status','priority','due_date','title', etc.
        old_value  TEXT,               -- valor anterior (null si era vacío)
        new_value  TEXT,               -- valor nuevo
        changed_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_task_history_task_id ON task_history(task_id);
    `);
    console.log('✔ Tabla task_history creada');
  } else {
    console.log('  task_history ya existe, se omite');
  }

  // ── task_comments ────────────────────────────────────────────────────────
  // Comentarios manuales del usuario + respuestas de IA
  if (!tableExists('task_comments')) {
    db.exec(`
      CREATE TABLE task_comments (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id      INTEGER NOT NULL,
        body         TEXT    NOT NULL,   -- texto del comentario del usuario
        ai_reply     TEXT,               -- respuesta de IA (null si no se pidió ayuda)
        created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_task_comments_task_id ON task_comments(task_id);
    `);
    console.log('✔ Tabla task_comments creada');
  } else {
    console.log('  task_comments ya existe, se omite');
  }

  // ── tasks: columna archived=0 para reabrir tareas ─────────────────────────
  // Si la tarea ya tenía archived=1, al reabrirla se pone archived=0
  // No se necesita nueva columna, solo aseguramos que status pueda volver a 'pendiente'
  if (!columnExists('tasks', 'reopened_at')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN reopened_at TEXT;`);
    console.log('✔ Columna tasks.reopened_at agregada');
  } else {
    console.log('  tasks.reopened_at ya existe, se omite');
  }

})();

db.close();
console.log('\n✅ Migración 003 completada.');
