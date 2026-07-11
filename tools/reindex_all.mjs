import Database from 'better-sqlite3';
import fs       from 'fs';
import path     from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k?.trim() && !process.env[k.trim()])
      process.env[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
  });
}

const GEMINI_KEY     = process.env.GEMINI_API_KEY?.trim();
const OLLAMA_URL     = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL   = 'nomic-embed-text';

const db = new Database(path.join(__dirname, '..', 'novatareas.db'));
db.pragma('journal_mode = WAL');

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
            model: 'models/text-embedding-004',
            content: { parts: [{ text: clean }] },
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
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: clean }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.embedding) return { vec: data.embedding, model: OLLAMA_MODEL };
    }
  } catch {}
  return null;
}

function buildText(task) {
  return [
    task.title,
    task.description,
    task.what_worked  ? `Lo que funcionó: ${task.what_worked}`  : '',
    task.what_failed  ? `Lo que falló: ${task.what_failed}`     : '',
    task.observations ? `Observaciones: ${task.observations}`   : '',
    task.priority     ? `Prioridad: ${task.priority}`           : '',
  ].filter(Boolean).join('. ');
}

async function main() {
  const pending = db.prepare(`
    SELECT t.*
    FROM tasks t
    LEFT JOIN task_embeddings e ON e.task_id = t.id
    WHERE t.archived = 1
      AND e.task_id IS NULL
      AND (t.description IS NOT NULL OR t.what_worked IS NOT NULL
           OR t.what_failed IS NOT NULL OR t.observations IS NOT NULL)
    ORDER BY t.user_id, t.id
  `).all();

  console.log(`📦 Tareas sin embedding: ${pending.length}`);
  if (!pending.length) { console.log('✅ Todo ya está indexado.'); return; }

  let ok = 0, fail = 0;
  for (const task of pending) {
    const text   = buildText(task);
    const result = await generateEmbedding(text);
    if (result) {
      db.prepare(`
        INSERT INTO task_embeddings (task_id, user_id, vector, model)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET vector=excluded.vector, model=excluded.model, updated_at=unixepoch()
      `).run(task.id, task.user_id, JSON.stringify(result.vec), result.model);
      ok++;
      process.stdout.write(`  ✅ [user=${task.user_id}] "${task.title.slice(0,40)}"\n`);
    } else {
      fail++;
      process.stdout.write(`  ⚠️  [user=${task.user_id}] "${task.title.slice(0,40)}" — sin embedding\n`);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\n📊 Indexadas: ${ok} | Fallidas: ${fail}`);
  db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
