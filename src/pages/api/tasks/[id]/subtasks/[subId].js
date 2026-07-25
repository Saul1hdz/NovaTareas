import { getDb } from '../../../../../lib/db.js';
import { getUser } from '../../../../../lib/auth.js';

export const PATCH = async ({ request, params }) => {
  const user = await getUser(request);
  if (!user) return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401 });

  const db = getDb();
  const sub = await db.prepare(`
    SELECT s.* FROM subtasks s
    JOIN tasks t ON t.id=s.task_id
    WHERE s.id=? AND s.task_id=? AND t.user_id=?
  `).get(params.subId, params.id, user.userId);

  if (!sub) return new Response(JSON.stringify({ error: 'No encontrado' }), { status: 404 });

  await db.prepare('UPDATE subtasks SET done=? WHERE id=? AND task_id=?')
    .run(sub.done ? 0 : 1, params.subId, params.id);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
