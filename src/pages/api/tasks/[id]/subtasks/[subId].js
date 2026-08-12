import { getDb } from '../../../../../lib/db.js';
import { getUser } from '../../../../../lib/auth.js';
import { parseId } from '../../../../../lib/routeParams.js';
import { can, getTaskAccess } from '../../../../../lib/collaboration.js';

export const PATCH = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401 });

  const taskId = parseId(params.id);
  const subId = parseId(params.subId);
  if (taskId === null || subId === null) {
    return new Response(JSON.stringify({ error: 'No encontrado' }), { status: 404 });
  }

  const db = getDb();
  const access = await getTaskAccess(db, taskId, user.userId);
  if (!access) return new Response(JSON.stringify({ error: 'No encontrado' }), { status: 404 });
  if (!can(access, 'edit')) {
    return new Response(
      JSON.stringify({ error: 'Tu nivel en esta tarea no permite marcar subtareas' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const sub = await db.prepare(
    'SELECT id FROM subtasks WHERE id=$1 AND task_id=$2'
  ).get(subId, taskId);

  if (!sub) return new Response(JSON.stringify({ error: 'No encontrado' }), { status: 404 });

  await db.prepare('UPDATE subtasks SET done = NOT done WHERE id=$1 AND task_id=$2')
    .run(subId, taskId);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
