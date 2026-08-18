import { describe, expect, it } from 'vitest';
import { POST as register } from '../src/pages/api/register.js';
import { POST as login } from '../src/pages/api/login.js';
import { GET as listTasks, POST as createTask } from '../src/pages/api/tasks.js';
import { PATCH as updateTask } from '../src/pages/api/tasks/[id].js';
import { POST as askAi, buildPrompt } from '../src/pages/api/tasks/[id]/ai.js';
import {
  GET as getFeedback,
  POST as sendFeedback,
} from '../src/pages/api/tasks/[id]/feedback.js';
import { POST as createInvite } from '../src/pages/api/tasks/[id]/invites.js';
import { POST as acceptInvite } from '../src/pages/api/invites/accept.js';
import { archivedFeedbackContext } from '../src/lib/recommendationFeedback.js';
import { validateFeedbackInput } from '../src/lib/taskValidation.js';
import { getDb } from '../src/lib/db.js';

// Valoración de las recomendaciones: el pulgar, el porqué, la regeneración que
// tiene en cuenta ese porqué, y la conservación del comentario al archivar.

const ORIGEN = 'http://127.0.0.1:4321';

function request(path, method, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return new Request(`${ORIGEN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function registerUser(email, name) {
  return register({
    request: request('/api/register', 'POST', {
      full_name: name,
      email,
      telefono: '+50370000000',
      password: 'Clave1234',
      user_type: 'estudiante',
      q1_index: 0,
      q1_answer: 'Luna',
      q2_index: 1,
      q2_answer: 'Santa Ana',
    }),
  });
}

async function cookieFor(email) {
  const response = await login({
    request: request('/api/login', 'POST', { email, password: 'Clave1234' }),
  });
  return response.headers.get('set-cookie')?.split(';')[0];
}

describe('validación de la valoración', () => {
  it('exige el pulgar pero no la explicación', () => {
    expect(validateFeedbackInput({}).error).toMatch(/útil/i);
    expect(validateFeedbackInput({ useful: 'si' }).error).toMatch(/útil/i);
    expect(validateFeedbackInput({ useful: false }).values)
      .toEqual({ useful: false, comment: '', regenerate: false });
  });

  it('recorta el comentario y respeta el tope', () => {
    expect(validateFeedbackInput({ useful: true, comment: '  muy genérica  ' }).values.comment)
      .toBe('muy genérica');
    expect(validateFeedbackInput({ useful: true, comment: 'x'.repeat(2001) }).error)
      .toMatch(/2000/);
  });
});

describe('el prompt incorpora la valoración', () => {
  it('le dice a la IA qué se descartó y por qué', () => {
    const prompt = buildPrompt(
      { title: 'Estudiar redes', priority: 'alta' },
      'estudiante',
      '',
      [{ useful: false, comment: 'ya probé el Pomodoro', recommendation: 'Usa la técnica Pomodoro' }],
    );

    expect(prompt).toContain('POCO ÚTIL');
    expect(prompt).toContain('ya probé el Pomodoro');
    expect(prompt).toContain('Usa la técnica Pomodoro');
    expect(prompt).toMatch(/recomendación DISTINTA/i);
  });

  it('distingue lo aprendido en otras tareas ya archivadas', () => {
    const prompt = buildPrompt(
      { title: 'Preparar informe', priority: 'media' },
      'empleado',
      '',
      [{
        task_title: 'Informe del trimestre pasado',
        useful: false,
        comment: 'los consejos genéricos no me sirven',
        recommendation: 'Divide el trabajo en bloques',
      }],
    );
    expect(prompt).toContain('En «Informe del trimestre pasado»');
  });

  it('no ensucia el prompt cuando no hay valoraciones', () => {
    const prompt = buildPrompt({ title: 'Tarea', priority: 'baja' }, 'comun', '');
    expect(prompt).not.toContain('VALORACIÓN DE TUS RECOMENDACIONES');
  });
});

describe('flujo de valoración sobre la base real', { sequential: true }, () => {
  let duena;
  let otra;
  let tareaId;

  it('crea una tarea con recomendación', async () => {
    expect((await registerUser('valora@example.test', 'Valora Prueba')).status).toBe(201);
    expect((await registerUser('mirona@example.test', 'Mirona Prueba')).status).toBe(201);
    duena = await cookieFor('valora@example.test');
    otra = await cookieFor('mirona@example.test');

    const creada = await createTask({
      request: request('/api/tasks', 'POST', {
        title: 'Preparar examen de redes',
        visibility: 'colaborativa',
      }, duena),
    });
    tareaId = Number((await creada.json()).id);

    const consejo = await askAi({
      request: request(`/api/tasks/${tareaId}/ai`, 'POST', {}, duena),
      params: { id: String(tareaId) },
    });
    expect(consejo.status).toBe(200);
  });

  it('rechaza valorar sin haber pedido consejo', async () => {
    const sinConsejo = await createTask({
      request: request('/api/tasks', 'POST', { title: 'Tarea sin consejo' }, duena),
    });
    const id = Number((await sinConsejo.json()).id);

    const respuesta = await sendFeedback({
      request: request(`/api/tasks/${id}/feedback`, 'POST', { useful: true }, duena),
      params: { id: String(id) },
    });
    expect(respuesta.status).toBe(409);
    expect((await respuesta.json()).error).toMatch(/Consejos/);
  });

  it('guarda el pulgar y la explicación', async () => {
    const respuesta = await sendFeedback({
      request: request(`/api/tasks/${tareaId}/feedback`, 'POST', {
        useful: false,
        comment: 'Es muy genérica, quiero pasos concretos.',
      }, duena),
      params: { id: String(tareaId) },
    });
    expect(respuesta.status).toBe(201);
    const datos = await respuesta.json();
    expect(datos.feedback.useful).toBe(false);
    expect(datos.feedback.comment).toBe('Es muy genérica, quiero pasos concretos.');
  });

  it('volver a valorar corrige la opinión en vez de duplicarla', async () => {
    await sendFeedback({
      request: request(`/api/tasks/${tareaId}/feedback`, 'POST', {
        useful: true,
        comment: 'Releyéndola, sí me sirve.',
      }, duena),
      params: { id: String(tareaId) },
    });

    const filas = await getDb().prepare(
      'SELECT COUNT(*)::int AS total FROM recommendation_feedback WHERE task_id = $1'
    ).get(tareaId);
    expect(filas.total).toBe(1);

    const consulta = await getFeedback({
      request: request(`/api/tasks/${tareaId}/feedback`, 'GET', undefined, duena),
      params: { id: String(tareaId) },
    });
    const datos = await consulta.json();
    expect(datos.current_feedback.useful).toBe(true);
    expect(datos.current_feedback.comment).toBe('Releyéndola, sí me sirve.');
  });

  it('no confunde dos recomendaciones distintas con texto idéntico', async () => {
    const db = getDb();
    const duenaId = (await db.prepare('SELECT id FROM users WHERE email = $1')
      .get('valora@example.test')).id;
    const duplicada = await createTask({
      request: request('/api/tasks', 'POST', { title: 'Tarea con consejos iguales' }, duena),
    });
    const id = Number((await duplicada.json()).id);
    const snapshot = JSON.stringify({ title: 'Tarea con consejos iguales' });
    const primera = await db.prepare(`
      INSERT INTO task_recommendations
        (task_id, user_id, source, input_snapshot, recommendation, created_at)
      VALUES ($1, $2, 'rules', $3::jsonb, 'Consejo idéntico', NOW() - INTERVAL '1 minute')
      RETURNING id
    `).get(id, duenaId, snapshot);
    await db.prepare(`
      INSERT INTO recommendation_feedback
        (recommendation_id, task_id, user_id, useful, comment)
      VALUES ($1, $2, $3, true, 'Valoración de la primera fila')
    `).run(primera.id, id, duenaId);
    const segunda = await db.prepare(`
      INSERT INTO task_recommendations
        (task_id, user_id, source, input_snapshot, recommendation, created_at)
      VALUES ($1, $2, 'rules', $3::jsonb, 'Consejo idéntico', NOW())
      RETURNING id
    `).get(id, duenaId, snapshot);

    const consulta = await getFeedback({
      request: request(`/api/tasks/${id}/feedback`, 'GET', undefined, duena),
      params: { id: String(id) },
    });
    const datos = await consulta.json();
    expect(datos.recommendation.id).toBe(segunda.id);
    expect(datos.current_feedback).toBeNull();
    expect(datos.history).toHaveLength(1);
    expect(datos.history[0].recommendation_id).toBe(primera.id);
  });

  it('la base rechaza feedback ligado a otra tarea', async () => {
    const db = getDb();
    const duenaId = (await db.prepare('SELECT id FROM users WHERE email = $1')
      .get('valora@example.test')).id;
    const tareaA = await createTask({
      request: request('/api/tasks', 'POST', { title: 'Tarea A de integridad' }, duena),
    });
    const tareaB = await createTask({
      request: request('/api/tasks', 'POST', { title: 'Tarea B de integridad' }, duena),
    });
    const idA = Number((await tareaA.json()).id);
    const idB = Number((await tareaB.json()).id);
    const recomendacion = await db.prepare(`
      INSERT INTO task_recommendations
        (task_id, user_id, source, input_snapshot, recommendation)
      VALUES ($1, $2, 'rules', '{}'::jsonb, 'Consejo para la tarea A')
      RETURNING id
    `).get(idA, duenaId);

    await expect(db.prepare(`
      INSERT INTO recommendation_feedback
        (recommendation_id, task_id, user_id, useful, comment)
      VALUES ($1, $2, $3, true, '')
    `).run(recomendacion.id, idB, duenaId)).rejects.toThrow(/foreign key|constraint/i);
  });

  it('genera una recomendación nueva cuando se pide', async () => {
    const antes = await getDb().prepare(
      'SELECT COUNT(*)::int AS total FROM task_recommendations WHERE task_id = $1'
    ).get(tareaId);

    const respuesta = await sendFeedback({
      request: request(`/api/tasks/${tareaId}/feedback`, 'POST', {
        useful: false,
        comment: 'Necesito un primer paso concreto.',
        regenerate: true,
      }, duena),
      params: { id: String(tareaId) },
    });
    expect(respuesta.status).toBe(201);
    const datos = await respuesta.json();
    expect(datos.recommendation?.text).toBeTruthy();

    const despues = await getDb().prepare(
      'SELECT COUNT(*)::int AS total FROM task_recommendations WHERE task_id = $1'
    ).get(tareaId);
    expect(despues.total).toBe(antes.total + 1);
  });

  it('la valoración de una persona no la ve otra', async () => {
    // La invitada entra en la tarea compartida, pero la valoración es de quien
    // la escribió: cada quien opina sobre la recomendación que pidió.
    const invitacion = await createInvite({
      request: request(`/api/tasks/${tareaId}/invites`, 'POST', { role: 'editor' }, duena),
      params: { id: String(tareaId) },
    });
    const token = (await invitacion.json()).url.split('/unirse/')[1];
    await acceptInvite({
      request: request('/api/invites/accept', 'POST', { token }, otra),
    });

    const consulta = await getFeedback({
      request: request(`/api/tasks/${tareaId}/feedback`, 'GET', undefined, otra),
      params: { id: String(tareaId) },
    });
    const datos = await consulta.json();
    expect(datos.history).toHaveLength(0);
    expect(datos.current_feedback).toBeNull();
    expect(JSON.stringify(datos)).not.toContain('primer paso concreto');
  });

  it('conserva el comentario al archivar y lo ofrece como contexto futuro', async () => {
    const archivada = await updateTask({
      request: request(`/api/tasks/${tareaId}`, 'PATCH', { archived: true }, duena),
      params: { id: String(tareaId) },
    });
    expect(archivada.status).toBe(200);

    const db = getDb();
    const duenaId = (await db.prepare('SELECT id FROM users WHERE email = $1')
      .get('valora@example.test')).id;

    // Sobrevive al archivado: es lo que permite aprender de una tarea cerrada.
    const guardadas = await db.prepare(
      'SELECT COUNT(*)::int AS total FROM recommendation_feedback WHERE task_id = $1'
    ).get(tareaId);
    expect(guardadas.total).toBeGreaterThan(0);

    const contexto = await archivedFeedbackContext(db, duenaId);
    expect(contexto.length).toBeGreaterThan(0);
    expect(contexto[0].task_title).toBe('Preparar examen de redes');
    expect(contexto[0].comment).toContain('primer paso concreto');
  });

  it('el listado deja de traer la tarea archivada pero la valoración sigue en pie', async () => {
    const listado = await listTasks({
      request: request('/api/tasks', 'GET', undefined, duena),
    });
    const activas = (await listado.json()).map(t => t.id);
    expect(activas).not.toContain(tareaId);
  });
});
