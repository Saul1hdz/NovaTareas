export const prerender = false;

import bcrypt from 'bcryptjs';
import { getDb } from '../../lib/db.js';
import { getUser } from '../../lib/auth.js';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;
const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/;

// GET: datos del perfil
export const GET = async ({ request }) => {
  const user = await getUser(request);
  if (!user) return json({ error: 'No autenticado' }, 401);

  const db = getDb();
  const u = db.prepare('SELECT id, full_name, email, telefono, user_type, avatar_url, telegram_chat_id, theme FROM users WHERE id = ?').get(user.userId);
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
    const file = formData.get('avatar');

    if (!file || typeof file === 'string') return json({ error: 'Archivo no válido.' }, 400);

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
      return json({ error: 'Solo se permiten imágenes JPG, PNG, WEBP o GIF.' }, 400);
    }

    if (file.size > 2 * 1024 * 1024) {
      return json({ error: 'La imagen no debe superar 2MB.' }, 400);
    }

    const uploadsDir = path.join(process.cwd(), 'public', 'avatars');
    mkdirSync(uploadsDir, { recursive: true });

    const filename = `avatar_${user.userId}_${Date.now()}.${ext}`;
    const filepath = path.join(uploadsDir, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(filepath, buffer);

    const db = getDb();
    const avatarUrl = `/avatars/${filename}`;
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, user.userId);

    return json({ ok: true, avatar_url: avatarUrl }, 200);
  }

  // ── Datos del perfil (JSON) ────────────────────────────────────────────────
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON inválido.' }, 400); }

  const { full_name, telefono, user_type, password } = body ?? {};
  const db = getDb();
  const updates = [];
  const params = [];

  if (full_name !== undefined) {
    if (!full_name.trim() || full_name.trim().length < 2) return json({ error: 'El nombre debe tener al menos 2 caracteres.' }, 400);
    updates.push('full_name = ?', 'username = ?');
    params.push(full_name.trim(), full_name.trim());
  }

  if (telefono !== undefined) {
    if (!PHONE_REGEX.test(telefono.trim())) return json({ error: 'Formato de teléfono inválido.' }, 400);
    updates.push('telefono = ?');
    params.push(telefono.trim());
  }

  if (user_type !== undefined) {
    if (!['estudiante', 'empleado', 'comun'].includes(user_type)) return json({ error: 'Tipo de usuario inválido.' }, 400);
    updates.push('user_type = ?');
    params.push(user_type);
  }

  if (password !== undefined) {
    if (!PASSWORD_REGEX.test(password)) return json({ error: 'La contraseña debe tener mínimo 8 caracteres, incluir letras y números.' }, 400);
    const hash = await bcrypt.hash(password, 10);
    updates.push('password_hash = ?');
    params.push(hash);
  }

  if (updates.length === 0) return json({ error: 'Nada que actualizar.' }, 400);

  params.push(user.userId);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  return json({ ok: true }, 200);
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}