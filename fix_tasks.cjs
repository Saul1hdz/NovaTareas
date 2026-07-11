const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'novatareas.db'));

const cols = db.prepare('PRAGMA table_info(tasks)').all().map(c => c.name);
console.log('Columnas actuales:', cols);

if (!cols.includes('category_id')) {
  db.exec('ALTER TABLE tasks ADD COLUMN category_id INTEGER;');
  console.log('✔ category_id agregado');
}
if (!cols.includes('priority')) {
  db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'media';");
  console.log('✔ priority agregado');
}
if (!cols.includes('completed')) {
  db.exec('ALTER TABLE tasks ADD COLUMN completed INTEGER DEFAULT 0;');
  console.log('✔ completed agregado');
}
if (!cols.includes('reminder_sent')) {
  db.exec('ALTER TABLE tasks ADD COLUMN reminder_sent INTEGER DEFAULT 0;');
  console.log('✔ reminder_sent agregado');
}
if (!cols.includes('archived')) {
  db.exec('ALTER TABLE tasks ADD COLUMN archived INTEGER DEFAULT 0;');
  console.log('✔ archived agregado');
}
if (!cols.includes('archived_at')) {
  db.exec('ALTER TABLE tasks ADD COLUMN archived_at TEXT;');
  console.log('✔ archived_at agregado');
}
if (!cols.includes('observations')) {
  db.exec('ALTER TABLE tasks ADD COLUMN observations TEXT;');
  console.log('✔ observations agregado');
}
if (!cols.includes('what_worked')) {
  db.exec('ALTER TABLE tasks ADD COLUMN what_worked TEXT;');
  console.log('✔ what_worked agregado');
}
if (!cols.includes('what_failed')) {
  db.exec('ALTER TABLE tasks ADD COLUMN what_failed TEXT;');
  console.log('✔ what_failed agregado');
}

db.close();
console.log('✔ Listo');