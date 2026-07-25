import { getDb } from '../../lib/db.js';
import { getUser } from '../../lib/auth.js';

export const POST = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const theme = body?.theme;
  if (!['dark', 'light'].includes(theme)) {
    return json({ error: 'Tema inválido' }, 400);
  }

  const db = getDb();
  await db.prepare('UPDATE users SET theme=? WHERE id=?').run(theme, user.userId);
  return json({ ok: true }, 200);
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
