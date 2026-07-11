export const prerender = false;

import bcrypt from 'bcryptjs';
import { db } from '../../lib/db.js';

const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;
// Mínimo 8 caracteres, al menos una letra y un número
const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/;

export async function POST({ request }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON inválido' }, 400); }

  const { full_name, email, telefono, password, user_type, q1_index, q1_answer, q2_index, q2_answer } = body ?? {};

  // ── Validaciones ──────────────────────────────────────────────────────────
  if (!full_name?.trim() || !email?.trim() || !telefono?.trim() || !password || !user_type) {
    return json({ error: 'Todos los campos obligatorios deben completarse.' }, 400);
  }

  if (q1_index === undefined || !q1_answer?.trim() || q2_index === undefined || !q2_answer?.trim()) {
    return json({ error: 'Debes responder las 2 preguntas de seguridad.' }, 400);
  }

  if (q1_index === q2_index) {
    return json({ error: 'Las dos preguntas de seguridad deben ser diferentes.' }, 400);
  }

  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRx.test(email.trim())) {
    return json({ error: 'El correo electrónico no es válido.' }, 400);
  }

  if (!PHONE_REGEX.test(telefono.trim())) {
    return json({ error: 'Formato de teléfono inválido. Usa el formato internacional, ej: +50312345678.' }, 400);
  }

  if (!PASSWORD_REGEX.test(password)) {
    return json({ error: 'La contraseña debe tener mínimo 8 caracteres, incluir letras y números.' }, 400);
  }

  if (!['estudiante', 'empleado', 'comun'].includes(user_type)) {
    return json({ error: 'Tipo de usuario inválido.' }, 400);
  }

  // ── Unicidad del correo ───────────────────────────────────────────────────
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) {
    return json({ error: 'Ya existe una cuenta con ese correo electrónico.' }, 409);
  }

  try {
    const hash = await bcrypt.hash(password, 10);

    // Usar el nombre completo como username visible
    const username = full_name.trim();

    const result = db.prepare(`
      INSERT INTO users (username, full_name, email, password_hash, telefono, user_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(username, full_name.trim(), email.toLowerCase().trim(), hash, telefono.trim(), user_type);

    const userId = result.lastInsertRowid;

    // Guardar preguntas de seguridad
    db.prepare(`
      INSERT INTO security_questions (user_id, q1_index, q1_answer, q2_index, q2_answer)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, Number(q1_index), q1_answer.toLowerCase().trim(), Number(q2_index), q2_answer.toLowerCase().trim());

    return json({ ok: true }, 201);
  } catch (err) {
    console.error('[register]', err);
    return json({ error: 'Error interno del servidor.' }, 500);
  }
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}