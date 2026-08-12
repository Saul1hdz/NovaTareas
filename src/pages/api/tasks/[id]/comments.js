import { getDb } from '../../../../lib/db.js';
import { getUser } from '../../../../lib/auth.js';
import { validateCommentInput } from '../../../../lib/taskValidation.js';
import { parseId } from '../../../../lib/routeParams.js';
import { can, getTaskAccess } from '../../../../lib/collaboration.js';

// Proveedores compartidos: una sola definición de modelo, timeouts y
// respaldos para toda la aplicación.
import { callOllama, callZai } from '../../../../lib/ai/providers.js';

const tryZai = prompt => callZai(prompt);
const tryOllama = prompt => callOllama(prompt);


const ZAI_API_KEY  = process.env.ZAI_API_KEY?.trim();

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

  // El tono de la IA se adapta a quien escribe, no al dueño de la tarea.
  const author = await db.prepare(
    'SELECT user_type, full_name FROM users WHERE id=$1'
  ).get(user.userId);

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
      FROM task_history WHERE task_id=$1 ORDER BY changed_at ASC
    `).all(taskId);

    // Comentarios previos (sin respuestas de IA para no sobrecargar el prompt).
    // En una tarea colaborativa se incluye quién escribió cada uno: sin el autor
    // la IA lee un monólogo donde en realidad hay varias personas discutiendo.
    const prevComments = await db.prepare(`
      SELECT c.body, c.kind, c.created_at, u.full_name AS author_name
      FROM task_comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.task_id=$1 ORDER BY c.created_at ASC LIMIT 10
    `).all(taskId);

    aiReply = await getContextualAiReply({
      task,
      history,
      prevComments,
      currentComment: body.body,
      userType: author?.user_type || 'comun',
      authorName: author?.full_name || 'un colaborador',
      collaborative: task.visibility === 'colaborativa',
    });
  }

  // ── Guardar comentario ───────────────────────────────────────────────────
  // RETURNING * evita el SELECT posterior: una sola ida a la base.
  const comment = await db.prepare(`
    INSERT INTO task_comments (task_id, user_id, body, kind, ai_reply)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `).get(taskId, user.userId, body.body, body.kind, aiReply || null);

  return json({
    id:          comment.id,
    body:        comment.body,
    kind:        comment.kind,
    ai_reply:    comment.ai_reply,
    created_at:  comment.created_at,
    author_id:   user.userId,
    author_name: author?.full_name || null,
  }, 201);
};

// ─── IA Contextual ────────────────────────────────────────────────────────────

async function getContextualAiReply({
  task,
  history,
  prevComments,
  currentComment,
  userType,
  authorName = '',
  collaborative = false,
}) {

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
    ? prevComments.map(c => {
        const who = c.author_name ? `${c.author_name}` : 'alguien';
        const tipo = c.kind === 'idea' ? 'idea' : 'comentario';
        return `  - [${c.created_at}] ${who} (${tipo}): "${c.body}"`;
      }).join('\n')
    : '  (sin comentarios previos)';

  const teamContext = collaborative
    ? `Esta tarea es colaborativa: varias personas aportan ideas y comentarios. ` +
      `Quien escribe ahora es ${authorName}. Ten en cuenta lo que ya propusieron ` +
      `los demás y evita repetir una idea que otro colaborador ya planteó.\n\n`
    : '';

  const prompt =
    `Eres un asistente de productividad experto. ${typeContext[userType] || typeContext.comun}\n\n` +
    teamContext +
    `El usuario está trabajando en la siguiente tarea:\n` +
    `  Título: ${task.title}\n` +
    (task.description ? `  Descripción: ${task.description}\n` : '') +
    `  Prioridad: ${task.priority || 'media'}\n` +
    (task.due_date ? `  Fecha límite: ${task.due_date}\n` : '') +
    `  Estado actual: ${task.status || 'pendiente'}\n\n` +
    `Historial de cambios de esta tarea:\n${historyLines}\n\n` +
    `Comentarios previos sobre esta tarea:\n${commentsLines}\n\n` +
    `Comentario actual${authorName ? ` de ${authorName}` : ''}:\n  "${currentComment}"\n\n` +
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





function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
