const Database = require('better-sqlite3');
const path     = require('path');

const db = new Database(path.join(__dirname, '..', 'novatareas.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  -- Tabla principal de embeddings
  -- Cada fila corresponde a una tarea archivada de un usuario específico.
  -- El campo "vector" almacena el embedding como JSON (array de floats).
  CREATE TABLE IF NOT EXISTS task_embeddings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL UNIQUE,          -- FK hacia tasks.id
    user_id     INTEGER NOT NULL,                 -- desnormalizado para filtrar rápido
    vector      TEXT    NOT NULL,                 -- JSON: [0.12, -0.34, ...]
    model       TEXT    NOT NULL DEFAULT 'gemini-embedding-004',
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  -- Índice para recuperar todos los embeddings de un usuario sin full-scan
  CREATE INDEX IF NOT EXISTS idx_emb_user ON task_embeddings(user_id);

  -- Índice para verificar si una tarea ya tiene embedding (usado en upsert)
  CREATE UNIQUE INDEX IF NOT EXISTS idx_emb_task ON task_embeddings(task_id);
`);

console.log('✅ Tabla task_embeddings creada correctamente.');
db.close();
