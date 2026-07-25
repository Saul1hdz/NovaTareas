import { getDb } from '../../../../lib/db.js';
import { getUser } from '../../../../lib/auth.js';
import { parseId } from '../../../../lib/routeParams.js';

export const GET = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const taskId = parseId(params.id);
  if (taskId === null) return json({ error: 'No encontrado' }, 404);

  const db   = getDb();

  // Verificar que la tarea pertenece al usuario
  const task = await db.prepare('SELECT id FROM tasks WHERE id=$1 AND user_id=$2').get(taskId, user.userId);
  if (!task) return json({ error: 'No encontrado' }, 404);

  // Historial de cambios automáticos
  const history = await db.prepare(`
    SELECT id, field, old_value, new_value, changed_at
    FROM task_history
    WHERE task_id = $1
    ORDER BY changed_at ASC
  `).all(taskId);

  // Comentarios del usuario
  const comments = await db.prepare(`
    SELECT id, body, ai_reply, created_at
    FROM task_comments
    WHERE task_id = $1
    ORDER BY created_at ASC
  `).all(taskId);

  return json({ history, comments }, 200);
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}
