export const prerender = false;

import bcrypt from 'bcryptjs';
import { getDb, withTransaction } from '../../lib/db.js';
import { createSessionCookie, createToken } from '../../lib/auth.js';
import { safeErrorSummary } from '../../lib/security.js';

const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;
const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'El cuerpo debe ser un objeto JSON.' }, 400);
  }

  const {
    full_name,
    email,
    telefono,
    password,
    user_type,
    q1_index,
    q1_answer,
    q2_index,
    q2_answer,
  } = body;

  if ([full_name, email, telefono, password, user_type, q1_answer, q2_answer]
    .some(value => typeof value !== 'string')) {
    return json({ error: 'Los campos de texto no son válidos.' }, 400);
  }
  if (!full_name.trim() || !email.trim() || !telefono.trim() || !password || !user_type) {
    return json({ error: 'Todos los campos obligatorios deben completarse.' }, 400);
  }
  if (q1_index === undefined || !q1_answer.trim() ||
      q2_index === undefined || !q2_answer.trim()) {
    return json({ error: 'Debes responder las 2 preguntas de seguridad.' }, 400);
  }
  if (full_name.trim().length > 120 || email.trim().length > 254 ||
      telefono.trim().length > 16 || password.length > 128 ||
      q1_answer.trim().length > 200 || q2_answer.trim().length > 200) {
    return json({ error: 'Uno o más campos superan el tamaño permitido.' }, 400);
  }

  const q1Index = Number(q1_index);
  const q2Index = Number(q2_index);
  if (!Number.isInteger(q1Index) || !Number.isInteger(q2Index) ||
      q1Index < 0 || q1Index > 9 || q2Index < 0 || q2Index > 9 ||
      q1Index === q2Index) {
    return json({ error: 'Las preguntas de seguridad no son válidas.' }, 400);
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (!EMAIL_REGEX.test(normalizedEmail)) {
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

  const db = getDb();
  if (await db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail)) {
    return json({ error: 'Ya existe una cuenta con ese correo electrónico.' }, 409);
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const q1Hash = await bcrypt.hash(q1_answer.toLowerCase().trim(), 10);
    const q2Hash = await bcrypt.hash(q2_answer.toLowerCase().trim(), 10);
    const username = full_name.trim();

    const userId = Number(await withTransaction(async (tx) => {
      const result = await tx.prepare(`
        INSERT INTO users (username, full_name, email, password_hash, telefono, user_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        username,
        full_name.trim(),
        normalizedEmail,
        passwordHash,
        telefono.trim(),
        user_type
      );

      await tx.prepare(`
        INSERT INTO security_questions (user_id, q1_index, q1_answer, q2_index, q2_answer)
        VALUES (?, ?, ?, ?, ?)
      `).run(result.lastInsertRowid, q1Index, q1Hash, q2Index, q2Hash);
      return result.lastInsertRowid;
    }, db));

    const token = await createToken(userId, username, 0);
    return json(
      { ok: true },
      201,
      { 'Set-Cookie': createSessionCookie(token, request) }
    );
  } catch (error) {
    console.error('[register]', safeErrorSummary(error));
    return json({ error: 'Error interno del servidor.' }, 500);
  }
}

function json(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
