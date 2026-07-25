export const prerender = false;

import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../../../lib/db.js';
import {
  consumeRateLimit,
  getClientIp,
  resetRateLimit,
  safeEqualStrings,
} from '../../../lib/security.js';

const SECURITY_QUESTIONS = [
  '¿Cuál fue el nombre de tu primera mascota?',
  '¿En qué ciudad o pueblo nació tu madre?',
  '¿Cuál era el apellido de tu maestro favorito de la escuela?',
  '¿Cuál fue el nombre de la primera escuela a la que asististe?',
  '¿Cuál era el apodo que tenía tu familia para ti cuando eras niño?',
  '¿Cuál fue el nombre de tu mejor amigo de la infancia?',
  '¿Cuál fue el primer videojuego que recuerdas haber jugado?',
  '¿Cuál era el nombre de la calle donde viviste durante tu infancia?',
  '¿Cuál fue el primer concierto o evento al que asististe?',
  '¿Cuál era el nombre de tu personaje favorito cuando eras niño?',
];

const MAX_FAILED_ANSWERS = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const DUMMY_ANSWER_HASH = '$2a$10$tlsd66MMP/MEMBxqiZ38OuDtrpEKn/muoJxToPm4z1OiCzsWvDkYC';
const fakeRecoveryAttempts = new Map();

// Los tokens se guardan hasheados en PostgreSQL, no en memoria del proceso.
// Antes, cualquier reinicio —incluido un despliegue— invalidaba una
// recuperación en curso, y con más de una instancia fallaba de forma aleatoria.
// Guardar el hash evita además que un volcado de la base permita usarlos.
function hashRecoveryToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function createRecoveryToken(db, userId) {
  const token = randomBytes(32).toString('base64url');
  await db.prepare(`
    INSERT INTO recovery_tokens (token_hash, user_id, expires_at)
    VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 millisecond'))
  `).run(hashRecoveryToken(token), userId, TOKEN_TTL_MS);
  return token;
}

/** Consume el token si es válido. Devuelve el usuario o null. Es de un solo uso. */
async function consumeRecoveryToken(db, token) {
  const row = await db.prepare(`
    UPDATE recovery_tokens
    SET used_at = NOW()
    WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
    RETURNING user_id
  `).get(hashRecoveryToken(token));
  return row?.user_id ?? null;
}

export const POST = async ({ request }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'El cuerpo debe ser un objeto JSON.' }, 400);
  }

  const { action, email, answer, question_index, token, new_password } = body;
  const ip = getClientIp(request);
  const ipLimit = await consumeRateLimit('recovery-ip', ip, 40, LOCK_WINDOW_MS);
  if (!ipLimit.allowed) return rateLimitResponse(ipLimit.retryAfterSeconds);

  const db = getDb();
  await removeExpiredTokens(db);

  if (action === 'get_question') {
    if (typeof email !== 'string' || !email || email.length > 254) {
      return json({ error: 'Correo requerido.' }, 400);
    }

    const normalizedEmail = email.toLowerCase().trim();
    const emailLimit = await consumeRateLimit('recovery-email', normalizedEmail, 15, LOCK_WINDOW_MS);
    if (!emailLimit.allowed) return rateLimitResponse(emailLimit.retryAfterSeconds);

    const user = await db.prepare('SELECT id FROM users WHERE email = $1').get(normalizedEmail);

    const security = user ? await db.prepare(
      'SELECT * FROM security_questions WHERE user_id = $1'
    ).get(user.id) : null;
    if (!user || !security) {
      const fake = getFakeRecoveryState(normalizedEmail);
      if (fake.locked) return rateLimitResponse(fake.retryAfterSeconds);
      return fakeQuestionResponse(normalizedEmail, fake.attempts);
    }

    const lock = await refreshOrReadLock(db, security);
    if (lock.locked) return rateLimitResponse(lock.retryAfterSeconds);

    const currentQuestionIndex = questionForAttempt(security, lock.attempts);
    return json({
      ok: true,
      question: SECURITY_QUESTIONS[currentQuestionIndex],
      question_index: currentQuestionIndex,
      attempts_left: MAX_FAILED_ANSWERS - lock.attempts,
    }, 200);
  }

  if (action === 'check_answer') {
    if (typeof email !== 'string' || !email || email.length > 254 ||
        typeof answer !== 'string' || answer.length > 200 ||
        question_index === undefined) {
      return json({ error: 'Datos incompletos.' }, 400);
    }

    const normalizedEmail = email.toLowerCase().trim();
    const emailLimit = await consumeRateLimit('recovery-answer', normalizedEmail, 10, LOCK_WINDOW_MS);
    if (!emailLimit.allowed) return rateLimitResponse(emailLimit.retryAfterSeconds);

    const user = await db.prepare('SELECT id FROM users WHERE email = $1').get(normalizedEmail);

    const security = user ? await db.prepare(
      'SELECT * FROM security_questions WHERE user_id = $1'
    ).get(user.id) : null;
    if (!user || !security) {
      await bcrypt.compare(answer.toLowerCase().trim(), DUMMY_ANSWER_HASH);
      return handleFakeAnswer(normalizedEmail);
    }

    const lock = await refreshOrReadLock(db, security);
    if (lock.locked) return rateLimitResponse(lock.retryAfterSeconds);

    const expectedQuestion = questionForAttempt(security, lock.attempts);
    if (Number(question_index) !== expectedQuestion) {
      return json({ error: 'La pregunta ya no es válida. Solicítala nuevamente.' }, 400);
    }

    const storedAnswer = expectedQuestion === security.q1_index
      ? security.q1_answer
      : security.q2_answer;
    const normalizedAnswer = answer.toLowerCase().trim();
    const isCorrect = await verifyStoredAnswer(normalizedAnswer, storedAnswer);

    if (!isCorrect) {
      const nextAttempts = lock.attempts + 1;
      await db.prepare(`
        UPDATE security_questions
        SET recovery_attempts = $1, last_attempt_at = NOW()
        WHERE user_id = $2
      `).run(nextAttempts, user.id);

      if (nextAttempts >= MAX_FAILED_ANSWERS) {
        return rateLimitResponse(Math.ceil(LOCK_WINDOW_MS / 1000));
      }

      const nextQuestion = questionForAttempt(security, nextAttempts);
      return json({
        ok: false,
        next_question: SECURITY_QUESTIONS[nextQuestion],
        next_question_index: nextQuestion,
        attempts_left: MAX_FAILED_ANSWERS - nextAttempts,
        message: 'Respuesta incorrecta. Intenta con la otra pregunta.',
      }, 200);
    }

    const recoveryToken = await createRecoveryToken(db, user.id);

    await db.prepare(`
      UPDATE security_questions
      SET recovery_attempts = 0, last_attempt_at = NULL
      WHERE user_id = $1
    `).run(user.id);
    await resetRateLimit('recovery-answer', normalizedEmail);

    return json({ ok: true, recovery_token: recoveryToken }, 200);
  }

  if (action === 'reset_password') {
    if (typeof token !== 'string' || !token || token.length > 100 ||
        typeof new_password !== 'string' || !new_password || new_password.length > 128) {
      return json({ error: 'Token y nueva contraseña requeridos.' }, 400);
    }

    const recoveredUserId = await consumeRecoveryToken(db, token);
    if (!recoveredUserId) {
      return json({ error: 'El enlace de recuperación expiró. Intenta de nuevo.' }, 400);
    }

    if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(new_password)) {
      return json({ error: 'La contraseña debe tener mínimo 8 caracteres, incluir letras y números.' }, 400);
    }

    const hash = await bcrypt.hash(new_password, 10);
    await db.prepare(`
      UPDATE users
      SET password_hash = $1, session_version = session_version + 1
      WHERE id = $2
    `).run(hash, recoveredUserId);

    return json({ ok: true, message: 'Contraseña restablecida exitosamente.' }, 200);
  }

  return json({ error: 'Acción no válida.' }, 400);
};

function questionForAttempt(security, attempts) {
  return attempts % 2 === 0 ? security.q1_index : security.q2_index;
}

function fakeQuestionIndexes(email) {
  const first = createHash('sha256').update(email).digest()[0] % SECURITY_QUESTIONS.length;
  return [first, (first + 5) % SECURITY_QUESTIONS.length];
}

function fakeQuestionForAttempt(email, attempts) {
  const indexes = fakeQuestionIndexes(email);
  return indexes[attempts % indexes.length];
}

function getFakeRecoveryState(email) {
  const current = fakeRecoveryAttempts.get(email);
  if (!current) return { locked: false, attempts: 0 };

  const elapsed = Date.now() - current.lastAttemptAt;
  if (elapsed >= LOCK_WINDOW_MS) {
    fakeRecoveryAttempts.delete(email);
    return { locked: false, attempts: 0 };
  }
  if (current.attempts < MAX_FAILED_ANSWERS) {
    return { locked: false, attempts: current.attempts };
  }
  return {
    locked: true,
    attempts: current.attempts,
    retryAfterSeconds: Math.ceil((LOCK_WINDOW_MS - elapsed) / 1000),
  };
}

function fakeQuestionResponse(email, attempts) {
  const questionIndex = fakeQuestionForAttempt(email, attempts);
  return json({
    ok: true,
    question: SECURITY_QUESTIONS[questionIndex],
    question_index: questionIndex,
    attempts_left: MAX_FAILED_ANSWERS - attempts,
  }, 200);
}

function handleFakeAnswer(email) {
  const current = getFakeRecoveryState(email);
  if (current.locked) return rateLimitResponse(current.retryAfterSeconds);

  const attempts = current.attempts + 1;
  fakeRecoveryAttempts.set(email, {
    attempts,
    lastAttemptAt: Date.now(),
  });
  if (attempts >= MAX_FAILED_ANSWERS) {
    return rateLimitResponse(Math.ceil(LOCK_WINDOW_MS / 1000));
  }

  const nextQuestion = fakeQuestionForAttempt(email, attempts);
  return json({
    ok: false,
    next_question: SECURITY_QUESTIONS[nextQuestion],
    next_question_index: nextQuestion,
    attempts_left: MAX_FAILED_ANSWERS - attempts,
    message: 'Respuesta incorrecta. Intenta con la otra pregunta.',
  }, 200);
}

async function refreshOrReadLock(db, security) {
  const attempts = Number(security.recovery_attempts || 0);
  if (attempts < MAX_FAILED_ANSWERS) return { locked: false, attempts };

  const lastAttempt = Number(security.last_attempt_at || 0);
  const elapsed = Date.now() - lastAttempt;
  if (elapsed >= LOCK_WINDOW_MS) {
    await db.prepare(`
      UPDATE security_questions
      SET recovery_attempts = 0, last_attempt_at = NULL
      WHERE user_id = $1
    `).run(security.user_id);
    return { locked: false, attempts: 0 };
  }

  return {
    locked: true,
    attempts,
    retryAfterSeconds: Math.ceil((LOCK_WINDOW_MS - elapsed) / 1000),
  };
}

async function verifyStoredAnswer(candidate, stored) {
  if (typeof stored !== 'string') return false;
  if (/^\$2[aby]\$/.test(stored)) return bcrypt.compare(candidate, stored);
  return safeEqualStrings(candidate, stored.toLowerCase().trim());
}

/**
 * Los tokens caducados se descartan por su columna `expires_at`, así que basta
 * con borrarlos de vez en cuando para que la tabla no crezca. `fakeRecoveryAttempts`
 * sigue en memoria a propósito: solo sirve para que las cuentas inexistentes
 * respondan igual que las reales, y perderlo en un reinicio no afecta a nadie.
 */
async function removeExpiredTokens(db) {
  await db.prepare(
    "DELETE FROM recovery_tokens WHERE expires_at < NOW() - INTERVAL '1 day'"
  ).run();

  const now = Date.now();
  for (const [email, state] of fakeRecoveryAttempts) {
    if (now - state.lastAttemptAt >= LOCK_WINDOW_MS) {
      fakeRecoveryAttempts.delete(email);
    }
  }
}

function rateLimitResponse(retryAfterSeconds) {
  return json(
    { error: 'Demasiados intentos. Intenta nuevamente más tarde.' },
    429,
    { 'Retry-After': String(retryAfterSeconds) }
  );
}

function json(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
