const GEMINI_KEY     = process.env.GEMINI_API_KEY?.trim();
const OLLAMA_URL     = process.env.OLLAMA_URL    || 'http://localhost:11434';
const OLLAMA_EMB_MODEL = process.env.OLLAMA_EMB_MODEL || 'nomic-embed-text'; // modelo de embedding local
const TOP_K          = 5;   // cuántas tareas similares recuperar
const MIN_SIMILARITY = 0.25; // similitud mínima para considerar relevante

// ───  Generación de embeddings ──────────────────────────────────────────────

export async function generateEmbedding(text) {
  const clean = text.trim().slice(0, 2000); // límite de tokens seguro

  // Gemini embeddings
  if (GEMINI_KEY) {
    const vec = await tryGeminiEmbedding(clean);
    if (vec) return vec;
  }

  // Ollama embeddings (requiere: ollama pull nomic-embed-text)
  const vec = await tryOllamaEmbedding(clean);
  return vec; // puede ser null si Ollama tampoco está disponible
}

async function tryGeminiEmbedding(text) {
  // Modelos de embedding de Gemini en orden de preferencia
  const models = ['text-embedding-004', 'embedding-001'];
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GEMINI_KEY}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model:   `models/${model}`,
            content: { parts: [{ text }] },
            taskType: 'RETRIEVAL_DOCUMENT',
          }),
        }
      );
      // 404 = modelo no disponible con esta clave, probar el siguiente
      if (res.status === 404 || res.status === 429 || res.status === 403) continue;
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      return data?.embedding?.values || null;
    } catch {
      continue;
    }
  }
  return null; // todos los modelos de Gemini fallaron → Ollama toma el relevo
}

async function tryOllamaEmbedding(text) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMB_MODEL, prompt: text }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.embedding || null;
  } catch {
    return null;
  }
}

// ───  Similitud coseno ───────────────────────────────────────────────────────

/**
 * Calcula la similitud coseno entre dos vectores.
 * Retorna un valor entre -1 (opuesto) y 1 (idéntico).
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ───  Indexación de tareas archivadas ───────────────────────────────────────

/**
 * Construye el texto representativo de una tarea para embedding.
 * Combina los campos más relevantes para capturar el significado completo.
 */
function buildTaskText(task) {
  return [
    task.title,
    task.description,
    task.what_worked   ? `Lo que funcionó: ${task.what_worked}`   : '',
    task.what_failed   ? `Lo que falló: ${task.what_failed}`       : '',
    task.observations  ? `Observaciones: ${task.observations}`     : '',
    task.priority      ? `Prioridad: ${task.priority}`             : '',
    task.label         ? `Categoría: ${task.label}`                : '',
  ].filter(Boolean).join('. ');
}

/**
 * Persiste un embedding en la base de datos (INSERT OR REPLACE).
 * Si la tarea ya tenía embedding lo actualiza.
 */
function saveEmbedding(db, taskId, userId, vector, model) {
  db.prepare(`
    INSERT INTO task_embeddings (task_id, user_id, vector, model, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(task_id) DO UPDATE SET
      vector     = excluded.vector,
      model      = excluded.model,
      updated_at = unixepoch()
  `).run(taskId, userId, JSON.stringify(vector), model);
}

/**
 * Indexa todas las tareas archivadas de un usuario que aún no tienen embedding.
 * Se llama una vez por usuario la primera vez que usa RAG.
 * Las siguientes llamadas son instantáneas (ya están indexadas).
 */
export async function indexArchivedTasks(userId) {
  const db = getDb();

  // Tareas archivadas con al menos un campo de aprendizaje
  const toIndex = db.prepare(`
    SELECT t.*
    FROM tasks t
    LEFT JOIN task_embeddings e ON e.task_id = t.id
    WHERE t.user_id   = ?
      AND t.archived  = 1
      AND e.task_id   IS NULL
      AND (
        t.what_worked  IS NOT NULL OR
        t.what_failed  IS NOT NULL OR
        t.observations IS NOT NULL OR
        t.description  IS NOT NULL
      )
    ORDER BY t.id DESC
    LIMIT 200
  `).all(userId);

  if (!toIndex.length) return 0;

  let indexed = 0;
  for (const task of toIndex) {
    const text   = buildTaskText(task);
    const vector = await generateEmbedding(text);
    if (!vector) continue; // si no hay embedding disponible, saltar

    const model = GEMINI_KEY ? 'text-embedding-004' : OLLAMA_EMB_MODEL;
    saveEmbedding(db, task.id, userId, vector, model);
    indexed++;
  }

  return indexed;
}

// ───  Búsqueda por similitud semántica ─────────────────────────────────────

/**
 * Recupera las TOP_K tareas más similares a la tarea nueva.
 * NUNCA mezcla tareas de otros usuarios.
 */
export async function findSimilarTasks(userId, queryText, topK = TOP_K) {
  const db = getDb();

  // Generar embedding de la consulta
  const queryVector = await generateEmbedding(queryText);

  // Si no hay embedding disponible, fallback a búsqueda por palabras clave
  if (!queryVector) {
    return fallbackKeywordSearch(db, userId, queryText, topK);
  }

  // Recuperar todos los embeddings del usuario (solo del usuario)
  const rows = db.prepare(`
    SELECT e.task_id, e.vector,
           t.title, t.description, t.priority, t.label,
           t.what_worked, t.what_failed, t.observations,
           t.due_date, t.status
    FROM task_embeddings e
    JOIN tasks t ON t.id = e.task_id
    WHERE e.user_id = ?
      AND t.archived = 1
    ORDER BY e.updated_at DESC
    LIMIT 500
  `).all(userId);

  if (!rows.length) return [];

  // Calcular similitud coseno contra cada embedding almacenado
  const scored = rows.map(row => {
    let storedVector;
    try { storedVector = JSON.parse(row.vector); } catch { return null; }
    const similarity = cosineSimilarity(queryVector, storedVector);
    return { ...row, similarity };
  }).filter(r => r && r.similarity >= MIN_SIMILARITY);

  // Ordenar por similitud descendente y retornar las mejores
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}

/**
 * Búsqueda por palabras clave cuando no hay embeddings disponibles.
 * Fallback seguro que sigue el principio de aislamiento por usuario.
 */
function fallbackKeywordSearch(db, userId, queryText, topK) {
  const words = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (!words.length) return [];

  const archived = db.prepare(`
    SELECT title, description, priority, label,
           what_worked, what_failed, observations, due_date, status
    FROM tasks
    WHERE user_id = ? AND archived = 1
      AND (what_worked IS NOT NULL OR what_failed IS NOT NULL OR observations IS NOT NULL)
    ORDER BY id DESC
    LIMIT 100
  `).all(userId);

  return archived
    .map(task => {
      const text  = buildTaskText(task).toLowerCase();
      const score = words.filter(w => text.includes(w)).length;
      return { ...task, similarity: score / words.length };
    })
    .filter(t => t.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

// ───  Constructor de contexto RAG ───────────────────────────────────────────

export function buildRagContext(similarTasks) {
  if (!similarTasks.length) return '';

  const lines = ['=== HISTORIAL RELEVANTE DEL USUARIO ===\n'];

  similarTasks.forEach((task, i) => {
    lines.push(`--- Tarea similar ${i + 1} (similitud: ${(task.similarity * 100).toFixed(0)}%) ---`);
    lines.push(`Título: ${task.title}`);
    if (task.description) lines.push(`Descripción: ${task.description}`);
    if (task.priority)    lines.push(`Prioridad: ${task.priority}`);

    if (task.what_worked)  lines.push(`✅ Lo que funcionó: ${task.what_worked}`);
    if (task.what_failed)  lines.push(`❌ Lo que falló: ${task.what_failed}`);
    if (task.observations) lines.push(`📝 Observaciones: ${task.observations}`);
    lines.push('');
  });

  lines.push('=== FIN DEL HISTORIAL ===\n');
  return lines.join('\n');
}

// ───  Pipeline RAG completo ─────────────────────────────────────────────────

/**

 * @param {number} userId   - ID del usuario autenticado
 * @param {object} task     - Tarea nueva (title, description, priority)
 * @returns {string}        - Bloque de contexto para inyectar en el prompt
 */
export async function getRagContext(userId, task) {
  try {
    // Indexar tareas que aún no tienen embedding (operación idempotente)
    await indexArchivedTasks(userId);

    // Texto de consulta: combina título y descripción de la tarea nueva
    const queryText = buildTaskText(task);

    // Buscar las más similares
    const similar = await findSimilarTasks(userId, queryText);

    if (!similar.length) return ''; // sin historial, sin contexto RAG

    return buildRagContext(similar);
  } catch (err) {
    console.error('[RAG] Error en pipeline:', err);
    return ''; // fallo silencioso — el sistema sigue funcionando sin RAG
  }
}

// ───  Función para re-indexar una tarea al editarla ─────────────────────────


export async function reindexTask(taskId, userId) {
  const db   = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(taskId, userId);
  if (!task || !task.archived) return;

  const text   = buildTaskText(task);
  const vector = await generateEmbedding(text);
  if (!vector)  return;

  const model = GEMINI_KEY ? 'text-embedding-004' : OLLAMA_EMB_MODEL;
  saveEmbedding(db, taskId, userId, vector, model);
}
