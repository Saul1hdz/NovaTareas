import { getDb } from '../../../../../lib/db.js';
import { getUser } from '../../../../../lib/auth.js';
import { parseId } from '../../../../../lib/routeParams.js';

export const PATCH = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401 });

  const taskId = parseId(params.id);
  const subId = parseId(params.subId);
  if (taskId === null || subId === null) {
    return new Response(JSON.stringify({ error: 'No encontrado' }), { status: 404 });
  }

  const db = getDb();
  const sub = await db.prepare(`
    SELECT s.* FROM subtasks s
    JOIN tasks t ON t.id=s.task_id
    WHERE s.id=$1 AND s.task_id=$2 AND t.user_id=$3
  `).get(subId, taskId, user.userId);

  if (!sub) return new Response(JSON.stringify({ error: 'No encontrado' }), { status: 404 });

  await db.prepare('UPDATE subtasks SET done = NOT done WHERE id=$1 AND task_id=$2')
    .run(subId, taskId);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
