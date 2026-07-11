import { getDb } from '../../../../lib/db.js';
import { getUser } from '../../../../lib/auth.js';

export const GET = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const db   = getDb();

  // Verificar que la tarea pertenece al usuario
  const task = db.prepare('SELECT id FROM tasks WHERE id=? AND user_id=?').get(params.id, user.userId);
  if (!task) return json({ error: 'No encontrado' }, 404);

  // Historial de cambios automáticos
  const history = db.prepare(`
    SELECT id, field, old_value, new_value, changed_at
    FROM task_history
    WHERE task_id = ?
    ORDER BY changed_at ASC
  `).all(params.id);

  // Comentarios del usuario
  const comments = db.prepare(`
    SELECT id, body, ai_reply, created_at
    FROM task_comments
    WHERE task_id = ?
    ORDER BY created_at ASC
  `).all(params.id);

  return json({ history, comments }, 200);
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}
