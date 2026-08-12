import { getDb } from '../../../../lib/db.js';
import { getUser } from '../../../../lib/auth.js';
import { parseId } from '../../../../lib/routeParams.js';
import { getTaskAccess, listParticipants } from '../../../../lib/collaboration.js';

export const GET = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const taskId = parseId(params.id);
  if (taskId === null) return json({ error: 'No encontrado' }, 404);

  const db = getDb();

  // Basta con participar en la tarea: propietario o colaborador de cualquier
  // nivel. Quien no participa recibe 404 y no sabe si la tarea existe.
  const access = await getTaskAccess(db, taskId, user.userId);
  if (!access) return json({ error: 'No encontrado' }, 404);

  // Historial de cambios automáticos, con el autor de cada cambio: en una tarea
  // compartida "Estado: pendiente → completada" no dice nada si no se sabe quién.
  const history = await db.prepare(`
    SELECT h.id, h.field, h.old_value, h.new_value, h.changed_at,
           h.user_id AS author_id, u.full_name AS author_name
    FROM task_history h
    LEFT JOIN users u ON u.id = h.user_id
    WHERE h.task_id = $1
    ORDER BY h.changed_at ASC
  `).all(taskId);

  // Comentarios e ideas de todos los participantes
  const comments = await db.prepare(`
    SELECT c.id, c.body, c.kind, c.ai_reply, c.created_at,
           c.user_id AS author_id, u.full_name AS author_name
    FROM task_comments c
    LEFT JOIN users u ON u.id = c.user_id
    WHERE c.task_id = $1
    ORDER BY c.created_at ASC
  `).all(taskId);

  const participants = await listParticipants(db, taskId);

  return json({
    history,
    comments,
    participants,
    task: {
      id: access.task.id,
      title: access.task.title,
      visibility: access.task.visibility,
      owner_id: access.task.user_id,
    },
    my_role: access.role,
    is_owner: access.isOwner,
  }, 200);
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}
