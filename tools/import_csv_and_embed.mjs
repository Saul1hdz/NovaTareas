import Database from 'better-sqlite3';
import fs       from 'fs';
import path     from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

// Cargar .env manualmente (sin dotenv en tools)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k?.trim() && !process.env[k.trim()]) {
      process.env[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  });
}

const GEMINI_KEY     = process.env.GEMINI_API_KEY?.trim();
const OLLAMA_URL     = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_EMB_MODEL = 'nomic-embed-text';
const CSV_PATH       = path.join(__dirname, '..', 'data', 'tareas_ejemplo.csv');
const DB_PATH        = path.join(__dirname, '..', 'novatareas.db');

// ─── DB ───────────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Leer CSV ─────────────────────────────────────────────────────────────────
function parseCSV(filePath) {
  const lines  = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    // Manejar comas dentro de campos entre comillas
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
      else { current += char; }
    }
    values.push(current.trim());
    return Object.fromEntries(headers.map((h, i) => [h.trim(), values[i] || '']));
  });
}

// ─── Embeddings ───────────────────────────────────────────────────────────────
async function generateEmbedding(text) {
  const clean = text.trim().slice(0, 2000);
  if (GEMINI_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model:    'models/text-embedding-004',
            content:  { parts: [{ text: clean }] },
            taskType: 'RETRIEVAL_DOCUMENT',
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.embedding?.values) return { vec: data.embedding.values, model: 'text-embedding-004' };
      }
    } catch {}
  }
  // Fallback: Ollama local
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMB_MODEL, prompt: clean }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.embedding) return { vec: data.embedding, model: OLLAMA_EMB_MODEL };
    }
  } catch {}
  return null;
}

function buildTaskText(row) {
  return [
    row.titulo,
    row.descripcion,
    row.que_salio_bien   ? `Lo que funcionó: ${row.que_salio_bien}`  : '',
    row.que_salio_mal    ? `Lo que falló: ${row.que_salio_mal}`       : '',
    row.observaciones    ? `Observaciones: ${row.observaciones}`      : '',
    row.prioridad        ? `Prioridad: ${row.prioridad}`              : '',
  ].filter(Boolean).join('. ');
}

// ─── Importar CSV a la BD ─────────────────────────────────────────────────────
function importTaskForUser(userId, row) {
  // Verificar si ya existe (evitar duplicados)
  const exists = db.prepare(
    `SELECT id FROM tasks WHERE user_id=? AND title=? AND archived=1`
  ).get(userId, row.titulo);
  if (exists) return exists.id;

  const result = db.prepare(`
    INSERT INTO tasks
      (user_id, title, description, priority, label,
       what_worked, what_failed, observations,
       archived, status, created_at, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'completada', unixepoch(), unixepoch())
  `).run(
    userId,
    row.titulo       || 'Sin título',
    row.descripcion  || null,
    row.prioridad    || 'media',
    row.etiqueta     || null,
    row.que_salio_bien  || null,
    row.que_salio_mal   || null,
    row.observaciones   || null,
  );
  return result.lastInsertRowid;
}

function saveEmbedding(taskId, userId, vector, model) {
  db.prepare(`
    INSERT INTO task_embeddings (task_id, user_id, vector, model)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      vector=excluded.vector, model=excluded.model, updated_at=unixepoch()
  `).run(taskId, userId, JSON.stringify(vector), model);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Determinar usuario(s) destino
  const arg = process.argv[2];
  let users;
  if (!arg || arg === '0' || arg === 'all') {
    users = db.prepare('SELECT id, username FROM users ORDER BY id').all();
  } else {
    const u = db.prepare('SELECT id, username FROM users WHERE id=?').get(parseInt(arg, 10));
    if (!u) { console.error(`❌ Usuario con id=${arg} no encontrado.`); process.exit(1); }
    users = [u];
  }

  if (!users.length) { console.error('❌ No hay usuarios en la base de datos.'); process.exit(1); }

  // Verificar que existe la tabla de embeddings
  const tableExists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='task_embeddings'`
  ).get();
  if (!tableExists) {
    console.error('❌ La tabla task_embeddings no existe. Ejecuta primero: node migrations/003_add_embeddings.cjs');
    process.exit(1);
  }

  const rows = parseCSV(CSV_PATH);
  console.log(`📄 CSV leído: ${rows.length} tareas.`);

  for (const user of users) {
    console.log(`\n👤 Importando para usuario: ${user.username} (id=${user.id})`);
    let imported = 0, embedded = 0, skipped = 0;

    for (const row of rows) {
      const taskId = importTaskForUser(user.id, row);

      // Verificar si ya tiene embedding
      const hasEmb = db.prepare('SELECT id FROM task_embeddings WHERE task_id=?').get(taskId);
      if (hasEmb) { skipped++; continue; }

      const text   = buildTaskText(row);
      const result = await generateEmbedding(text);

      if (result) {
        saveEmbedding(taskId, user.id, result.vec, result.model);
        embedded++;
        process.stdout.write(`  ✅ "${row.titulo.slice(0, 40)}" → embedding (${result.model})\n`);
      } else {
        process.stdout.write(`  ⚠️  "${row.titulo.slice(0, 40)}" → sin embedding (API no disponible)\n`);
      }
      imported++;

      // Pequeña pausa para no saturar la API
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`  📊 Resumen: ${imported} importadas, ${embedded} con embedding, ${skipped} ya existían.`);
  }

  console.log('\n🎉 Importación completada.');
  db.close();
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });
