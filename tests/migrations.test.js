import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';

const freshDbPath = path.resolve('tmp/migration-fresh.sqlite');
const legacyDbPath = path.resolve('tmp/migration-legacy.sqlite');

function removeDatabase(databasePath) {
  for (const suffix of ['', '-shm', '-wal']) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

function runMigration(databasePath) {
  return spawnSync(process.execPath, ['migrations/run.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, NOVATAREAS_DB_PATH: databasePath },
    encoding: 'utf8',
  });
}

describe('migrador SQLite seguro', () => {
  beforeEach(() => {
    removeDatabase(freshDbPath);
    removeDatabase(legacyDbPath);
  });

  it('crea el esquema y puede repetirse sin duplicar migraciones', () => {
    expect(runMigration(freshDbPath).status).toBe(0);
    expect(runMigration(freshDbPath).status).toBe(0);

    const db = new Database(freshDbPath);
    expect(db.prepare('SELECT COUNT(*) AS total FROM schema_migrations').get().total)
      .toBe(2);
    expect(db.prepare(
      "SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = 'tasks'"
    ).get().total).toBe(1);
    expect(db.prepare(
      "SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = 'telegram_link_codes'"
    ).get().total).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('quick_check', { simple: true })).toBe('ok');
    db.close();
  });

  it('rechaza una base heredada y conserva sus datos', () => {
    const db = new Database(legacyDbPath);
    db.exec('CREATE TABLE legacy_data (id INTEGER PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO legacy_data (value) VALUES (?)').run('conservar');
    db.close();

    const result = runMigration(legacyDbPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tablas heredadas sin historial');

    const unchanged = new Database(legacyDbPath);
    expect(unchanged.prepare('SELECT value FROM legacy_data').get().value)
      .toBe('conservar');
    expect(unchanged.prepare(
      "SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
    ).get().total).toBe(0);
    unchanged.close();
  });
});
