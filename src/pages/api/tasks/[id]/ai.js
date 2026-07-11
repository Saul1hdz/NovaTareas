

import { getDb }                         from '../../../../lib/db.js';
import { getUser }                       from '../../../../lib/auth.js';
import { getRagContext, reindexTask }    from '../../../../lib/rag.js';

const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

export const POST = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const db   = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(params.id, user.userId);
  if (!task) return json({ error: 'No encontrado' }, 404);

  const userRecord = db.prepare('SELECT user_type FROM users WHERE id=?').get(user.userId);
  const userType   = userRecord?.user_type || 'comun';
  const geminiKey  = process.env.GEMINI_API_KEY?.trim();

  // ── RAG: recuperar contexto del historial del usuario ─────────────────────
  // Esta operación indexa tareas sin embedding al vuelo y busca las similares.
  // Si el usuario no tiene historial, ragContext queda vacío y el sistema
  // genera recomendaciones normales sin contexto adicional.
  const ragContext = await getRagContext(user.userId, task);
  const hasRag     = ragContext.length > 0;

  // ── Construir prompt (con o sin contexto RAG) ─────────────────────────────
  const prompt = buildPrompt(task, userType, ragContext);

  // ── 1. Gemini con contexto RAG ────────────────────────────────────────────
  if (geminiKey) {
    const text = await tryGemini(prompt, geminiKey);
    if (text) return saveAndReturn(db, params.id, text, hasRag);
  }

  // ── 2. Ollama con contexto RAG ────────────────────────────────────────────
  const ollamaText = await tryOllama(prompt);
  if (ollamaText) return saveAndReturn(db, params.id, ollamaText, hasRag);

  // ── 3. Historial de tareas archivadas (sin LLM) ───────────────────────────
  const archivedRec = getRecommendationFromArchived(db, user.userId, task);
  if (archivedRec) return saveAndReturn(db, params.id, archivedRec, false);

  // ── 4. Reglas locales (último recurso) ────────────────────────────────────
  const rec = getRulesRecommendation(
    task.title + (task.description ? ': ' + task.description : ''),
    userType,
    task.priority
  );
  return saveAndReturn(db, params.id, rec, false);
};

// ─── Prompt con contexto RAG inyectado ────────────────────────────────────────

function buildPrompt(task, userType, ragContext) {
  const typeContext = {
    estudiante: 'El usuario es estudiante. Adapta las recomendaciones al contexto académico.',
    empleado:   'El usuario es empleado. Adapta las recomendaciones al contexto laboral.',
    comun:      'El usuario tiene tareas cotidianas. Adapta las recomendaciones a la vida diaria.',
  };
  const hasDesc = task.description?.trim().length > 0;

  // Si hay contexto RAG, el prompt instruye al LLM a usarlo activamente
  const ragInstruction = ragContext
    ? `A continuación encontrarás el historial de tareas similares que este usuario ya completó.\n` +
      `Úsalo para:\n` +
      `  • Aprovechar estrategias que le funcionaron antes.\n` +
      `  • Advertir sobre errores que ya cometió y debe evitar.\n` +
      `  • Identificar patrones de comportamiento del usuario.\n\n` +
      ragContext
    : '';

  return (
    `Eres un asistente de productividad personal experto. ${typeContext[userType] || typeContext.comun}\n\n` +
    ragInstruction +
    `=== TAREA NUEVA A ANALIZAR ===\n` +
    `Título: ${task.title}\n` +
    (hasDesc ? `Descripción: ${task.description}\n` : '') +
    `Prioridad: ${task.priority || 'media'}\n` +
    (task.due_date ? `Fecha límite: ${task.due_date}\n` : '') +
    `\nGenera UNA recomendación práctica y personalizada de 4 a 6 oraciones. Debe:\n` +
    `- Ser ESPECÍFICA a esta tarea, no genérica.\n` +
    `- Si hay historial, referenciarlo explícitamente ("Como la vez que hiciste X...").\n` +
    `- Incluir un primer paso concreto a tomar ahora mismo.\n` +
    `- Si detectas un patrón negativo en el historial, mencionarlo.\n` +
    `- Terminar SIEMPRE las oraciones. Máximo 180 palabras.\n\n` +
    `Responde directamente, sin frases introductorias.`
  );
}

// ─── Capas de LLM ─────────────────────────────────────────────────────────────

async function tryGemini(prompt, geminiKey) {
  const models = ['gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.0-pro'];
  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 2048, temperature: 0.7 }
          })
        }
      );
      if (response.status === 429 || response.status === 403 || response.status === 404) continue;
      if (!response.ok) continue;
      const data = await response.json().catch(() => null);
      const text = (
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        data?.candidates?.[0]?.content?.text || ''
      ).trim();
      if (text) return text;
    } catch { continue; }
  }
  return null;
}

async function tryOllama(prompt) {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:   OLLAMA_MODEL,
        prompt,
        stream:  false,
        options: { temperature: 0.7, num_predict: 400 }
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    return data?.response?.trim() || null;
  } catch { return null; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function saveAndReturn(db, taskId, text, usedRag = false) {
  const finalText = usedRag
    ? text  // el LLM ya tiene el contexto RAG integrado
    : text;

  db.prepare('DELETE FROM subtasks WHERE task_id=?').run(taskId);
  db.prepare('INSERT INTO subtasks (task_id, text) VALUES (?,?)').run(taskId, finalText);
  const subtasks = db.prepare('SELECT * FROM subtasks WHERE task_id=?').all(taskId);
  return json({ subtasks, tip: finalText, rag: usedRag }, 200);
}

function getRecommendationFromArchived(db, userId, currentTask) {
  try {
    const archived = db.prepare(`
      SELECT title, what_worked, what_failed, observations
      FROM tasks
      WHERE user_id = ? AND archived = 1
        AND (what_worked IS NOT NULL OR what_failed IS NOT NULL OR observations IS NOT NULL)
      ORDER BY id DESC LIMIT 20
    `).all(userId);

    if (!archived.length) return null;

    const words = (currentTask.title + ' ' + (currentTask.description || ''))
      .toLowerCase().split(/\s+/).filter(w => w.length > 3);

    let best = null, bestScore = 0;
    for (const t of archived) {
      const tWords = (t.title || '').toLowerCase().split(/\s+/);
      const score  = words.filter(w => tWords.some(tw => tw.includes(w) || w.includes(tw))).length;
      if (score > bestScore) { bestScore = score; best = t; }
    }

    const source = best || archived[0];
    const parts  = ['📂 Basado en tu historial de tareas similares:'];
    if (source.what_worked)  parts.push(`\n✅ Lo que funcionó antes: ${source.what_worked}`);
    if (source.what_failed)  parts.push(`\n⚠️ Lo que no funcionó: ${source.what_failed}`);
    if (source.observations) parts.push(`\n📝 ${source.observations}`);
    parts.push('\n\n(Recomendación desde tu historial — IA no disponible)');
    return parts.join('');
  } catch { return null; }
}

function getRulesRecommendation(description, userType, priority = 'media') {
  const lower = description.toLowerCase();
  if (lower.includes('examen') || lower.includes('prueba'))
    return '📚 Divide el temario en bloques de 25 minutos (Pomodoro). Empieza por el tema que menos dominas. Duerme bien la noche anterior — el sueño consolida el aprendizaje.';
  if (lower.includes('reunión') || lower.includes('junta'))
    return '📋 Prepara una agenda con los 3 puntos clave y el tiempo para cada uno. Revisa el contexto 30 minutos antes. Define el único resultado concreto que necesitas lograr.';
  if (lower.includes('informe') || lower.includes('reporte'))
    return '📝 Escribe primero los títulos de cada sección. Luego un borrador rápido sin editar. Bloquea al menos 1 hora hoy para avanzar el 50%.';

  const prefix = priority === 'urgente' ? '⚠️ Urgente — empieza en los próximos 10 minutos. '
    : priority === 'alta' ? '🔶 Alta prioridad — bloquea tiempo hoy. ' : '';

  const tips = {
    estudiante: prefix + 'Divide la tarea en partes pequeñas. Empieza por la más difícil. Trabaja 25 minutos sin distracciones.',
    empleado:   prefix + 'Define el resultado esperado en una línea. Bloquea 45 minutos en tu calendario. Comunica tu avance al equipo.',
    comun:      prefix + 'Divide en 3 pasos concretos. Asigna 20 minutos ahora. Prepara todo lo necesario antes de empezar.',
  };
  return tips[userType] || tips.comun;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}