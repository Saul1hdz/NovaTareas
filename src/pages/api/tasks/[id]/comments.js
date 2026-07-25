import { getDb } from '../../../../lib/db.js';
import { getUser } from '../../../../lib/auth.js';
import { validateCommentInput } from '../../../../lib/taskValidation.js';

const ZAI_API_KEY  = process.env.ZAI_API_KEY?.trim();
const ZAI_URL       = 'https://api.z.ai/api/paas/v4/chat/completions';
const ZAI_MODEL     = process.env.ZAI_MODEL || 'glm-4.5-flash';
const OLLAMA_URL     = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL   = process.env.OLLAMA_MODEL || 'llama3.2:3b';

export const POST = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const db   = getDb();
  const task = await db.prepare(`
    SELECT t.*, u.user_type FROM tasks t
    JOIN users u ON t.user_id = u.id
    WHERE t.id=? AND t.user_id=?
  `).get(params.id, user.userId);
  if (!task) return json({ error: 'No encontrado' }, 404);

  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const validation = validateCommentInput(rawBody);
  if (validation.error) return json({ error: validation.error }, 400);
  const body = validation.values;

  // ── Construir contexto acumulado para la IA ──────────────────────────────
  let aiReply = null;

  if (body.ask_ai) {
    // Historial de cambios
    const history = await db.prepare(`
      SELECT field, old_value, new_value, changed_at
      FROM task_history WHERE task_id=? ORDER BY changed_at ASC
    `).all(params.id);

    // Comentarios previos (sin respuestas de IA para no sobrecargar el prompt)
    const prevComments = await db.prepare(`
      SELECT body, created_at FROM task_comments
      WHERE task_id=? ORDER BY created_at ASC LIMIT 10
    `).all(params.id);

    aiReply = await getContextualAiReply({
      task,
      history,
      prevComments,
      currentComment: body.body,
      userType: task.user_type || 'comun',
    });
  }

  // ── Guardar comentario ───────────────────────────────────────────────────
  const result = await db.prepare(`
    INSERT INTO task_comments (task_id, user_id, body, ai_reply)
    VALUES (?, ?, ?, ?)
  `).run(params.id, user.userId, body.body, aiReply || null);

  const comment = await db.prepare('SELECT * FROM task_comments WHERE id=?').get(result.lastInsertRowid);

  return json({
    id:         comment.id,
    body:       comment.body,
    ai_reply:   comment.ai_reply,
    created_at: comment.created_at,
  }, 201);
};

// ─── IA Contextual ────────────────────────────────────────────────────────────

async function getContextualAiReply({ task, history, prevComments, currentComment, userType }) {

  const typeContext = {
    estudiante: 'El usuario es estudiante. Usa lenguaje motivador y enfocado en técnicas de estudio y organización académica.',
    empleado:   'El usuario es empleado. Usa lenguaje profesional enfocado en productividad y cumplimiento de objetivos laborales.',
    comun:      'El usuario tiene tareas personales. Usa lenguaje cercano y práctico enfocado en organización cotidiana.',
  };

  // Construir resumen del historial de cambios
const historyLines = history.length > 0
  ? history
      .map(
        h =>
          `  - [${h.changed_at}] ${h.field}: "${h.old_value ?? '(vacío)'}" → "${h.new_value ?? '(vacío)'}"`
      )
      .join('\n')
  : '  (sin cambios registrados)';

  // Construir resumen de comentarios previos
  const commentsLines = prevComments.length > 0
    ? prevComments.map(c => `  - [${c.created_at}] "${c.body}"`).join('\n')
    : '  (sin comentarios previos)';

  const prompt =
    `Eres un asistente de productividad experto. ${typeContext[userType] || typeContext.comun}\n\n` +
    `El usuario está trabajando en la siguiente tarea:\n` +
    `  Título: ${task.title}\n` +
    (task.description ? `  Descripción: ${task.description}\n` : '') +
    `  Prioridad: ${task.priority || 'media'}\n` +
    (task.due_date ? `  Fecha límite: ${task.due_date}\n` : '') +
    `  Estado actual: ${task.status || 'pendiente'}\n\n` +
    `Historial de cambios de esta tarea:\n${historyLines}\n\n` +
    `Comentarios previos del usuario sobre esta tarea:\n${commentsLines}\n\n` +
    `Comentario actual del usuario:\n  "${currentComment}"\n\n` +
    `Basándote en TODO el contexto anterior (tarea, historial y comentarios), ` +
    `da una respuesta de ayuda práctica y específica. ` +
    `Máximo 4 oraciones. Sin introducciones. Responde directamente en español.`;

  // 1. z.ai
  if (ZAI_API_KEY) {
    const text = await tryZai(prompt);
    if (text) return text;
  }

  // 2. Ollama
  const ollamaText = await tryOllama(prompt);
  if (ollamaText) return ollamaText;

  // 3. Fallback genérico
  return (
    `Basado en tu progreso: ${currentComment}. ` +
    `Te recomiendo continuar paso a paso y registrar cada avance aquí para mantener el contexto claro.`
  );
}

async function tryZai(prompt) {
  try {
    const res = await fetch(ZAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ZAI_API_KEY}`
      },
      body: JSON.stringify({
        model: ZAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (!res.ok) {
      console.error('[Z.AI] Respuesta no exitosa:', res.status);
      return null;
    }

    const data = await res.json().catch(() => null);
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('[Z.AI] Fallo de red o proveedor');
    return null;
  }
}

async function tryOllama(prompt) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 200,
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json().catch(() => null);
    return data?.response?.trim() || null;
  } catch {
    return null;
  }
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
