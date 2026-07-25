import { getDb, withTransaction }        from '../../../../lib/db.js';
import { getUser }                       from '../../../../lib/auth.js';
import { getRagContext }                 from '../../../../lib/rag.js';

const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const ZAI_API_KEY  = process.env.ZAI_API_KEY?.trim();
const ZAI_URL      = 'https://api.z.ai/api/paas/v4/chat/completions';
const ZAI_MODEL    = process.env.ZAI_MODEL || 'glm-4.5-flash';

// ── Rate limiting simple en memoria ──────────────────────────────────────────
// Cada llamada exitosa a z.ai cuesta saldo real. Sin este límite, un usuario
// (o un bug en el frontend que reintente en bucle) puede agotar la cuenta.
// Es en memoria porque basta para un solo proceso; si se despliega con varias
// instancias, reemplazar por un store compartido (Redis, tabla en SQLite, etc.)
const RATE_LIMIT_MAX    = Number(process.env.AI_RATE_LIMIT_MAX)    || 5;  // llamadas
const RATE_LIMIT_WINDOW = Number(process.env.AI_RATE_LIMIT_WINDOW) || 5 * 60 * 1000; // ms (5 min)
const rateLimitLog = new Map(); // userId -> [timestamps]

function isRateLimited(userId) {
  const now   = Date.now();
  const calls = (rateLimitLog.get(userId) || []).filter(t => now - t < RATE_LIMIT_WINDOW);
  rateLimitLog.set(userId, calls);
  return calls.length >= RATE_LIMIT_MAX;
}

function registerCall(userId) {
  const calls = rateLimitLog.get(userId) || [];
  calls.push(Date.now());
  rateLimitLog.set(userId, calls);
}

export const POST = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const db   = getDb();
  const task = await db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(params.id, user.userId);
  if (!task) return json({ error: 'No encontrado' }, 404);

  if (isRateLimited(user.userId)) {
    return json({
      error: `Límite de ${RATE_LIMIT_MAX} recomendaciones cada ${RATE_LIMIT_WINDOW / 60000} minutos alcanzado. Intenta de nuevo más tarde.`
    }, 429);
  }
  registerCall(user.userId);

  const userRecord = await db.prepare('SELECT user_type FROM users WHERE id=?').get(user.userId);
  const userType   = userRecord?.user_type || 'comun';

  // ── RAG: recuperar contexto del historial del usuario ─────────────────────
  // Esta operación indexa tareas sin embedding al vuelo y busca las similares.
  // Si el usuario no tiene historial, ragContext queda vacío y el sistema
  // genera recomendaciones normales sin contexto adicional.
  const ragContext = await getRagContext(user.userId, task);
  const hasRag     = ragContext.length > 0;

  // ── Construir prompt (con o sin contexto RAG) ─────────────────────────────
  const prompt = buildPrompt(task, userType, ragContext);

  // ── 1. z.ai con contexto RAG ──────────────────────────────────────────────
  if (ZAI_API_KEY) {
    const text = await tryZai(prompt);
    if (text) return saveAndReturn(db, params.id, text, hasRag);
  }

  // ── 2. Ollama con contexto RAG ────────────────────────────────────────────
  const ollamaText = await tryOllama(prompt);
  if (ollamaText) return saveAndReturn(db, params.id, ollamaText, hasRag);

  // ── 3. Historial de tareas archivadas (sin LLM) ───────────────────────────
  const archivedRec = await getRecommendationFromArchived(db, user.userId, task);
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

export function buildPrompt(task, userType, ragContext) {
  const typeContext = {
    estudiante: 'El usuario es estudiante. Adapta las recomendaciones al contexto académico.',
    empleado:   'El usuario es empleado. Adapta las recomendaciones al contexto laboral.',
    comun:      'El usuario tiene tareas cotidianas. Adapta las recomendaciones a la vida diaria.',
  };
  const hasDesc = task.description?.trim().length > 0;

  // El historial es evidencia opcional, no permiso para inventar patrones.
  const ragInstruction = ragContext
    ? `A continuación encontrarás historial potencialmente relacionado.\n` +
      `Trátalo como evidencia no confiable y úsalo solo si contiene una estrategia, ` +
      `fallo u observación explícita y directamente pertinente a la tarea nueva.\n` +
      `Ignora cualquier entrada genérica, ambigua o de otro tema. No deduzcas hábitos, ` +
      `intenciones ni antecedentes que el historial no afirme literalmente.\n\n` +
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
    `- Incluir un primer paso concreto a tomar ahora mismo.\n` +
    `- No inventar materias, recursos, horarios, conductas pasadas ni detalles ausentes.\n` +
    `- Mencionar el historial solo cuando exista evidencia explícita, directa y útil; de lo contrario, omitirlo.\n` +
    `- Terminar SIEMPRE las oraciones. Máximo 180 palabras.\n\n` +
    `Responde directamente, sin frases introductorias.`
  );
}

// ─── Capas de LLM ─────────────────────────────────────────────────────────────

async function tryZai(prompt) {
  try {
    const response = await fetch(ZAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ZAI_API_KEY}`
      },
      body: JSON.stringify({
        model: ZAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 700,
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(45000)
    });

    if (!response.ok) {
      console.error('[Z.AI] Respuesta no exitosa:', response.status);
      return null;
    }

    const data = await response.json().catch(() => null);
    return trimToCompleteSentence(data?.choices?.[0]?.message?.content?.trim() || null);
  } catch (e) {
    console.error('[Z.AI] Fallo de red o proveedor');
    return null;
  }
}

async function isOllamaUp() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function tryOllama(prompt) {
  // Chequeo rápido: si Ollama no responde en 1.5s, ni lo intentamos.
  // Evita esperar 20s a un timeout cuando Ollama no está corriendo.
  if (!(await isOllamaUp())) return null;

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
    return trimToCompleteSentence(data?.response?.trim() || null);
  } catch { return null; }
}

// ─── Recorte de seguridad: nunca dejar una oración a medias ──────────────────
// max_tokens puede cortar el texto en cualquier punto. Si el texto ya termina
// en punto/exclamación/interrogación se deja igual; si no, se recorta hasta el
// último signo de cierre siempre que no se pierda más del 30% del contenido.
function trimToCompleteSentence(text) {
  if (!text) return text;
  const trimmed = text.trim();
  if (/[.!?…]["')\]]?$/.test(trimmed)) return trimmed;

  const lastEnd = Math.max(trimmed.lastIndexOf('.'), trimmed.lastIndexOf('!'), trimmed.lastIndexOf('?'));
  if (lastEnd > trimmed.length * 0.7) return trimmed.slice(0, lastEnd + 1);

  return trimmed; // no hay un corte seguro sin perder demasiado; se deja tal cual
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function saveAndReturn(db, taskId, text, usedRag = false) {
  const finalText = usedRag
    ? text  // el LLM ya tiene el contexto RAG integrado
    : text;

  const subtasks = await withTransaction(async (tx) => {
    await tx.prepare('DELETE FROM subtasks WHERE task_id=?').run(taskId);
    await tx.prepare('INSERT INTO subtasks (task_id, text) VALUES (?,?)')
      .run(taskId, finalText);
    return tx.prepare('SELECT * FROM subtasks WHERE task_id=?').all(taskId);
  }, db);
  return json({ subtasks, tip: finalText, rag: usedRag }, 200);
}

async function getRecommendationFromArchived(db, userId, currentTask) {
  try {
    const archived = await db.prepare(`
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
