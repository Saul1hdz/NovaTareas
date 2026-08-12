import { getDb } from '../../../../../lib/db.js';
import { getUser } from '../../../../../lib/auth.js';
import { parseId } from '../../../../../lib/routeParams.js';
import { can, getTaskAccess } from '../../../../../lib/collaboration.js';

/** Revoca un enlace concreto sin tocar los demás. */
export const DELETE = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const taskId = parseId(params.id);
  const inviteId = parseId(params.inviteId);
  if (taskId === null || inviteId === null) return json({ error: 'No encontrado' }, 404);

  const db = getDb();
  const access = await getTaskAccess(db, taskId, user.userId);
  if (!access) return json({ error: 'No encontrado' }, 404);
  if (!can(access, 'manage')) {
    return json({ error: 'Solo el propietario puede revocar invitaciones' }, 403);
  }

  const result = await db.prepare(`
    UPDATE task_invites SET revoked_at = NOW()
    WHERE id = $1 AND task_id = $2 AND revoked_at IS NULL
  `).run(inviteId, taskId);

  if (result.rowCount === 0) return json({ error: 'No encontrado' }, 404);
  return json({ ok: true }, 200);
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
