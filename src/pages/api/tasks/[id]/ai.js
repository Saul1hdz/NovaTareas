import { getDb }                         from '../../../../lib/db.js';
import { getUser }                       from '../../../../lib/auth.js';
import { getRagContext }                 from '../../../../lib/rag.js';
import { parseId }                     from '../../../../lib/routeParams.js';
import { consumeRateLimit } from '../../../../lib/security.js';
import { can, getTaskAccess } from '../../../../lib/collaboration.js';
import {
  archivedFeedbackContext,
  feedbackForPrompt,
} from '../../../../lib/recommendationFeedback.js';

// Proveedores compartidos: una sola definición de modelo, timeouts y
// respaldos para toda la aplicación.
import { callOllama, callRemote } from '../../../../lib/ai/providers.js';

const tryOllama = prompt => callOllama(prompt);


const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
// Identifica el prompt con el que se generó cada recomendación guardada.
const PROMPT_VERSION = 'task-recommendation-v1';

const RATE_LIMIT_MAX    = Number(process.env.AI_RATE_LIMIT_MAX)    || 5;  // llamadas
const RATE_LIMIT_WINDOW = Number(process.env.AI_RATE_LIMIT_WINDOW) || 5 * 60 * 1000; // ms (5 min)

export const POST = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const db   = getDb();
  const taskId = parseId(params.id);
  if (taskId === null) return json({ error: 'No encontrado' }, 404);

  const access = await getTaskAccess(db, taskId, user.userId);
  if (!access) return json({ error: 'No encontrado' }, 404);
  if (!can(access, 'comment')) {
    return json({ error: 'Tu nivel en esta tarea solo permite leerla' }, 403);
  }
  const task = access.task;

  const rateLimit = await consumeRateLimit(
    'task-ai-user',
    String(user.userId),
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW
  );
  if (!rateLimit.allowed) {
    return json({
      error: `Límite de ${RATE_LIMIT_MAX} recomendaciones cada ${RATE_LIMIT_WINDOW / 60000} minutos alcanzado. Intenta de nuevo más tarde.`
    }, 429, { 'Retry-After': String(rateLimit.retryAfterSeconds) });
  }

  const previas = await feedbackForPrompt(db, taskId, user.userId);
  const saved = await generateForTask(db, task, user.userId, { feedback: previas });
  return json(describeRecommendation(saved), 200);
};

/**
 * Genera y guarda una recomendación para una tarea, devolviendo la fila.
 *
 * Vive aparte del handler porque el endpoint de valoración necesita generar
 * exactamente igual —misma cascada, mismo guardado— pero pasándole lo que el
 * usuario dijo de la recomendación anterior.
 */
export async function generateForTask(db, task, userId, { feedback = [] } = {}) {
  const userRecord = await db.prepare('SELECT user_type FROM users WHERE id=$1').get(userId);
  const userType   = userRecord?.user_type || 'comun';

  // ── RAG: recuperar contexto del historial del usuario ─────────────────────
  // Esta operación indexa tareas sin embedding al vuelo y busca las similares.
  // Si el usuario no tiene historial, ragContext queda vacío y el sistema
  // genera recomendaciones normales sin contexto adicional.
  const ragContext = await getRagContext(userId, task);
  const hasRag     = ragContext.length > 0;

  // Lo que el usuario opinó de los consejos de sus tareas ya archivadas. Es la
  // memoria de largo plazo: sobrevive a la tarea que la originó y evita repetir
  // enfoques que esa persona ya dijo que no le funcionan.
  const aprendido = await archivedFeedbackContext(db, userId);

  const prompt = buildPrompt(task, userType, ragContext, [...feedback, ...aprendido]);

  // ── 1. Proveedores remotos con contexto RAG: OpenRouter, luego z.ai ───────
  const remote = await callRemote(prompt);
  if (remote.text) {
    return saveRecommendation(db, task, userId, remote.text, remote.source, hasRag, remote.model);
  }

  // ── 2. Ollama con contexto RAG ────────────────────────────────────────────
  const ollamaText = await tryOllama(prompt);
  if (ollamaText) return saveRecommendation(db, task, userId, ollamaText, 'ollama', hasRag);

  // ── 3. Historial de tareas archivadas (sin LLM) ───────────────────────────
  const archivedRec = await getRecommendationFromArchived(db, userId, task);
  if (archivedRec) return saveRecommendation(db, task, userId, archivedRec, 'history', false);

  // ── 4. Reglas locales (último recurso) ────────────────────────────────────
  const rec = getRulesRecommendation(
    task.title + (task.description ? ': ' + task.description : ''),
    userType,
    task.priority
  );
  return saveRecommendation(db, task, userId, rec, 'rules', false);
}

// ─── Prompt con contexto RAG inyectado ────────────────────────────────────────

/** Recorta un texto largo: al prompt le basta con reconocer de qué consejo habla. */
function recorte(texto, max = 160) {
  const limpio = String(texto || '').replace(/\s+/g, ' ').trim();
  return limpio.length > max ? `${limpio.slice(0, max)}…` : limpio;
}

export function buildPrompt(task, userType, ragContext, feedback = []) {
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

  // Lo que el usuario opinó del intento anterior. Es la parte más valiosa del
  // prompt: sin ella la IA vuelve a proponer el consejo que ya se descartó.
  const feedbackInstruction = feedback.length > 0
    ? `=== VALORACIÓN DE TUS RECOMENDACIONES ANTERIORES ===\n` +
      feedback.map(f =>
        // Las de otra tarea llevan su título delante: sin eso, la IA no
        // distingue lo que se dijo aquí de lo que se aprendió antes.
        (f.task_title ? `- En «${recorte(f.task_title, 60)}», el consejo ` : '- El consejo ') +
        `«${recorte(f.recommendation)}» le pareció ` +
        `${f.useful ? 'ÚTIL' : 'POCO ÚTIL'}` +
        (f.comment ? `, y explicó: "${f.comment}"` : ', sin explicar por qué') +
        '.'
      ).join('\n') +
      `\n\nGenera una recomendación DISTINTA que corrija lo señalado. No repitas ` +
      `lo que ya se marcó como poco útil. Si la valoración fue positiva, ` +
      `mantén ese enfoque y profundiza.\n\n`
    : '';

  return (
    `Eres un asistente de productividad personal experto. ${typeContext[userType] || typeContext.comun}\n\n` +
    ragInstruction +
    feedbackInstruction +
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




// ─── Recorte de seguridad: nunca dejar una oración a medias ──────────────────
// max_tokens puede cortar el texto en cualquier punto. Si el texto ya termina
// en punto/exclamación/interrogación se deja igual; si no, se recorta hasta el
// último signo de cierre siempre que no se pierda más del 30% del contenido.

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function saveRecommendation(db, task, userId, text, source, usedRag = false, model = null) {
  // Antes esto hacía DELETE + INSERT sobre `subtasks`, así que cada consulta a
  // la IA borraba las subtareas reales que el usuario había escrito. Ahora las
  // recomendaciones tienen su propia tabla y se registra de dónde salió cada
  // una: z.ai, Ollama, el historial archivado o las reglas locales.
  const saved = await db.prepare(`
    INSERT INTO task_recommendations
      (task_id, user_id, source, model, prompt_version, input_snapshot, recommendation)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
    RETURNING id, source, model, recommendation, created_at
  `).get(
    task.id,
    userId,
    source,
    model ?? (source === 'ollama' ? OLLAMA_MODEL : null),
    PROMPT_VERSION,
    JSON.stringify({
      title: task.title,
      priority: task.priority,
      due_date: task.due_date,
      used_rag: usedRag,
    }),
    text,
  );

  return { ...saved, used_rag: usedRag };
}

/** Forma en la que el dashboard espera recibir una recomendación recién hecha. */
export function describeRecommendation(saved) {
  return {
    recommendation: {
      id: saved.id,
      text: saved.recommendation,
      source: saved.source,
      model: saved.model,
      created_at: saved.created_at,
    },
    tip: saved.recommendation,
    source: saved.source,
    rag: Boolean(saved.used_rag),
  };
}

async function getRecommendationFromArchived(db, userId, currentTask) {
  try {
    const archived = await db.prepare(`
      SELECT title, what_worked, what_failed, observations
      FROM tasks
      WHERE user_id = $1 AND archived
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

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...headers }
  });
}
