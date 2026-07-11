export const prerender = false;

import { getDb } from '../../lib/db.js';
import { verifyPassword, createToken } from '../../lib/auth.js';

export const POST = async ({ request }) => {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON inválido' }, 400); }

  const { email, password } = body ?? {};

  if (!email || !password) {
    return json({ error: 'Correo y contraseña son requeridos.' }, 400);
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());

  if (!user) return json({ error: 'Credenciales inválidas' }, 401);

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return json({ error: 'Credenciales inválidas' }, 401);

  const token = await createToken(user.id, user.username);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Set-Cookie': `token=${token}; Path=/; HttpOnly; Max-Age=604800` }
  });
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}