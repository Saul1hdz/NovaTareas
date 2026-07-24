import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const testDbPath = path.resolve('tmp/vitest-novatareas.sqlite');

export default function setup() {
  mkdirSync(path.dirname(testDbPath), { recursive: true });

  for (const suffix of ['', '-shm', '-wal']) {
    rmSync(`${testDbPath}${suffix}`, { force: true });
  }

  const db = new Database(testDbPath);
  db.pragma('foreign_keys = ON');
  const migrations = readdirSync('migrations/sqlite')
    .filter(name => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const migration of migrations) {
    db.exec(readFileSync(`migrations/sqlite/${migration}`, 'utf8'));
    db.prepare(
      'INSERT INTO schema_migrations (version) VALUES (?)'
    ).run(migration);
  }
  db.close();
}
