import { getDb } from '../../../../lib/db.js';
import { getUser } from '../../../../lib/auth.js';
import { parseId } from '../../../../lib/routeParams.js';
import { can, getTaskAccess } from '../../../../lib/collaboration.js';
import { validateFeedbackInput } from '../../../../lib/taskValidation.js';
import { consumeRateLimit } from '../../../../lib/security.js';
import { describeRecommendation, generateForTask } from './ai.js';
import { feedbackForPrompt } from '../../../../lib/recommendationFeedback.js';

/**
 * Valoración de las recomendaciones de IA de una tarea.
 *
 * Cada persona valora **su** recomendación: desde la corrección de privacidad,
 * el listado solo devuelve a cada quien la que pidió, así que la valoración
 * sigue el mismo criterio y nadie ve ni puntúa el consejo de otro.
 */

const RATE_LIMIT_MAX    = Number(process.env.AI_RATE_LIMIT_MAX)    || 5;
const RATE_LIMIT_WINDOW = Number(process.env.AI_RATE_LIMIT_WINDOW) || 5 * 60 * 1000;

export const GET = async ({ request, params }) => {
  const contexto = await resolver(request, params, 'view');
  if (contexto.response) return contexto.response;
  const { db, taskId, user } = contexto;

  const actual = await recomendacionActual(db, taskId, user.userId);
  const historial = await db.prepare(`
    SELECT f.id, f.recommendation_id, f.useful, f.comment, f.created_at, f.updated_at,
           r.recommendation, r.source
    FROM recommendation_feedback f
    JOIN task_recommendations r ON r.id = f.recommendation_id
    WHERE f.task_id = $1 AND f.user_id = $2
    ORDER BY f.created_at DESC
    LIMIT 20
  `).all(taskId, user.userId);

  return json({
    recommendation: actual
      ? { id: actual.id, text: actual.recommendation, source: actual.source }
      : null,
    // Valoración de la recomendación que está viendo ahora mismo, si ya opinó.
    current_feedback: actual
      ? historial.find(f => Number(f.recommendation_id) === Number(actual.id)) || null
      : null,
    history: historial,
  }, 200);
};

export const POST = async ({ request, params }) => {
  const contexto = await resolver(request, params, 'comment');
  if (contexto.response) return contexto.response;
  const { db, taskId, user, access } = contexto;

  let crudo;
  try {
    crudo = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const validacion = validateFeedbackInput(crudo);
  if (validacion.error) return json({ error: validacion.error }, 400);
  const { useful, comment, regenerate } = validacion.values;

  const actual = await recomendacionActual(db, taskId, user.userId);
  if (!actual) {
    return json({
      error: 'Esta tarea todavía no tiene una recomendación tuya que valorar. Pulsa «Consejos» primero.',
    }, 409);
  }

  // Volver a valorar corrige la opinión anterior en vez de acumular veredictos
  // contradictorios de la misma persona sobre el mismo consejo.
  const guardada = await db.prepare(`
    INSERT INTO recommendation_feedback (recommendation_id, task_id, user_id, useful, comment)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (recommendation_id, user_id) DO UPDATE
      SET useful = EXCLUDED.useful,
          comment = EXCLUDED.comment,
          updated_at = NOW()
    RETURNING id, useful, comment, created_at, updated_at
  `).get(actual.id, taskId, user.userId, useful, comment);

  if (!regenerate) {
    return json({ ok: true, feedback: guardada, recommendation: null }, 201);
  }

  // Generar de nuevo cuesta una llamada al proveedor externo, así que paga la
  // misma cuota que el botón de consejos.
  const limite = await consumeRateLimit(
    'task-ai-user',
    String(user.userId),
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW,
  );
  if (!limite.allowed) {
    return json({
      ok: true,
      feedback: guardada,
      recommendation: null,
      warning: `Tu valoración se guardó, pero alcanzaste el límite de ${RATE_LIMIT_MAX} `
        + `recomendaciones cada ${RATE_LIMIT_WINDOW / 60000} minutos. `
        + `Inténtalo de nuevo más tarde.`,
    }, 429, { 'Retry-After': String(limite.retryAfterSeconds) });
  }

  const previas = await feedbackForPrompt(db, taskId, user.userId);
  const nueva = await generateForTask(db, access.task, user.userId, { feedback: previas });

  return json({ ok: true, feedback: guardada, ...describeRecommendation(nueva) }, 201);
};

// ─── Apoyo ───────────────────────────────────────────────────────────────────

/** La recomendación vigente de este usuario en esta tarea. */
async function recomendacionActual(db, taskId, userId) {
  return db.prepare(`
    SELECT id, recommendation, source
    FROM task_recommendations
    WHERE task_id = $1 AND user_id = $2
    ORDER BY created_at DESC
    LIMIT 1
  `).get(taskId, userId);
}

async function resolver(request, params, capacidad) {
  const user = await getUser(request);
  if (!user) return { response: json({ error: 'No autenticado' }, 401) };

  const taskId = parseId(params.id);
  if (taskId === null) return { response: json({ error: 'No encontrado' }, 404) };

  const db = getDb();
  const access = await getTaskAccess(db, taskId, user.userId);
  if (!access) return { response: json({ error: 'No encontrado' }, 404) };
  if (!can(access, capacidad)) {
    return {
      response: json({ error: 'Tu nivel en esta tarea solo permite leerla' }, 403),
    };
  }

  return { db, taskId, user, access };
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
