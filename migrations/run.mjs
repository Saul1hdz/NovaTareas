import Database from 'better-sqlite3';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'sqlite'
);
const databasePath = path.resolve(
  process.env.NOVATAREAS_DB_PATH || path.join(process.cwd(), 'novatareas.db')
);
const databaseExisted = existsSync(databasePath);
const db = new Database(databasePath);

try {
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  const existingTables = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(row => row.name);

  if (existingTables.length > 0 && !existingTables.includes('schema_migrations')) {
    throw new Error(
      'La base contiene tablas heredadas sin historial. Se rechazó la migración para no modificar datos.'
    );
  }

  const migrationFiles = readdirSync(migrationsDirectory)
    .filter(name => /^\d+_.+\.sql$/.test(name))
    .sort();

  for (const filename of migrationFiles) {
    const alreadyApplied = existingTables.includes('schema_migrations')
      ? db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(filename)
      : null;
    if (alreadyApplied) continue;

    const sql = readFileSync(path.join(migrationsDirectory, filename), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_migrations (version) VALUES (?)'
      ).run(filename);
    })();

    console.log(`Aplicada: ${filename}`);
  }

  const foreignKeyProblems = db.pragma('foreign_key_check');
  const integrity = db.pragma('quick_check', { simple: true });
  if (foreignKeyProblems.length > 0 || integrity !== 'ok') {
    throw new Error('La verificación de integridad de SQLite no fue satisfactoria.');
  }

  console.log(`Base preparada correctamente: ${databasePath}`);
} catch (error) {
  if (!databaseExisted) {
    db.close();
    // El archivo vacío o parcialmente creado queda sin tablas por la transacción.
  }
  console.error(`Migración cancelada: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (db.open) db.close();
}
