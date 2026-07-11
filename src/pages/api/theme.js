import { getDb } from '../../lib/db.js';
import { getUser } from '../../lib/auth.js';

export const POST = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401 });

  const { theme } = await request.json();
  const db = getDb();
  db.prepare('UPDATE users SET theme=? WHERE id=?').run(theme, user.userId);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
