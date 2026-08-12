import { getDb } from '../../../../lib/db.js';
import { getUser } from '../../../../lib/auth.js';
import { parseId } from '../../../../lib/routeParams.js';
import { getTaskAccess, listParticipants } from '../../../../lib/collaboration.js';

/** Quiénes participan en la tarea y con qué nivel. Visible para todos ellos. */
export const GET = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const taskId = parseId(params.id);
  if (taskId === null) return json({ error: 'No encontrado' }, 404);

  const db = getDb();
  const access = await getTaskAccess(db, taskId, user.userId);
  if (!access) return json({ error: 'No encontrado' }, 404);

  return json({
    participants: await listParticipants(db, taskId),
    my_role: access.role,
    is_owner: access.isOwner,
    visibility: access.task.visibility,
  }, 200);
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
