export const prerender = false;

import bcrypt from 'bcryptjs';
import { getDb } from '../../../lib/db.js';

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

// Tokens temporales en memoria: { token: { userId, expires } }
const recoveryTokens = new Map();

function generateToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const POST = async ({ request }) => {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON inválido' }, 400); }

  const { action, email, answer, question_index, token, new_password } = body ?? {};
  const db = getDb();

  // ── Obtener pregunta ──────────────────────────────────────────────────────
  if (action === 'get_question') {
    if (!email) return json({ error: 'Correo requerido.' }, 400);

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) return json({ error: 'No existe una cuenta con ese correo.' }, 404);

    const sq = db.prepare('SELECT * FROM security_questions WHERE user_id = ?').get(user.id);
    if (!sq) return json({ error: 'Esta cuenta no tiene preguntas de seguridad configuradas.' }, 400);

    // Si ya agotó todos los intentos (10 preguntas fallidas), eliminar cuenta
    if (sq.recovery_attempts >= 10) {
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      return json({ error: 'Has fallado todas las preguntas. Tu cuenta ha sido eliminada por seguridad.' }, 403);
    }

    // Determinar qué preguntas ya fueron intentadas y ofrecer la siguiente
    // Usamos recovery_attempts para saber el turno actual
    const attempt = sq.recovery_attempts;
    // Orden de preguntas: primero q1, luego q2, luego el resto en orden
    const questionOrder = buildQuestionOrder(sq.q1_index, sq.q2_index);
    const currentQuestionIndex = questionOrder[attempt % questionOrder.length];

    return json({
      ok: true,
      question: SECURITY_QUESTIONS[currentQuestionIndex],
      question_index: currentQuestionIndex,
      attempts_left: 10 - attempt,
    }, 200);
  }

  // ── Verificar respuesta ───────────────────────────────────────────────────
  if (action === 'check_answer') {
    if (!email || answer === undefined || question_index === undefined) {
      return json({ error: 'Datos incompletos.' }, 400);
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) return json({ error: 'Cuenta no encontrada.' }, 404);

    const sq = db.prepare('SELECT * FROM security_questions WHERE user_id = ?').get(user.id);
    if (!sq) return json({ error: 'Sin preguntas de seguridad.' }, 400);

    if (sq.recovery_attempts >= 10) {
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      return json({ error: 'Cuenta eliminada por demasiados intentos fallidos.' }, 403);
    }

    // Verificar si la respuesta corresponde a q1 o q2
    const isQ1 = sq.q1_index === Number(question_index);
    const isQ2 = sq.q2_index === Number(question_index);
    const correctAnswer = isQ1 ? sq.q1_answer : isQ2 ? sq.q2_answer : null;

    if (!correctAnswer) {
      return json({ error: 'Pregunta no válida para esta cuenta.' }, 400);
    }

    const isCorrect = answer.toLowerCase().trim() === correctAnswer;

    if (!isCorrect) {
      // Incrementar intentos fallidos
      db.prepare('UPDATE security_questions SET recovery_attempts = recovery_attempts + 1, last_attempt_at = ? WHERE user_id = ?')
        .run(Date.now(), user.id);

      const updatedSq = db.prepare('SELECT recovery_attempts FROM security_questions WHERE user_id = ?').get(user.id);

      if (updatedSq.recovery_attempts >= 10) {
        db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
        return json({ error: 'Has fallado todas las preguntas de seguridad. Tu cuenta ha sido eliminada.', deleted: true }, 403);
      }

      // Ofrecer la siguiente pregunta
      const questionOrder = buildQuestionOrder(sq.q1_index, sq.q2_index);
      const nextIndex = questionOrder[updatedSq.recovery_attempts % questionOrder.length];

      return json({
        ok: false,
        next_question: SECURITY_QUESTIONS[nextIndex],
        next_question_index: nextIndex,
        attempts_left: 10 - updatedSq.recovery_attempts,
        message: 'Respuesta incorrecta. Intenta con otra pregunta.',
      }, 200);
    }

    // Respuesta correcta: generar token temporal (válido 15 min)
    const recoveryToken = generateToken();
    recoveryTokens.set(recoveryToken, { userId: user.id, expires: Date.now() + 15 * 60 * 1000 });

    // Resetear intentos
    db.prepare('UPDATE security_questions SET recovery_attempts = 0 WHERE user_id = ?').run(user.id);

    return json({ ok: true, recovery_token: recoveryToken }, 200);
  }

  // ── Restablecer contraseña ────────────────────────────────────────────────
  if (action === 'reset_password') {
    if (!token || !new_password) return json({ error: 'Token y nueva contraseña requeridos.' }, 400);

    const session = recoveryTokens.get(token);
    if (!session || session.expires < Date.now()) {
      recoveryTokens.delete(token);
      return json({ error: 'El enlace de recuperación expiró. Intenta de nuevo.' }, 400);
    }

    const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/;
    if (!PASSWORD_REGEX.test(new_password)) {
      return json({ error: 'La contraseña debe tener mínimo 8 caracteres, incluir letras y números.' }, 400);
    }

    const hash = await bcrypt.hash(new_password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, session.userId);
    recoveryTokens.delete(token);

    return json({ ok: true, message: 'Contraseña restablecida exitosamente.' }, 200);
  }

  return json({ error: 'Acción no válida.' }, 400);
};

function buildQuestionOrder(q1Index, q2Index) {
  // Las primeras 2 son las propias del usuario, luego el resto de las 10
  const own = [q1Index, q2Index];
  const rest = [0,1,2,3,4,5,6,7,8,9].filter(i => i !== q1Index && i !== q2Index);
  return [...own, ...rest];
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}
