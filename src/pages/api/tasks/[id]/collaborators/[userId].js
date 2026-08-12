import { getDb } from '../../../../../lib/db.js';
import { getUser } from '../../../../../lib/auth.js';
import { parseId } from '../../../../../lib/routeParams.js';
import {
  can,
  getTaskAccess,
  isCollaboratorRole,
} from '../../../../../lib/collaboration.js';

/** Cambia el nivel de un colaborador. Solo el propietario. */
export const PATCH = async ({ request, params }) => {
  const context = await resolve(request, params);
  if (context.response) return context.response;
  const { db, taskId, targetId, access } = context;

  if (!can(access, 'manage')) {
    return json({ error: 'Solo el propietario puede cambiar los niveles' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  if (!isCollaboratorRole(body?.role)) return json({ error: 'Rol inválido' }, 400);

  const result = await db.prepare(`
    UPDATE task_collaborators SET role = $1, updated_at = NOW()
    WHERE task_id = $2 AND user_id = $3
  `).run(body.role, taskId, targetId);

  if (result.rowCount === 0) return json({ error: 'No encontrado' }, 404);
  return json({ ok: true, role: body.role }, 200);
};

/**
 * Expulsa a un colaborador, o permite que él mismo salga de la tarea.
 * El propietario no puede quitarse a sí mismo: para eso está borrar la tarea.
 */
export const DELETE = async ({ request, params }) => {
  const context = await resolve(request, params);
  if (context.response) return context.response;
  const { db, taskId, targetId, access, user } = context;

  const isSelf = Number(targetId) === Number(user.userId);
  if (!isSelf && !can(access, 'manage')) {
    return json({ error: 'Solo el propietario puede quitar colaboradores' }, 403);
  }
  if (Number(targetId) === Number(access.task.user_id)) {
    return json({ error: 'El propietario no puede salir de su propia tarea' }, 400);
  }

  const result = await db.prepare(
    'DELETE FROM task_collaborators WHERE task_id = $1 AND user_id = $2'
  ).run(taskId, targetId);

  if (result.rowCount === 0) return json({ error: 'No encontrado' }, 404);
  return json({ ok: true }, 200);
};

async function resolve(request, params) {
  const user = await getUser(request);
  if (!user) return { response: json({ error: 'No autenticado' }, 401) };

  const taskId = parseId(params.id);
  const targetId = parseId(params.userId);
  if (taskId === null || targetId === null) {
    return { response: json({ error: 'No encontrado' }, 404) };
  }

  const db = getDb();
  const access = await getTaskAccess(db, taskId, user.userId);
  if (!access) return { response: json({ error: 'No encontrado' }, 404) };

  return { db, taskId, targetId, access, user };
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
