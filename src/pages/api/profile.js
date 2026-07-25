export const prerender = false;

import bcrypt from 'bcryptjs';
import { getDb } from '../../lib/db.js';
import { getUser } from '../../lib/auth.js';
import { validateAvatarFile } from '../../lib/avatarValidation.js';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;
const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/;

// GET: datos del perfil
export const GET = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const db = getDb();
  const u = await db.prepare('SELECT id, full_name, email, telefono, user_type, avatar_url, telegram_chat_id, theme FROM users WHERE id = $1').get(user.userId);
  if (!u) return json({ error: 'Usuario no encontrado' }, 404);

  return json(u, 200);
};

// PUT: actualizar perfil
export const PUT = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const contentType = request.headers.get('content-type') || '';

  // ── Avatar (multipart) ────────────────────────────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const validation = await validateAvatarFile(formData.get('avatar'));
    if (validation.error) return json({ error: validation.error }, 400);

    // En desarrollo Astro sirve `public/`; en producción sirve `dist/client`.
    // Escribir siempre en `public/` dejaba los avatares subidos en el servidor
    // inaccesibles: la URL guardada devolvía 404. AVATAR_UPLOAD_DIR permite
    // además apuntar a un volumen persistente.
    const uploadsDir = process.env.AVATAR_UPLOAD_DIR
      ? path.resolve(process.env.AVATAR_UPLOAD_DIR)
      : path.join(
          process.cwd(),
          process.env.NODE_ENV === 'production' ? 'dist/client' : 'public',
          'avatars',
        );
    mkdirSync(uploadsDir, { recursive: true });

    const filename = `avatar_${user.userId}_${Date.now()}.${validation.extension}`;
    const filepath = path.join(uploadsDir, filename);
    writeFileSync(filepath, validation.buffer, { flag: 'wx' });

    const db = getDb();
    const avatarUrl = `/avatars/${filename}`;
    await db.prepare('UPDATE users SET avatar_url = $1 WHERE id = $2').run(avatarUrl, user.userId);

    return json({ ok: true, avatar_url: avatarUrl }, 200);
  }

  // ── Datos del perfil (JSON) ────────────────────────────────────────────────
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON inválido.' }, 400); }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'El cuerpo debe ser un objeto JSON.' }, 400);
  }

  const { full_name, telefono, user_type, password } = body;
  const db = getDb();
  const updates = [];
  const params = [];

  // Cada valor se numera a partir de su posición real en `params`. No se lleva
  // un contador aparte: hay asignaciones que no consumen ningún parámetro
  // (session_version) y otras que consumen dos, y un contador manual las
  // desalinearía escribiendo en la columna equivocada sin lanzar ningún error.
  const placeholder = value => {
    params.push(value);
    return `$${params.length}`;
  };

  if (full_name !== undefined) {
    if (typeof full_name !== 'string') return json({ error: 'El nombre debe ser texto.' }, 400);
    if (!full_name.trim() || full_name.trim().length < 2) return json({ error: 'El nombre debe tener al menos 2 caracteres.' }, 400);
    if (full_name.trim().length > 120) return json({ error: 'El nombre no debe superar 120 caracteres.' }, 400);
    updates.push(`full_name = ${placeholder(full_name.trim())}`);
    updates.push(`username = ${placeholder(full_name.trim())}`);
  }

  if (telefono !== undefined) {
    if (typeof telefono !== 'string') return json({ error: 'El teléfono debe ser texto.' }, 400);
    if (!PHONE_REGEX.test(telefono.trim())) return json({ error: 'Formato de teléfono inválido.' }, 400);
    updates.push(`telefono = ${placeholder(telefono.trim())}`);
  }

  if (user_type !== undefined) {
    if (typeof user_type !== 'string') return json({ error: 'Tipo de usuario inválido.' }, 400);
    if (!['estudiante', 'empleado', 'comun'].includes(user_type)) return json({ error: 'Tipo de usuario inválido.' }, 400);
    updates.push(`user_type = ${placeholder(user_type)}`);
  }

  if (password !== undefined) {
    if (typeof password !== 'string') return json({ error: 'La contraseña debe ser texto.' }, 400);
    if (!PASSWORD_REGEX.test(password)) return json({ error: 'La contraseña debe tener mínimo 8 caracteres, incluir letras y números.' }, 400);
    const hash = await bcrypt.hash(password, 10);
    updates.push(`password_hash = ${placeholder(hash)}`);
    updates.push('session_version = session_version + 1');
  }

  if (updates.length === 0) return json({ error: 'Nada que actualizar.' }, 400);

  const idPlaceholder = placeholder(user.userId);
  await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ${idPlaceholder}`).run(...params);

  return json({ ok: true, reauthenticate: password !== undefined }, 200);
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}
