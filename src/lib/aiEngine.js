// src/lib/aiEngine.js
// ─────────────────────────────────────────────────────────────────────────────
// Motor de recomendaciones reutilizable, SIN dependencia de base de datos ni
// de sesión de usuario. Recibe los datos de la tarea directamente y devuelve
// una recomendación de texto. Lo consumen tanto el endpoint público
// (/api/v1/recommend) como el endpoint interno del dashboard.
// ─────────────────────────────────────────────────────────────────────────────

export const AI_META = {
  service: 'novatareas-ai',
  version: '1.0.0',
  purpose: 'Genera recomendaciones prácticas de productividad para una tarea.',
  primary_model: process.env.ZAI_MODEL || 'glm-4.5-flash',
  provider: 'z.ai (GLM) con fallback local Ollama y reglas heurísticas',
  language: 'es',
};

const ZAI_API_KEY  = process.env.ZAI_API_KEY?.trim();
const ZAI_URL      = 'https://api.z.ai/api/paas/v4/chat/completions';
const ZAI_MODEL    = process.env.ZAI_MODEL || 'glm-4.5-flash';
const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

const VALID_PRIORITIES = ['baja', 'media', 'alta', 'urgente'];
const VALID_USER_TYPES = ['comun', 'estudiante', 'empleado'];

/**
 * Valida y normaliza el payload de entrada.
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function validateTaskInput(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }

  const title = typeof body.titulo === 'string' ? body.titulo.trim() : '';
  if (!title) {
    return { ok: false, error: 'El campo "titulo" es obligatorio y no puede estar vacío.' };
  }
  if (title.length > 200) {
    return { ok: false, error: 'El campo "titulo" no puede superar los 200 caracteres.' };
  }

  const description = typeof body.descripcion === 'string' ? body.descripcion.trim() : '';
  if (description.length > 1000) {
    return { ok: false, error: 'El campo "descripcion" no puede superar los 1000 caracteres.' };
  }

  let priority = typeof body.prioridad === 'string' ? body.prioridad.toLowerCase().trim() : 'media';
  if (!VALID_PRIORITIES.includes(priority)) {
    return { ok: false, error: `El campo "prioridad" debe ser uno de: ${VALID_PRIORITIES.join(', ')}.` };
  }

  let userType = typeof body.tipo_usuario === 'string' ? body.tipo_usuario.toLowerCase().trim() : 'comun';
  if (!VALID_USER_TYPES.includes(userType)) {
    userType = 'comun';
  }

  let dueDate = null;
  if (body.fecha_limite != null && body.fecha_limite !== '') {
    const parsed = new Date(body.fecha_limite);
    if (isNaN(parsed.getTime())) {
      return { ok: false, error: 'El campo "fecha_limite" no es una fecha válida (usa formato YYYY-MM-DD).' };
    }
    dueDate = String(body.fecha_limite).slice(0, 10);
  }

  return {
    ok: true,
    value: { title, description, priority, userType, dueDate },
  };
}

/**
 * Genera la recomendación. Intenta z.ai → Ollama → reglas locales.
 * @returns {Promise<{text: string, source: string}>}
 */
export async function generateRecommendation(task) {
  const prompt = buildPrompt(task);

  if (ZAI_API_KEY) {
    const text = await tryZai(prompt);
    if (text) return { text, source: 'zai' };
  }

  const ollamaText = await tryOllama(prompt);
  if (ollamaText) return { text: ollamaText, source: 'ollama' };

  return { text: getRulesRecommendation(task), source: 'rules' };
}

function buildPrompt(task) {
  const typeContext = {
    estudiante: 'El usuario es estudiante. Adapta las recomendaciones al contexto académico.',
    empleado:   'El usuario es empleado. Adapta las recomendaciones al contexto laboral.',
    comun:      'El usuario tiene tareas cotidianas. Adapta las recomendaciones a la vida diaria.',
  };
  const hasDesc  = task.description?.trim().length > 0;
  const isSimple = task.priority === 'baja' && (!hasDesc || task.description.trim().length < 60);

  const lengthInstruction = isSimple
    ? `Genera UNA recomendación breve de 1 a 2 oraciones. Ve directo al primer paso concreto, sin rodeos.`
    : `Genera UNA recomendación práctica de 3 a 5 oraciones.`;

  return (
    `Eres un asistente de productividad personal experto. ${typeContext[task.userType] || typeContext.comun}\n\n` +
    `=== TAREA A ANALIZAR ===\n` +
    `Título: ${task.title}\n` +
    (hasDesc ? `Descripción: ${task.description}\n` : '') +
    `Prioridad: ${task.priority}\n` +
    (task.dueDate ? `Fecha límite: ${task.dueDate}\n` : '') +
    `\n${lengthInstruction} Debe:\n` +
    `- Ser ESPECÍFICA a esta tarea, no genérica.\n` +
    `- Incluir un primer paso concreto a tomar ahora mismo.\n` +
    `- Escribir en oraciones CORTAS separadas por punto. Nunca encadenes todo en una sola oración larga con comas.\n` +
    `- Máximo 130 palabras en total.\n\n` +
    `Responde directamente, sin frases introductorias.`
  );
}

async function tryZai(prompt) {
  try {
    const res = await fetch(ZAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ZAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: ZAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 700,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      console.error('[aiEngine/zai] error:', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json().catch(() => null);
    return trimToCompleteSentence(data?.choices?.[0]?.message?.content?.trim() || null);
  } catch (e) {
    console.error('[aiEngine/zai] excepción:', e.message);
    return null;
  }
}

async function isOllamaUp() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

async function tryOllama(prompt) {
  if (!(await isOllamaUp())) return null;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL, prompt, stream: false,
        options: { temperature: 0.7, num_predict: 400 },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return trimToCompleteSentence(data?.response?.trim() || null);
  } catch { return null; }
}

function trimToCompleteSentence(text) {
  if (!text) return text;
  const trimmed = text.trim();
  if (/[.!?…]["')\]]?$/.test(trimmed)) return trimmed;
  const lastEnd = Math.max(trimmed.lastIndexOf('.'), trimmed.lastIndexOf('!'), trimmed.lastIndexOf('?'));
  if (lastEnd > trimmed.length * 0.7) return trimmed.slice(0, lastEnd + 1);
  const lastComma = trimmed.lastIndexOf(',');
  if (lastComma > trimmed.length * 0.5) return trimmed.slice(0, lastComma) + '.';
  return trimmed;
}

function getRulesRecommendation(task) {
  const lower  = (task.title + ' ' + (task.description || '')).toLowerCase();
  if (lower.includes('examen') || lower.includes('prueba'))
    return '📚 Divide el temario en bloques de 25 minutos (Pomodoro). Empieza por el tema que menos dominas. Duerme bien la noche anterior.';
  if (lower.includes('reunión') || lower.includes('junta'))
    return '📋 Prepara una agenda con los 3 puntos clave. Revisa el contexto 30 minutos antes. Define el resultado concreto que necesitas.';
  if (lower.includes('informe') || lower.includes('reporte'))
    return '📝 Escribe primero los títulos de cada sección. Luego un borrador rápido sin editar. Bloquea 1 hora hoy para avanzar la mitad.';

  const prefix = task.priority === 'urgente' ? '⚠️ Urgente: empieza en los próximos 10 minutos. '
    : task.priority === 'alta' ? '🔶 Alta prioridad: bloquea tiempo hoy. ' : '';
  const tips = {
    estudiante: prefix + 'Divide la tarea en partes pequeñas. Empieza por la más difícil. Trabaja 25 minutos sin distracciones.',
    empleado:   prefix + 'Define el resultado esperado en una línea. Bloquea 45 minutos en tu calendario. Comunica tu avance al equipo.',
    comun:      prefix + 'Divide en 3 pasos concretos. Asigna 20 minutos ahora. Prepara todo lo necesario antes de empezar.',
  };
  return tips[task.userType] || tips.comun;
}
