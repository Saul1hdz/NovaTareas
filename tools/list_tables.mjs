import { getDb } from '../src/lib/db.js';

const db = getDb();
const rows = db.prepare("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all();
console.log('Found objects:');
rows.forEach(r => console.log(r.name));
