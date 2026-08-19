export const prerender = false;

import bcrypt from 'bcryptjs';
import { getDb, withTransaction } from '../../lib/db.js';
import { createSessionCookie, createToken } from '../../lib/auth.js';
import {
  consumeRateLimit,
  getClientIp,
  safeErrorSummary,
} from '../../lib/security.js';
import {
  createEmailVerificationToken,
} from '../../lib/emailVerification.js';
import {
  emailVerificationRequired,
  sendVerificationEmail,
  smtpConfigured,
} from '../../lib/mailer.js';

const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;
const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;
const REGISTRATION_ATTEMPTS_PER_IP = 10;

export async function POST({ request }) {
  if (process.env.REGISTRATION_ENABLED !== 'true') {
    return json({ error: 'El registro público está deshabilitado.' }, 403);
  }

  const registrationLimit = await consumeRateLimit(
    'register-ip',
    getClientIp(request),
    REGISTRATION_ATTEMPTS_PER_IP,
    REGISTRATION_WINDOW_MS
  );
  if (!registrationLimit.allowed) {
    return json(
      { error: 'Demasiados intentos de registro. Intenta nuevamente más tarde.' },
      429,
      { 'Retry-After': String(registrationLimit.retryAfterSeconds) }
    );
  }

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
  } = body;

  if ([full_name, email, telefono, password, user_type]
    .some(value => typeof value !== 'string')) {
    return json({ error: 'Los campos de texto no son válidos.' }, 400);
  }
  if (!full_name.trim() || !email.trim() || !telefono.trim() || !password || !user_type) {
    return json({ error: 'Todos los campos obligatorios deben completarse.' }, 400);
  }
  if (full_name.trim().length > 120 || email.trim().length > 254 ||
      telefono.trim().length > 16 || password.length > 128) {
    return json({ error: 'Uno o más campos superan el tamaño permitido.' }, 400);
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
  if (await db.prepare('SELECT id FROM users WHERE email = $1').get(normalizedEmail)) {
    return json({ error: 'Ya existe una cuenta con ese correo electrónico.' }, 409);
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const username = full_name.trim();

    const userId = await withTransaction(async (tx) => {
      const created = await tx.prepare(`
        INSERT INTO users (username, full_name, email, password_hash, telefono, user_type)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `).get(
        username,
        full_name.trim(),
        normalizedEmail,
        passwordHash,
        telefono.trim(),
        user_type
      );

      return created.id;
    }, db);

    const token = await createToken(userId, username, 0);

    // Política de verificación de correo: si está activa, la cuenta nace sin
    // sesión y el usuario debe confirmar su correo antes de entrar.
    if (emailVerificationRequired()) {
      if (!smtpConfigured()) {
        return json(
          { error: 'El registro requiere verificación de correo, pero el envío SMTP no está configurado.' },
          503
        );
      }
      const verifyToken = await createEmailVerificationToken(db, userId);
      const mail = await sendVerificationEmail({
        to: normalizedEmail,
        token: verifyToken,
        name: full_name.trim(),
      });
      if (!mail.sent) {
        // Si el correo no pudo enviarse, no dejar una cuenta huérfana:
        // se revierte el registro para que el usuario pueda reintentar
        // (sin chocar con "Ya existe una cuenta").
        try {
          await withTransaction(async (tx) => {
            await tx.prepare('DELETE FROM email_verification_tokens WHERE user_id = $1').run(userId);
            await tx.prepare('DELETE FROM security_questions WHERE user_id = $1').run(userId);
            await tx.prepare('DELETE FROM users WHERE id = $1').run(userId);
          }, db);
        } catch (cleanupError) {
          console.error('[register] cleanup', safeErrorSummary(cleanupError));
        }
        return json(
          {
            error: 'No se pudo enviar el correo de verificación. Verifica que el correo sea correcto e inténtalo de nuevo.',
            recoverable: true,
          },
          502
        );
      }
      return json({ ok: true, pending_verification: true }, 201);
    }

    return json(
      { ok: true },
      201,
      { 'Set-Cookie': createSessionCookie(token, request) }
    );
  } catch (error) {
    // La comprobación previa del correo no es atómica. Con el índice único de
    // PostgreSQL, dos registros simultáneos hacen que uno llegue hasta aquí:
    // es un conflicto del cliente, no un fallo del servidor.
    if (error?.code === '23505') {
      return json({ error: 'Ya existe una cuenta con ese correo electrónico.' }, 409);
    }
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
