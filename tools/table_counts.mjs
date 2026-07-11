import { getDb } from '../src/lib/db.js';
const db = getDb();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
for (const t of tables) {
  const row = db.prepare(`SELECT COUNT(*) as c FROM ${t.name}`).get();
  console.log(`${t.name}: ${row.c}`);
}
